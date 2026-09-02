// GraphAnalyzer (TASK-117, DES-131/121/122/123/127/129, ARCH-079): the async, single-flight,
// self-retrying analyzer that turns a registered workflow script into an ASCII diagram via the
// configured LLM provider, gated through diagram-gate.ts's allowlist before it is ever persisted
// or served (ARCH-080).
import { gateDiagram, type GateDiagramResult } from './diagram-gate.js';
import { parseMeta, parseWorkflowSkeleton } from './workflow-meta.js';
import { isKnownAlias } from './params/contract.js';
import type { Clock } from './clock.js';
import type { AgentOpts } from './types.js';
import type { GatewayClient, GatewayResult } from './gateway/client.js';
import type { DiagramRow, PersistedDiagramNoteCode, WorkflowCatalog } from './workflow-catalog.js';
import { describeTriggerBindings, getTriggerBindings, type TriggerBinding, type TriggerPorts } from './trigger-bindings.js';

// DES-123: the full, closed 10-value note vocabulary. DISABLED/NOT_GENERATED are synthesized at
// READ time only (workflow-view.ts's projectWorkflowDescribe) and are never persisted — the store's
// own `PersistedDiagramNoteCode` (workflow-catalog.ts) enumerates the other eight.
export type DiagramNoteCode =
  | 'TIMEOUT' | 'PROVIDER_UNREACHABLE' | 'PROVIDER_ERROR' // GatewayResult ok:false reasons
  | 'GATE_REJECTED_CONTENT' | 'GATE_REJECTED_SHAPE' // ARCH-080
  | 'QUEUE_FULL' | 'RETRIES_EXHAUSTED' | 'MODEL_UNMAPPED' // analyzer-side
  | 'DISABLED' | 'NOT_GENERATED'; // READ-SYNTHESIZED ONLY

/** DES-123: the total mapping from every failure shape this analyzer can produce to its persisted
 *  note code. Never called on success. */
export function noteCodeFor(
  r:
    | Extract<GatewayResult, { ok: false }>
    | { kind: 'gate'; reason: 'GATE_REJECTED_CONTENT' | 'GATE_REJECTED_SHAPE' }
    | { kind: 'queue' }
    | { kind: 'exhausted' }
    | { kind: 'config'; reason: 'model_unmapped' },
): Exclude<DiagramNoteCode, 'DISABLED' | 'NOT_GENERATED'> {
  if ('kind' in r) {
    switch (r.kind) {
      case 'gate': return r.reason;
      case 'queue': return 'QUEUE_FULL';
      case 'exhausted': return 'RETRIES_EXHAUSTED';
      case 'config': return 'MODEL_UNMAPPED';
    }
  }
  switch (r.reason) {
    case 'timeout': return 'TIMEOUT';
    case 'unreachable': return 'PROVIDER_UNREACHABLE';
    case 'terminal': return 'PROVIDER_ERROR';
  }
}

// DES-123: engine-authored, user-facing text for every code — GATE_REJECTED_SHAPE's wording covers
// BOTH causes it folds together (an out-of-vocabulary shape AND a provider that returned nothing),
// so it is worded as an outcome, never as "violated the vocabulary".
const NOTE_TEXT: Record<DiagramNoteCode, string> = {
  TIMEOUT: 'The diagram generator timed out.',
  PROVIDER_UNREACHABLE: "The diagram generator's provider was unreachable.",
  PROVIDER_ERROR: "The diagram generator's provider returned an error.",
  GATE_REJECTED_CONTENT: 'The diagram generator produced content outside the allowed vocabulary.',
  GATE_REJECTED_SHAPE: 'The analyzer did not return a valid diagram.',
  QUEUE_FULL: 'The diagram queue is full; try regenerating again shortly.',
  RETRIES_EXHAUSTED: 'The diagram generator exhausted its retries.',
  MODEL_UNMAPPED: 'The configured diagram model is not a known alias.',
  DISABLED: 'Diagram generation is disabled for this deployment.',
  NOT_GENERATED: 'No diagram has been generated for this version yet.',
};

export function noteTextFor(code: DiagramNoteCode): string {
  return NOTE_TEXT[code];
}

