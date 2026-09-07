// RunManager (DES-003 / ARCH-002 / TASK-004). Run lifecycle state machine: legal transitions
// only (queued->running; running->{suspended,stopped,completed,failed}; suspended->{running,stopped};
// stopped->running), every transition persisted via RunStore.recordTransition BEFORE it is
// observable elsewhere (DES-003 signature). Owns one RunGuard + one SandboxHost per run so caps
// and in-flight processes never leak across runs; suspend/stop actually abort in-flight agent()
// calls (AbortSignal) and kill the sandbox child, not just flip the status flag.
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { materializeSeed, materializeManifest } from './workspace-seed.js';
import type { CasStore } from './cas-store.js';
import { casNamespaceFor } from './cas-store.js';
import { initGitBaseline } from './workspace-git.js';
import { listArtifacts, type ArtifactEntry } from './workspace-artifacts.js';
import { IllegalTransitionError, codedError, toErrorCode } from './errors.js';
import { isEgressAllowed, normalizeSeedRefAllowlist } from './seedref-egress.js';
import type { SeedRefFetcher } from './seedref-fetcher.js';
import { HardenedSeedRefFetcher } from './seedref-fetcher.js';

// v13 REQ-080 (DES-082/083): seedRef fetch bounds. Named constants (the DES-listed config knobs default
// here; overridable later without an API break like maxConcurrentRuns). Match UT-084's BASE_REQ values.
const SEEDREF_TIMEOUT_MS = 30_000;
const SEEDREF_MAX_TOTAL_BYTES = 50 * 1024 * 1024;
const SEEDREF_MAX_FILE_BYTES = 10 * 1024 * 1024;
import type { RunSpec, RunStatusView, RunStatus, CallKey, AgentOpts, JournalEntry, PhaseView, AgentRecord, WorkflowNodeView, ManifestEntry, EngineWarning } from './types.js';
import type { RunStore } from './run-store.js';
import { InMemoryRunStore, sumUsageTokens } from './run-store.js';
import type { Clock } from './clock.js';
import { SystemClock } from './clock.js';
import { RunGuard } from './run-guard.js';
import { createSemaphore, type Semaphore, type SemaphoreGauge } from './agent-semaphore.js';
import { SandboxHost } from './sandbox/host.js';
import type { AgentSpawner, AgentTypeDef } from './agent-executor.js';
import { AgentExecutor } from './agent-executor.js';
import { redact, hasSecretMarker } from './secret-resolver.js';
import type { SecretValueProvider } from './secret-resolver.js';
import { ResumeCache, MISS, type ResumePlan } from './resume-cache.js';
import { WorkflowCatalog } from './workflow-catalog.js';
import { assetRootsFor, defaultAssetRoot, globalAssetRoot } from './asset-sync.js';
import type { GatewayClient, GatewayConfig } from './gateway/client.js';
import { LiteLLMGatewayClient } from './gateway/client.js';
import { DEFAULT_ALIASES } from './default-aliases.js';
import { validateUserOverrides, validateDeclaredArgs, isKnownAlias, FRAME_CLOSE_FORGERY, DEFAULT_CEILINGS, type ParamContract, type Ceilings, type Err as ParamErr } from './params/contract.js';
import { defaultRunParams, mergeRunParams, type RunParams } from './params/resolve.js';

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
  /** v25 (DES-168, REQ-120, owner ruling 2026-09-07): max agent() calls this run may have IN FLIGHT
   *  at once. `acquireSlot()` QUEUES at the cap — a wider fan-out is slower, never truncated.
   *  Default DEFAULT_RUN_CONCURRENCY (24), an explicit number rather than the pre-v25
   *  `min(16, cores-2)`: how wide a workflow may fan out has nothing to do with how many cores the
   *  box has, and deriving it from the CPU count made the real ceiling invisible to the author.
   *  Operators set it via `runConcurrency` in rwe.config.json. Invalid (≤0/non-integer) is rejected
   *  at construction. The HOST-wide `agentSlots` semaphore (default 32) is a different layer: it
   *  rations spawns across ALL runs and is unchanged. */
  concurrency?: number;
  workRoot?: string;
  /** v24 (integrator; REQ-113, DES-154/ARCH-103): the resolved asset roots this run's dispatches
   *  materialize from. Omitted -> derived from `workRoot` with the SAME two functions
   *  `AssetSyncService` and the GC sweep use (`asset-sync.ts`), never re-spelt here. */
  assetRoot?: string;
  globalAssetRoot?: string;
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
  /** v25 (issue #53, adjudication #9 I-2): sink for structured observations about the terminal path
   *  — a run going terminal with live agents, or a terminal status with no matching transition row.
   *  Defaults to `console.warn` of the JSON record, which is what puts it in the engine log with no
   *  operator wiring: a sink that only exists when a composition root remembers to pass it is the
   *  bug class this codebase has already hit twice (v11 updateFlagPath, v15 auth). Fire-and-forget,
   *  like `onTerminal` — a throwing listener never wedges a run. */
  onWarning?: (warning: EngineWarning) => void;
  /** v8 Slice 4 (REQ-054): max live (non-terminal) top-level runs; an over-limit start() is rejected
   *  with RUN_ADMISSION_LIMIT before any durable work. Default 64. Invalid (≤0/non-integer) rejected. */
  maxConcurrentRuns?: number;
  /** v10 Slice 2 (REQ-065): the content-addressed store used to assemble a run's workspace from a
   *  `seedManifest`. Omitted → a seedManifest spec is rejected (no store to read blobs from). */
  cas?: CasStore;
  /** v13 (REQ-080 / DES-080, TASK-077): https-only prefix allowlist for engine-pull seedRef.
   *  Absent/empty → SEEDREF_DISABLED (fail-closed). Normalized at construction via normalizeSeedRefAllowlist. */
  seedRefAllowlist?: string[];
  /** v13 (REQ-080 / DES-083, TASK-078): injectable SeedRefFetcher for the hardened-git impl.
   *  Omitted in TASK-077 (no-op); wired in TASK-078. */
  seedFetcher?: SeedRefFetcher;
  /** v14 (REQ-083, DES-088, TASK-082): inject to enable redact-at-capture on all transcript/
   *  snapshot/journal persist sinks. Omitted → no redaction (legacy/test callers unchanged). */
  secretValueProvider?: SecretValueProvider;
  /** v21 (ARCH-066 inv-6, DES-104, TASK-100): engine ceilings bounding the USER-override rung
   *  (ADR-005) — refuse, never clamp. Per-key fail-closed defaults when a key is absent from config
   *  (composeConfig() forwards these three from rwe.config.json; see src/main.ts). */
  ceilings?: Partial<Ceilings>;
  /** v21 Gate 8 send-back (review §4 B1, adopted S-1): the configured model-alias table's key set,
   *  same convention as WorkflowCatalog's `aliasNames` (server.ts:1141) — validateUserOverrides'
   *  admission-time UNKNOWN_ALIAS check against it. Omitted/empty = D-AUTH-5-B (no configured
   *  aliases means every alias passes; the gateway itself is the fail point). */
  aliasNames?: Set<string>;
}

