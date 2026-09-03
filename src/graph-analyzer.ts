// GraphAnalyzer (TASK-117, DES-131/121/122/123/127/129, ARCH-079): the async, single-flight,
// self-retrying analyzer that turns a registered workflow script into an ASCII diagram via the
// configured LLM provider, gated through diagram-gate.ts's allowlist before it is ever persisted
// or served (ARCH-080).
import { gateDiagram, type GateDiagramResult } from './diagram-gate.js';
import { parseMeta, parseWorkflowSkeleton } from './workflow-meta.js';
import { isKnownAlias } from './params/contract.js';
import { CatalogNotFoundError } from './errors.js';
import type { Clock } from './clock.js';
import type { AgentOpts } from './types.js';
import type { GatewayClient, GatewayResult } from './gateway/client.js';
import type { DiagramRow, PersistedDiagramNoteCode, WorkflowCatalog } from './workflow-catalog.js';
import { describeTriggerBindings, getTriggerBindings, UNBOUND_ENTRY_LABEL, type TriggerBinding, type TriggerPorts } from './trigger-bindings.js';

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

// ARCH-079 R-2(d): the journal's `cause` field — a CLOSED UNION of engine-classified literals,
// never `string` (ADR-016: never raw provider/model text; a provider error payload can echo the
// request, and the request carries the masked script). One literal per distinct reason a settle
// can occur, so `RETRIES_EXHAUSTED`'s persisted-noteCode overload (disabled / boot_abandoned /
// script_unresolved / job_exception all share that one noteCode) stops being opaque in the log.
export type AnalyzerCause =
  | 'disabled' | 'model_unmapped' | 'queue_full' | 'boot_abandoned' | 'script_unresolved'
  | 'job_exception' | 'provider_terminal' | 'provider_timeout' | 'gate_refused' | 'prior_restored'
  | 'settle_failed';

/** R-2(d): the total mapping from a real attempt's failure noteCode to its `cause` — only the
 *  three provider/gate noteCodes `_attempt` can actually produce reach here. */
