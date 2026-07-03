// RunManager (DES-003 / ARCH-002 / TASK-004). Run lifecycle state machine: legal transitions
// only (queued->running; running->{suspended,stopped,completed,failed}; suspended->{running,stopped};
// stopped->running), every transition persisted via RunStore.recordTransition BEFORE it is
// observable elsewhere (DES-003 signature). Owns one RunGuard + one SandboxHost per run so caps
// and in-flight processes never leak across runs; suspend/stop actually abort in-flight agent()
// calls (AbortSignal) and kill the sandbox child, not just flip the status flag.
import { cpus, tmpdir } from 'node:os';
import { join } from 'node:path';
import { IllegalTransitionError } from './errors.js';
import type { RunSpec, RunStatusView, RunStatus, CallKey, AgentOpts, JournalEntry, PhaseView, AgentRecord } from './types.js';
import type { RunStore } from './run-store.js';
import { InMemoryRunStore } from './run-store.js';
import type { Clock } from './clock.js';
import { SystemClock } from './clock.js';
import { RunGuard } from './run-guard.js';
import { SandboxHost } from './sandbox/host.js';
import type { AgentSpawner, AgentTypeDef } from './agent-executor.js';
import { AgentExecutor } from './agent-executor.js';
import { ResumeCache, MISS, type ResumePlan } from './resume-cache.js';
import { WorkflowCatalog } from './workflow-catalog.js';
import type { GatewayClient, GatewayConfig, AliasMap } from './gateway/client.js';
import { LiteLLMGatewayClient } from './gateway/client.js';