/** v25 (DES-168, REQ-120, owner ruling): the default per-run in-flight agent() cap. Explicit and
 *  host-independent — it replaces `Math.max(1, Math.min(16, cpus().length - 2))`, which made the
 *  real fan-out ceiling a function of the machine (14 on the owner's host, and cut to 2 by the
 *  reservation arithmetic issue #61 removed). Overridable per deployment via `runConcurrency`. */
export const DEFAULT_RUN_CONCURRENCY = 24;

const TERMINAL: RunStatus[] = ['stopped', 'completed', 'failed'];

/** v21 (DES-101): wraps a params/contract.ts rejection into the codebase's one Error factory,
 *  carrying the machine-shaped `detail` object as an extra (non-ErrEnvelope) property — read by
 *  any caller that wants it, ignored by ones (like McpFacade.toErrEnvelope) that don't. */
function paramCodedError(err: ParamErr): Error {
  return Object.assign(codedError(err.code, err.message), { detail: err.detail });
}


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
  /** v13 (REQ-080, DES-083): observable seedRef outcome overlaid onto RunStatusView by _mergeLive. */
  seedRef?: RunStatusView['seedRef'];
  /** v14 (REQ-082, DES-087): the seedManifestRef sha used, overlaid onto RunStatusView by _mergeLive. */
  seedManifestRef?: string;
  /** v21 (ARCH-066, DES-104, TASK-100): the run-immutable admission-time parameter snapshot —
   *  computed once in start() (or rehydrated in _requireLive() on resume), never re-resolved. */
  effectiveParams: RunParams;
  /** v24 (integrator; REQ-113, DES-154): the author-DECLARED asset names per agent label, taken
   *  from the registered `ParamContract`'s `agents.<label>.skills/.mcp` at admission. `RunParams`
   *  deliberately does not carry `skills`/`mcp` (they are author-only, not tunable), so the
   *  declared set has to travel beside the resolved one — and without it `AgentReq.assets` was
   *  never populated at all, which is why DES-154's selective materialization had never fired on a
   *  real dispatch (adjudication #4 C-2). Empty for an unregistered/legacy contract. */
  declaredAssets: Record<string, { skills: string[]; mcp: string[] }>;
}

/** v24 (integrator; REQ-113, DES-154): the author-DECLARED per-label asset names, lifted out of the
 *  registered `ParamContract` at admission so `_handleAgentRequest` can hand the dispatching
 *  gateway the set THIS label declared — the input DES-154's selective materialization takes and
 *  which nothing ever produced. Pure; an absent contract yields `{}` (no label declares anything,
 *  so every dispatch materializes nothing, which is the honest v24 default). */
function declaredAssetsOf(contract: ParamContract | undefined): Record<string, { skills: string[]; mcp: string[] }> {
  const out: Record<string, { skills: string[]; mcp: string[] }> = {};
  for (const [label, spec] of Object.entries(contract?.agents ?? {})) {
    out[label] = { skills: spec.skills ?? [], mcp: spec.mcp ?? [] };
  }
  return out;
}

export class RunManager {
  private readonly _store: RunStore;
  private readonly _clock: Clock;
  private readonly _spawnerOverride: AgentSpawner | undefined;
  private readonly _gateway: GatewayClient;
  private readonly _catalog: WorkflowCatalog;
  private readonly _concurrency: number;
  private readonly _workRoot: string;
  private readonly _assetRoot: string;
  private readonly _globalAssetRoot: string;
  private readonly _agentTypes: Record<string, AgentTypeDef>;
  private readonly _semaphore: Semaphore;
  private readonly _maxWorkflowDepth: number;
  private readonly _maxWorkflowDescendants: number;
  private readonly _onTerminal: ((runId: string, status: RunStatus) => void) | undefined;
  private readonly _onWarning: (warning: EngineWarning) => void;
  private readonly _maxConcurrentRuns: number;
  private readonly _cas: CasStore | undefined;
  /** v13 (REQ-080, TASK-077): normalized allowlist for seedRef egress gate; [] = disabled. */
  private readonly _seedRefAllowlist: string[];
  /** v13 (REQ-080, TASK-078): injected SeedRefFetcher; undefined until TASK-078 wires it. */
  private readonly _seedFetcher: SeedRefFetcher;
  /** v14 (REQ-083, DES-088, TASK-082): redact-at-capture for snapshot/journal sinks. */
  private readonly _secretValueProvider: SecretValueProvider | undefined;
  /** v21 (ARCH-066, DES-104, TASK-100): engine ceilings bounding the USER-override rung. */
  private readonly _ceilings: Ceilings;
  /** v21 Gate 8 send-back (review §4 B1): configured alias-name set for admission-time UNKNOWN_ALIAS. */
  private readonly _aliasNames: Set<string>;
  private readonly _runs = new Map<string, RunEntry>();
  /** v25 (#53): runIds already reported for `terminal_without_transition` — one record per run,
   *  not one per poll (a terminal run is polled until the caller notices it is terminal). */
  private readonly _warnedMissingTransition = new Set<string>();

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
    this._concurrency = RunManager._positiveInt(deps.concurrency, DEFAULT_RUN_CONCURRENCY, 'runConcurrency');
    this._workRoot = deps.workRoot ?? join(tmpdir(), 'remote-workflow-runs');
    this._assetRoot = deps.assetRoot ?? defaultAssetRoot(this._workRoot);
    this._globalAssetRoot = deps.globalAssetRoot ?? globalAssetRoot(this._workRoot);
    this._catalog = deps.catalog ?? new WorkflowCatalog(this._workRoot, this._clock);
    this._agentTypes = deps.agentTypes ?? {};
    // D-V3M-2: unbounded local default (1024 ≫ the 1000-agent lifetime cap) preserves the exact
    // prior behavior for every direct RunManager caller; the real DOS cap is injected by createServer.
    this._semaphore = deps.semaphore ?? createSemaphore(1024);
    this._maxWorkflowDepth = RunManager._positiveInt(deps.maxWorkflowDepth, 4, 'maxWorkflowDepth');
    this._maxWorkflowDescendants = RunManager._positiveInt(deps.maxWorkflowDescendants, 256, 'maxWorkflowDescendants');
    this._onTerminal = deps.onTerminal;
    this._onWarning = deps.onWarning ?? ((w) => { console.warn(`[remote-workflow-engine] ${JSON.stringify(w)}`); });
    this._maxConcurrentRuns = RunManager._positiveInt(deps.maxConcurrentRuns, 64, 'maxConcurrentRuns');
    this._cas = deps.cas;
    // v13 (REQ-080, TASK-077): normalize allowlist at construction (config-load check); default [] = disabled.
    this._seedRefAllowlist = deps.seedRefAllowlist ? normalizeSeedRefAllowlist(deps.seedRefAllowlist) : [];
    this._seedFetcher = deps.seedFetcher ?? new HardenedSeedRefFetcher();
    this._secretValueProvider = deps.secretValueProvider;
    // v21 (ARCH-066 inv-6): per-key fail-closed default, not "whole block present or defaults".
    this._ceilings = {
      maxTimeoutMs: deps.ceilings?.maxTimeoutMs ?? DEFAULT_CEILINGS.maxTimeoutMs,
      maxAppendPromptBytes: deps.ceilings?.maxAppendPromptBytes ?? DEFAULT_CEILINGS.maxAppendPromptBytes,
      maxEffort: deps.ceilings?.maxEffort ?? DEFAULT_CEILINGS.maxEffort,
    };
    // v21 Gate 8 send-back (review §4 B1): mirrors WorkflowCatalog's aliasNames convention
    // (server.ts) — undefined/omitted -> empty Set (D-AUTH-5-B: no configured aliases means the
    // check is a no-op, same as before this fix, never a false-positive UNKNOWN_ALIAS).
    this._aliasNames = deps.aliasNames ?? new Set();
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

