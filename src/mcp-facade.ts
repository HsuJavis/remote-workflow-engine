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
import { resolveVersionRequest, type WorkflowDetail, type Channel, type VersionSelector } from './workflow-catalog.js';
import { SubmissionValidator } from './submission-validator.js';
import { CatalogNotFoundError } from './errors.js';
import type { ErrEnvelope, ResultEnvelope, RunStatusView, RunSummary, TranscriptEvent, HarnessDescriptor, ManifestEntry } from './types.js';
import { parseMeta } from './workflow-meta.js';
import { canonicalContract, effectiveBounds, DEFAULT_CEILINGS, type ParamContract, type Ceilings } from './params/contract.js';
import { projectWorkflowForRead, projectWorkflowDescribe, type WorkflowOwnerView } from './workflow-view.js';
import { getTriggerBindings, type TriggerPorts } from './trigger-bindings.js';

// v23 (DES-128, TASK-119): the honest empty snapshot for a test that doesn't care about triggers —
// `triggerPorts` is REQUIRED on McpFacadeDeps (adjudication #2 R-2), so a test facade passes this
// explicitly rather than relying on a silently-degrading default.
export const NO_TRIGGER_PORTS: TriggerPorts = {
  schedules: { listByWorkflow: () => [] },
  webhooks: { listByWorkflow: () => [] },
  continuations: { listPendingByWorkflow: () => [] },
  runs: { getWorkflowName: () => null },
};

// v23 (DES-126/DES-131, TASK-126): the disabled-analyzer default — same convention as
// NO_TRIGGER_PORTS above. `regenerate` is unreachable through the facade while `enabled:false`
// (workflow_regenerate_diagram short-circuits to ANALYZER_DISABLED first) so it never needs to do
// real work here.
export const NO_GRAPH_ANALYZER: NonNullable<McpFacadeDeps['graphAnalyzer']> = {
  enabled: false,
  regenerate: () => ({ queued: false, status: 'pending' }),
};

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

/** v22 (DES-116, ARCH-076, ADR-012, TASK-111): required (no default) read-time identity for
 *  `workflow_get`/`workflow_list` — an optional `principal = null` default would reproduce this
 *  project's `composeConfig` wiring-bug class verbatim (correct implementation, unwired call site,
 *  every unit test green, zero protection). A required argument makes an unwired call site a `tsc`
 *  error instead. Masking keys on `authEnabled`, NEVER on `principal == null` alone: a null
 *  principal has TWO causes — auth genuinely off, and the D-BIND loopback-peer exemption on an
 *  auth-enabled non-loopback-bound server — and both must mask. */
export interface ReadContext {
  authEnabled: boolean;
  principal: string | null;
}

export interface McpFacadeDeps {
  clock?: Clock;
  store?: RunStore;
  runManager?: RunManager;
  validator?: SubmissionValidator;
  /** v21 (ARCH-066, DES-104, TASK-100): engine ceilings bounding workflow_get/list's read-time
   *  effective bounds — forwarded from ServerConfig (see server.ts's createServer). */
  ceilings?: Ceilings;
  /** v23 (DES-128, TASK-119): live cross-store ports for workflow_describe's `triggers` field —
   *  DES-128's read-time call site (the analyzer's own generation-time call is separate, TASK-117).
   *  REQUIRED (adjudication #2 R-2, TASK-126): an unwired call site must be a `tsc` error, not a
   *  silent degrade to "no triggers exist" — a caller that genuinely doesn't care passes
   *  `NO_TRIGGER_PORTS` explicitly. */
  triggerPorts: TriggerPorts;
  /** v23 (DES-126, DES-127 B2/B4, TASK-119): analyzer enabled-state + regenerate delegate for
   *  workflow_describe's diagram fields and workflow_regenerate_diagram's gate. REQUIRED (same R-2
   *  ruling as `triggerPorts` — a disabled deployment passes `NO_GRAPH_ANALYZER` explicitly, never
   *  an omission that reads as "unwired" and "genuinely disabled" alike). */
  graphAnalyzer: { enabled: boolean; regenerate(name: string, version: string, principal: string | null): { queued: boolean; status: 'pending' } };
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

// v22 (DES-117, TASK-109): the closed-error message template, shared by both ingress refusal sites
// in this file (workflow_run/workflow_resume) and RunManager.start()'s own chokepoint check — the
// two-call migration recipe an agent needs (workflow_register then workflow_run({name})).
const INLINE_SCRIPT_CLOSED_MESSAGE = 'Inline scripts are no longer accepted at run start; register once (workflow_register) then run by name: workflow_register({script}) then workflow_run({name})';

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
  private readonly triggerPorts: TriggerPorts;
  private readonly graphAnalyzer: McpFacadeDeps['graphAnalyzer'];

