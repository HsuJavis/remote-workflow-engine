// RunStore port + InMemoryRunStore (DES-010).
import { randomUUID } from 'node:crypto';
import type { Clock } from './clock.js';
import type { RunSpec, RunStatusView, RunSummary, JournalEntry, TranscriptEvent, RunStatus, AgentRecord, StateTransition } from './types.js';
// v21 (ARCH-066, DES-104, TASK-100): the run-immutable admission snapshot type — a type-only import,
// so this does not create a real runtime cycle with params/resolve.ts's own type-only agent-executor.js import.
import type { RunParams } from './params/resolve.js';

/** Reconstructs the AgentRecord[] a run's getRun() should report (D-F9b) from its persisted
 *  agent-<id>.jsonl transcripts — the single source of truth `getRun` reads from directly,
 *  rather than relying on an in-process AgentExecutor's transient Map (D-V6/AgentTranscriptSink),
 *  so `workflow_status.agents`/`workflow_agent_log` survive a real server restart.
 *
 *  DES-066 (TASK-069): run-status-aware harness handling — drop `if(!usage)continue`:
 *  - usage event → terminal state (done/failed)
 *  - harness event (no usage) → 'running' on in-process parent, 'queued' on interrupted/suspended
 *  - neither → agent never dispatched, omit from records
 *  - Latest-wins dedupe: multiple harness events for same agentId → last one wins.
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
    if (usage) {
      // Terminal: usage event wins regardless of harness.
      const data = usage.data as { tokens?: { input: number; output: number }; provider?: string; model?: string; reason?: string };
      if (data.tokens) {
        records.push({ agentId, state: 'done', provider: data.provider ?? 'unknown', model: data.model ?? '', tokens: data.tokens });
      } else {
        records.push({ agentId, state: 'failed', provider: data.provider ?? 'unknown', model: '', tokens: { input: 0, output: 0 } });
      }
      continue;
    }
    // No usage yet — check for a harness event (latest-wins).
    const harness = reversed.find((e) => e.kind === 'harness');
    if (harness) {
      const hd = (harness.data as { descriptor?: { model?: string; provider?: string } }).descriptor;
      const nonTerminalState: AgentRecord['state'] = parentStatus === 'running' ? 'running' : 'queued';
      records.push({
        agentId,
        state: nonTerminalState,
        // #20: the harness descriptor now carries provider — surface it (like model) so a restart-
        // reconstructed running/queued agent shows its backend, not a blank 'unknown'. Pre-#20
        // transcripts (no descriptor.provider) still fall back to 'unknown'.
        provider: hd?.provider ?? 'unknown',
        model: hd?.model ?? '',
        tokens: { input: 0, output: 0 },
      });
    }
    // Neither usage nor harness → never dispatched, omit.
  }
  return records;
}

/** DES-068 (TASK-071): pure fold — sums all `kind:'usage'` token counts in a transcript slice.
 *  Never throws; missing/absent `tokens` field contributes 0. Used by the resume path to hydrate
 *  RunGuard.spent without double-counting a snapshot already reflected in the guard. */
export function sumUsageTokens(events: TranscriptEvent[]): number {
  let total = 0;
  for (const ev of events) {
    if (ev.kind !== 'usage') continue;
    const tok = (ev.data as { tokens?: { input?: number; output?: number } }).tokens;
    if (tok) total += (tok.input ?? 0) + (tok.output ?? 0);
  }
  return total;
}

export interface RunStore {
  /** `scriptVersion` (D-V7) is the resolved catalog version ("v2", ...) actually executed for this
   *  run; defaults to 'v1' when omitted (inline/adhoc scripts, or callers not yet passing it).
   *  `effectiveParams` (v21, DES-104): the run-immutable admission-time snapshot RunManager computed
   *  from the registered defaults + validated overrides — persisted once, never re-resolved. */
  createRun(spec: RunSpec, scriptVersion?: string, effectiveParams?: RunParams): Promise<string>;
  /** v21 (DES-104): reads back the pinned admission snapshot for resume — `null` for a pre-v21 run
   *  row (never persisted one) or an unknown runId; the caller (RunManager) applies the legacy
   *  `defaultRunParams(registered.defaults)` fallback, never a crash. */
  getEffectiveParams(runId: string): Promise<RunParams | null>;
  appendJournal(runId: string, entry: JournalEntry): Promise<void>;
  appendTranscript(runId: string, agentId: string, ev: TranscriptEvent): Promise<void>;
  recordTransition(runId: string, from: RunStatus | null, to: RunStatus, ts: string): Promise<void>;
  /** O-2: the ordered state-transition audit trail for a run (from/to/ts), oldest first — the
   *  read side of recordTransition's "one writer of every transition" promise (ARCH-006). Empty
   *  for an unknown run. */
  getTransitions(runId: string): Promise<StateTransition[]>;
  getRun(runId: string): Promise<RunStatusView | null>;
  listRuns(): Promise<RunSummary[]>;
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
}

/** v8 Slice 2c: the persisted DAG detail a getRun overlays after a restart. */
export interface RunDagSnapshot {
  phases: RunStatusView['phases'];
  agents: AgentRecord[];
  workflowNodes: RunStatusView['workflowNodes'];
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
}

/** In-memory fake for unit tests — injected where RunStore is needed. */
export class InMemoryRunStore implements RunStore {
  private readonly _runs = new Map<string, StoredRun>();

  constructor(private readonly _clock: Clock) {}

  async createRun(spec: RunSpec, scriptVersion = 'v1', effectiveParams?: RunParams): Promise<string> {
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
    });
    return runId;
  }

  async getEffectiveParams(runId: string): Promise<RunParams | null> {
    return this._runs.get(runId)?.effectiveParams ?? null;
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
      startedBy: run.spec.startedBy ?? { type: 'unknown' },
      terminalAt: terminalTransition?.ts,
      // v15 (DES-096): omit when absent (conditional spread mirrors terminalAt pattern).
      ...(run.spec.principal ? { principal: run.spec.principal } : {}),
    };
  }

  async saveSnapshot(runId: string, snapshot: RunDagSnapshot): Promise<void> {
    const run = this._runs.get(runId);
    if (run) run.snapshot = snapshot;
  }

  async listRuns(): Promise<RunSummary[]> {
    const TERMINAL = new Set<RunStatus>(['completed', 'failed', 'stopped']);
    return [...this._runs.values()].map((r) => {
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
    });
  }

  async hydrateAll(): Promise<RunSummary[]> {
    return this.listRuns();
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
}
