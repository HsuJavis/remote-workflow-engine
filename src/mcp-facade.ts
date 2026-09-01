// McpFacade (DES-001 / ARCH-001 / TASK-002).
// Pure delegation + uniform ResultEnvelope: every tool call resolves to an envelope,
// never throws across the tool boundary (DES-001).
import { rmSync } from 'node:fs';
import { readArtifactChunk, type ArtifactEntry, type ChunkResult } from './workspace-artifacts.js';
import type { Clock } from './clock.js';
import { SystemClock } from './clock.js';
import type { RunStore } from './run-store.js';
import { InMemoryRunStore } from './run-store.js';
import { RunManager } from './run-manager.js';
import { SubmissionValidator } from './submission-validator.js';
import type { ErrEnvelope, ResultEnvelope, RunStatusView, RunSummary, TranscriptEvent, HarnessDescriptor, ManifestEntry } from './types.js';
import { parseMeta, parseWorkflowSkeleton, type SkeletonNode } from './workflow-meta.js';
import { canonicalContract, effectiveBounds, DEFAULT_CEILINGS, type ParamContract, type Ceilings } from './params/contract.js';

// v21 (DES-103/DES-104): the engine ceilings bound the read surfaces (workflow_get/list) at read
// time — TASK-100 wires the live values from ServerConfig via McpFacadeDeps.ceilings (server.ts);
// contract.ts's shared DEFAULT_CEILINGS applies only when a caller omits them (e.g. direct
// RunManager-less test construction). v21 Gate 8 RE-REVIEW #6 (P6-5): this file used to re-type
// that literal; it now imports the one constant, like every other site.

/** Read surfaces never serve null/unbounded (DES-103): a missing contract reads back as the
 *  canonical 4-knob contract, and every contract is bounded by the engine ceilings at read time. */
function readParams(stored: unknown, ceilings: Ceilings): ParamContract {
  return effectiveBounds((stored as ParamContract | undefined) ?? canonicalContract(), ceilings);
}

export interface McpFacadeDeps {
  clock?: Clock;
  store?: RunStore;
  runManager?: RunManager;
  validator?: SubmissionValidator;
  /** v21 (ARCH-066, DES-104, TASK-100): engine ceilings bounding workflow_get/list's read-time
   *  effective bounds — forwarded from ServerConfig (see server.ts's createServer). */
  ceilings?: Ceilings;
}

function toErrEnvelope(err: unknown): ErrEnvelope {
  // Every coded error the engine throws is an Error carrying `.code` (errors.ts `codedError` — the
  // single factory, no bare `throw {…}` in src/), so prefer `.code`, else the Error name.
  if (err instanceof Error) {
    const code = (err as { code?: unknown }).code;
    return { code: typeof code === 'string' && code ? code : err.name || 'INTERNAL_ERROR', message: err.message };
  }
  return { code: 'INTERNAL_ERROR', message: String(err) };
}

/** Robustness at the MCP boundary: some MCP clients serialize the untyped `args` object into a JSON
 *  STRING before it reaches the tool (observed with the Claude Code plugin — the script then read
 *  `args.inquiry` off a string and silently got `undefined`). If `args` arrives as a string that is
 *  valid JSON, parse it back into the object the caller intended; a non-JSON string is left as-is
 *  (a workflow that genuinely wants a string arg still gets it). Non-string values pass through. */