/** DES-122: the analyzer session's own scratch `cwd`, a subdirectory of the operator-configured
 *  `workRoot`. TWO importers, and they must never drift: `main.ts` creates it and passes it as the
 *  SDK gateway's `cwd`, `server.ts` names it in the `graph-analyzer effective tools=… jail=…` boot
 *  line — a re-typed literal at either site would make that line describe a directory nothing uses
 *  (same one-declaration/two-importers rule as `DEFAULT_CEILINGS`, v21 P6-5). */
export const ANALYZER_SCRATCH_SUBDIR = '.graph-analyzer-scratch';

export interface GraphAnalyzerConfig {
  enabled: boolean;
  model: string;
  systemPrompt: string;
  tools: string[];
  timeoutMs: number;
  retries: number;
  maxBytes: number;
  maxLines: number;
  maxQueueDepth: number; // REQ-104: harness values, not engine constants
}

type AttemptOutcome =
  | { ok: true; diagram: string }
  | { ok: false; noteCode: Exclude<DiagramNoteCode, 'DISABLED' | 'NOT_GENERATED'>; gatewayOk: boolean };

type GateFailReason = Extract<GateDiagramResult, { ok: false }>['gateFail'];

export class GraphAnalyzer {
  private readonly _gateway: GatewayClient;
  private readonly _catalog: WorkflowCatalog;
  private readonly _ports: TriggerPorts;
  private readonly _clock: Clock;
  private readonly _config: GraphAnalyzerConfig;
  private readonly _aliasNames: Set<string>;
  private readonly _schedule: (job: () => Promise<void>) => void;

  // Concurrency 1: a single running slot + a bounded FIFO queue (DES-131). Single-flight is keyed
  // by "name@version" (DES-127 B4) — a key stays claimed from the moment its pending row is
  // written until the job settles (including while merely queued, not yet running).
  private _runningCount = 0;
  private readonly _queue: Array<() => Promise<void>> = [];
  private readonly _pendingKeys = new Set<string>();

  constructor(deps: {
    gateway: GatewayClient;
    catalog: WorkflowCatalog;
    ports: TriggerPorts;
    clock: Clock;
    config: GraphAnalyzerConfig;
    aliasNames: Set<string>;
    schedule?: (job: () => Promise<void>) => void;
  }) {
    this._gateway = deps.gateway;
    this._catalog = deps.catalog;
    this._ports = deps.ports;
    this._clock = deps.clock;
    this._config = deps.config;
    this._aliasNames = deps.aliasNames;
    // Prod default: fire-and-forget via setImmediate — never awaited by enqueue()/regenerate()
    // (REQ-102). Tests pass `runInline` (deterministic) or omit this entirely to exercise the real
    // async race (IT-096).
    this._schedule = deps.schedule ?? ((job) => { setImmediate(() => { void job(); }); });
  }

  /** REQ-102: writes the `pending` row and returns BEFORE the job runs — never awaits it. */
  enqueue(name: string, version: string, script: string, principal: string | null): void {
    const key = `${name}@${version}`;
    if (this._pendingKeys.has(key)) return; // DES-127 B4: single-flight, no second job
    if (!isKnownAlias(this._config.model, this._aliasNames)) {
      // DES-131: short-circuit, zero model calls, never even reaches `pending`.
      this._settleUnavailable(name, version, noteCodeFor({ kind: 'config', reason: 'model_unmapped' }));
      return;
    }
    if (this._runningCount >= 1 && this._queue.length >= this._config.maxQueueDepth) {
      this._settleUnavailable(name, version, noteCodeFor({ kind: 'queue' }));
      return;
    }
    const priorRow = this._catalog.getDiagram(name, version);
    this._catalog.putDiagramPending(name, version);
    this._startJob(name, version, principal, key, Promise.resolve(script), priorRow);
  }

  /** DES-127 B4/B5: idempotent while already pending; a real regenerate resolves the CURRENT
   *  script off the catalog (the caller only ever hands enqueue() a name/version). */
  regenerate(name: string, version: string, principal: string | null): { queued: boolean; status: 'pending' } {
    const key = `${name}@${version}`;
    if (this._pendingKeys.has(key)) return { queued: false, status: 'pending' };
    this._pendingKeys.add(key); // claim immediately — closes the race between two back-to-back calls
    void this._catalog
      .resolve(name, { version })
      .then((entry) => {
        this._pendingKeys.delete(key); // enqueue() re-claims (or settles synchronously) below
        this.enqueue(name, version, entry.script, principal);
      })
      .catch(() => { this._pendingKeys.delete(key); });
    return { queued: true, status: 'pending' };
  }