function causeForAttemptFailure(noteCode: Exclude<DiagramNoteCode, 'DISABLED' | 'NOT_GENERATED'>): AnalyzerCause {
  switch (noteCode) {
    case 'TIMEOUT': return 'provider_timeout';
    case 'PROVIDER_UNREACHABLE':
    case 'PROVIDER_ERROR': return 'provider_terminal';
    case 'GATE_REJECTED_CONTENT':
    case 'GATE_REJECTED_SHAPE': return 'gate_refused';
    default: return 'job_exception'; // unreachable via _attempt's own real-call path
  }
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

// R-2b(c): _attempt returns its telemetry inside this union and emits nothing itself — the ONE
// settle seam (_settle) aggregates promptTokens/completionTokens/durationMs across every attempt
// and is the ONE place that journals (R-2/R-2b).
type AttemptOutcome =
  | { ok: true; diagram: string; promptTokens: number; completionTokens: number; durationMs: number }
  | {
      ok: false; noteCode: Exclude<DiagramNoteCode, 'DISABLED' | 'NOT_GENERATED'>; gatewayOk: boolean;
      gateFail: GateFailReason | null; promptTokens: number | null; completionTokens: number | null; durationMs: number;
    };

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
      this._settleUnavailable(name, version, noteCodeFor({ kind: 'config', reason: 'model_unmapped' }), principal, 'model_unmapped');
      return;
    }
    if (this._runningCount >= 1 && this._queue.length >= this._config.maxQueueDepth) {
      this._settleUnavailable(name, version, noteCodeFor({ kind: 'queue' }), principal, 'queue_full');
      return;
    }
    // ARCH-079 R-3: `_startJob` is the ONE choke point for `config.enabled` (below) — the durable
    // `putDiagramPending` write also moves there, behind the guard, so a prior `ready` row is never
    // clobbered to NULL before a disabled analyzer's settle ever runs (the latent-clobber trap
    // UT-124's fourth case pins). `priorRow` is still read HERE, before that write, so B5's
    // protection is unchanged regardless of where the write itself lands.
    const priorRow = this._catalog.getDiagram(name, version);
    this._startJob(name, version, principal, key, () => Promise.resolve(script), priorRow, null);
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
        // Never stamped — a crash mid-generation. Requeue exactly once, stamping the attempt marker
        // — ARCH-079 R-3: the stamp write now lands INSIDE `_startJob`, behind the `enabled` guard
        // (inv 9's "stamp before schedule" becomes "stamp inside _startJob before schedule", which
        // is strictly tighter: a disabled analyzer settles the row without ever stamping it, so a
        // never-stamped pending row does not strand forever).
        const key = `${name}@${version}`;
        this._startJob(
          name, version, null, key,
          () => this._catalog.resolve(name, { version }).then((e) => e.script),
          null, this._clock.isoNow(),
        );
      } else if (Date.parse(row.generatedAt) < bootInstant) {
        // Stamped by a previous, now-dead process — settle with ZERO model calls.
        this._settleUnavailable(name, version, noteCodeFor({ kind: 'exhausted' }), null, 'boot_abandoned');
      }
      // else: stamped at/after the boot instant — a live job in THIS process, leave alone.
    }
  }

  /** ARCH-079 R-2/R-2b: the ONE settle seam — the only caller of `catalog.putDiagramResult` and
   *  the only caller of `_journal`, in that order. Every terminal path funnels through here, which
   *  is what makes "exactly one line per settle" and "the line's outcome equals the row just
   *  written" (oracle O5) hold BY CONSTRUCTION rather than by care. Deliberately unwrapped: if the
   *  write throws (a permanently-orphaned row per DES-130 B6, or a genuine store failure), it
   *  propagates to the scheduled closure's own catch (below) / `_settleUnavailable`'s inner catch,
   *  which performs the ONE recovery attempt — this function does not retry itself. */
  private _settle(
    name: string, version: string, principal: string | null,
    row:
      | { status: 'ready'; diagram: string; generatedAt: string; bindingsFp: string }
      | { status: 'unavailable'; noteCode: PersistedDiagramNoteCode; generatedAt: string; bindingsFp: string },
    telemetry: {
      promptTokens: number | null; completionTokens: number | null; durationMs: number;
      gateFail: GateFailReason | null; attempts: number; cause: AnalyzerCause | null;
    },
  ): void {
    this._catalog.putDiagramResult(name, version, row);
    this._journal({
      name, version, principal,
      promptTokens: telemetry.promptTokens, completionTokens: telemetry.completionTokens, durationMs: telemetry.durationMs,
      outcome: row.status, noteCode: row.status === 'unavailable' ? row.noteCode : null,
      gateFail: telemetry.gateFail, attempts: telemetry.attempts, cause: telemetry.cause,
    });
  }

  /** UT-128/ARCH-079 inv 5: every path that writes a terminal row emits exactly one journal line,
   *  even a zero-model-call settle (no `_attempt`, so no other emitter runs for it). Also the ONE
   *  recovery path (inv 2 FLOOR 2b/V-F): the scheduled closure's catch and `enqueue`/`sweepAtBoot`'s
   *  zero-model-call guards both call this, and its own write is guarded against a SECOND failure —
   *  a permanently-failing store settles with `cause:'settle_failed'` and writes no row at all,
   *  rather than letting the closure reject a second time. */
  private _settleUnavailable(
    name: string, version: string, noteCode: PersistedDiagramNoteCode, principal: string | null, cause: AnalyzerCause,
  ): void {
    // DES-127 B5: a failure must never clobber a prior `ready` row.
    const current = this._catalog.getDiagram(name, version);
    if (current?.status === 'ready') return;
    try {
      const bindings = getTriggerBindings(name, this._ports);
      this._settle(
        name, version, principal,
        { status: 'unavailable', noteCode, generatedAt: this._clock.isoNow(), bindingsFp: bindings.bindingsFp },
        { promptTokens: null, completionTokens: null, durationMs: 0, gateFail: null, attempts: 0, cause },
      );
    } catch {
      this._journal({
        name, version, principal,
        promptTokens: null, completionTokens: null, durationMs: 0,
        outcome: 'unavailable', noteCode: null, gateFail: null, attempts: 0, cause: 'settle_failed',
      });
    }
  }

  /** ARCH-079 inv 5: the ONE emitter of the `graph-analyzer` journal line. Every settle path — the
   *  zero-model-call settle above and `_settle`'s own model-call settle — goes through here, so the
   *  line's shape cannot drift between them (the same one-declaration rule as `UNBOUND_ENTRY_LABEL`
   *  and `ANALYZER_SCRATCH_SUBDIR`). The key order below IS the line's wire format; keep it. */
  private _journal(f: {
    name: string; version: string; principal: string | null;
    promptTokens: number | null; completionTokens: number | null; durationMs: number;
    outcome: 'ready' | 'unavailable'; noteCode: PersistedDiagramNoteCode | null; gateFail: GateFailReason | null;
    attempts: number; cause: AnalyzerCause | null;
  }): void {
    // eslint-disable-next-line no-console
    console.log('[remote-workflow-engine] graph-analyzer ' + JSON.stringify({
      name: f.name, version: f.version, principal: f.principal, model: this._config.model,
      promptTokens: f.promptTokens, completionTokens: f.completionTokens, durationMs: f.durationMs,
      outcome: f.outcome, noteCode: f.noteCode, gateFail: f.gateFail, attempts: f.attempts, cause: f.cause,
    }));
  }

  /** ARCH-079 inv 2 FLOOR 2a (V-E): the single release site, idempotent per key — a key already
   *  released (or never claimed) is a no-op, so a `finally` that ever ran twice for the same job
   *  cannot double-release the slot into negative/unbounded concurrency. */
  private _release(key: string): void {
    if (!this._pendingKeys.has(key)) return;
    this._pendingKeys.delete(key);
    this._runningCount--;
    const next = this._queue.shift();
    if (next) {
      this._runningCount++;
      this._schedule(next);
    }
  }

  /** ARCH-079 R-3: the ONE choke point for `config.enabled` — every `_startJob` caller
   *  (`enqueue`, `sweepAtBoot`, `regenerate` via `enqueue`) funnels through here, and this is the
   *  FIRST statement, before either claim (`_pendingKeys`/`_runningCount`) and before the durable
   *  `putDiagramPending` write. `server.ts:955`/`mcp-facade.ts:462` stay as defence-in-depth, not
   *  load-bearing. `scriptSource` is a THUNK, not an already-started promise: constructing it (e.g.
   *  `sweepAtBoot`'s `catalog.resolve`) must not happen until the guard passes, or a disabled
   *  analyzer would leave an unawaited, potentially-rejecting promise behind — the exact
   *  unhandled-rejection shape inv 2 exists to close. `bootStamp` is `sweepAtBoot`'s attempt marker
   *  (`null` from `enqueue`, which never stamps). */
  private _startJob(
    name: string, version: string, principal: string | null, key: string,
    scriptSource: () => Promise<string>, priorRow: DiagramRow | null, bootStamp: string | null,
  ): void {
    if (!this._config.enabled) {
      this._settleUnavailable(name, version, noteCodeFor({ kind: 'exhausted' }), principal, 'disabled');
      return;
    }
    this._catalog.putDiagramPending(name, version, bootStamp ?? undefined);
    this._pendingKeys.add(key);
    const job = async (): Promise<void> => {
      try {
        const script = await scriptSource();
        await this._runJob(name, version, script, principal, priorRow);
      } catch (e) {
        // ARCH-079 inv 2 FLOOR 2b: the catch is TOTAL — every reachable throw in this closure
        // (the orphan `scriptPromise` rejection, `_runJob`'s own `getTriggerBindings`/write throws)
        // settles the row unavailable via the one recovery path, so the closure itself never
        // rejects. `CatalogNotFoundError` is the enqueue-races-deregister orphan case (A3/N-1);
        // any other throw is an opaque `job_exception` (ADR-016: never inspect the error's own
        // message, it can echo request text that contains the masked script).
        const cause: AnalyzerCause = e instanceof CatalogNotFoundError ? 'script_unresolved' : 'job_exception';
        this._settleUnavailable(name, version, noteCodeFor({ kind: 'exhausted' }), principal, cause);
      } finally {
        this._release(key);
      }
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
    // v23 adjudication #7: the THIRD engine-authored sentinel — the label `describeTriggerBindings`
    // instructs for an unbound workflow, read from its ONE declaration rather than re-typed here
    // (Gate 6.5), since re-typing it is exactly how the instruction and the gate came to disagree.
    // Without it the engine instructs a word its own gate refuses, and since every workflow is
    // unbound at v1 (schedule/webhook creation is refused CHANNEL_UNPUBLISHED before publish), an
    // obedient model loses EVERY first diagram.
    labels.add(UNBOUND_ENTRY_LABEL);
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
    // with two `as` casts the compiler could not check). R-2b(c): telemetry rides the outcome —
    // `_attempt` emits nothing; `_settle` (the one settle seam) journals once per SETTLE, not once
    // per attempt.
    let outcome: AttemptOutcome;
    if (result.ok) {
      const gate = gateDiagram(result.content, allowedLabels, { maxBytes: this._config.maxBytes, maxLines: this._config.maxLines });
      if (gate.ok) {
        outcome = { ok: true, diagram: gate.diagram, promptTokens: result.tokens.input, completionTokens: result.tokens.output, durationMs };
      } else {
        outcome = {
          ok: false, noteCode: noteCodeFor({ kind: 'gate', reason: gate.reason }), gatewayOk: true, gateFail: gate.gateFail,
          promptTokens: result.tokens.input, completionTokens: result.tokens.output, durationMs,
        };
      }
    } else {
      outcome = { ok: false, noteCode: noteCodeFor(result), gatewayOk: false, gateFail: null, promptTokens: null, completionTokens: null, durationMs };
    }

    return outcome;
  }

  private async _runJob(
    name: string, version: string, script: string, principal: string | null, priorRow: DiagramRow | null,
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
    // R-2b(c): promptTokens/completionTokens are SUMMED and durationMs is the TOTAL wall clock
    // across every attempt this settle makes — "the only information the move [to the settle
    // choke point] destroys" is the per-attempt count, which `attemptNum` (below) restores as its
    // own field.
    let last: AttemptOutcome;
    let attemptNum = 0;
    let promptTokens: number | null = null;
    let completionTokens: number | null = null;
    let totalDurationMs = 0;
    do {
      attemptNum++;
      last = await this._attempt(name, version, principal, attemptNum, prompt, allowedLabels);
      totalDurationMs += last.durationMs;
      if (last.promptTokens !== null) promptTokens = (promptTokens ?? 0) + last.promptTokens;
      if (last.completionTokens !== null) completionTokens = (completionTokens ?? 0) + last.completionTokens;
      // success, or a gate rejection — retrying won't help either
    } while (!last.ok && !last.gatewayOk && attemptNum < attempts);

    const generatedAt = this._clock.isoNow();
    const telemetry = { promptTokens, completionTokens, durationMs: totalDurationMs, attempts: attemptNum };
    if (last.ok) {
      this._settle(
        name, version, principal,
        { status: 'ready', diagram: last.diagram, generatedAt, bindingsFp: bindings.bindingsFp },
        { ...telemetry, gateFail: null, cause: null },
      );
    } else if (priorRow?.status === 'ready') {
      // DES-127 B5: restore the untouched prior row rather than clobber it with this failure. R-2b(e):
      // the journal line still reads `outcome:'ready'` (O5's relational oracle — the line must match
      // the row actually written) with `cause:'prior_restored'` naming why a new one was not drawn.
      this._settle(
        name, version, principal,
        {
          status: 'ready', diagram: priorRow.diagram as string,
          generatedAt: priorRow.generatedAt as string, bindingsFp: priorRow.bindingsFp as string,
        },
        { ...telemetry, gateFail: last.gateFail, cause: 'prior_restored' },
      );
    } else {
      this._settle(
        name, version, principal,
        { status: 'unavailable', noteCode: last.noteCode, generatedAt, bindingsFp: bindings.bindingsFp },
        { ...telemetry, gateFail: last.gateFail, cause: causeForAttemptFailure(last.noteCode) },
      );
    }
  }
}
