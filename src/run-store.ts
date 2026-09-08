// RunStore port + InMemoryRunStore (DES-010).
import { randomUUID } from 'node:crypto';
import type { Clock } from './clock.js';
import type { RunSpec, RunStatusView, RunSummary, JournalEntry, TranscriptEvent, RunStatus, AgentRecord, StateTransition, RunListFilter, AuditEvent, PriceBook, RunUsage } from './types.js';
// v26 (DES-183, TASK-183): the "at rest" RunUsage fold — shared by InMemoryRunStore and
// SqliteRunStore's getRun, mirroring deriveAgentRecords above (both live in run-guard.js/here
// respectively; no runtime cycle — run-guard.ts imports only errors.js and types.js).
import { foldUsage } from './run-guard.js';
// v21 (ARCH-066, DES-104, TASK-100): the run-immutable admission snapshot type — a type-only import,
// so this does not create a real runtime cycle with params/resolve.ts's own type-only agent-executor.js import.
import type { RunParams } from './params/resolve.js';
import type { ErrorCode } from './errors.js';

/** v26 (DES-180, DES-188): the four-column zero — a call that never dispatched (harness-only /
 *  refused) owes the run's arithmetic a KNOWN zero, never an absence. */
const ZERO_TOKENS = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

/** Reconstructs the AgentRecord[] a run's getRun() should report (D-F9b) from its persisted
 *  agent-<id>.jsonl transcripts — the single source of truth `getRun` reads from directly,
 *  rather than relying on an in-process AgentExecutor's transient Map (D-V6/AgentTranscriptSink),
 *  so `workflow_status.agents`/`workflow_agent_log` survive a real server restart.
 *
 *  v26 (DES-188, TASK-188): FOUR branches, precedence usage > refused > harness-only:
 *  (1) usage/done — four-column tokens (a legacy two-column event zero-fills the cache columns),
 *      costUSD/unpriced read from the event when present (a legacy event has neither → `{0, true}`),
 *      startedAt from the FIRST harness event's ts, endedAt from the usage event's ts.
 *  (2) usage/failed — ZERO_TOKENS, costUSD:0, unpriced:false (a failed call moves no counter), model
 *      from the harness descriptor (never `''`) since a failed usage event carries no model of its
 *      own.
 *  (3) refused — a `kind:'refused'` event (DES-188/TASK-188's own journal row); a refused call never
 *      has a harness event, so label/frame/phase/phaseIndex come from the event's OWN data.
 *  (4) harness-only — 'running' on an in-process parent, 'queued' on interrupted/suspended; the SAME
 *      ZERO_TOKENS/costUSD:0/unpriced:false triple `AgentTranscriptSink.markQueued` initialises live,
 *      so a harness-only record is byte-identical on both producers.
 *  Neither usage, refused, nor harness → never dispatched, omit.
 *  Latest-wins dedupe: multiple harness events for the same agentId → the last one wins.
 *
 *  @param parentStatus The current status of the owning run; default 'running' (backward-compatible
 *    for callers that have not yet been updated to pass the status). Pass the real status at all
 *    call sites so interrupted runs show 'queued' agents, not 'running'.
 */