  /** DES-127 B7: the three row shapes a restart can find, distinguished by `generated_at` alone. */
  sweepAtBoot(): void {
    const bootInstant = this._clock.now();
    for (const { name, version } of this._catalog.listPendingDiagrams()) {
      const row = this._catalog.getDiagram(name, version);
      if (!row) continue;
      if (row.generatedAt === null) {
        // Never stamped — a crash mid-generation. Requeue exactly once, stamping the attempt marker.
        const stamp = this._clock.isoNow();
        this._catalog.putDiagramPending(name, version, stamp);
        const key = `${name}@${version}`;
        this._startJob(
          name, version, null, key,
          this._catalog.resolve(name, { version }).then((e) => e.script),
          null, // a still-pending row was never 'ready' — nothing to restore on failure
        );
      } else if (Date.parse(row.generatedAt) < bootInstant) {
        // Stamped by a previous, now-dead process — settle with ZERO model calls.
        const bindings = getTriggerBindings(name, this._ports);
        this._catalog.putDiagramResult(name, version, {
          status: 'unavailable',
          noteCode: noteCodeFor({ kind: 'exhausted' }),
          generatedAt: this._clock.isoNow(),
          bindingsFp: bindings.bindingsFp,
        });
      }
      // else: stamped at/after the boot instant — a live job in THIS process, leave alone.
    }
  }

  private _settleUnavailable(name: string, version: string, noteCode: PersistedDiagramNoteCode): void {
    // DES-127 B5: a failure must never clobber a prior `ready` row.
    const current = this._catalog.getDiagram(name, version);
    if (current?.status === 'ready') return;
    const bindings = getTriggerBindings(name, this._ports);
    this._catalog.putDiagramResult(name, version, {
      status: 'unavailable', noteCode, generatedAt: this._clock.isoNow(), bindingsFp: bindings.bindingsFp,
    });
  }

  private _startJob(
    name: string, version: string, principal: string | null, key: string,
    scriptPromise: Promise<string>, priorRow: DiagramRow | null,
  ): void {
    this._pendingKeys.add(key);
    const job = async (): Promise<void> => {
      const script = await scriptPromise;
      await this._runJob(name, version, script, principal, key, priorRow);
    };
    if (this._runningCount >= 1) {
      this._queue.push(job);
    } else {
      this._runningCount++;
      this._schedule(job);
    }
  }

  /** DES-131: the allowlist gateDiagram checks every model-authored token against — script
   *  structure (both the actual `phase()`/`workflow()` calls AND the declarative `meta.phases`
   *  titles adjudication #1 makes public), the configured alias names, the two reserved sentinels,
   *  and the live trigger snapshot's kinds/upstream name (DES-128). */
  private _buildAllowlist(script: string, bindings: TriggerBinding[]): Set<string> {
    const labels = new Set<string>();
    for (const node of parseWorkflowSkeleton(script)) {
      if (node.title !== undefined) labels.add(node.title);
      if (node.workflow !== undefined) labels.add(node.workflow);
    }
    for (const phase of parseMeta(script).phases) labels.add(phase.title);
    for (const alias of this._aliasNames) labels.add(alias);
    labels.add('default');
    labels.add('model:param'); // the shipped systemPrompt's own sentinel for a run-time-determined model
    // v23 adjudication #7: the THIRD engine-authored sentinel. `describeTriggerBindings` (for an
    // unbound workflow) and the shipped default systemPrompt both instruct the model to label the
    // entry node `workflow_run` — so the gate must allow it, exactly as it allows the other two
    // tokens the engine itself authors. Without this the engine instructs a word its own gate
    // refuses, and since every workflow is unbound at v1 (schedule/webhook creation is refused
    // CHANNEL_UNPUBLISHED before publish), an obedient model loses EVERY first diagram.
    labels.add('workflow_run');
    for (const b of bindings) {
      labels.add(b.kind);
      if (b.kind === 'chain' && b.upstreamWorkflow !== null) labels.add(b.upstreamWorkflow);
    }
    return labels;
  }