  /** `overrides` (v21, ARCH-066, DES-104) is an ARGUMENT, never a RunSpec field — persisting it on
   *  RunSpec (read back wholesale by getSpec() on resume) would be a second unredacted sink plus a
   *  standing temptation to re-merge on resume. The redacted `effectiveParams` snapshot (below) is
   *  the single durable representation. */
  async start(spec: RunSpec, overrides?: unknown): Promise<string> {
    // v22 (REQ-098, ADR-013, DES-113, DES-117, TASK-108/TASK-109): the inline ban is on INGRESS
    // ONLY — start() refuses ANY inline script, even off the wire (a caller that bypasses the MCP
    // schema entirely and calls RunManager directly). resume() never applies this check: a run
    // suspended before the ban shipped has a persisted spec.script and must still resume.
    if (spec.script !== undefined) {
      throw codedError('INLINE_SCRIPT_CLOSED', 'Inline scripts are no longer accepted at run start; register once (workflow_register) then run by name: workflow_register({name, script, mermaid}) then run_start({name})');
    }
    // v22 (DES-114, TASK-109): `scriptSha256` was REQ-085's integrity guard for INLINE scripts
    // only — with inline scripts closed above and REQ-085 `[SUPERSEDED v22]`, it has nothing left
    // to guard. `scriptSha256` was already removed from `RunSpec` (types.ts); the guard function
    // (`assertScriptIntegrity`) and its now-orphaned unit test were removed in the same pass
    // (v22 gate-closeout, adjudication (v22) #2 L-1 / REQ-085's own retirement instruction).
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
    // v14 REQ-082 (DES-087): 4-way mutual-exclusion — {seed, seedManifest, seedRef, seedManifestRef}:
    //   >1 of these present → SEED_SOURCE_CONFLICT (highest precedence; fires before any CAS lookup).
    {
      const hasSeed = Array.isArray(spec.seed) && spec.seed.length > 0;
      const hasManifest = Array.isArray(spec.seedManifest) && spec.seedManifest.length > 0;
      const hasSeedRef = spec.seedRef !== undefined;
      const hasSeedManifestRef = spec.seedManifestRef !== undefined;
      const count = [hasSeed, hasManifest, hasSeedRef, hasSeedManifestRef].filter(Boolean).length;
      if (count > 1) {
        throw codedError('SEED_SOURCE_CONFLICT', 'seed, seedManifest, seedRef, and seedManifestRef are mutually exclusive; specify exactly one');
      }
    }
    // v13 REQ-080 (DES-080, TASK-077): seedRef pre-createRun validation — pinned precedence:
    //   SEEDREF_DISABLED → INVALID_SEED_SPEC → EGRESS_DENIED → CAS_UNAVAILABLE
    // (SEED_SOURCE_CONFLICT is now the 4-way check above.)
    if (spec.seedRef !== undefined) {
      if (this._seedRefAllowlist.length === 0) {
        throw codedError('SEEDREF_DISABLED', 'seedRef requires seedRefAllowlist in engine config (add seedRefAllowlist:[…] to rwe.config.json)');
      }
      const { repoUrl, sha } = spec.seedRef;
      if (!repoUrl || typeof repoUrl !== 'string') {
        throw codedError('INVALID_SEED_SPEC', 'seedRef.repoUrl must be a non-empty string');
      }
      if (!/^[0-9a-f]{40}$/.test(sha) && !/^[0-9a-f]{64}$/.test(sha)) {
        throw codedError('INVALID_SEED_SPEC', 'seedRef.sha must be a full 40-hex or 64-hex commit sha (branch refs and short shas are rejected)');
      }
      const verdict = isEgressAllowed(repoUrl, this._seedRefAllowlist);
      if (!verdict.ok) {
        throw codedError(verdict.code, verdict.reason);
      }
      if (!this._cas) {
        throw codedError('CAS_UNAVAILABLE', 'seedRef requires a configured content store (cas); like seedManifest, it assembles via materializeManifest');
      }
    }
    // v14 REQ-082 (DES-087): seedManifestRef pre-createRun validation — pinned precedence after
    //   SEED_SOURCE_CONFLICT (handled above): CAS_UNAVAILABLE → MISSING_BLOBS → INVALID_SEED_SPEC.
    //   Loads the manifest blob from CAS, parses it, re-validates referenced blobs, then assigns
    //   spec.seedManifest so the EXISTING materializeManifest branch runs unchanged (inline+ref parity).
    if (spec.seedManifestRef !== undefined) {
      if (!this._cas) throw codedError('CAS_UNAVAILABLE', 'seedManifestRef requires a configured content store');
      const ns = spec.seedNamespace ?? casNamespaceFor(spec.principal);
      // Check the manifest blob is present in the namespace (security boundary: namespace-scoped check).
      const manifestMissing = await this._cas.missing(ns, [spec.seedManifestRef]);
      if (manifestMissing.length > 0) {
        throw codedError('MISSING_BLOBS', `manifest blob ${spec.seedManifestRef} not found in namespace ${ns}; register via POST /assets/manifest`);
      }
      // Read from the namespace-agnostic blob pool (presence already confirmed above).
      const manifestBuf = await this._cas.readBlob(spec.seedManifestRef);
      if (!manifestBuf) throw codedError('MISSING_BLOBS', `manifest blob ${spec.seedManifestRef} missing from blob pool`);
      let parsedManifest: unknown;
      try { parsedManifest = JSON.parse(manifestBuf.toString('utf8')); } catch {
        throw codedError('INVALID_SEED_SPEC', `seedManifestRef blob is not valid JSON; register via POST /assets/manifest`);
      }
      if (!Array.isArray(parsedManifest)) {
        throw codedError('INVALID_SEED_SPEC', `seedManifestRef blob must be a JSON array of {path, sha256, exec?}`);
      }
      // Re-validate all referenced blobs are present in the namespace (security boundary per DES-087).
      const referencedShas = (parsedManifest as Array<{ sha256?: unknown }>).map((e) => String(e.sha256 ?? ''));
      const missing = await this._cas.missing(ns, referencedShas);
      if (missing.length > 0) throw codedError('MISSING_BLOBS', `${missing.length} blob(s) missing for seedManifestRef: ${missing.slice(0, 8).join(',')}${missing.length > 8 ? '…' : ''}`);
      // Fall into the existing materializeManifest branch.
      spec.seedManifest = parsedManifest as ManifestEntry[];
      spec.seedNamespace = ns;
    }
    // v10 REQ-065: fail fast (before any durable work) if a seedManifest references blobs the client
    // hasn't uploaded — surface the missing shas so the client blob_put's them and retries.
    if (spec.seedManifest && spec.seedManifest.length > 0) {
      if (!this._cas) throw codedError('CAS_UNAVAILABLE', 'seedManifest requires a configured content store');
      const ns = spec.seedNamespace ?? casNamespaceFor(spec.principal);
      const missing = await this._cas.missing(ns, spec.seedManifest.map((e) => e.sha256));
      if (missing.length > 0) throw codedError('MISSING_BLOBS', `upload ${missing.length} blob(s) first: ${missing.slice(0, 8).join(',')}${missing.length > 8 ? '…' : ''}`);
    }
    let script = spec.script ?? '';
    let scriptVersion = 1;
    let resolvedVersion = 'v1'; // catalog version string actually executed (D-V7) — threaded into RunStore.createRun
    let registeredContract: ParamContract | undefined;
    if (spec.name && !spec.script) {
      // v22 (REQ-097, DES-114, TASK-109): the wire selector — explicit `version` wins over `channel`;
      // neither supplied defaults to `release` (DES-110's resolveVersionRequest truth table).
      const registered = await this._catalog.resolve(spec.name, { version: spec.version, channel: spec.channel }); // throws CatalogNotFoundError/typed resolve error — caught by SubmissionValidator pre-run
      script = registered.script;
      resolvedVersion = registered.version;
      scriptVersion = Number(registered.version.replace(/^v/, '')) || 1;
      registeredContract = registered.params as ParamContract | undefined;
      // v24 (integrator; DES-144/DES-156, flagged by the Batch-A executor as unowned): a version
      // row whose `params` column is NULL predates the per-agent contract. Every v24 registration
      // writes one unconditionally (`insertVersion` JSON-stringifies the parsed contract, `{}`
      // included), so `undefined` here means exactly "registered before v24". `workflow_describe`
      // and `workflow_list` ALREADY report such a version as `runnableReason:'LEGACY_REREGISTER'`;
      // `run_start` accepted it anyway and ran it with no per-agent slice at all — the read
      // surfaces and the run path disagreed about the same row. Same code, same reason, same
      // remedy as the resume readback gate below.
      if (registeredContract === undefined) {
        throw codedError(
          'LEGACY_REREGISTER',
          `LEGACY_REREGISTER: workflow '${spec.name}' version ${resolvedVersion} predates the v24 per-agent parameter contract and cannot be run; re-register it`,
          { workflow: spec.name, version: resolvedVersion },
        );
      }
    }

    // v21 (ARCH-066 inv-6, DES-104, TASK-100): admission rung — ONE task by decree (validate +
    // snapshot + config wiring together, so this bug class doesn't ship a fifth time). Validates
    // `overrides`/declared `args` against the workflow's tunable-parameter contract BEFORE any
    // durable work (createRun/runWorkspace/sandbox spawn) — an ad-hoc inline script (no registered
    // contract) is bound by the canonical 4-knob contract, same as a registered script with no
    // `params` block (DES-101). Order pinned: overrides -> declared args -> merge.
    // v24 (DES-144): the "canonical 4-knob contract" fallback is RETIRED (params/contract.ts no
    // longer exports it) — an unregistered/legacy contract reads back as the zero-label shape.
    // v24 (TASK-136/137/158): `validateUserOverrides`/`validateDeclaredArgs` already validate the
    // real per-agent `{agents:{...}}}` shape (DES-145) — the merge below (TASK-158) is what folds
    // that validated per-label result into the admission snapshot's `.agents` slice.
    const contract = registeredContract ?? ({ agents: {}, args: {} } as ParamContract);
    const overridesResult = validateUserOverrides(contract, overrides, this._aliasNames, this._ceilings);
    if (!overridesResult.ok) throw paramCodedError(overridesResult);
    const argsResult = validateDeclaredArgs(contract, spec.args);
    if (!argsResult.ok) throw paramCodedError(argsResult);
    // defaultRunParams is the ONLY no-overrides producer (DES-104) — the callers that never supply
    // `overrides` (schedule/webhook/chain triggers) must not each reach for `overrides ?? {}`.
    const effectiveParams: RunParams = overrides === undefined
      // v24 Gate 7.5 (ADR-035): the workflow-wide `defaults` object is retired and no longer read
      // from the catalog, so the first argument — the registered HarnessDefaults snapshot — is
      // always absent. Every value now comes from the per-agent contract (`contract.agents`).
      ? defaultRunParams(undefined, contract.agents)
      : mergeRunParams(undefined, overridesResult.value, contract.agents);
    // v21 Gate 8 RE-REVIEW (review §R2 (b), R-G2 HIGH): validateUserOverrides only re-checks a
    // CALLER-SUPPLIED overrides.model; a registered defaults.model that was valid at registration
    // but has since fallen out of the configured alias table (a config change between restarts)
    // was never re-examined — every un-overridden submission using it was silently admitted. Same
    // UNKNOWN_ALIAS code, same "before any durable work" placement as the override-rung check.
    // v24 (TASK-158): re-checked over EVERY label's resolved model too, not just the (now largely
    // vestigial, HarnessDefaults-only) top-level field — a per-agent override/default is just as
    // reachable here as the old flat one was.
    const modelsToCheck = [effectiveParams.model, ...Object.values(effectiveParams.agents ?? {}).map((a) => a.model)];
    for (const m of modelsToCheck) {
      if (m !== undefined && !isKnownAlias(m, this._aliasNames)) {
        throw paramCodedError({
          ok: false,
          code: 'UNKNOWN_ALIAS',
          message: `model is not a known alias: ${m}`,
          detail: { param: 'model', supplied: m, allowed: { enum: [...this._aliasNames] } },
        });
      }
    }
    // v21 Gate 8 RE-REVIEW #6 (P6-2, review §T5/§T6): mirrors R-G2 one field over — F2
    // (validateUserOverrides in contract.ts) only frame-checks a CALLER-SUPPLIED
    // overrides.appendPrompt; a registered defaults.appendPrompt origin reaches this point
    // unchecked on every no-overrides submission. Re-check the EFFECTIVE post-merge value before
    // any durable work, same shared FRAME_CLOSE_FORGERY constant, reported by size only (DES-101
    // row 6 discipline: never echo caller/author text). v24 (TASK-158): same widen as the alias
    // check above — every label's resolved appendPrompt, not just the top-level field.
    const appendPromptsToCheck = [effectiveParams.appendPrompt, ...Object.values(effectiveParams.agents ?? {}).map((a) => a.appendPrompt)];
    for (const ap of appendPromptsToCheck) {
      if (typeof ap === 'string' && FRAME_CLOSE_FORGERY.test(ap)) {
        throw paramCodedError({
          ok: false,
          code: 'PARAM_OUT_OF_RANGE',
          message: 'appendPrompt cannot contain the user-instructions frame close delimiter',
          detail: { param: 'appendPrompt', suppliedBytes: Buffer.byteLength(ap, 'utf8') },
        });
      }
    }
    // DES-088/ARCH-056 (REQ-083 sink-completeness sweep): this is a NEW persist sink — redact
    // BEFORE the durable write, same convention as the journal/snapshot sinks below. The live
    // RunEntry (below) keeps the unredacted value (dispatch never sees a redaction marker).
    const persistedParams = this._secretValueProvider
      ? (redact(effectiveParams, this._secretValueProvider.entries()) as RunParams)
      : effectiveParams;

    const runId = await this._store.createRun(spec, resolvedVersion, persistedParams);
    const workspace = this._catalog.runWorkspace(spec.name ?? '_adhoc', runId);
    // v13 REQ-080 (DES-083, TASK-078): engine-pull seedRef — fetch the tree AFTER createRun, feed the
    // fetched entries into the EXISTING seedManifest materialize branch below (guard-parity is structural:
    // regular files only, .git never materialized). Timing/dropped/failure surface on RunStatusView.seedRef;
    // a fetch failure fails the run via the same resultError channel as any other run failure.
    let seedRefView: RunEntry['seedRef'];
    let seedRefFail: { code: string; message: string } | undefined;
    if (spec.seedRef !== undefined) {
      const ns = spec.seedNamespace ?? casNamespaceFor(spec.principal);
      const t0 = this._clock.now();
      try {
        const r = await this._seedFetcher.fetch(
          { repoUrl: spec.seedRef.repoUrl, sha: spec.seedRef.sha, timeoutMs: SEEDREF_TIMEOUT_MS, maxTotalBytes: SEEDREF_MAX_TOTAL_BYTES, maxFileBytes: SEEDREF_MAX_FILE_BYTES },
          async (sha, bytes) => { await this._cas!.putBlob(ns, sha, bytes); },
        );
        spec.seedManifest = r.entries; // fall into the existing materializeManifest branch below
        spec.seedNamespace = ns;
        seedRefView = { resolvedSha: r.resolvedSha, bytes: r.bytesTransferred, latencyMs: Math.max(0, this._clock.now() - t0), fetchedAt: this._clock.isoNow(), dropped: r.dropped };
      } catch (err) {
        const code = (err as { code?: string }).code ?? 'SEEDREF_FETCH_FAILED';
        const message = String((err as { message?: string }).message ?? err).slice(0, 200);
        seedRefFail = { code, message };
        const failCode = (code === 'SEEDREF_SHA_MISMATCH' || code === 'SEEDREF_TOO_LARGE') ? code : 'SEEDREF_FETCH_FAILED';
        seedRefView = { resolvedSha: spec.seedRef.sha, bytes: 0, latencyMs: Math.max(0, this._clock.now() - t0), fetchedAt: this._clock.isoNow(), dropped: [], failCode, failDetail: message };
      }
    }
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
    const spawner = this._spawnerOverride ?? new AgentExecutor({ gateway: this._gateway, guard, store: this._store, clock: this._clock, agentTypes: this._agentTypes, secretValueProvider: this._secretValueProvider });
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
      effectiveParams,
      declaredAssets: declaredAssetsOf(contract),
    };
    this._runs.set(runId, entry);
    entry.seedRef = seedRefView; // v13: overlaid onto RunStatusView by _mergeLive (present on success AND failure)
    if (spec.seedManifestRef !== undefined) entry.seedManifestRef = spec.seedManifestRef; // v14: DES-087
    if (seedRefFail) {
      // v13 REQ-080: a seedRef fetch failure fails the run typed (never starts the script against an
      // empty/partial tree) via the same resultError channel every other run failure uses.
      entry.resultError = seedRefFail;
      await this._transition(runId, entry, 'failed');
      return runId;
    }
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

