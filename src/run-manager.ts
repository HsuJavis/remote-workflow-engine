// RunManager (DES-003 / ARCH-002 / TASK-004). Run lifecycle state machine: legal transitions
// only (queued->running; running->{suspended,stopped,completed,failed}; suspended->{running,stopped};
// stopped->running), every transition persisted via RunStore.recordTransition BEFORE it is
// observable elsewhere (DES-003 signature). Owns one RunGuard + one SandboxHost per run so caps
// and in-flight processes never leak across runs; suspend/stop actually abort in-flight agent()
// calls (AbortSignal) and kill the sandbox child, not just flip the status flag.
import { cpus, tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { materializeSeed, materializeManifest } from './workspace-seed.js';
import type { CasStore } from './cas-store.js';
import { initGitBaseline } from './workspace-git.js';
import { listArtifacts, type ArtifactEntry } from './workspace-artifacts.js';
import { IllegalTransitionError, codedError } from './errors.js';
import type { RunSpec, RunStatusView, RunStatus, CallKey, AgentOpts, JournalEntry, PhaseView, AgentRecord, WorkflowNodeView } from './types.js';
import type { RunStore } from './run-store.js';
import { InMemoryRunStore, sumUsageTokens } from './run-store.js';
import type { Clock } from './clock.js';
import { SystemClock } from './clock.js';
import { RunGuard } from './run-guard.js';
import { createSemaphore, type Semaphore, type SemaphoreGauge } from './agent-semaphore.js';
import { SandboxHost } from './sandbox/host.js';
import type { AgentSpawner, AgentTypeDef } from './agent-executor.js';
import { AgentExecutor } from './agent-executor.js';
import { ResumeCache, MISS, type ResumePlan } from './resume-cache.js';
import { WorkflowCatalog } from './workflow-catalog.js';
import type { GatewayClient, GatewayConfig } from './gateway/client.js';
import { LiteLLMGatewayClient } from './gateway/client.js';
import { DEFAULT_ALIASES } from './default-aliases.js';

// Default gateway config (REQ-004) for the gateway RunManager builds when no GatewayClient is
// injected — routes through the single-source DEFAULT_ALIASES table (src/default-aliases.ts).
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
  /** D-V3M-2 (REQ-020 / D-DOS, TASK-035/DES-027/ARCH-002): the ONE process-global agent-slot
   *  semaphore rationing SDK-CLI subprocess spawns across ALL runs — built at the composition root
   *  (createServer) and observed via `GET /api/status`. Omitted (bare/test callers) -> an
   *  effectively-unbounded local semaphore so direct RunManager construction keeps its exact prior
   *  concurrency behavior; only the real cap is imposed at the composition root. */
  semaphore?: Semaphore;
  /** v8 Slice 1 (REQ-041): max `workflow()` nesting depth — a registered composite may be a node
   *  inside another composite up to this many levels (top run = depth 0; first workflow() = depth 1).
   *  Default 4. Invalid (≤0 / non-integer) is rejected at construction. */
  maxWorkflowDepth?: number;
  /** v8 Slice 1 (REQ-043): max total nested workflow() invocations across a run's whole tree
   *  (bounds fan-out × depth independently of maxWorkflowDepth). Default 256. */
  maxWorkflowDescendants?: number;
  /** v8 Slice 4 (REQ-052): fired once from the authoritative terminal `_transition` for each
   *  top-level run reaching completed/failed/stopped. Fire-and-forget (a throwing listener never
   *  wedges the run's terminal write). The continuation store subscribes here (REQ-053). */
  onTerminal?: (runId: string, status: RunStatus) => void;
  /** v8 Slice 4 (REQ-054): max live (non-terminal) top-level runs; an over-limit start() is rejected
   *  with RUN_ADMISSION_LIMIT before any durable work. Default 64. Invalid (≤0/non-integer) rejected. */
  maxConcurrentRuns?: number;
  /** v10 Slice 2 (REQ-065): the content-addressed store used to assemble a run's workspace from a
   *  `seedManifest`. Omitted → a seedManifest spec is rejected (no store to read blobs from). */
  cas?: CasStore;
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
  /** Top-level workflow name (undefined for an ad-hoc script run) — seeds the nesting ancestor set
   *  so a top→…→top cycle is caught (v8 REQ-042). */
  name?: string;
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
  /** v8 REQ-043: running count of nested workflow() invocations across this run's whole tree. */
  descendants: number;
  /** v8 REQ-044: deterministic frame-path → journal callSeq base allocation for nested runs, keeping
   *  nested callSeq keys unique AND within MAX_SAFE_INTEGER at any depth (replaces the old
   *  (parentCallSeq+1)*1e6+n multiply scheme, which overflowed past ~depth 2). */
  nestedFrames: Map<string, number>;
  nestedFrameSeq: number;
  /** v8 REQ-046: nested workflow() boundary nodes recorded as the run composes — surfaced by
   *  workflow_status (via _mergeLive) so the dashboard can render composites as sub-cards. */
  workflowNodes: WorkflowNodeView[];
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
  private readonly _semaphore: Semaphore;
  private readonly _maxWorkflowDepth: number;
  private readonly _maxWorkflowDescendants: number;
  private readonly _onTerminal: ((runId: string, status: RunStatus) => void) | undefined;
  private readonly _maxConcurrentRuns: number;
  private readonly _cas: CasStore | undefined;
  private readonly _runs = new Map<string, RunEntry>();

  /** v8 Slice 1: config values are positive integers — reject bad config loudly at construction
   *  (the composition root builds RunManager from rwe.config.json, so this IS the config-load check). */
  private static _positiveInt(value: number | undefined, fallback: number, name: string): number {
    if (value === undefined) return fallback;
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`${name} must be a positive integer, got ${value}`);
    }
    return value;
  }

  constructor(deps: RunManagerDeps = {}) {
    this._clock = deps.clock ?? new SystemClock();
    this._store = deps.store ?? new InMemoryRunStore(this._clock);
    this._spawnerOverride = deps.spawner;
    this._gateway = deps.gateway ?? new LiteLLMGatewayClient(DEFAULT_GATEWAY_CONFIG);
    this._concurrency = deps.concurrency ?? Math.max(1, Math.min(16, cpus().length - 2));
    this._workRoot = deps.workRoot ?? join(tmpdir(), 'remote-workflow-runs');
    this._catalog = deps.catalog ?? new WorkflowCatalog(this._workRoot, this._clock);
    this._agentTypes = deps.agentTypes ?? {};
    // D-V3M-2: unbounded local default (1024 ≫ the 1000-agent lifetime cap) preserves the exact
    // prior behavior for every direct RunManager caller; the real DOS cap is injected by createServer.
    this._semaphore = deps.semaphore ?? createSemaphore(1024);
    this._maxWorkflowDepth = RunManager._positiveInt(deps.maxWorkflowDepth, 4, 'maxWorkflowDepth');
    this._maxWorkflowDescendants = RunManager._positiveInt(deps.maxWorkflowDescendants, 256, 'maxWorkflowDescendants');
    this._onTerminal = deps.onTerminal;
    this._maxConcurrentRuns = RunManager._positiveInt(deps.maxConcurrentRuns, 64, 'maxConcurrentRuns');
    this._cas = deps.cas;
  }

  /** v8 Slice 4 (REQ-054): count of live (non-terminal) top-level runs in this process — the
   *  admission-gate live count (synchronous, drift-free: a resumed run is naturally re-counted by its
   *  status, no increment/decrement to get wrong). Nested runs are not in _runs, so never counted. */
  private _liveRunCount(): number {
    let n = 0;
    for (const e of this._runs.values()) if (!TERMINAL.includes(e.status)) n++;
    return n;
  }

  /** D-V3M-2 (REQ-020 D-DOS gauge): a snapshot of the process-global agent-slot semaphore, surfaced
   *  by `GET /api/status` — total capacity, in-use slots, and the FIFO wait-queue depth. */
  semaphoreGauge(): SemaphoreGauge {
    return this._semaphore.gauge();
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

  /** R-3 (review finding): the run-workspace artifact listing (REQ-023), owned by the workspace
   *  owner (RunManager) so the MCP facade reads through this domain layer instead of reaching into
   *  the filesystem itself. `null` when the run has no on-disk workspace (unknown run); `[]` when the
   *  workspace dir was never materialized (a run that wrote nothing) — the latter is not an error. */
  async listArtifacts(runId: string): Promise<ArtifactEntry[] | null> {
    const workspace = await this.workspacePath(runId);
    if (!workspace) return null;
    try {
      return listArtifacts(workspace);
    } catch {
      return [];
    }
  }

  async start(spec: RunSpec): Promise<string> {
    // v8 REQ-054: admission chokepoint — reject BEFORE any durable/expensive work (createRun,
    // workspace mkdir, seed, sandbox spawn) when the cap is already reached. The global agent
    // semaphore caps only agent() dispatch, not run count / sandbox forks / workspace materialization.
    if (this._liveRunCount() >= this._maxConcurrentRuns) {
      throw codedError('RUN_ADMISSION_LIMIT', `maxConcurrentRuns=${this._maxConcurrentRuns} reached; run rejected`);
    }
    // Defense-in-depth (issue #21): the seed params are arrays, but a non-compliant / schema-blind MCP
    // client can hand a JSON-stringified array through (the crash the schema fix in server.ts prevents
    // for compliant clients). A bare string has `.length` and passes `&& length > 0`, then `.map(...)`
    // throws a raw `TypeError: … .map is not a function`. Reject a non-array here with a typed,
    // actionable error BEFORE any durable work, whatever the client's serialization quirk.
    if (spec.seed !== undefined && !Array.isArray(spec.seed)) {
      throw codedError('INVALID_SEED_SPEC', `seed must be an array of {path, contentB64}; got ${typeof spec.seed}`);
    }
    if (spec.seedManifest !== undefined && !Array.isArray(spec.seedManifest)) {
      throw codedError('INVALID_SEED_SPEC', `seedManifest must be an array of {path, sha256, exec?}; got ${typeof spec.seedManifest}`);
    }
    // v10 REQ-065: fail fast (before any durable work) if a seedManifest references blobs the client
    // hasn't uploaded — surface the missing shas so the client blob_put's them and retries.
    if (spec.seedManifest && spec.seedManifest.length > 0) {
      if (!this._cas) throw codedError('CAS_UNAVAILABLE', 'seedManifest requires a configured content store');
      const ns = spec.seedNamespace ?? '_default';
      const missing = await this._cas.missing(ns, spec.seedManifest.map((e) => e.sha256));
      if (missing.length > 0) throw codedError('MISSING_BLOBS', `upload ${missing.length} blob(s) first: ${missing.slice(0, 8).join(',')}${missing.length > 8 ? '…' : ''}`);
    }
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
    // REQ-025 (v2) / REQ-065 (v10): materialize a seed into the workspace BEFORE any agent starts
    // (engine-side, so replay/determinism holds) — from an inline tree (`seed`) or a CAS manifest
    // (`seedManifest`, blobs verified present above). Both go through the SAME guardrails and the SAME
    // pre/post steps (mkdir + git baseline), differing only in the materializer — pick it once.
    const cas = this._cas;
    const materialize =
      spec.seed && spec.seed.length > 0 ? (ws: string) => { materializeSeed(ws, spec.seed!); } :
      spec.seedManifest && spec.seedManifest.length > 0 && cas ? (ws: string) => { materializeManifest(ws, spec.seedManifest!, (sha) => cas.readBlobSync(sha)); } :
      null;
    if (materialize) {
      mkdirSync(workspace, { recursive: true });
      materialize(workspace);
      // REQ-027 (v2.5): the client cannot seed `.git/`, so the engine gives the seeded tree a
      // brownfield git baseline here — the SDLC precheck needs a work tree + a commit to diff against.
      // Best-effort: a null baseSha never fails the run.
      initGitBaseline(workspace);
    }
    const guard = new RunGuard({ concurrency: this._concurrency, budget: spec.budget ?? null });
    const spawner = this._spawnerOverride ?? new AgentExecutor({ gateway: this._gateway, guard, store: this._store, clock: this._clock, agentTypes: this._agentTypes });
    const entry: RunEntry = {
      script,
      args: spec.args,
      name: spec.name,
      status: 'queued',
      guard,
      abortController: new AbortController(),
      sandbox: this._newSandbox(runId, workspace, spec.name),
      spawner,
      workspace,
      journal: [],
      scriptVersion,
      cachePlan: null,
      phases: [],
      descendants: 0,
      nestedFrames: new Map(),
      nestedFrameSeq: 0,
      workflowNodes: [],
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
    // v8 Defer A (REQ-060): `interrupted` (crashed while running) is resumable, like suspended/stopped.
    if (entry.status !== 'suspended' && entry.status !== 'stopped' && entry.status !== 'interrupted') {
      throw new IllegalTransitionError(entry.status, 'running');
    }
    const newScript = script ?? entry.script;
    const cachePlan = ResumeCache.build(entry.journal, newScript);
    entry.script = newScript;
    entry.scriptVersion += 1;
    entry.abortController = new AbortController();
    entry.sandbox = this._newSandbox(runId, entry.workspace, entry.name);
    // v8 REQ-044: reset the deterministic nested-frame allocator + descendant counter so a resumed
    // re-execution re-allocates the SAME frame bases in the same order (replay-stable callSeqs).
    entry.descendants = 0;
    entry.nestedFrames = new Map();
    entry.nestedFrameSeq = 0;
    entry.workflowNodes = [];
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
    return { ...view, phases: entry.phases, agents, workflowNodes: entry.workflowNodes };
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
    if (!view || (view.status !== 'suspended' && view.status !== 'stopped' && view.status !== 'interrupted')) {
      throw new IllegalTransitionError('unknown', 'transition');
    }
    const spec = await this._store.getSpec(runId);
    if (!spec) throw new IllegalTransitionError('unknown', 'transition');
    // v8 Defer A (fix): a NAMED-workflow run stores no inline script on its spec (start() resolves it
    // from the catalog at launch), so `spec.script` is empty — resume/rehydrate must re-resolve the
    // script from the catalog the SAME way start() does, or the resumed run executes an empty script
    // and returns undefined. (Pre-Defer-A, no test covered a named-workflow restart-resume.)
    let script = spec.script ?? '';
    if (spec.name && !spec.script) {
      const registered = await this._catalog.get(spec.name); // throws CatalogNotFoundError — same as start()
      script = registered.script;
    }
    // v8 Defer A (REQ-059): read the persisted journal back so a run resumed in a fresh process
    // replays its settled agent()/workflow() calls from cache instead of re-running them live.
    const persistedJournal = await this._store.getJournal(runId);

    const workspace = this._catalog.runWorkspace(spec.name ?? '_adhoc', runId);
    const guard = new RunGuard({ concurrency: this._concurrency, budget: spec.budget ?? null });
    // DES-068 (TASK-071): hydrate the guard's spent count from the persisted journal transcripts so
    // the budget cap is correctly enforced on resume. Fold-only (pure); never adds snapshot totals.
    if (spec.budget !== null && spec.budget !== undefined) {
      const allEvents = (await Promise.all(
        view.agents.map((a) => this._store.getTranscript(runId, a.agentId)),
      )).flat();
      guard.setSpent(sumUsageTokens(allEvents));
    }
    const spawner = this._spawnerOverride ?? new AgentExecutor({ gateway: this._gateway, guard, store: this._store, clock: this._clock, agentTypes: this._agentTypes });
    const entry: RunEntry = {
      script,
      args: spec.args,
      name: spec.name,
      status: view.status,
      guard,
      abortController: new AbortController(),
      sandbox: this._newSandbox(runId, workspace, spec.name),
      spawner,
      workspace,
      journal: persistedJournal,
      scriptVersion: Number(view.scriptVersion.replace(/^v/, '')) || 1,
      cachePlan: null,
      phases: [],
      descendants: 0,
      nestedFrames: new Map(),
      nestedFrameSeq: 0,
      workflowNodes: [],
    };
    this._runs.set(runId, entry);
    return entry;
  }

  private async _transition(runId: string, entry: RunEntry, to: RunStatus): Promise<void> {
    const from = entry.status;
    entry.status = to;
    await this._store.recordTransition(runId, from, to, this._clock.isoNow());
    // v8 REQ-055: persist a one-shot DAG snapshot at the terminal transition (covers failed/stopped,
    // not only completed) so a composite run's nested tree/phases/agent-frames survive a restart.
    if (TERMINAL.includes(to)) {
      const agents = entry.spawner instanceof AgentExecutor ? entry.spawner.getAllRecords() : [];
      await this._store.saveSnapshot(runId, { phases: entry.phases, agents, workflowNodes: entry.workflowNodes });
    }
    // v8 REQ-052: fire onTerminal from the ONE authoritative choke (covers stopped, which the
    // un-.catch'd .then in _runLive never sees) — AFTER the transition is persisted, and NOT awaited,
    // so a slow/throwing listener (e.g. a continuation starting run B) can never wedge A's terminal write.
    if (TERMINAL.includes(to) && this._onTerminal) {
      const fire = this._onTerminal;
      queueMicrotask(() => { try { fire(runId, to); } catch { /* listener errors never wedge the run */ } });
    }
  }

  private _newSandbox(runId: string, workspace: string, topName?: string): SandboxHost {
    // v8 REQ-042: seed the top-level nesting chain with the run's own workflow name (if any), so a
    // composite that eventually calls back into itself is caught as a cycle.
    const topAncestors = new Set<string>(topName ? [topName] : []);
    return new SandboxHost({
      workspaceRoot: workspace,
      onAgentRequest: (prompt, opts, callSeq) => this._handleAgentRequest(runId, prompt, opts, callSeq, ''),
      onWorkflowRequest: (ref, args, callSeq) => this._handleWorkflowRequest(runId, ref, args, '', callSeq, 1, topAncestors),
      onPhase: (title) => { this._runs.get(runId)?.phases.push({ title, ts: this._clock.isoNow() }); },
      onBudgetSnapshot: () => this._runs.get(runId)?.guard.budgetView().spent() ?? 0,
    });
  }

  // v8 REQ-044 (supersedes D-G8-1): a nested workflow()'s own child process has its OWN callSeq
  // counter starting at 0, but its agent() calls are journaled into the SAME parent run's shared
  // journal/ResumeCache — so nested callSeq values must be namespaced to never collide. The prior
  // (parentCallSeq+1)*1e6+n multiply scheme composed MULTIPLICATIVELY per level and overflowed
  // MAX_SAFE_INTEGER past ~depth 2 (now that N-level nesting is allowed). Instead, each distinct
  // nested FRAME (a workflow() call site, identified by its deterministic ancestor callSeq path) is
  // allocated one base = frameSeq * STRIDE, additively; a frame's agent() callSeq = base + local.
  // frameSeq is allocated on first touch in execution order, which is deterministic (parallel()
  // invokes thunks in array order) and identical on resume, so the same call gets the same key.
  // STRIDE bounds calls-per-frame (< STRIDE, enforced by the agent/descendant caps); frameSeq stays
  // far within MAX_SAFE_INTEGER (9e15/1e6 ≈ 9e9 frames >> the descendant cap).
  private static readonly NESTED_FRAME_STRIDE = 1_000_000;

  private _frameBaseFor(entry: RunEntry, pathKey: string): number {
    let base = entry.nestedFrames.get(pathKey);
    if (base === undefined) {
      base = (entry.nestedFrameSeq += 1) * RunManager.NESTED_FRAME_STRIDE;
      entry.nestedFrames.set(pathKey, base);
    }
    return base;
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

  /** Handles one child workflow(name|{scriptPath}) call: resolves the named script from the catalog
   *  and runs it inline as a NESTED run (v8 Slice 1 — N levels deep up to maxWorkflowDepth). Shares
   *  the parent run's RunGuard (one budget for the whole graph) and workspace. The nested sandbox is
   *  wired with its own onWorkflowRequest so a deeper workflow() recurses here with depth+1 and the
   *  extended ancestor set — bounded by three fail-closed guards:
   *    REQ-041 depth   > maxWorkflowDepth        → NESTING_DEPTH_EXCEEDED
   *    REQ-042 cycle    (target ∈ ancestors)      → NESTING_CYCLE
   *    REQ-043 descendants > maxWorkflowDescendants → DESCENDANT_CAP_EXCEEDED
   *  `depth` is the depth of THIS call (top run = 0; first workflow() = 1). `ancestors` is the set of
   *  workflow names already on the chain (incl. the top run's own name). */
  private async _handleWorkflowRequest(
    runId: string,
    ref: unknown,
    args: unknown,
    parentPathKey: string,
    parentCallSeq: number,
    depth: number,
    ancestors: Set<string>,
  ): Promise<unknown> {
    const entry = this._runs.get(runId);
    if (!entry) throw new Error(`Unknown run: ${runId}`);
    const name = typeof ref === 'string' ? ref : (ref as { scriptPath?: string } | undefined)?.scriptPath;
    if (!name) throw new Error('workflow() requires a registered name or {scriptPath}');

    if (depth > this._maxWorkflowDepth) {
      throw codedError('NESTING_DEPTH_EXCEEDED', `workflow() nesting depth ${depth} exceeds maxWorkflowDepth=${this._maxWorkflowDepth}`);
    }
    if (ancestors.has(name)) {
      throw codedError('NESTING_CYCLE', `workflow() cycle: '${name}' is already an ancestor in this nesting chain`);
    }
    if ((entry.descendants += 1) > this._maxWorkflowDescendants) {
      throw codedError('DESCENDANT_CAP_EXCEEDED', `workflow() exceeds maxWorkflowDescendants=${this._maxWorkflowDescendants} for this run`);
    }

    const registered = await this._catalog.get(name); // throws CatalogNotFoundError — message names the missing workflow
    const framePathKey = `${parentPathKey}.${parentCallSeq}`;
    const frameBase = this._frameBaseFor(entry, framePathKey);
    const childAncestors = new Set(ancestors).add(name);
    // v8 REQ-046: record this nested workflow() call as a composite-boundary node (dashboard sub-card).
    entry.workflowNodes.push({ frame: framePathKey, name, parentFrame: parentPathKey, depth });

    const nested = new SandboxHost({
      workspaceRoot: entry.workspace,
      // v8 REQ-044: nested agent() callSeqs are namespaced into this frame's base (see _frameBaseFor)
      // so they never collide with the parent's own or a sibling frame's entries in the shared journal.
      // v8 REQ-045: the nested agents are tagged with THIS frame's path so the dashboard nests them.
      onAgentRequest: (prompt, opts, callSeq) =>
        this._handleAgentRequest(runId, prompt, opts, frameBase + callSeq, framePathKey),
      // v8 REQ-041: a deeper workflow() recurses here one level down, carrying this frame's path +
      // the extended ancestor set — enabling N-level composition (was: no delegate → NESTING_ERROR).
      onWorkflowRequest: (ref2, args2, callSeq2) =>
        this._handleWorkflowRequest(runId, ref2, args2, framePathKey, callSeq2, depth + 1, childAncestors),
    });
    const outcome = await nested.run(`${runId}-nested`, registered.script, args, entry.guard.budgetView().total);
    if ('result' in outcome) return outcome.result;
    const err = toErr(outcome.error);
    throw codedError(err.code, err.message);
  }

  /** Handles one child agent() call: replay from the resume cache when available, otherwise
   *  enforce budget + concurrency (RunGuard, single authority) and dispatch to the AgentSpawner. */
  private async _handleAgentRequest(runId: string, prompt: string, opts: unknown, callSeq: number, framePath = ''): Promise<unknown> {
    const entry = this._runs.get(runId);
    if (!entry) throw new Error(`Unknown run: ${runId}`);
    const key: CallKey = { prompt, opts: (opts ?? {}) as AgentOpts };
    if (entry.cachePlan) {
      const cached = entry.cachePlan.replay(callSeq, key);
      if (cached !== MISS) return cached;
    }

    entry.guard.assertBudget();
    // D-G8-6 + D-V2G8-2: reserve a per-call SHARE of this run's remaining budget for this one
    // about-to-dispatch call BEFORE releasing control (no `await` between assertBudget() and
    // reserve() — an atomic gate). There is no per-call cost estimate ahead of time, so reserve()
    // takes a flat fraction (RESERVATION_FRACTION, see run-guard.ts) rather than the entire
    // remainder: reserving 100% (the original D-G8-6 fix) stopped the TOCTOU race but collapsed
    // parallel() concurrency to exactly 1; the fractional reserve stops a burst of concurrent
    // calls from ALL passing the stale pre-dispatch check while still restoring real concurrency
    // (review findings V2/V4). Released in the finally block below regardless of the call's real cost.
    const reserved = entry.guard.reserve();
    try {
      // D-F12: allocate the agentId and mark it "queued" BEFORE acquiring a concurrency slot — so a
      // call genuinely blocked behind the concurrency cap is observable via workflow_status right
      // away, not only once it resolves (round-5 VAL-002/VAL-007's `agents:[]`-while-running gap).
      const agentId = entry.guard.nextAgentId();
      if (entry.spawner instanceof AgentExecutor) {
        entry.spawner.markQueued(agentId, key.opts.label, key.opts.phase, framePath);
      }
      const release = await entry.guard.acquireSlot();
      try {
        if (entry.spawner instanceof AgentExecutor) {
          entry.spawner.markRunning(agentId, this._clock.isoNow());
        }
        // D-V3M-2 (REQ-020 D-DOS): the actual gateway dispatch (the SDK-CLI subprocess spawn) runs
        // inside the process-global semaphore slot — so `GET /api/status`'s inUse reflects real
        // concurrent spawns across all runs and returns to baseline once each settles.
        const outcome = await this._semaphore.withSlot(() =>
          entry.spawner.run({
            runId,
            agentId,
            prompt,
            opts: key.opts,
            workspace: entry.workspace,
            signal: entry.abortController.signal,
          }),
        );
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