export function deriveAgentRecords(
  transcripts: Map<string, TranscriptEvent[]>,
  parentStatus: RunStatus = 'running',
): AgentRecord[] {
  const records: AgentRecord[] = [];
  for (const [agentId, events] of transcripts) {
    const reversed = [...events].reverse();
    const usage = reversed.find((e) => e.kind === 'usage');
    const refused = reversed.find((e) => e.kind === 'refused');
    // v24 (DES-161, TASK-145): the LATEST harness event of this agent is the label/model/provider
    // source on every branch that reads it — a finished/failed/queued agent must not lose the name
    // (or, for a failed call, the model) its harness event carried.
    const harnessAny = reversed.find((e) => e.kind === 'harness');
    const harnessDescriptor = (harnessAny?.data as { descriptor?: { model?: string; provider?: string; label?: string } } | undefined)?.descriptor;
    // v26 (DES-188): startedAt is the FIRST harness event's ts (dispatch time), not the latest.
    const firstHarnessTs = events.find((e) => e.kind === 'harness')?.ts;

    // v26 (DES-188): ONE local helper — every branch's shared, optional fields (label/phase/
    // phaseIndex/frame) go through here, never defaulted, so no branch can forget one and no branch
    // can silently invent one (UT-162's "absent, never defaulted" contract extends to the new
    // fields).
    const withCommon = (rec: AgentRecord, common: { label?: string; phase?: string; phaseIndex?: number; frame?: string }): AgentRecord => ({
      ...rec,
      ...(common.label !== undefined ? { label: common.label } : {}),
      ...(common.phase !== undefined ? { phase: common.phase } : {}),
      ...(common.phaseIndex !== undefined ? { phaseIndex: common.phaseIndex } : {}),
      ...(common.frame !== undefined ? { frame: common.frame } : {}),
    });

    if (usage) {
      // Terminal: usage event wins regardless of refused/harness.
      const data = usage.data as {
        tokens?: { input: number; output: number; cacheRead?: number; cacheWrite?: number };
        provider?: string; model?: string; costUSD?: number; unpriced?: boolean; unmapped?: string[];
      };
      const startedAt = firstHarnessTs;
      const endedAt = usage.ts;
      if (data.tokens) {
        records.push(withCommon({
          agentId, state: 'done', provider: data.provider ?? 'unknown', model: data.model ?? '',
          tokens: { input: data.tokens.input, output: data.tokens.output, cacheRead: data.tokens.cacheRead ?? 0, cacheWrite: data.tokens.cacheWrite ?? 0 },
          // A legacy (pre-v26) usage event carries neither field — the honest reading is "never
          // priced", not "free" (ADR-046).
          costUSD: data.costUSD ?? 0, unpriced: data.unpriced ?? true,
          // v26 integration (DES-183, DES-188 lock): derived exactly as `capture()` sets it live —
          // present only when non-empty — so the reconstructed record stays byte-identical.
          ...(data.unmapped && data.unmapped.length > 0 ? { unmapped: data.unmapped } : {}),
          ...(startedAt !== undefined ? { startedAt } : {}),
          ...(endedAt !== undefined ? { endedAt } : {}),
        }, { label: harnessDescriptor?.label }));
      } else {
        records.push(withCommon({
          agentId, state: 'failed', provider: data.provider ?? 'unknown', model: harnessDescriptor?.model ?? '',
          tokens: ZERO_TOKENS, costUSD: 0, unpriced: false,
          ...(startedAt !== undefined ? { startedAt } : {}),
          ...(endedAt !== undefined ? { endedAt } : {}),
        }, { label: harnessDescriptor?.label }));
      }
      continue;
    }

    if (refused) {
      // v26 (DES-188): a refused call never reaches a gateway and never has a harness event of its
      // own — label/frame/phase/phaseIndex come from the refused event's OWN data (markRefused
      // journals them from the live record markQueued created).
      const data = refused.data as { reasonCode?: ErrorCode; label?: string; frame?: string; phase?: string; phaseIndex?: number };
      records.push(withCommon({
        agentId, state: 'refused', provider: '', model: '',
        tokens: ZERO_TOKENS, costUSD: 0, unpriced: false,
        ...(data.reasonCode !== undefined ? { reasonCode: data.reasonCode } : {}),
        ...(refused.ts !== undefined ? { endedAt: refused.ts } : {}),
      }, { label: data.label, phase: data.phase, phaseIndex: data.phaseIndex, frame: data.frame }));
      continue;
    }

    // No usage/refused yet — check for a harness event (latest-wins).
    if (harnessAny) {
      const nonTerminalState: AgentRecord['state'] = parentStatus === 'running' ? 'running' : 'queued';
      records.push(withCommon({
        agentId,
        state: nonTerminalState,
        // #20: the harness descriptor now carries provider — surface it (like model) so a restart-
        // reconstructed running/queued agent shows its backend, not a blank 'unknown'. Pre-#20
        // transcripts (no descriptor.provider) still fall back to 'unknown'.
        provider: harnessDescriptor?.provider ?? 'unknown',
        model: harnessDescriptor?.model ?? '',
        // v26 (DES-188): the SAME three `markQueued` initialises live, so a restart-reconstructed
        // harness-only record is byte-identical to its live counterpart.
        tokens: ZERO_TOKENS, costUSD: 0, unpriced: false,
        ...(firstHarnessTs !== undefined ? { startedAt: firstHarnessTs } : {}),
      }, { label: harnessDescriptor?.label }));
    }
    // Neither usage, refused, nor harness → never dispatched, omit.
  }
  return records;
}