  private async _attempt(
    name: string, version: string, principal: string | null, attemptNum: number,
    prompt: string, allowedLabels: ReadonlySet<string>,
  ): Promise<AttemptOutcome> {
    const start = this._clock.now();
    let result: GatewayResult;
    try {
      result = await this._gateway.invoke({
        prompt,
        // DES-120: the analyzer's tool field rides the gateway's existing off-schema wire name.
        opts: { model: this._config.model, timeoutMs: this._config.timeoutMs, allowedTools: this._config.tools } as AgentOpts & { allowedTools: string[] },
        runId: `analyzer:${name}@${version}:${attemptNum}`,
        agentId: 'graph-analyzer',
      });
    } catch {
      // ADR-016: never inspect/forward the thrown error's own message — it can echo request text
      // (which can contain the masked script), and the journal line is a concatenation site.
      result = { ok: false, provider: 'unknown', reason: 'terminal' };
    }
    const durationMs = this._clock.now() - start;

    // Build the outcome ONCE, as the discriminated union it already is (Gate 6.5 simplify: the
    // previous shape carried four independent `let`s that the return statement then had to re-narrow
    // with two `as` casts the compiler could not check).
    let outcome: AttemptOutcome;
    let gateFail: GateFailReason | null = null;
    if (result.ok) {
      const gate = gateDiagram(result.content, allowedLabels, { maxBytes: this._config.maxBytes, maxLines: this._config.maxLines });
      if (gate.ok) {
        outcome = { ok: true, diagram: gate.diagram };
      } else {
        outcome = { ok: false, noteCode: noteCodeFor({ kind: 'gate', reason: gate.reason }), gatewayOk: true };
        gateFail = gate.gateFail;
      }
    } else {
      outcome = { ok: false, noteCode: noteCodeFor(result), gatewayOk: false };
    }

    // eslint-disable-next-line no-console
    console.log('[remote-workflow-engine] graph-analyzer ' + JSON.stringify({
      name, version, principal, model: this._config.model,
      promptTokens: result.ok ? result.tokens.input : null,
      completionTokens: result.ok ? result.tokens.output : null,
      durationMs,
      outcome: outcome.ok ? 'ready' : 'unavailable',
      noteCode: outcome.ok ? null : outcome.noteCode,
      gateFail,
    }));

    return outcome;
  }

  private async _runJob(
    name: string, version: string, script: string, principal: string | null, key: string, priorRow: DiagramRow | null,
  ): Promise<void> {
    const bindings = getTriggerBindings(name, this._ports);
    const allowedLabels = this._buildAllowlist(script, bindings.bindings);
    // v23 adjudication #6 V-1 (REQ-103): the bindings reach the PROMPT, not only the allowlist.
    // Triggers live in the schedule/webhook/continuation stores and are ABSENT from the script,
    // so an analyzer fed only the script can never name how the workflow is started — the gap in
    // issue #32 as filed, and the clause 04-design.md's REQ-103 row had silently dropped.
    const prompt = `${this._config.systemPrompt}\n\n---\nHow this workflow is triggered:\n`
      + `${describeTriggerBindings(bindings.bindings)}\n\n---\nWorkflow script:\n${script}`;
    const attempts = 1 + this._config.retries;

    // do/while, not for: the first attempt is unconditional, which is what makes `last` definitely
    // assigned without the `as AttemptOutcome` cast the `for` shape needed (Gate 6.5 simplify).
    let last: AttemptOutcome;
    let attemptNum = 0;
    do {
      attemptNum++;
      last = await this._attempt(name, version, principal, attemptNum, prompt, allowedLabels);
      // success, or a gate rejection — retrying won't help either
    } while (!last.ok && !last.gatewayOk && attemptNum < attempts);

    const generatedAt = this._clock.isoNow();
    if (last.ok) {
      this._catalog.putDiagramResult(name, version, { status: 'ready', diagram: last.diagram, generatedAt, bindingsFp: bindings.bindingsFp });
    } else if (priorRow?.status === 'ready') {
      // DES-127 B5: restore the untouched prior row rather than clobber it with this failure.
      this._catalog.putDiagramResult(name, version, {
        status: 'ready', diagram: priorRow.diagram as string,
        generatedAt: priorRow.generatedAt as string, bindingsFp: priorRow.bindingsFp as string,
      });
    } else {
      this._catalog.putDiagramResult(name, version, { status: 'unavailable', noteCode: last.noteCode, generatedAt, bindingsFp: bindings.bindingsFp });
    }

    this._pendingKeys.delete(key);
    this._runningCount--;
    const next = this._queue.shift();
    if (next) {
      this._runningCount++;
      this._schedule(next);
    }
  }
}