  // v23 (adjudication #2 R-2, TASK-126): `deps` itself has no default — `triggerPorts`/
  // `graphAnalyzer` are required fields on `McpFacadeDeps`, so a `deps = {}` default would fail to
  // typecheck here and, worse, would reintroduce exactly the silent-degrade default this ruling
  // closes. Every caller (including a facade built only for the pre-v23 core 8 tools) passes
  // `NO_TRIGGER_PORTS`/`NO_GRAPH_ANALYZER` explicitly.
  constructor(deps: McpFacadeDeps) {
    const clock = deps.clock ?? new SystemClock();
    // Construct the store FIRST and inject it into RunManager (D-I1) — otherwise RunManager
    // builds its own private InMemoryRunStore and every lookup through `this.store` 404s
    // (RUN_NOT_FOUND) even for runs that really are in flight.
    this.store = deps.store ?? new InMemoryRunStore(clock);
    this.runManager = deps.runManager ?? new RunManager({ store: this.store, clock });
    this.validator = deps.validator ?? new SubmissionValidator({ catalog: this.runManager.catalog });
    this.ceilings = deps.ceilings ?? DEFAULT_CEILINGS;
    this.triggerPorts = deps.triggerPorts;
    this.graphAnalyzer = deps.graphAnalyzer;
  }