  async resume(runId: string): Promise<void> {
    const entry = await this._requireLive(runId);
    // v8 Defer A (REQ-060): `interrupted` (crashed while running) is resumable, like suspended/stopped.
    if (entry.status !== 'suspended' && entry.status !== 'stopped' && entry.status !== 'interrupted') {
      throw new IllegalTransitionError(entry.status, 'running');
    }
    // v21 Gate 8 RE-REVIEW (review §R2 (a), R-G1 HIGH): `_requireLive` never restores a redaction
    // marker (see comment there) — any rehydrated snapshot that still carries one is refused typed,
    // never dispatched, so a resumed run is always either byte-identical to admission or a typed
    // refusal, never a silent secret-marker substitution.
    if (hasSecretMarker(entry.effectiveParams)) {
      throw codedError('PARAM_SECRET_UNAVAILABLE', `Run ${runId}'s admission-time parameters carry a redaction marker that resume never restores (ARCH-066 inv-5 forbids dispatching it)`);
    }
    // v21 Gate 8 RE-REVIEW #5 (review §S7 F2, durable half): `validateUserOverrides` (contract.ts)
    // refuses this shape AT ADMISSION, but a row admitted before that guard existed could already
    // carry it in the persisted snapshot — resume must not silently re-dispatch a forged frame-close
    // delimiter any more than it silently re-dispatches an unrestorable secret marker (same "refuse,
    // never dispatch" discipline as the check above). Shares contract.ts's exported FRAME_CLOSE_FORGERY
    // pattern so the two refusal sites can never drift onto different shapes.
    // v24 (TASK-158): same per-label widen as the admission-time check above — a forged
    // appendPrompt could equally have been persisted under a per-agent-label slice.
    const resumeAppendPrompts = [entry.effectiveParams.appendPrompt, ...Object.values(entry.effectiveParams.agents ?? {}).map((a) => a.appendPrompt)];
    if (resumeAppendPrompts.some((ap) => typeof ap === 'string' && FRAME_CLOSE_FORGERY.test(ap))) {
      throw codedError('PARAM_OUT_OF_RANGE', `Run ${runId}'s admission-time appendPrompt carries the user-instructions frame close delimiter and cannot be resumed`);
    }
    // v22 (DES-113/DES-114, TASK-109): the replacement-script parameter is CLOSED with inline
    // scripts (REQ-098) — a resume always continues `entry.script` unchanged, never a caller-supplied
    // substitute. A hand-rolled `workflow_resume({runId, script})` is refused INLINE_SCRIPT_CLOSED at
    // the facade before this method is ever called.
    const cachePlan = ResumeCache.build(entry.journal, entry.script);
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
    this._runLive(runId, entry, entry.script, cachePlan);
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
    await this._checkTerminalHasTransition(runId, view);
    return this._mergeLive(runId, view);
  }

