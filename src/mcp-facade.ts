// McpFacade (DES-001 / ARCH-001 / TASK-002).
// Pure delegation + uniform ResultEnvelope: every tool call resolves to an envelope,
// never throws across the tool boundary (DES-001).
import { readdirSync } from 'node:fs';
import type { Clock } from './clock.js';
import { SystemClock } from './clock.js';
import type { RunStore } from './run-store.js';
import { InMemoryRunStore } from './run-store.js';
import { RunManager } from './run-manager.js';
import { SubmissionValidator } from './submission-validator.js';
import type { ErrEnvelope, ResultEnvelope, RunStatusView, RunSummary, TranscriptEvent } from './types.js';

export interface McpFacadeDeps {
  clock?: Clock;
  store?: RunStore;
  runManager?: RunManager;
  validator?: SubmissionValidator;
}

function toErrEnvelope(err: unknown): ErrEnvelope {
  if (err instanceof Error) return { code: err.name || 'INTERNAL_ERROR', message: err.message };
  return { code: 'INTERNAL_ERROR', message: String(err) };
}

function notFound(runId: string): ErrEnvelope {
  return { code: 'RUN_NOT_FOUND', message: `Run not found: ${runId}` };
}

// Shared body for suspend/resume/stop: pre-check, delegate action, post-read new status (or old on error).
async function lifecycle(
  store: RunStore,
  runId: string,
  action: () => Promise<void>,
): Promise<ResultEnvelope> {
  const view = await store.getRun(runId);
  if (!view) return { runId, status: 'failed', error: notFound(runId) };
  try {
    await action();
    const after = await store.getRun(runId);
    return { runId, status: after?.status ?? view.status };
  } catch (err) {
    return { runId, status: view.status, error: toErrEnvelope(err) };
  }
}

export class McpFacade {
  private readonly store: RunStore;
  private readonly runManager: RunManager;
  private readonly validator: SubmissionValidator;

  constructor(deps: McpFacadeDeps = {}) {
    const clock = deps.clock ?? new SystemClock();
    // Construct the store FIRST and inject it into RunManager (D-I1) — otherwise RunManager
    // builds its own private InMemoryRunStore and every lookup through `this.store` 404s
    // (RUN_NOT_FOUND) even for runs that really are in flight.
    this.store = deps.store ?? new InMemoryRunStore(clock);
    this.runManager = deps.runManager ?? new RunManager({ store: this.store, clock });
    this.validator = deps.validator ?? new SubmissionValidator({ catalog: this.runManager.catalog });
  }

  async workflow_run(a: { name?: string; script?: string; args?: unknown; budget?: number | null }): Promise<ResultEnvelope<{ runId: string }>> {
    // Fail fast at submission (DES-012/ARCH-008), never mid-run.
    const validation = await this.validator.validate({ name: a.name, script: a.script });
    if (!validation.ok) {
      return { runId: '', status: 'failed', error: validation.errors[0] };
    }
    try {
      const runId = await this.runManager.start({ name: a.name, script: a.script, args: a.args, budget: a.budget ?? null });
      const view = await this.store.getRun(runId);
      return { runId, status: view?.status ?? 'queued', result: { runId } };
    } catch (err) {
      return { runId: '', status: 'failed', error: toErrEnvelope(err) };
    }
  }

  /** Registers/updates a named workflow in the catalog (REQ-014). Not part of the DES-001 core
   *  8-tool contract, but required at the same submission-style entry point for the registry slice. */
  async workflow_register(a: { name: string; script: string }): Promise<ResultEnvelope<{ name: string; version: string }>> {
    try {
      const { version } = await this.runManager.catalog.register(a.name, a.script);
      return { runId: '', status: 'completed', result: { name: a.name, version } };
    } catch (err) {
      return { runId: '', status: 'failed', error: toErrEnvelope(err) };
    }
  }

  async workflow_status(a: { runId: string }): Promise<ResultEnvelope<RunStatusView> & Partial<RunStatusView>> {
    const view = await this.store.getRun(a.runId);
    if (!view) return { runId: a.runId, status: 'failed', error: notFound(a.runId) };
    const merged = await this.runManager.status(a.runId).catch(() => view);
    return { ...merged, result: merged };
  }