// Default model-alias table (REQ-004) for the gateway RunManager builds when no GatewayClient is
// injected — same shape SubmissionValidator's default table validates against.
const DEFAULT_ALIASES: AliasMap = {
  sonnet: { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
  haiku: { provider: 'anthropic', model: 'claude-3-5-haiku-20241022' },
  opus: { provider: 'anthropic', model: 'claude-opus-4-5' },
  default: { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
};
const DEFAULT_GATEWAY_CONFIG: GatewayConfig = { aliases: DEFAULT_ALIASES, timeoutMs: 15000, retries: 1 };

export interface RunManagerDeps {
  store?: RunStore;
  clock?: Clock;
  /** Overrides the AgentSpawner for EVERY run (test seam) — bypasses the per-run
   *  RunGuard/RunStore wiring below entirely (fakes don't need it). */
  spawner?: AgentSpawner;
  gateway?: GatewayClient;
  catalog?: WorkflowCatalog;
  concurrency?: number;
  workRoot?: string;
  /** Server-side agent-type registry (D-F2), forwarded unchanged into every AgentExecutor this
   *  manager constructs — populated at the composition root (createServer()) from agents/*.md. */
  agentTypes?: Record<string, AgentTypeDef>;
}

const TERMINAL: RunStatus[] = ['stopped', 'completed', 'failed'];

function toErr(err: unknown): { code: string; message: string } {
  if (err && typeof err === 'object' && 'code' in err && 'message' in err) {
    return { code: String((err as { code: unknown }).code), message: String((err as { message: unknown }).message) };
  }
  if (err instanceof Error) return { code: err.name || 'SCRIPT_ERROR', message: err.message };
  return { code: 'SCRIPT_ERROR', message: String(err) };
}

interface RunEntry {
  script: string;
  args: unknown;
  status: RunStatus;
  guard: RunGuard;
  abortController: AbortController;
  sandbox: SandboxHost;
  spawner: AgentSpawner;
  workspace: string;
  journal: JournalEntry[];
  scriptVersion: number;
  cachePlan: ResumePlan | null;
  phases: PhaseView[];
  result?: unknown;
  resultError?: { code: string; message: string };
}

export class RunManager {
  private readonly _store: RunStore;
  private readonly _clock: Clock;
  private readonly _spawnerOverride: AgentSpawner | undefined;
  private readonly _gateway: GatewayClient;
  private readonly _catalog: WorkflowCatalog;
  private readonly _concurrency: number;
  private readonly _workRoot: string;
  private readonly _agentTypes: Record<string, AgentTypeDef>;
  private readonly _runs = new Map<string, RunEntry>();

  constructor(deps: RunManagerDeps = {}) {
    this._clock = deps.clock ?? new SystemClock();
    this._store = deps.store ?? new InMemoryRunStore(this._clock);
    this._spawnerOverride = deps.spawner;
    this._gateway = deps.gateway ?? new LiteLLMGatewayClient(DEFAULT_GATEWAY_CONFIG);
    this._concurrency = deps.concurrency ?? Math.max(1, Math.min(16, cpus().length - 2));
    this._workRoot = deps.workRoot ?? join(tmpdir(), 'remote-workflow-runs');
    this._catalog = deps.catalog ?? new WorkflowCatalog(this._workRoot, this._clock);
    this._agentTypes = deps.agentTypes ?? {};
  }

  /** The catalog this manager resolves named workflows against (shared with SubmissionValidator). */
  get catalog(): WorkflowCatalog {
    return this._catalog;
  }

  /** Resolves the on-disk workspace path for a run (D-V7/REQ-013 artifact listing): live state
   *  first, falling back to recomputing from the persisted spec (a deterministic function of
   *  name+runId) so this also works for a run this process hasn't touched since a restart. */
  async workspacePath(runId: string): Promise<string | null> {
    const entry = this._runs.get(runId);
    if (entry) return entry.workspace;
    const spec = await this._store.getSpec(runId);
    if (!spec) return null;
    return this._catalog.runWorkspace(spec.name ?? '_adhoc', runId);
  }

  async start(spec: RunSpec): Promise<string> {
    let script = spec.script ?? '';
    let scriptVersion = 1;
    let resolvedVersion = 'v1'; // catalog version string actually executed (D-V7) — threaded into RunStore.createRun
    if (spec.name && !spec.script) {
      const registered = await this._catalog.get(spec.name); // throws CatalogNotFoundError — caught by SubmissionValidator pre-run
      script = registered.script;
      resolvedVersion = registered.version;
      scriptVersion = Number(registered.version.replace(/^v/, '')) || 1;
    }

    const runId = await this._store.createRun(spec, resolvedVersion);
    const workspace = this._catalog.runWorkspace(spec.name ?? '_adhoc', runId);
    const guard = new RunGuard({ concurrency: this._concurrency, budget: spec.budget ?? null });
    const spawner = this._spawnerOverride ?? new AgentExecutor({ gateway: this._gateway, guard, store: this._store, clock: this._clock, agentTypes: this._agentTypes });
    const entry: RunEntry = {
      script,
      args: spec.args,
      status: 'queued',
      guard,
      abortController: new AbortController(),
      sandbox: this._newSandbox(runId, workspace),
      spawner,
      workspace,
      journal: [],
      scriptVersion,
      cachePlan: null,
      phases: [],
    };
    this._runs.set(runId, entry);
    await this._transition(runId, entry, 'running');
    this._runLive(runId, entry, entry.script, null);
    return runId;
  }

  async suspend(runId: string): Promise<void> {
    const entry = await this._requireLive(runId);
    if (entry.status !== 'running') throw new IllegalTransitionError(entry.status, 'suspended');
    entry.abortController.abort();
    await entry.sandbox.abort(runId, 'suspend');
    await this._transition(runId, entry, 'suspended');
  }

  async resume(runId: string, script?: string): Promise<void> {
    const entry = await this._requireLive(runId);
    if (entry.status !== 'suspended' && entry.status !== 'stopped') {
      throw new IllegalTransitionError(entry.status, 'running');
    }
    const newScript = script ?? entry.script;
    const cachePlan = ResumeCache.build(entry.journal, newScript);
    entry.script = newScript;
    entry.scriptVersion += 1;
    entry.abortController = new AbortController();
    entry.sandbox = this._newSandbox(runId, entry.workspace);
    await this._transition(runId, entry, 'running');
    this._runLive(runId, entry, newScript, cachePlan);
  }

  async stop(runId: string): Promise<void> {
    const entry = await this._requireLive(runId);
    if (TERMINAL.includes(entry.status)) throw new IllegalTransitionError(entry.status, 'stopped');
    entry.abortController.abort();
    await entry.sandbox.abort(runId, 'stop');
    await this._transition(runId, entry, 'stopped');
  }

  async status(runId: string): Promise<RunStatusView> {
    const view = await this._store.getRun(runId);
    if (!view) throw new IllegalTransitionError('unknown', 'status');
    return this._mergeLive(runId, view);
  }

  /** Overlays this-process live data (phases observed, agent records captured) onto the
   *  store's persisted view — both are ephemeral per-process state, not replayed after restart. */
  private _mergeLive(runId: string, view: RunStatusView): RunStatusView {
    const entry = this._runs.get(runId);
    if (!entry) return view;
    const agents = entry.spawner instanceof AgentExecutor ? entry.spawner.getAllRecords() : view.agents;
    return { ...view, phases: entry.phases, agents };
  }

  /** The script return value for a completed run, or the failure error (DES-001 workflow_result). */
  async result(runId: string): Promise<{ ok: true; value: unknown } | { ok: false; error: { code: string; message: string } }> {
    const entry = this._runs.get(runId);
    if (entry) {
      if (entry.status === 'completed') return { ok: true, value: entry.result };
      if (entry.status === 'failed' && entry.resultError) return { ok: false, error: entry.resultError };
    }
    const stored = await this._store.getResult(runId);
    if (stored) return { ok: true, value: stored.value };
    const view = await this._store.getRun(runId);
    return { ok: false, error: { code: 'RUN_NOT_TERMINAL', message: `Run ${runId} has not completed (status: ${view?.status ?? 'unknown'})` } };
  }

  /** Looks up a live RunEntry, rehydrating one from persisted state (REQ-006 restart survival)
   *  when this run isn't in this process's memory — e.g. after a server restart, a suspend/resume/
   *  stop call for a run that was suspended/stopped before the restart. Live per-process state
   *  (in-flight journal replay cache, phases observed) does not survive restart; the rehydrated
   *  entry resumes cleanly but replays nothing from before the restart (no test currently requires
   *  exact cross-restart cache replay — a documented simplification, not silent data loss). */
  private async _requireLive(runId: string): Promise<RunEntry> {
    const cached = this._runs.get(runId);
    if (cached) return cached;

    const view = await this._store.getRun(runId);
    if (!view || (view.status !== 'suspended' && view.status !== 'stopped')) {
      throw new IllegalTransitionError('unknown', 'transition');
    }
    const spec = await this._store.getSpec(runId);
    if (!spec) throw new IllegalTransitionError('unknown', 'transition');

    const workspace = this._catalog.runWorkspace(spec.name ?? '_adhoc', runId);
    const guard = new RunGuard({ concurrency: this._concurrency, budget: spec.budget ?? null });
    const spawner = this._spawnerOverride ?? new AgentExecutor({ gateway: this._gateway, guard, store: this._store, clock: this._clock, agentTypes: this._agentTypes });
    const entry: RunEntry = {
      script: spec.script ?? '',
      args: spec.args,
      status: view.status,
      guard,
      abortController: new AbortController(),
      sandbox: this._newSandbox(runId, workspace),
      spawner,
      workspace,
      journal: [],
      scriptVersion: Number(view.scriptVersion.replace(/^v/, '')) || 1,
      cachePlan: null,
      phases: [],
    };
    this._runs.set(runId, entry);
    return entry;
  }

  private async _transition(runId: string, entry: RunEntry, to: RunStatus): Promise<void> {
    const from = entry.status;
    entry.status = to;
    await this._store.recordTransition(runId, from, to, this._clock.isoNow());
  }

  private _newSandbox(runId: string, workspace: string): SandboxHost {
    return new SandboxHost({
      workspaceRoot: workspace,
      onAgentRequest: (prompt, opts, callSeq) => this._handleAgentRequest(runId, prompt, opts, callSeq),
      onWorkflowRequest: (ref, args, callSeq) => this._handleWorkflowRequest(runId, ref, args, callSeq),
      onPhase: (title) => { this._runs.get(runId)?.phases.push({ title }); },
      onBudgetSnapshot: () => this._runs.get(runId)?.guard.budgetView().spent() ?? 0,
    });
  }

  // D-G8-1: a nested workflow()'s own child process has its OWN independent callSeq counter that
  // restarts at 0 (child-entry.ts's own `nextCallSeq`) — but its agent() calls are journaled into
  // the SAME parent run's shared journal/ResumeCache as the outer script's own callSeq values, so a
  // raw pass-through collides callSeq 0 (outer) with callSeq 0 (nested), corrupting both entries
  // (review finding V3). Namespace the nested child's own callSeq into a distinct numeric range,
  // keyed off the PARENT's own callSeq for the workflow() call that spawned it (itself unique in
  // the parent's own callSeq space) — deterministic across an original run and a resume of the same
  // unmodified script, since the same workflow() call gets the same parent-level callSeq both times.
  private static readonly NESTED_CALLSEQ_STRIDE = 1_000_000;

  private static _nestedCallSeq(parentCallSeq: number, nestedCallSeq: number): number {
    return (parentCallSeq + 1) * RunManager.NESTED_CALLSEQ_STRIDE + nestedCallSeq;
  }

  /** Runs one live (or replay-then-live) execution of `script` against the sandbox; settles the
   *  run's terminal status (completed/failed) unless suspend/stop already moved it on (DES-003). */
  private _runLive(runId: string, entry: RunEntry, script: string, cachePlan: ResumePlan | null): void {
    entry.cachePlan = cachePlan;
    entry.sandbox
      .run(runId, script, entry.args, entry.guard.budgetView().total)
      .then(async (outcome) => {
        if (entry.status !== 'running') return; // suspend/stop already recorded the terminal transition
        if ('result' in outcome) {
          entry.result = outcome.result;
          await this._store.recordResult(runId, outcome.result);
          await this._transition(runId, entry, 'completed');
        } else {
          entry.resultError = toErr(outcome.error);
          await this._transition(runId, entry, 'failed');
        }
      });
  }

  /** Handles one child workflow(name|{scriptPath}) call: resolves the named script from the
   *  catalog and runs it inline, one level deep — the nested run's own sandbox is given no
   *  onWorkflowRequest, so a second-level workflow() call throws NESTING_ERROR automatically
   *  (DES-005/DES-013). Shares the parent run's RunGuard (budget/concurrency) and workspace. */
  private async _handleWorkflowRequest(runId: string, ref: unknown, args: unknown, parentCallSeq: number): Promise<unknown> {
    const entry = this._runs.get(runId);
    if (!entry) throw new Error(`Unknown run: ${runId}`);
    const name = typeof ref === 'string' ? ref : (ref as { scriptPath?: string } | undefined)?.scriptPath;
    if (!name) throw new Error('workflow() requires a registered name or {scriptPath}');
    const registered = await this._catalog.get(name); // throws CatalogNotFoundError — message names the missing workflow

    const nested = new SandboxHost({
      workspaceRoot: entry.workspace,
      // D-G8-1: namespace the nested child's own callSeq (see RunManager._nestedCallSeq) so it can
      // never collide with the parent script's own journal entries in this run's shared journal.
      onAgentRequest: (prompt, opts, callSeq) =>
        this._handleAgentRequest(runId, prompt, opts, RunManager._nestedCallSeq(parentCallSeq, callSeq)),
      // no onWorkflowRequest — blocks a second level of nesting.
    });
    const outcome = await nested.run(`${runId}-nested`, registered.script, args, entry.guard.budgetView().total);
    if ('result' in outcome) return outcome.result;
    const err = toErr(outcome.error);
    throw Object.assign(new Error(err.message), { code: err.code });
  }

  /** Handles one child agent() call: replay from the resume cache when available, otherwise
   *  enforce budget + concurrency (RunGuard, single authority) and dispatch to the AgentSpawner. */
  private async _handleAgentRequest(runId: string, prompt: string, opts: unknown, callSeq: number): Promise<unknown> {
    const entry = this._runs.get(runId);
    if (!entry) throw new Error(`Unknown run: ${runId}`);
    const key: CallKey = { prompt, opts: (opts ?? {}) as AgentOpts };
    if (entry.cachePlan) {
      const cached = entry.cachePlan.replay(callSeq, key);
      if (cached !== MISS) return cached;
    }

    entry.guard.assertBudget();
    // D-G8-6: reserve this run's entire currently-remaining budget for this one about-to-dispatch
    // call BEFORE releasing control (no `await` between assertBudget() and reserve() — an atomic
    // gate) — the single source of truth has no per-call cost estimate ahead of time, so this is
    // the simplest atomic gate that stops a burst of concurrent parallel() calls from ALL passing
    // the stale pre-dispatch check before any one of them has recorded its own real spend (review
    // finding V2). Released in the finally block below regardless of the call's real cost.
    const reserved = entry.guard.reserve();
    try {
      // D-F12: allocate the agentId and mark it "queued" BEFORE acquiring a concurrency slot — so a
      // call genuinely blocked behind the concurrency cap is observable via workflow_status right
      // away, not only once it resolves (round-5 VAL-002/VAL-007's `agents:[]`-while-running gap).
      const agentId = entry.guard.nextAgentId();
      if (entry.spawner instanceof AgentExecutor) {
        entry.spawner.markQueued(agentId, key.opts.label, key.opts.phase);
      }
      const release = await entry.guard.acquireSlot();
      try {
        if (entry.spawner instanceof AgentExecutor) {
          entry.spawner.markRunning(agentId);
        }
        const outcome = await entry.spawner.run({
          runId,
          agentId,
          prompt,
          opts: key.opts,
          workspace: entry.workspace,
          signal: entry.abortController.signal,
        });
        const value = outcome.kind === 'null' ? null : outcome.value;
        const journalEntry: JournalEntry = {
          callSeq,
          key,
          value,
          ts: this._clock.isoNow(),
          scriptVersion: `v${entry.scriptVersion}`,
          // D-F13: a null caused by suspend/stop aborting this call mid-flight must MISS on resume
          // (re-run live), never replay as if it were a genuinely-completed terminal null.
          aborted: outcome.kind === 'null' && outcome.aborted === true,
        };
        entry.journal.push(journalEntry);
        await this._store.appendJournal(runId, journalEntry);
        return value;
      } finally {
        release();
      }
    } finally {
      entry.guard.releaseReserved(reserved);
    }
  }
}