function normalizeArgs(args: unknown): unknown {
  if (typeof args !== 'string') return args;
  try {
    return JSON.parse(args);
  } catch {
    return args;
  }
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
  private readonly ceilings: Ceilings;

  constructor(deps: McpFacadeDeps = {}) {
    const clock = deps.clock ?? new SystemClock();
    // Construct the store FIRST and inject it into RunManager (D-I1) — otherwise RunManager
    // builds its own private InMemoryRunStore and every lookup through `this.store` 404s
    // (RUN_NOT_FOUND) even for runs that really are in flight.
    this.store = deps.store ?? new InMemoryRunStore(clock);
    this.runManager = deps.runManager ?? new RunManager({ store: this.store, clock });
    this.validator = deps.validator ?? new SubmissionValidator({ catalog: this.runManager.catalog });
    this.ceilings = deps.ceilings ?? DEFAULT_CEILINGS;
  }

  async workflow_run(a: { name?: string; script?: string; args?: unknown; budget?: number | null; seed?: { path: string; contentB64: string }[]; seedManifest?: ManifestEntry[]; seedNamespace?: string; seedRef?: { repoUrl: string; sha: string }; seedManifestRef?: string; scriptSha256?: string; overrides?: unknown }, principal: string | null = null): Promise<ResultEnvelope<{ runId: string }>> {
    // Fail fast at submission (DES-012/ARCH-008), never mid-run.
    const validation = await this.validator.validate({ name: a.name, script: a.script });
    if (!validation.ok) {
      return { runId: '', status: 'failed', error: validation.errors[0] };
    }
    try {
      // v21 (ARCH-066, DES-104, TASK-100): `overrides` travels as start()'s own argument, never as
      // a RunSpec field (RunSpec is persisted+read-back wholesale by getSpec() on resume).
      const runId = await this.runManager.start({ name: a.name, script: a.script, args: normalizeArgs(a.args), budget: a.budget ?? null, seed: a.seed, seedManifest: a.seedManifest, seedNamespace: a.seedNamespace, seedRef: a.seedRef, seedManifestRef: a.seedManifestRef, scriptSha256: a.scriptSha256, startedBy: { type: 'client' }, ...(principal ? { principal } : {}) }, a.overrides);
      const view = await this.store.getRun(runId);
      return { runId, status: view?.status ?? 'queued', result: { runId } };
    } catch (err) {
      return { runId: '', status: 'failed', error: toErrEnvelope(err) };
    }
  }

  /** Registers/updates a named workflow in the catalog (REQ-014). Not part of the DES-001 core
   *  8-tool contract, but required at the same submission-style entry point for the registry slice.
   *  v15 (DES-098, DES-099, TASK-089): principal threaded for ownership gate; defaults validated + stored.
   *  Flat response: `version` (number) surfaced at top level for direct `r.version` callers; on error,
   *  `code` surfaced at top level alongside `error` for direct `r.code` callers. */
  async workflow_register(a: { name: string; script: string; defaults?: Record<string, unknown> }, principal: string | null = null): Promise<Record<string, unknown>> {
    try {
      const { version } = await this.runManager.catalog.register(a.name, a.script, a.defaults as import('./harness-defaults.js').HarnessDefaults | undefined, principal);
      const versionNum = Number(version.replace(/^v/, '')) || 1;
      return { runId: '', status: 'completed', version: versionNum, result: { name: a.name, version } };
    } catch (err) {
      const e = toErrEnvelope(err);
      return { runId: '', status: 'failed', code: e.code, error: e };
    }
  }

  // v15 (DES-098, TASK-089): ownership gate → NOT_WORKFLOW_OWNER; flat response with `removed` +
  // `code` at top level for direct `r.removed` / `r.code` callers.
  async workflow_deregister(a: { name: string }, principal: string | null = null): Promise<Record<string, unknown>> {
    try {
      const { removed } = await this.runManager.catalog.deregister(a.name, principal);
      return { runId: '', status: 'completed', name: a.name, removed, result: { name: a.name, removed } };
    } catch (err) {
      const e = toErrEnvelope(err);
      return { runId: '', status: 'failed', code: e.code, error: e };
    }
  }

  /** C-3 (review finding): returns the SAME uniform `{ runId, status, result }` envelope as every
   *  other tool — the full RunStatusView (phases/agents/scriptVersion) is the `result` payload, NOT
   *  spread at the top level (which previously made this the only non-uniform tool of the 16). */
  async workflow_status(a: { runId: string }): Promise<ResultEnvelope<RunStatusView>> {
    const view = await this.store.getRun(a.runId);
    if (!view) return { runId: a.runId, status: 'failed', error: notFound(a.runId) };
    const merged = await this.runManager.status(a.runId).catch(() => view);
    // v15 (DES-096): surface principal at the outer envelope level (same level as status/runId)
    // so callers can observe attribution without unwrapping the inner result.
    return { runId: merged.runId, status: merged.status, ...(merged.principal ? { principal: merged.principal } : {}), result: merged };
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
    // v21 (ARCH-066, DES-104, TASK-100): the mere PRESENCE of an `overrides` field is a typed
    // rejection, full stop — no absent-vs-{}-vs-equal semantics to get subtly wrong. A resumed run
    // always re-dispatches from its pinned admission-time snapshot, never a second merge.
    if (Object.prototype.hasOwnProperty.call(a, 'overrides')) {
      return { runId: a.runId, status: 'failed', error: { code: 'RESUME_OVERRIDES_NOT_ALLOWED', message: 'workflow_resume does not accept overrides; the pinned admission-time snapshot is reused. Start a new run to apply different overrides.' } };
    }
    return lifecycle(this.store, a.runId, () => this.runManager.resume(a.runId, a.script));
  }

  async workflow_stop(a: { runId: string }): Promise<ResultEnvelope> {
    return lifecycle(this.store, a.runId, () => this.runManager.stop(a.runId));
  }

  /** REQ-014: a registered workflow must be visible here BEFORE any run — result is a flat
   *  kind-discriminated array mixing catalog entries (unrun workflows) with run summaries, so
   *  callers can find either a workflow by `.name` or a run by `.runId` in the same list (D-I9). */
  async workflow_list(_a?: Record<string, never>): Promise<ResultEnvelope<Array<
    ({ kind: 'workflow'; name: string; version: string; createdAt: string; description: string; params: ParamContract }) | (RunSummary & { kind: 'run' })
  >>> {
    const workflows = await this.runManager.catalog.list();
    const runs = await this.store.listRuns();
    // v21 (DES-103, TASK-099): params surfaced per entry, ceiling-bounded, from the column only
    // (catalog.list() never re-parses the script for it).
    const result = [
      ...workflows.map((w) => ({ kind: 'workflow' as const, ...w, params: readParams(w.params, this.ceilings) })),
      ...runs.map((r) => ({ kind: 'run' as const, ...r })),
    ];
    return { runId: '', status: 'completed', result };
  }

  /** v9 (REQ-061/062): full detail for one registered workflow — its purpose (meta.description +
   *  phases), the script, and a predicted static DAG skeleton — so a client can understand what a
   *  workflow does and see its shape BEFORE deciding to reuse it or author a new one. Unknown name →
   *  typed WORKFLOW_NOT_FOUND envelope (never throws across the tool boundary).
   *  v15 (DES-098, DES-099, TASK-089): adds owner + defaults to output; flat response surfaces
   *  owner/defaults/code at top level for direct `r.owner` / `r.defaults` / `r.code` callers. */
  async workflow_get(a: { name: string }): Promise<Record<string, unknown>> {
    let full: { name: string; script: string; version: string; createdAt: string; owner: string | null; defaults: import('./harness-defaults.js').HarnessDefaults | undefined; params: unknown };
    try {
      full = await this.runManager.catalog.getFull(a.name);
    } catch {
      return { runId: '', status: 'failed', code: 'WORKFLOW_NOT_FOUND', error: { code: 'WORKFLOW_NOT_FOUND', message: `Unknown workflow: ${a.name}` } };
    }
    const meta = parseMeta(full.script);
    // v21 (DES-103, TASK-099): ceiling-bounded contract — never null/unbounded (REQ-090..093).
    const params = readParams(full.params, this.ceilings);
    const resultObj = {
      name: full.name, version: full.version, createdAt: full.createdAt,
      description: meta.description, phases: meta.phases, script: full.script,
      skeleton: parseWorkflowSkeleton(full.script),
      owner: full.owner,
      defaults: full.defaults as Record<string, unknown> | undefined,
      params,
    };
    return {
      runId: '', status: 'completed',
      // Flat: owner + defaults + params + script also at top level for direct r.owner / r.defaults / r.params access
      owner: full.owner,
      params,
      defaults: full.defaults as Record<string, unknown> | undefined,
      script: full.script,
      result: resultObj,
    };
  }

  /** DES-067 (TASK-070): shaped agent log — harness descriptor at top level, stripped from events,
   *  hasMore windowing. The MCP tool enforces a 50-event cap; the HTTP handler passes limit/offset.
   *  `harness:null` means the agent was never dispatched (no harness event in transcript).
   *  `result` retained as an alias for `events` for backward compatibility with existing callers. */
  async workflow_agent_log(a: { runId: string; agentId: string; limit?: number; offset?: number }): Promise<
    ResultEnvelope<TranscriptEvent[]> & {
      harness: HarnessDescriptor | null;
      events: TranscriptEvent[];
      hasMore: boolean;
    }
  > {
    const stored = await this.store.getRun(a.runId);
    if (!stored) return { runId: a.runId, status: 'failed', error: notFound(a.runId), harness: null, events: [], hasMore: false };
    const view = await this.runManager.status(a.runId).catch(() => stored);
    const agent = view.agents.find((ag) => ag.agentId === a.agentId);
    if (!agent) {
      return { runId: a.runId, status: view.status, error: { code: 'AGENT_NOT_FOUND', message: `Agent not found: ${a.agentId}`, field: 'agentId' }, harness: null, events: [], hasMore: false };
    }
    // Real read-back (D-V6): the persisted transcript events for this agent.
    const transcript = await this.store.getTranscript(a.runId, a.agentId);
    // DES-067: project harness event to top-level field (latest-wins), strip from events window.
    const harnessEvents = transcript.filter((e) => e.kind === 'harness');
    const lastHarness = harnessEvents[harnessEvents.length - 1];
    const harness: HarnessDescriptor | null = lastHarness
      ? ((lastHarness.data as { descriptor?: HarnessDescriptor }).descriptor ?? null)
      : null;
    // Strip harness events; apply limit/offset windowing (MCP cap = 50; cap-exempt: harness is already out).
    const nonHarness = transcript.filter((e) => e.kind !== 'harness');
    const cap = a.limit ?? 50;
    const offset = a.offset ?? 0;
    const window = nonHarness.slice(offset, offset + cap);
    const hasMore = offset + cap < nonHarness.length;
    // `result` = backward-compat alias for `events` (existing callers read result; new callers use events).
    return { runId: a.runId, status: view.status, harness, events: window, result: window, hasMore };
  }

  /** REQ-013/D-V7: lists the relative file names present in a run's on-disk workspace — the
   *  smaller of D-V7's two options (no change to the widely-shared RunStatusView/RunSummary
   *  shapes). Missing/never-materialized workspace (e.g. a run that wrote nothing) → []. */
  /** REQ-023 (v1.5): recursively list every file in the run's workspace with size + sha256, so a
   *  client can diff/verify what changed without downloading everything. Escape-safe (realpath). */
  async workflow_artifacts(a: { runId: string }): Promise<ResultEnvelope<ArtifactEntry[]>> {
    const stored = await this.store.getRun(a.runId);
    if (!stored) return { runId: a.runId, status: 'failed', error: notFound(a.runId) };
    // R-3: read through the workspace owner (RunManager), not a direct filesystem call from the
    // facade. null (no workspace) and [] (materialized-but-empty) both surface as an empty list.
    const files = await this.runManager.listArtifacts(a.runId);
    return { runId: a.runId, status: stored.status, result: files ?? [] };
  }

  /** REQ-022 (v1.5): read a windowed, size-capped, realpath-contained chunk of a workspace file, so
   *  a patch/bundle too large for an inline workflow_result can be fetched without OOM. A path that
   *  escapes the workspace (`../`/symlink) is denied with a typed error, never bytes from outside. */
  async workflow_artifact_get(a: { runId: string; path: string; offset?: number; length?: number }): Promise<ResultEnvelope<ChunkResult>> {
    const stored = await this.store.getRun(a.runId);
    if (!stored) return { runId: a.runId, status: 'failed', error: notFound(a.runId) };
    const workspace = await this.runManager.workspacePath(a.runId);
    if (!workspace) return { runId: a.runId, status: stored.status, error: { code: 'RUN_WORKSPACE_MISSING', message: `run ${a.runId} has no on-disk workspace` } };
    const r = readArtifactChunk(workspace, String(a.path ?? ''), a.offset, a.length);
    if ('error' in r) return { runId: a.runId, status: stored.status, error: { code: r.error, message: `artifact_get denied: ${r.error} (${a.path})` } };
    return { runId: a.runId, status: stored.status, result: r };
  }

  /** REQ-026 (v2): delete a terminal run's on-disk workspace tree (its journaled record/transcript
   *  is preserved). Refuses while the run is still active/suspended (would race the sandbox). */
  async workspace_purge(a: { runId: string }): Promise<ResultEnvelope<{ purged: boolean }>> {
    const stored = await this.store.getRun(a.runId);
    if (!stored) return { runId: a.runId, status: 'failed', error: notFound(a.runId) };
    if (stored.status === 'running' || stored.status === 'suspended' || stored.status === 'queued') {
      return { runId: a.runId, status: stored.status, error: { code: 'RUN_NOT_TERMINAL', message: `cannot purge workspace of a ${stored.status} run` } };
    }
    const workspace = await this.runManager.workspacePath(a.runId);
    if (workspace) {
      try { rmSync(workspace, { recursive: true, force: true }); } catch { /* already gone — idempotent */ }
    }
    return { runId: a.runId, status: stored.status, result: { purged: true } };
  }
}