  /** Returns the script's own return value (REQ-005 acceptance), not the RunStatusView — poll
   *  workflow_status for lifecycle/observability, fetch workflow_result for the payload (D-I2). */
  async workflow_result(a: { runId: string }): Promise<ResultEnvelope> {
    const view = await this.store.getRun(a.runId);
    if (!view) return { runId: a.runId, status: 'failed', error: notFound(a.runId) };
    const outcome = await this.runManager.result(a.runId);
    if (outcome.ok) return { runId: a.runId, status: view.status, result: outcome.value };
    return { runId: a.runId, status: view.status, error: outcome.error };
  }

  async workflow_suspend(a: { runId: string }): Promise<ResultEnvelope> {
    return lifecycle(this.store, a.runId, () => this.runManager.suspend(a.runId));
  }

  async workflow_resume(a: { runId: string; script?: string }): Promise<ResultEnvelope> {
    return lifecycle(this.store, a.runId, () => this.runManager.resume(a.runId, a.script));
  }

  async workflow_stop(a: { runId: string }): Promise<ResultEnvelope> {
    return lifecycle(this.store, a.runId, () => this.runManager.stop(a.runId));
  }

  /** REQ-014: a registered workflow must be visible here BEFORE any run — result is a flat
   *  kind-discriminated array mixing catalog entries (unrun workflows) with run summaries, so
   *  callers can find either a workflow by `.name` or a run by `.runId` in the same list (D-I9). */
  async workflow_list(_a?: Record<string, never>): Promise<ResultEnvelope<Array<
    ({ kind: 'workflow'; name: string; version: string; createdAt: string }) | (RunSummary & { kind: 'run' })
  >>> {
    const workflows = await this.runManager.catalog.list();
    const runs = await this.store.listRuns();
    const result = [
      ...workflows.map((w) => ({ kind: 'workflow' as const, ...w })),
      ...runs.map((r) => ({ kind: 'run' as const, ...r })),
    ];
    return { runId: '', status: 'completed', result };
  }

  async workflow_agent_log(a: { runId: string; agentId: string }): Promise<ResultEnvelope<TranscriptEvent[]>> {
    const stored = await this.store.getRun(a.runId);
    if (!stored) return { runId: a.runId, status: 'failed', error: notFound(a.runId) };
    const view = await this.runManager.status(a.runId).catch(() => stored);
    const agent = view.agents.find((ag) => ag.agentId === a.agentId);
    if (!agent) {
      return { runId: a.runId, status: view.status, error: { code: 'AGENT_NOT_FOUND', message: `Agent not found: ${a.agentId}`, field: 'agentId' } };
    }
    // Real read-back (D-V6): the persisted transcript events for this agent, never a
    // hard-coded [] — RunStore.getTranscript reads agent-<id>.jsonl (or the in-memory
    // equivalent) that AgentExecutor's AgentTranscriptSink already appends to.
    const transcript = await this.store.getTranscript(a.runId, a.agentId);
    return { runId: a.runId, status: view.status, result: transcript };
  }

  /** REQ-013/D-V7: lists the relative file names present in a run's on-disk workspace — the
   *  smaller of D-V7's two options (no change to the widely-shared RunStatusView/RunSummary
   *  shapes). Missing/never-materialized workspace (e.g. a run that wrote nothing) → []. */
  async workflow_artifacts(a: { runId: string }): Promise<ResultEnvelope<string[]>> {
    const stored = await this.store.getRun(a.runId);
    if (!stored) return { runId: a.runId, status: 'failed', error: notFound(a.runId) };
    const workspace = await this.runManager.workspacePath(a.runId);
    if (!workspace) return { runId: a.runId, status: stored.status, result: [] };
    let files: string[] = [];
    try {
      files = readdirSync(workspace, { withFileTypes: true })
        .filter((d) => d.isFile())
        .map((d) => d.name);
    } catch {
      files = []; // workspace dir never materialized (no writes yet) — not an error
    }
    return { runId: a.runId, status: stored.status, result: files };
  }
}