// v26 (DES-181, TASK-181, integrator): the v13 two-column resume fold that used to live here is
// DELETED, not merely unused. It summed input+output only and carried no USD, so once the live
// accumulator moved to four columns plus a USD counter it was a SECOND, disagreeing arithmetic for
// the same question — and a run that resumed enforced a different total than the same run without a
// restart. `foldUsage` (run-guard.ts) is the one read path; `RunManager._requireLive` hydrates the
// guard from it. Its own unit test (UT-071, tests/unit/budget-fold.test.ts) moved with it and pins
// the same properties over the same fixtures. Also one of the ten identifiers the v26 retirement
// grep guard (no-retired-surface.test.ts) requires absent from src/.

export interface RunStore {
  /** `scriptVersion` (D-V7) is the resolved catalog version ("v2", ...) actually executed for this
   *  run; defaults to 'v1' when omitted (inline/adhoc scripts, or callers not yet passing it).
   *  `effectiveParams` (v21, DES-104): the run-immutable admission-time snapshot RunManager computed
   *  from the registered defaults + validated overrides — persisted once, never re-resolved. */
  createRun(spec: RunSpec, scriptVersion?: string, effectiveParams?: RunParams, priceBook?: PriceBook): Promise<string>;
  /** v21 (DES-104): reads back the pinned admission snapshot for resume — `null` for a pre-v21 run
   *  row (never persisted one) or an unknown runId; the caller (RunManager) applies the legacy
   *  `defaultRunParams(registered.defaults)` fallback, never a crash. */
  getEffectiveParams(runId: string): Promise<RunParams | null>;
  /** v26 (DES-178, ARCH-116, TASK-178): reads back the price/capability pin taken at admission —
   *  `null` for a pre-v26 run row (never persisted one) or an unknown runId. Same row `getEffectiveParams`
   *  reads. */
  getPriceBook(runId: string): Promise<PriceBook | null>;
  appendJournal(runId: string, entry: JournalEntry): Promise<void>;
  appendTranscript(runId: string, agentId: string, ev: TranscriptEvent): Promise<void>;
  recordTransition(runId: string, from: RunStatus | null, to: RunStatus, ts: string): Promise<void>;
  /** O-2: the ordered state-transition audit trail for a run (from/to/ts), oldest first — the
   *  read side of recordTransition's "one writer of every transition" promise (ARCH-006). Empty
   *  for an unknown run. */
  getTransitions(runId: string): Promise<StateTransition[]>;
  getRun(runId: string): Promise<RunStatusView | null>;
  listRuns(): Promise<RunSummary[]>;
  /** v24 (DES-152): filtered/paginated read `run_list` is built on — `workflow`/`status`/`principal`
   *  narrow with SQL WHERE (SqliteRunStore) or an equivalent in-memory filter (InMemoryRunStore,
   *  parity required); a row with no `principal` is excluded whenever the filter supplies one (the
   *  cross-seam agreement with authz's null=ownerless rule). `limit` defaults to 50, capped at 500. */
  list(filter?: RunListFilter): Promise<RunSummary[]>;
  hydrateAll(): Promise<RunSummary[]>;
  /** Persists the script's return value for a completed run (DES-001/REQ-005: workflow_result
   *  returns the script return value, not the RunStatusView). */
  recordResult(runId: string, result: unknown): Promise<void>;
  getResult(runId: string): Promise<{ value: unknown } | null>;
  /** The original submission (name/script/args/budget) — lets RunManager rebuild a live RunEntry
   *  for a suspended/stopped run after a process restart (REQ-006 resume survives restart). */
  getSpec(runId: string): Promise<RunSpec | null>;
  /** Reads back the persisted transcript events for one agent (D-V6) — the real read-back path
   *  McpFacade.workflow_agent_log delegates to, never a hard-coded []. */
  getTranscript(runId: string, agentId: string): Promise<TranscriptEvent[]>;
  /** v8 Defer A (REQ-059): reads back the settled-call journal entries for a run (excluding the
   *  terminal result marker) — lets a run resumed in a fresh process (after a crash/restart) build a
   *  non-empty ResumeCache and replay its journaled agent()/workflow() calls instead of re-running
   *  them live. Empty for an unknown run. */
  getJournal(runId: string): Promise<JournalEntry[]>;
  /** v8 Slice 2c (REQ-055): persist a one-shot snapshot of the run's DAG detail (phases, full agent
   *  records incl. frame/label/timing, workflowNodes) at the terminal transition, so a completed
   *  composite run's nested tree survives a restart (getRun overlays it). Written once from the
   *  authoritative terminal `_transition` (covers failed/stopped, not only completed). */
  saveSnapshot(runId: string, snapshot: RunDagSnapshot): Promise<void>;
  /** v22 (DES-113, TASK-108): durably records the legacy-cohort fallback outcome (never rewrites
   *  the pin itself) so it survives a restart and workflow_status/getRun can surface it. No-op for
   *  an unknown runId. */
  recordLegacySubstitution(runId: string, sub: { pinned: string; resolved: string }): Promise<void>;
  /** v24 (DES-151): synchronous append (better-sqlite3 is sync) — a throw at the call site must
   *  propagate BEFORE any bytes are read (fail-closed by construction, never caught here). */
  appendAudit(ev: AuditEvent): void;
  /** v24 (DES-151): newest-first, capped at `limit` (default 200). */
  auditFor(runId: string, limit?: number): AuditEvent[];
}