  /** v25 (issue #53, adjudication #9 I-2, warning 2): the invariant ARCH-006 promises — a terminal
   *  status has a matching row in `transitions`, because `recordTransition` is the single writer of
   *  both and writes them together. Run 3977b82d violated it: `run_status` said `failed`, the trail
   *  had no `failed` row, and there was no error anywhere to explain either.
   *
   *  Checked HERE, on the READ, rather than after the write. A check straight after
   *  `recordTransition` would be near-vacuous for the store production runs on — SqliteRunStore
   *  INSERTs the row and only then UPDATEs the status, so a status it wrote always has its row —
   *  whereas the read side is where the broken state was actually OBSERVED, and it fires whatever
   *  produced it. The trigger is `terminalAt` being absent (both stores derive it from the
   *  transitions themselves, so it is a genuine cross-check against `status`, not a re-read of the
   *  same field) and costs nothing on the healthy path: the transitions are fetched only once the
   *  invariant is already broken.
   *
   *  Once per runId — a terminal run gets polled, and one record is evidence while one per poll is
   *  noise that buries it. Observability only: the view returned is byte-identical either way. */
  private async _checkTerminalHasTransition(runId: string, view: RunStatusView): Promise<void> {
    if (!TERMINAL.includes(view.status) || view.terminalAt !== undefined) return;
    if (this._warnedMissingTransition.has(runId)) return;
    this._warnedMissingTransition.add(runId);
    // The WHOLE body is guarded, not just the sink: `getTransitions` is an extra store read that
    // `status()` did not make before, and "observability only" has to mean that a store failing on
    // THIS read cannot turn a status call that used to succeed into a throw. An observation that
    // can break the thing it observes is not an observation.
    try {
      const transitions = await this._store.getTransitions(runId);
      const entry = this._runs.get(runId);
      this._warn({
        kind: 'terminal_without_transition',
        ts: this._clock.isoNow(),
        runId,
        terminalState: view.status,
        reason: entry?.resultError ? `${entry.resultError.code}: ${entry.resultError.message}` : null,
        transitions: transitions.map((t) => `${t.from ?? 'null'}->${t.to}`),
      });
    } catch { /* an observer's failure is never the caller's */ }
  }