  async workflow_run(a: { name?: string; script?: string; args?: unknown; budget?: number | null; seed?: { path: string; contentB64: string }[]; seedManifest?: ManifestEntry[]; seedNamespace?: string; seedRef?: { repoUrl: string; sha: string }; seedManifestRef?: string; version?: string; channel?: 'beta' | 'release'; overrides?: unknown }, principal: string | null = null): Promise<ResultEnvelope<{ runId: string }>> {
    // v22 (DES-114, DES-117, TASK-109): ingress closure is asserted BEFORE `validator.validate()` —
    // `script` is no longer on the advertised schema, but `/mcp` accepts arbitrary JSON, so a
    // hand-rolled body carrying it must be refused INLINE_SCRIPT_CLOSED here; validate() only checks
    // `name` and would otherwise mask this behind MISSING_NAME (script-only bodies carry no name).
    if (a.script !== undefined) {
      return { runId: '', status: 'failed', error: { code: 'INLINE_SCRIPT_CLOSED', message: INLINE_SCRIPT_CLOSED_MESSAGE } };
    }
    // Fail fast at submission (DES-012/ARCH-008), never mid-run.
    const validation = await this.validator.validate({ name: a.name });
    if (!validation.ok) {
      return { runId: '', status: 'failed', error: validation.errors[0] };
    }
    try {
      // v21 (ARCH-066, DES-104, TASK-100): `overrides` travels as start()'s own argument, never as
      // a RunSpec field (RunSpec is persisted+read-back wholesale by getSpec() on resume).
      const runId = await this.runManager.start({ name: a.name, args: normalizeArgs(a.args), budget: a.budget ?? null, seed: a.seed, seedManifest: a.seedManifest, seedNamespace: a.seedNamespace, seedRef: a.seedRef, seedManifestRef: a.seedManifestRef, version: a.version, channel: a.channel, startedBy: { type: 'client' }, ...(principal ? { principal } : {}) }, a.overrides);
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

  /** v22 (REQ-097, DES-111, DES-114, TASK-109): NEW tool — moves a named channel pointer to an
   *  already-registered version. Ownership-gated like register/deregister (NOT_WORKFLOW_OWNER for a
   *  non-owner); registration ≠ publication (a freshly registered version is on no channel until
   *  this is called). Same flat-response shape as workflow_register/deregister. */
  async workflow_publish(a: { name: string; version: string; channel: Channel }, principal: string | null = null): Promise<Record<string, unknown>> {
    try {
      const result = await this.runManager.catalog.publish(a.name, a.version, a.channel, principal);
      return { runId: '', status: 'completed', result };
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
    // v22 (DES-114, DES-117, TASK-109): the replacement-script capability is CLOSED with inline
    // scripts (REQ-098) — `script` is no longer on the advertised schema; a hand-rolled body
    // carrying it is refused here, before any run lookup (matches workflow_run's ordering).
    if (a.script !== undefined) {
      return { runId: a.runId, status: 'failed', error: { code: 'INLINE_SCRIPT_CLOSED', message: INLINE_SCRIPT_CLOSED_MESSAGE } };
    }
    // v21 (ARCH-066, DES-104, TASK-100): the mere PRESENCE of an `overrides` field is a typed
    // rejection, full stop — no absent-vs-{}-vs-equal semantics to get subtly wrong. A resumed run
    // always re-dispatches from its pinned admission-time snapshot, never a second merge.
    if (Object.prototype.hasOwnProperty.call(a, 'overrides')) {
      return { runId: a.runId, status: 'failed', error: { code: 'RESUME_OVERRIDES_NOT_ALLOWED', message: 'workflow_resume does not accept overrides; the pinned admission-time snapshot is reused. Start a new run to apply different overrides.' } };
    }
    return lifecycle(this.store, a.runId, () => this.runManager.resume(a.runId));
  }

  async workflow_stop(a: { runId: string }): Promise<ResultEnvelope> {
    return lifecycle(this.store, a.runId, () => this.runManager.stop(a.runId));
  }

  /** REQ-014: a registered workflow must be visible here BEFORE any run — result is a flat
   *  kind-discriminated array mixing catalog entries (unrun workflows) with run summaries, so
   *  callers can find either a workflow by `.name` or a run by `.runId` in the same list (D-I9). */
  // v22 (DES-116, TASK-111): `ctx` is required (see ReadContext) — entries here have never carried
  // `script` (a catalog-list entry is `{kind:'workflow', name, version, createdAt, description,
  // params, versions, channels}`, never the script text), so there is no masking DECISION to make
  // yet; the parameter exists so a future field that DOES need one is added to an already-wired
  // call site, not a `= null`-defaulted one (the composeConfig class this task exists to close).
  async workflow_list(_a: unknown, _ctx: ReadContext): Promise<ResultEnvelope<Array<
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
   *  phases) and the script — so a client can understand what a
   *  workflow does and see its shape BEFORE deciding to reuse it or author a new one. Unknown name →
   *  typed WORKFLOW_NOT_FOUND envelope (never throws across the tool boundary).
   *  v15 (DES-098, DES-099, TASK-089): adds owner + defaults to output; flat response surfaces
   *  owner/defaults/code at top level for direct `r.owner` / `r.defaults` / `r.code` callers. */
  async workflow_get(a: { name: string; version?: string }, ctx: ReadContext): Promise<Record<string, unknown>> {
    let full: WorkflowDetail;
    try {
      // v22 (REQ-097, DES-114, TASK-109): optional version selector — no `channel` here (unlike
      // workflow_run), same DES-110 truth table, so an unpublished draft still reads by version.
      full = await this.runManager.catalog.resolveDetail(a.name, { version: a.version });
    } catch (err) {
      // Unknown NAME keeps the pre-v22 WORKFLOW_NOT_FOUND code (existing callers depend on it);
      // a KNOWN name with an unresolvable version/channel selector surfaces its real typed code
      // (UNKNOWN_VERSION/CHANNEL_UNPUBLISHED/INVALID_CHANNEL) instead of being swallowed into it.
      if (err instanceof CatalogNotFoundError) {
        return { runId: '', status: 'failed', code: 'WORKFLOW_NOT_FOUND', error: { code: 'WORKFLOW_NOT_FOUND', message: `Unknown workflow: ${a.name}` } };
      }
      const e = toErrEnvelope(err);
      return { runId: '', status: 'failed', code: e.code, error: e };
    }
    const meta = parseMeta(full.script);
    // v21 (DES-103, TASK-099): ceiling-bounded contract — never null/unbounded (REQ-090..093).
    const params = readParams(full.params, this.ceilings);

    // v22 (DES-116, ADR-012, TASK-111): masking keys on `ctx.authEnabled`, never on
    // `ctx.principal == null` alone — a null principal has two causes (auth off; the D-BIND
    // loopback exemption while auth stays on) and both mask. A NULL-`owner` row falls out of this
    // SAME check with no special-casing (`ctx.principal !== null` never matches a null `owner`).
    // `a`'s caller-supplied args are NEVER consulted for identity (ADR-012 bars an `args.principal`
    // unmask path) — only the server-resolved `ctx.principal`.
    const viewerIsOwner = ctx.authEnabled ? (ctx.principal !== null && ctx.principal === full.owner) : true;

    // REQ-099: re-validated against the CURRENT alias/MCP config, never the registration-time
    // result, so staleness (an alias removed after registration) is visible on every read.
    // v22 adjudication #3 (M-1): computed for BOTH branches. It used to run only inside the
    // non-owner branch, so on a default auth-disabled server — where every reader takes the owner
    // branch — REQ-099's "surfaced, not silently swallowed, so the author can fix and re-register"
    // was observable to everyone EXCEPT the author it exists for.
    const check = this.runManager.catalog.validateCurrent(full.script);
    const validation = check.ok ? { ok: true, errors: [] } : { ok: false, errors: check.errors };

    if (!viewerIsOwner) {
      const ownerView: WorkflowOwnerView = {
        name: full.name, version: full.version,
        // v22 (DES-115): workflow-view.ts's `channels` is typed `Record<string,string>` while the
        // catalog's `Channels` allows a null (unpublished) pointer; the double cast is a type-shape
        // reconciliation only — `channels` (with its possible nulls) is on the public allowlist
        // either way (REQ-096's `+channels{release,beta}`), so this widens no disclosure.
        channels: full.channels as unknown as Record<string, string>,
        versions: full.versions,
        description: meta.description, phases: meta.phases,
        params, owner: full.owner, createdAt: full.createdAt,
        reportProblem: full.owner === null
          ? `this workflow has no recorded owner (ask an operator to run the boot backfill); to report a problem: issue_report({workflow: "${full.name}"})`
          : `issue_report({workflow: "${full.name}"})`,
        validation,
        script: full.script,
      };
      // v22 (DES-115): the allowlist projection is the ENTIRE response — no flat top-level copies
      // (the `script` twice-leak this design closes, `mcp-facade.ts:220/232` pre-v22).
      return { runId: '', status: 'completed', result: projectWorkflowForRead(ownerView, false) };
    }

    // Owner (or auth disabled): the pre-v22 surface (REQ-100 clause 3), plus exactly ONE added
    // field — `result.validation` (v22 adjudication #3, M-1). REQ-099 requires the staleness of a
    // workflow that would now fail its registration checks to be observable to the AUTHOR, who is
    // this branch's reader on every auth-disabled deployment; a non-owner already got it. Full
    // `{ok, errors}` here (the non-owner projection narrows it to `{ok}`) because the author is the
    // one who has to act on the errors and re-register.
    const resultObj = {
      name: full.name, version: full.version, createdAt: full.createdAt,
      description: meta.description, phases: meta.phases, script: full.script,
      owner: full.owner,
      defaults: full.defaults as Record<string, unknown> | undefined,
      params,
      validation,
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

  /** v23 (REQ-101, DES-125, DES-126, ARCH-082, TASK-119): the ONE workflow_describe response — every
   *  principal gets the SAME non-owner-shaped view (DES-125 drops `viewerIsOwner`; `ctx` stays
   *  required with no default per ADR-012, but this tool makes no masking decision on it — a future
   *  field that does need one is added to an already-wired call site). Reuses `resolveVersionRequest`
   *  (via `catalog.resolveDetail`) so its error code is IDENTICAL to run-admission's for the same
   *  selector — the only structural way REQ-101's "resolve by REQ-097's exact order" survives someone
   *  editing one call site without the other. */
  async workflow_describe(a: { name: string; version?: string; channel?: 'beta' | 'release' }, _ctx: ReadContext): Promise<Record<string, unknown>> {
    const catalog = this.runManager.catalog;
    const sel: VersionSelector = { version: a.version, channel: a.channel };
    let full: WorkflowDetail;
    try {
      full = await catalog.resolveDetail(a.name, sel);
    } catch (err) {
      if (err instanceof CatalogNotFoundError) {
        const e = { code: 'WORKFLOW_NOT_FOUND', message: `Unknown workflow: ${a.name}` };
        return { runId: '', status: 'failed', code: e.code, error: e };
      }
      const e = toErrEnvelope(err);
      return { runId: '', status: 'failed', code: e.code, error: e };
    }
    // Same pure resolver, called again against the row we already have, purely to name HOW this
    // version was picked (`resolvedBy`) — the codes on the error path above already came from it.
    const requested = resolveVersionRequest(sel, full.channels, new Set(full.versions));
    const meta = parseMeta(full.script);
    const params = readParams(full.params, this.ceilings);
    const check = catalog.validateCurrent(full.script);
    const ownerView: WorkflowOwnerView = {
      name: full.name, version: full.version,
      resolvedBy: requested.ok ? requested.requested.kind : 'default-release',
      channels: full.channels as unknown as Record<string, string>,
      versions: full.versions,
      description: meta.description, phases: meta.phases,
      params, owner: full.owner, createdAt: full.createdAt,
      reportProblem: full.owner === null
        ? `this workflow has no recorded owner (ask an operator to run the boot backfill); to report a problem: issue_report({workflow: "${full.name}"})`
        : `issue_report({workflow: "${full.name}"})`,
      validation: check.ok ? { ok: true, errors: [] } : { ok: false, errors: check.errors },
      script: full.script,
    };
    const { bindings, bindingsFp } = getTriggerBindings(full.name, this.triggerPorts);
    const diagram = catalog.getDiagram(full.name, full.version);
    const view = projectWorkflowDescribe(ownerView, {
      diagram, bindings, bindingsFp, analyzerEnabled: this.graphAnalyzer.enabled,
    });
    return { runId: '', status: 'completed', result: view };
  }

  /** v23 (REQ-102, DES-126, DES-127 B4/B5, ARCH-082, TASK-119): owner-gated kick of a diagram
   *  regeneration for one already-registered `(name, version)`. `version` is required (never
   *  "whatever release currently points at") so nobody regenerates a version they didn't mean to.
   *  Ownership + existence are checked HERE (mirrors `catalog.publish`'s own gate) before the
   *  analyzer is ever touched, so a non-owner or a dangling name/version never reaches it; in-flight
   *  idempotence (DES-127 B4) is `GraphAnalyzer.regenerate`'s own property, simply delegated to. */
  async workflow_regenerate_diagram(a: { name: string; version: string }, principal: string | null = null): Promise<Record<string, unknown>> {
    const catalog = this.runManager.catalog;
    let full: WorkflowDetail;
    try {
      full = await catalog.resolveDetail(a.name, { version: a.version });
    } catch (err) {
      if (err instanceof CatalogNotFoundError) {
        const e = { code: 'WORKFLOW_NOT_FOUND', message: `Unknown workflow: ${a.name}` };
        return { queued: false, code: e.code, error: e };
      }
      const e = toErrEnvelope(err);
      return { queued: false, code: e.code, error: e };
    }
    if (full.owner && principal !== null && full.owner !== principal) {
      const e = { code: 'NOT_WORKFLOW_OWNER', message: `NOT_WORKFLOW_OWNER: workflow '${a.name}' is owned by ${full.owner}` };
      return { queued: false, code: e.code, error: e };
    }
    if (!this.graphAnalyzer.enabled) {
      const e = { code: 'ANALYZER_DISABLED', message: 'the graph analyzer is disabled (graphAnalyzer.enabled:false)' };
      return { queued: false, code: e.code, error: e };
    }
    return this.graphAnalyzer.regenerate(a.name, a.version, principal);
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