/** v8 Slice 2c: the persisted DAG detail a getRun overlays after a restart. */
export interface RunDagSnapshot {
  phases: RunStatusView['phases'];
  agents: AgentRecord[];
  workflowNodes: RunStatusView['workflowNodes'];
  /** v26 (DES-183, TASK-183): the run's usage total at its terminal transition — OPTIONAL so a
   *  pre-v26 snapshot (never wrote this key) parses as `undefined` and falls through to
   *  `foldUsage` below, never to a fabricated zero. */
  usage?: RunUsage;
}

interface StoredRun {
  runId: string;
  spec: RunSpec;
  status: RunStatus;
  scriptVersion: string;
  createdAt: string;
  journal: JournalEntry[];
  transcripts: Map<string, TranscriptEvent[]>;
  transitions: StateTransition[];
  result?: unknown;
  hasResult: boolean;
  snapshot?: RunDagSnapshot; // v8 Slice 2c: DAG detail captured at terminal
  effectiveParams?: RunParams; // v21 (DES-104): run-immutable admission snapshot
  legacySubstitution?: { pinned: string; resolved: string }; // v22 (DES-113)
  priceBook?: PriceBook; // v26 (DES-178): admission-time price/capability pin
}

/** In-memory fake for unit tests — injected where RunStore is needed. */
export class InMemoryRunStore implements RunStore {
  private readonly _runs = new Map<string, StoredRun>();
  private readonly _audit: AuditEvent[] = [];

  constructor(private readonly _clock: Clock) {}

  async createRun(spec: RunSpec, scriptVersion = 'v1', effectiveParams?: RunParams, priceBook?: PriceBook): Promise<string> {
    const runId = randomUUID();
    this._runs.set(runId, {
      runId,
      spec,
      status: 'queued',
      scriptVersion,
      createdAt: this._clock.isoNow(),
      journal: [],
      transcripts: new Map(),
      transitions: [],
      hasResult: false,
      effectiveParams,
      priceBook,
    });
    return runId;
  }

  async getEffectiveParams(runId: string): Promise<RunParams | null> {
    return this._runs.get(runId)?.effectiveParams ?? null;
  }

  async getPriceBook(runId: string): Promise<PriceBook | null> {
    return this._runs.get(runId)?.priceBook ?? null;
  }

  async getSpec(runId: string): Promise<RunSpec | null> {
    const run = this._runs.get(runId);
    return run ? run.spec : null;
  }

  async recordResult(runId: string, result: unknown): Promise<void> {
    const run = this._runs.get(runId);
    if (!run) return;
    run.result = result;
    run.hasResult = true;
  }

  async getResult(runId: string): Promise<{ value: unknown } | null> {
    const run = this._runs.get(runId);
    if (!run || !run.hasResult) return null;
    return { value: run.result };
  }

  async appendJournal(runId: string, entry: JournalEntry): Promise<void> {
    const run = this._runs.get(runId);
    if (!run) return;
    run.journal.push(entry);
  }

  async appendTranscript(runId: string, agentId: string, ev: TranscriptEvent): Promise<void> {
    const run = this._runs.get(runId);
    if (!run) return;
    const list = run.transcripts.get(agentId) ?? [];
    list.push(ev);
    run.transcripts.set(agentId, list);
  }