  /** Fire-and-forget, like `onTerminal`: a throwing sink never wedges the path it observes. */
  private _warn(warning: EngineWarning): void {
    try { this._onWarning(warning); } catch { /* an observer's failure is never the run's */ }
  }

  /** Overlays this-process live data (phases observed, agent records captured) onto the
   *  store's persisted view — both are ephemeral per-process state, not replayed after restart. */
  private _mergeLive(runId: string, view: RunStatusView): RunStatusView {
    const entry = this._runs.get(runId);
    if (!entry) return view;
    const agents = entry.spawner instanceof AgentExecutor ? entry.spawner.getAllRecords() : view.agents;
    return { ...view, phases: entry.phases, agents, workflowNodes: entry.workflowNodes, ...(entry.seedRef !== undefined ? { seedRef: entry.seedRef } : {}), ...(entry.seedManifestRef !== undefined ? { seedManifestRef: entry.seedManifestRef } : {}) };
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

  /** v24 (DES-155, ARCH-091 note 1, TASK-148): the TOCTOU guard `workspace_delete`/`workspace_purge`
   *  need — "refused while the run is live" is checked HERE, against the store (not a facade-side
   *  status read that a concurrent start()/resume() could race), single process (a check inside the
   *  owner, not a lock protocol — ADR-026's same assumption as the trigger stores). A run known to
   *  the store but not to this process's `_runs` map (a restart) is resolved through `store.getRun`
   *  and `queued`/`running`/`suspended` all count as LIVE — "not in memory" is never treated as
   *  terminal. */
  async withTerminalRun<T>(runId: string, fn: () => Promise<T> | T): Promise<T> {
    const view = await this._store.getRun(runId);
    if (!view) throw codedError('RUN_NOT_FOUND', `Run not found: ${runId}`);
    if (!TERMINAL.includes(view.status)) {
      throw codedError('RUN_NOT_TERMINAL', `run ${runId} is ${view.status}, not terminal`);
    }
    return fn();
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
    let registeredContract: ParamContract | undefined;
    if (spec.name && !spec.script) {
      // v22 (DES-113, ADR-010, TASK-108): resolve the PIN (view.scriptVersion), never the current
      // `release` — a suspended run continues the version it started with. Legacy-cohort fallback
      // (the name row exists, but the pin isn't in workflow_versions — e.g. after a
      // deregister/re-register restarted the lineage): resolve through `release` instead, and
      // record the substitution durably (the pin itself is NEVER rewritten).
      try {
        const registered = await this._catalog.resolve(spec.name, { version: view.scriptVersion });
        script = registered.script;
        registeredContract = registered.params as ParamContract | undefined;
      } catch (err) {
        if ((err as { code?: string } | undefined)?.code !== 'VERSION_NOT_FOUND') throw err;
        const registered = await this._catalog.resolve(spec.name, {});
        script = registered.script;
        registeredContract = registered.params as ParamContract | undefined;
        const sub = { pinned: view.scriptVersion, resolved: registered.version };
        await this._store.recordLegacySubstitution(runId, sub);
        console.log(`run.legacySubstitution: ${JSON.stringify({ runId, name: spec.name, ...sub })}`);
      }
    }
    // v8 Defer A (REQ-059): read the persisted journal back so a run resumed in a fresh process
    // replays its settled agent()/workflow() calls from cache instead of re-running them live.
    const persistedJournal = await this._store.getJournal(runId);
    // v21 (ARCH-066, DES-104): resume reads the PINNED admission snapshot, never re-resolving from
    // the current catalog row — a legacy pre-v21 run (effective_params NULL) falls back to
    // defaultRunParams(registered.defaults), today's behaviour, never a crash.
    // v21 Gate 8 RE-REVIEW (review §R2 (a), R-G1 HIGH — supersedes the deleted `unredactBestEffort`):
    // the persisted copy is redact-at-capture (persist-only, see start()) and is NEVER restored —
    // blindly expanding any `‹secret:NAME›`-shaped substring back to the live secret value made the
    // marker grammar itself a secret-dereference primitive (an attacker who only guessed the public
    // marker spelling, never possessed the secret, got it substituted into a dispatched prompt on
    // resume). If a marker survives in the snapshot, `resume()` below refuses typed instead —
    // "byte-identical to admission, or a typed refusal" never "silently dispatch the marker".
    const storedParams = await this._store.getEffectiveParams(runId);
    // v24 (integrator; DES-146/DES-156 boundary, adjudication #4 C-7 [28]): a snapshot persisted
    // BEFORE the per-agent contract has no `.agents` key at all — every v24 admission writes one
    // (`{}` at minimum, since `contract.agents` is always passed). Reading that legacy flat shape
    // back and resuming on it SILENTLY dropped every per-label model/effort/timeout: the run
    // continued with the run-wide fields and nobody was told. `LEGACY_REREGISTER` is the code the
    // design assigns ("this version predates the v24 contract and cannot run; re-register it") and
    // it is already what `workflow_describe`/`workflow_list` report as `runnableReason`, so the
    // refusal a caller meets here matches what the read surfaces already told it.
    if (storedParams !== null && storedParams.agents === undefined) {
      throw codedError(
        'LEGACY_REREGISTER',
        `LEGACY_REREGISTER: run ${runId} was admitted before the v24 per-agent parameter contract and cannot be resumed; re-register the workflow and start a new run`,
        { runId, ...(spec.name !== undefined ? { workflow: spec.name } : {}) },
      );
    }
    const effectiveParams = storedParams ?? defaultRunParams(undefined, registeredContract?.agents);

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
    const spawner = this._spawnerOverride ?? new AgentExecutor({ gateway: this._gateway, guard, store: this._store, clock: this._clock, agentTypes: this._agentTypes, secretValueProvider: this._secretValueProvider });
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
      effectiveParams,
      declaredAssets: declaredAssetsOf(registeredContract),
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
      let agents = entry.spawner instanceof AgentExecutor ? entry.spawner.getAllRecords() : [];
      // DES-088 (TASK-082) sink (2): redact agents array BEFORE saveSnapshot (persist write only).
      if (this._secretValueProvider) {
        const secrets = this._secretValueProvider.entries();
        agents = redact(agents, secrets) as typeof agents;
      }
      await this._store.saveSnapshot(runId, { phases: entry.phases, agents, workflowNodes: entry.workflowNodes });
      // v25 (issue #53, adjudication #9 I-2, warning 1): the run is terminal — is anything it owns
      // still running? Run 3977b82d was in EXACTLY this state (its agent ran on for ~36 seconds
      // after the terminal write and produced real output) and nothing was recorded. Emitted from
      // the REDACTED array on purpose: a label or state that carried a secret value must not reach
      // the log by this new route (DES-088's redact-at-capture sink, same array, same reason).
      //
      // This does NOT abort the agent. Making a terminal state stop the work it owns is a separate
      // decision with its own tests (adjudication #9 I-2: "不改變任何現有行為"); the point here is
      // that when it happens again there is a record naming what was left running.
      for (const a of agents) {
        if (a.state !== 'queued' && a.state !== 'running') continue;
        this._warn({
          kind: 'agent_live_at_terminal',
          ts: this._clock.isoNow(),
          runId,
          terminalState: to,
          reason: entry.resultError ? `${entry.resultError.code}: ${entry.resultError.message}` : null,
          agent: { agentId: a.agentId, ...(a.label !== undefined ? { label: a.label } : {}), state: a.state },
        });
      }
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

    const registered = await this._catalog.resolve(name, {}); // throws CatalogNotFoundError/typed resolve error — message names the missing workflow
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
    // v24 (DES-137): the one genuinely-`string` site — `toErr()` can return a raw `Error.name`
    // (e.g. `SCRIPT_ERROR` from an uncaught throw). An unrecognized code becomes INTERNAL_ERROR
    // with `detail.rawCode` set, a greppable production signal rather than a silent passthrough.
    const mapped = toErrorCode(err.code);
    throw codedError(mapped, err.message, mapped === 'INTERNAL_ERROR' && err.code !== 'INTERNAL_ERROR' ? { rawCode: err.code } : undefined);
  }

  /** Handles one child agent() call: replay from the resume cache when available, otherwise
   *  enforce budget + concurrency (RunGuard, single authority) and dispatch to the AgentSpawner. */
  private async _handleAgentRequest(runId: string, positional: string, opts: unknown, callSeq: number, framePath = ''): Promise<unknown> {
    const entry = this._runs.get(runId);
    if (!entry) throw new Error(`Unknown run: ${runId}`);
    // v24 (integrator; DES-143/ADR-029 + REQ-110/REQ-113): the script-facing call is
    // `agent(LABEL, {prompt, …})` — `scanAgentCalls` REFUSES registration unless the first
    // positional is a literal label matching `/^[A-Za-z_][\w-]*$/` and a declared
    // `meta.params.agents.<label>`. The sandbox API (`guards.ts`) still marshals that positional
    // through as `prompt` and nothing ever set `opts.label`, so on a REAL dispatch: the per-label
    // parameter slice below (`entry.effectiveParams.agents[label]`) never resolved, `markQueued`
    // recorded every agent as anonymous, `run_agent_log({label})` could not find its agent, and
    // DES-154's selective materialization had no declared set to materialize. The whole v24
    // per-agent chain hung off one translation nobody wrote. It is written here, at the single
    // point the positional crosses the sandbox boundary, so every caller (agent(), parallel(),
    // pipeline(), a nested workflow() frame) gets it once.
    const rawOpts = (opts ?? {}) as AgentOpts & { prompt?: unknown };
    const label = typeof rawOpts.label === 'string' && rawOpts.label !== '' ? rawOpts.label : positional;
    const prompt = typeof rawOpts.prompt === 'string' ? rawOpts.prompt : positional;
    const key: CallKey = { prompt, opts: { ...rawOpts, label } };
    if (entry.cachePlan) {
      const cached = entry.cachePlan.replay(callSeq, key);
      if (cached !== MISS) return cached;
    }

    // D-F12: allocate the agentId and mark it "queued" BEFORE acquiring a concurrency slot — so a
    // call genuinely blocked behind the concurrency cap is observable via workflow_status right
    // away, not only once it resolves (round-5 VAL-002/VAL-007's `agents:[]`-while-running gap).
    // v25 (REQ-120): it is also what gives a call the engine later REFUSES a record to carry the
    // reason on — before v25 a refused call had no record at all.
    const agentId = entry.guard.nextAgentId();
    if (entry.spawner instanceof AgentExecutor) {
      entry.spawner.markQueued(agentId, key.opts.label, key.opts.phase, framePath);
    }
    const release = await entry.guard.acquireSlot();
    try {
      // v25 (DES-167, REQ-120, issue #61, owner ruling): ONE budget door — "has this run already
      // spent its whole allowance?" — evaluated HERE, holding the concurrency slot, immediately
      // before dispatch. The position is load-bearing: checked before acquireSlot() (where the v2
      // code checked it), every call of a wide parallel() passes while spend is still 0 and then
      // queues, so the budget stops nothing at all. Checked after the slot, only the calls actually
      // IN FLIGHT can overshoot — which is precisely the bound the guide now states (budget is a
      // stop-dispatching signal; overshoot ≤ concurrency × one call's cost).
      //
      // What this replaces: the v2 `assertBudget()` + `reserve()` pair, where each call reserved
      // half the TOTAL budget, so two concurrent calls reserved 100% and a third branch of any
      // budgeted parallel() threw however little had been spent (issue #61). The reservation is
      // gone entirely — see run-guard.ts's header for why no formula replaces it.
      try {
        entry.guard.assertBudget();
      } catch (err) {
        // A real refusal — record it as a terminal `refused` agent carrying its named code, then
        // let it propagate. `parallel()` (sandbox/guards.ts) re-throws refusal codes rather than
        // swallowing them to null, so the caller learns why instead of silently losing a branch.
        if (entry.spawner instanceof AgentExecutor) {
          entry.spawner.markRefused(agentId, 'BUDGET_EXCEEDED', this._clock.isoNow());
        }
        throw err;
      }
      if (entry.spawner instanceof AgentExecutor) {
        entry.spawner.markRunning(agentId, this._clock.isoNow());
      }
      // D-V3M-2 (REQ-020 D-DOS): the actual gateway dispatch (the SDK-CLI subprocess spawn) runs
      // inside the process-global semaphore slot — so `GET /api/status`'s inUse reflects real
      // concurrent spawns across all runs and returns to baseline once each settles.
      // v24 (DES-146, TASK-158): when this call's script label has its OWN per-agent slice in
      // the admission snapshot (`entry.effectiveParams.agents[label]`), its resolved
      // model/effort/timeoutMs/appendPrompt + provenance override the run-wide flat fields for
      // THIS call only — a sibling label's call reads its own slice, never this one's (REQ-110
      // close). `prompt`/`tools` stay the run-wide (workflow-level, not per-agent) fields. No
      // label, or no contract at admission (ad-hoc/legacy script) → the flat snapshot unchanged,
      // same as before this task.
      const labelParams = key.opts.label ? entry.effectiveParams.agents?.[key.opts.label] : undefined;
      const runParams: RunParams = labelParams
        ? { ...entry.effectiveParams, model: labelParams.model, effort: labelParams.effort, timeoutMs: labelParams.timeoutMs, appendPrompt: labelParams.appendPrompt, provenance: labelParams.provenance }
        : entry.effectiveParams;
      // v24 (integrator; REQ-113, ARCH-103/DES-154, adjudication #4 C-2): `AgentReq.assets` —
      // THE missing wire. `agent-executor.ts` forwards it, `claude-agent-sdk-client.ts` acts on
      // it and `materialize-assets.test.ts` proved the algorithm, but NOBODY produced the value,
      // so on every real dispatch `req.assets` was `undefined` and the gateway took its
      // "no workspace / no assets -> materialize nothing" branch. REQ-113 ("each agent declares
      // the skills IT needs, not one set for the whole workflow") therefore had no runtime
      // behaviour at all. Built here from the three things only this scope has together: the run's
      // workflow name, THIS label's declared `skills`/`mcp`, and the resolved asset roots.
      // Absent for an ad-hoc/unnamed run or an unlabelled call — nothing to scope assets BY.
      const declared = key.opts.label ? entry.declaredAssets[key.opts.label] : undefined;
      const assets = entry.name !== undefined && declared !== undefined
        ? { roots: assetRootsFor(this._assetRoot, this._globalAssetRoot, entry.name), declared, workflow: entry.name }
        : undefined;
      const outcome = await this._semaphore.withSlot(() =>
        entry.spawner.run({
          runId,
          agentId,
          prompt,
          opts: key.opts,
          workspace: entry.workspace,
          signal: entry.abortController.signal,
          ...(assets !== undefined ? { assets } : {}),
          // v21 (ARCH-068, DES-105, TASK-101): the run-immutable admission-time snapshot — one
          // per run (incl. nested workflow() frames, which share the parent's entry), never
          // re-resolved per call. v24 (TASK-158): narrowed to this call's label above when the
          // admission snapshot has a per-label slice for it.
          runParams,
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
      // DES-088 (TASK-082) sink (4): redact the ENTIRE JournalEntry (key.prompt + key.opts + value)
      // at the persist-write site only. The live in-memory journal (entry.journal, the replay cache)
      // keeps the raw key+value so same-process suspend/resume matches exactly; only the durable
      // journal.jsonl is redacted. Accepted caveat — invariant (c) EXTENDED to call params: if a
      // provisioned secret rides a prompt/opts (e.g. a prior agent's MCP result echoed into a later
      // prompt), a HARD-CRASH resume reads the redacted key from disk, MISSes that call's key
      // (sameKey compares prompt+opts, resume-cache.ts:14) and re-runs it + the tail LIVE — correct
      // values, just recomputed. Strictly more graceful than a redacted VALUE (which feeds a marker
      // back as data). (Future option, not built: persist a keyHash of the raw key so replay matches
      // without the raw prompt — see DES-088 Decision rationale.)
      const journalToStore = this._secretValueProvider
        ? (redact(journalEntry, this._secretValueProvider.entries()) as JournalEntry)
        : journalEntry;
      await this._store.appendJournal(runId, journalToStore);
      return value;
    } finally {
      release();
    }
  }
}