  async recordTransition(runId: string, from: RunStatus | null, to: RunStatus, ts: string): Promise<void> {
    const run = this._runs.get(runId);
    if (!run) return;
    run.transitions.push({ from, to, ts });
    run.status = to;
  }

  async getTransitions(runId: string): Promise<StateTransition[]> {
    const run = this._runs.get(runId);
    return run ? [...run.transitions] : [];
  }

  async getRun(runId: string): Promise<RunStatusView | null> {
    const run = this._runs.get(runId);
    if (!run) return null;
    // v8 Slice 2c: a persisted terminal snapshot restores the full DAG (frames/phases/timing);
    // otherwise fall back to deriving bare agent records from transcripts (backward-compatible).
    const s = run.snapshot;
    const TERMINAL = new Set<RunStatus>(['completed', 'failed', 'stopped']);
    const terminalTransition = run.transitions.find((t) => TERMINAL.has(t.to));
    return {
      runId: run.runId, status: run.status, scriptVersion: run.scriptVersion,
      phases: s?.phases ?? [],
      agents: s?.agents ?? deriveAgentRecords(run.transcripts, run.status),
      workflowNodes: s?.workflowNodes ?? [],
      // v26 (DES-183, TASK-183): same fallback shape as `agents` above — a snapshot-less run (still
      // live, or interrupted-then-restarted with no snapshot) still answers.
      usage: s?.usage ?? foldUsage([...run.transcripts.values()].flat()),
      startedBy: run.spec.startedBy ?? { type: 'unknown' },
      terminalAt: terminalTransition?.ts,
      // v15 (DES-096): omit when absent (conditional spread mirrors terminalAt pattern).
      ...(run.spec.principal ? { principal: run.spec.principal } : {}),
      // v22 (DES-113): omit when absent, same conditional-spread convention.
      ...(run.legacySubstitution ? { legacySubstitution: run.legacySubstitution } : {}),
    };
  }

  async saveSnapshot(runId: string, snapshot: RunDagSnapshot): Promise<void> {
    const run = this._runs.get(runId);
    if (run) run.snapshot = snapshot;
  }

  async recordLegacySubstitution(runId: string, sub: { pinned: string; resolved: string }): Promise<void> {
    const run = this._runs.get(runId);
    if (run) run.legacySubstitution = sub;
  }

  async listRuns(): Promise<RunSummary[]> {
    return [...this._runs.values()].map((r) => this._toSummary(r));
  }

  async hydrateAll(): Promise<RunSummary[]> {
    return this.listRuns();
  }

  /** v24 (DES-152): parity with SqliteRunStore.list — same filter semantics, in-memory. */
  async list(filter: RunListFilter = {}): Promise<RunSummary[]> {
    const limit = Math.min(filter.limit ?? 50, 500);
    return [...this._runs.values()]
      .filter((r) => filter.workflow === undefined || r.spec.name === filter.workflow)
      .filter((r) => filter.status === undefined || r.status === filter.status)
      .filter((r) => filter.principal === undefined || r.spec.principal === filter.principal)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
      .slice(0, limit)
      .map((r) => this._toSummary(r));
  }

  private _toSummary(r: StoredRun): RunSummary {
    const TERMINAL = new Set<RunStatus>(['completed', 'failed', 'stopped']);
    const terminalTransition = r.transitions.find((t) => TERMINAL.has(t.to));
    return {
      runId: r.runId,
      name: r.spec.name,
      status: r.status,
      scriptVersion: r.scriptVersion,
      createdAt: r.createdAt,
      startedBy: r.spec.startedBy ?? { type: 'unknown' },
      ...(terminalTransition ? { terminalAt: terminalTransition.ts } : {}),
    };
  }

  async getJournal(runId: string): Promise<JournalEntry[]> {
    const run = this._runs.get(runId);
    return run ? [...run.journal] : [];
  }

  async getTranscript(runId: string, agentId: string): Promise<TranscriptEvent[]> {
    const run = this._runs.get(runId);
    if (!run) return [];
    return run.transcripts.get(agentId) ?? [];
  }

  /** v24 (DES-151): synchronous, in-memory. */
  appendAudit(ev: AuditEvent): void {
    this._audit.push(ev);
  }

  /** v24 (DES-151): newest-first (insertion order reversed — appendAudit is the only writer). */
  auditFor(runId: string, limit = 200): AuditEvent[] {
    return this._audit.filter((e) => e.runId === runId).slice(-limit).reverse();
  }
}
