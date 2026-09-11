// McpFacade (v24 rewrite — DES-149/151/152/155, ARCH-091, TASK-148): the 35-handler v24 tool
// surface behind the new names. Pure delegation + uniform ResultEnvelope, same DES-001 discipline
// as before (never throws across the tool boundary) plus three v24 additions: the register→claim→
// insert→compensate trigger sequence, the six workspace_* modes, and the audited admin cross-read.
import { existsSync, rmSync } from 'node:fs';
import { readArtifactChunk, type ArtifactEntry, type ChunkResult } from './workspace-artifacts.js';
import type { Clock } from './clock.js';
import { SystemClock } from './clock.js';
import type { RunStore } from './run-store.js';
import { InMemoryRunStore } from './run-store.js';
import { RunManager, DEFAULT_RUN_CONCURRENCY } from './run-manager.js';
import { resolveVersionRequest, type WorkflowDetail, type Channel, type VersionSelector } from './workflow-catalog.js';
import { SubmissionValidator } from './submission-validator.js';
// v24 Gate 7.5 (D-3): `toErrEnvelope` is IMPORTED, not re-implemented. This file used to carry a
// private copy whose envelope had no `see` field at all, and since every `workflow_*` handler
// called the local one, the catalog's `see:'workflow_authoring_guide'` pointer never reached the
// wire — the guide a cold model is told to consult was unreachable from the errors that tell it to.
import { CatalogNotFoundError, codedError, toErrEnvelope, type ErrorCode } from './errors.js';
import type { ErrEnvelope, ResultEnvelope, RunStatusView, RunSummary, HarnessDescriptor, RunListFilter, AuditAction, RunSpec, RunUsage, AgentLogView } from './types.js';
import { parseMeta } from './workflow-meta.js';
import { buildAuthoringGuide } from './authoring-guide.js';
import { effectiveAgentBounds, DEFAULT_CEILINGS, type ParamContract, type Ceilings, type AgentParamSpec } from './params/contract.js';
import { projectWorkflowForRead, projectWorkflowDescribe, type WorkflowOwnerView } from './workflow-view.js';
import { scanAgentCalls } from './scan-agent-calls.js';
import { predictedLanes } from './dashboard.js';
import type { Principal } from './authz.js';
import { pathVerdict } from './path-verdict.js';
import { auditedWorkspaceRead } from './audited-read.js';
import type { CasStore } from './cas-store.js';
import { casNamespaceFor } from './cas-store.js';
import type { AssetSyncService, AssetKind, AssetScope } from './asset-sync.js';

// v21 (DES-103/DES-104): the engine ceilings bound the read surfaces (workflow_source/list) at read
// time — TASK-100 wires the live values from ServerConfig via McpFacadeDeps.ceilings (server.ts);
// contract.ts's shared DEFAULT_CEILINGS applies only when a caller omits them.

/** Read surfaces never serve null/unbounded (DES-103): a missing contract reads back as the
 *  canonical 4-knob contract, and every contract is bounded by the engine ceilings at read time. */
/** v24 (DES-144): the "canonical 4-knob contract" fallback is RETIRED — a missing/legacy contract
 *  reads back as the zero-label `{agents:{},args:{}}` shape; `effectiveAgentBounds` bounds each
 *  declared agent's spec individually (the whole-contract `effectiveBounds` it replaces operated
 *  on the now-deleted `knobs` shape). */
function readParams(stored: unknown, ceilings: Ceilings): ParamContract {
  const c = (stored as ParamContract | undefined) ?? { agents: {}, args: {} };
  const agents: Record<string, AgentParamSpec> = {};
  for (const [label, spec] of Object.entries(c.agents ?? {})) {
    agents[label] = effectiveAgentBounds(spec, ceilings);
  }
  return { agents, args: c.args ?? {} };
}

/** v24 (DES-142, ADR-028): the ONE namespace expression — CAS namespace = the caller's own
 *  identity, `'local'` for the no-identity kinds (auth-disabled single-operator, loopback-exempt). */
function nsOf(p: Principal): string {
  // Delegates to `casNamespaceFor` (cas-store.ts) — the ONE expression, shared with the READ side
  // in run-manager.ts, which used to spell it `'_default'` and so never found what this stored.
  return casNamespaceFor(p.kind === 'auth-disabled' || p.kind === 'loopback-exempt' ? null : p.id);
}

/** Structural port both SqliteSchedulerPort and WebhookRegistry satisfy (DES-149) — the facade's
 *  register/deregister sequence only needs these three trigger-claim primitives from either store. */
interface TriggerClaimStore {
  ownerOf(id: string): string | null | undefined;
  claim(id: string, workflow: string): 'claimed' | 'held' | 'NOT_FOUND' | 'ALREADY_CLAIMED';
  release(id: string, workflow: string): void;
  /** v24 (integrator; DES-156/REQ-103): the by-id snapshot `workflow_describe.triggers[]` serves,
   *  and the id set for one workflow. Optional so a unit-tier construction with no trigger stores
   *  still satisfies the port. */
  get?(id: string): unknown;
  claimedIdsFor?(workflow: string): string[];
}

const NEVER_CLAIMS: TriggerClaimStore = {
  ownerOf: () => undefined,
  claim: () => 'NOT_FOUND',
  release: () => { /* no-op */ },
  get: () => null,
  claimedIdsFor: () => [],
};

/** v24 (DES-148): the two catalog methods the facade's register sequence calls SEPARATELY (with a
 *  trigger-claim step in between) — a structural port so this file does not need the concrete
 *  WorkflowCatalog class beyond what's already imported for read-side helpers. */
interface RegistrationCatalog {
  validateRegistration(req: { name: string; script: string; mermaid: string; principal?: string | null }): Promise<{ params: ParamContract }>;
  insertVersion(req: { name: string; script: string; mermaid: string; triggers?: string[]; params: ParamContract; principal?: string | null }): Promise<{ version: string }>;
}

export interface McpFacadeDeps {
  clock?: Clock;
  store?: RunStore;
  runManager?: RunManager;
  validator?: SubmissionValidator;
  /** v21 (ARCH-066, DES-104, TASK-100): engine ceilings bounding workflow_source/list's read-time
   *  effective bounds — forwarded from ServerConfig (see server.ts's createServer). */
  ceilings?: Ceilings;
  /** v24 Gate 7.5 (D-12, REQ-117): the RESOLVED model-alias names this deployment accepts — the
   *  same Set `RunManager` admission and the catalog's registration check use (server.ts's
   *  `aliasNames`), so `workflow_authoring_guide` can NAME them instead of leaving a cold model to
   *  guess. Absent (unit construction) renders the "no alias table configured" sentence. */
  aliasNames?: Set<string>;
  /** v25 (DES-168, REQ-120, issue #61): this deployment's resolved per-run in-flight agent() cap, so
   *  `workflow_authoring_guide` states the REAL fan-out width instead of a literal. Same
   *  "resolved, never hard-coded" rule as `ceilings`/`aliasNames` above. */
  runConcurrency?: number;
  cas?: CasStore;
  assetSync?: AssetSyncService;
  /** v24 (DES-149): the two trigger-claim stores the register/deregister sequence calls into.
   *  Absent (unit-test construction with no triggers ever passed) degrades to a store that answers
   *  NOT_FOUND for everything, rather than crashing. */
  schedulerClaims?: TriggerClaimStore;
  webhookClaims?: TriggerClaimStore;
  /** v25 (REQ-119, DES-166): the rendered-diagram cache, so `workflow_deregister` can drop this
   *  name's entries. REQ-111 makes a version's `mermaid` immutable, so a DELETE is the only event
   *  that can stale the cache — and it can, because `insertVersion` allocates `v${max+1}` over the
   *  name's own rows: deregister + re-register reuses the same (name, 'v1') key. Optional, exactly
   *  like `assetSync` — a unit-constructed facade has no cache bound. */
  diagramCache?: DiagramInvalidator;
}

/** The one method `workflowDeregister` needs from `DiagramRenderer` (v25, DES-166). */
export interface DiagramInvalidator {
  invalidate(name: string): void;
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

/** v24 (integrator, DES-137 + REQ-118): `readArtifactChunk` answers with its own INTERNAL reason
 *  vocabulary (`workspace-artifacts.ts`'s `ArtifactError`), which used to be handed to the caller
 *  verbatim as the error code — so `workspace_pull` advertised `WORKSPACE_ESCAPE`/`NOT_FOUND` in
 *  `tools/list` and actually returned `PATH_OUTSIDE_WORKSPACE`/`NOT_A_FILE`, neither of them a
 *  member of the closed `ErrorCode` union. This is the one translation point between the internal
 *  reason and the advertised code; anything unmapped is `NOT_FOUND` (the tool's generic miss). */
const PULL_REASON_TO_CODE: Record<string, ErrorCode> = {
  PATH_OUTSIDE_WORKSPACE: 'WORKSPACE_ESCAPE',
  NOT_A_FILE: 'NOT_FOUND',
  RUN_WORKSPACE_MISSING: 'NOT_FOUND',
};

function notFound(runId: string): ErrEnvelope {
  return { code: 'RUN_NOT_FOUND', message: `Run not found: ${runId}` };
}

/** v23 Gate 6.5 simplify: the `{code, error}` half of a failed `catalog.resolveDetail`, shared by
 *  `workflow_describe`/`workflow_source` (byte-identical in both before this extraction). Unknown
 *  NAME keeps the pre-v22 `WORKFLOW_NOT_FOUND` code; a known name with an unresolvable version/
 *  channel selector surfaces its own typed code. */
function catalogResolveFailure(err: unknown, name: string): { code: string; error: ErrEnvelope } {
  const error = err instanceof CatalogNotFoundError
    ? { code: 'WORKFLOW_NOT_FOUND', message: `Unknown workflow: ${name}` }
    : toErrEnvelope(err);
  return { code: error.code, error };
}

function reportProblemFor(name: string, owner: string | null): string {
  return owner === null
    ? `this workflow has no recorded owner (ask an operator to run the boot backfill); to report a problem: issue_report({workflow: "${name}"})`
    : `issue_report({workflow: "${name}"})`;
}

export const INLINE_SCRIPT_CLOSED_MESSAGE = 'Inline scripts are no longer accepted at run start; register once (workflow_register) then run by name: workflow_register({name, script, mermaid}) then run_start({name})';

// Shared body for suspend/resume/stop: pre-check, delegate action, post-read new status (or old on error).
async function lifecycle(store: RunStore, runId: string, action: () => Promise<void>): Promise<ResultEnvelope> {
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

/** DES-149: `null` for the two no-real-identity Principal kinds; the CATALOG's own internal
 *  ownership re-check (`existing.owner !== principal`, unchanged since v15) treats `principal ===
 *  null` as "bypass" — the mechanism an `admin`/`auth-disabled` caller uses to act on ANY owner's
 *  row, since authorize() already permitted it structurally and the catalog method itself has no
 *  concept of roles. */
function bypassPrincipal(p: Principal): string | null {
  return p.kind === 'admin' || p.kind === 'auth-disabled' ? null : p.kind === 'loopback-exempt' ? null : p.id;
}

/** DES-149: attribution for a NEW row — always the caller's own id (never a bypass), so an
 *  admin's own registrations/creations are attributed to them, not silently ownerless. */
function attributionPrincipal(p: Principal): string | null {
  return p.kind === 'auth-disabled' || p.kind === 'loopback-exempt' ? null : p.id;
}

/** v24 (integrator; RESTORES 04-design.md:3526, the v22 send-back round-2 wrinkle-1 ruling, which
 *  the v24 dispatch rewrite dropped with no amending design row — found by the Batch-C executor).
 *
 *  That ruling says, in terms: *"while `authEnabled` is false, `args.principal` remains legitimate
 *  identity for all three writes … the gate is `authEnabled`, never 'does a principal exist'."*
 *  v24's `callTool` builds identity only from the edge-resolved `Principal`, so on a no-auth server
 *  EVERY registration was stored ownerless and workflow ownership was neither recorded nor
 *  enforced — REQ-100's whole subject, silently off for the single-operator deployment that is this
 *  engine's default shape.
 *
 *  Scoped exactly as the ruling scopes it, and no wider: the argument is honoured ONLY for
 *  `kind:'auth-disabled'`. A `loopback-exempt` caller on an auth-ENABLED server is deliberately
 *  excluded — self-asserted identity reaching an authenticated deployment is the hole v22's H1
 *  closed, and it stays closed. This is ATTRIBUTION and OWNERSHIP only; it never grants a role
 *  (authorization already short-circuited for `auth-disabled` before this is reached). */
function attributionWithArg(p: Principal, a: unknown): string | null {
  const supplied = (a as { principal?: unknown } | null | undefined)?.principal;
  if (p.kind === 'auth-disabled' && typeof supplied === 'string' && supplied !== '') return supplied;
  return attributionPrincipal(p);
}

/** The ownership-COMPARISON identity, same rule. `bypassPrincipal` answers `null` for admin and for
 *  the no-identity kinds, which the catalog reads as "skip the ownership gate"; with an
 *  `args.principal` on a no-auth server there IS an identity to compare, so the gate applies. */
function bypassWithArg(p: Principal, a: unknown): string | null {
  const supplied = (a as { principal?: unknown } | null | undefined)?.principal;
  if (p.kind === 'auth-disabled' && typeof supplied === 'string' && supplied !== '') return supplied;
  return bypassPrincipal(p);
}

export class McpFacade {
  private readonly store: RunStore;
  private readonly runManager: RunManager;
  private readonly validator: SubmissionValidator;
  private readonly ceilings: Ceilings;
  private readonly aliasNames: Set<string>;
  private readonly runConcurrency: number;
  private readonly cas?: CasStore;
  // Not readonly: `AssetSyncService` needs the server's bound port for `selfBind` (server.ts
  // constructs it AFTER `http.listen()`, well after the facade). `bindAssetSync` lets the
  // composition root supply it once that port is known.
  private assetSync?: AssetSyncService;
  private readonly diagramCache?: DiagramInvalidator;
  private readonly schedulerClaims: TriggerClaimStore;
  private readonly webhookClaims: TriggerClaimStore;

  constructor(deps: McpFacadeDeps) {
    const clock = deps.clock ?? new SystemClock();
    // Construct the store FIRST and inject it into RunManager (D-I1) — otherwise RunManager
    // builds its own private InMemoryRunStore and every lookup through `this.store` 404s
    // (RUN_NOT_FOUND) even for runs that really are in flight.
    this.store = deps.store ?? new InMemoryRunStore(clock);
    this.runManager = deps.runManager ?? new RunManager({ store: this.store, clock });
    this.validator = deps.validator ?? new SubmissionValidator({ catalog: this.runManager.catalog });
    this.ceilings = deps.ceilings ?? DEFAULT_CEILINGS;
    this.aliasNames = deps.aliasNames ?? new Set();
    this.runConcurrency = deps.runConcurrency ?? DEFAULT_RUN_CONCURRENCY;
    this.cas = deps.cas;
    this.assetSync = deps.assetSync;
    this.diagramCache = deps.diagramCache;
    this.schedulerClaims = deps.schedulerClaims ?? NEVER_CLAIMS;
    this.webhookClaims = deps.webhookClaims ?? NEVER_CLAIMS;
  }

  /** See the `assetSync` field comment — called once by the composition root after
   *  `AssetSyncService` is constructed (needs the server's bound port). */
  bindAssetSync(assetSync: AssetSyncService): void {
    this.assetSync = assetSync;
  }

  private _triggerOwner(id: string): string | null | undefined {
    const s = this.schedulerClaims.ownerOf(id);
    if (s !== undefined) return s;
    return this.webhookClaims.ownerOf(id);
  }

  /** One row per declared trigger id, in declaration order. An id that resolves in NEITHER store is
   *  reported as `{id, status:'TRIGGER_NOT_FOUND'}` rather than dropped — a trigger the released
   *  version claims but no store knows is precisely what the reader needs to see. */
  private _resolveTriggers(workflow: string, declaredIds: readonly string[]): unknown[] {
    // Both binding doors, de-duplicated in declaration-then-discovery order: the ids the RESOLVED
    // VERSION declares, plus the ids either store reports as bound to this workflow (a create-time
    // `schedule_create({workflow})` binding never entered a version's `triggers[]`). v24
    // adjudication #8 (H-2) closed the create-time door, so the second source now reaches PRE-v24
    // legacy rows only — and still must, or those rows become invisible here.
    const ids = [...new Set([
      ...declaredIds,
      ...(this.schedulerClaims.claimedIdsFor?.(workflow) ?? []),
      ...(this.webhookClaims.claimedIdsFor?.(workflow) ?? []),
    ])];
    return ids.map((id) => this.schedulerClaims.get?.(id) ?? this.webhookClaims.get?.(id) ?? { id, status: 'TRIGGER_NOT_FOUND' });
  }

  private _storeFor(id: string): TriggerClaimStore {
    return this.schedulerClaims.ownerOf(id) !== undefined ? this.schedulerClaims : this.webhookClaims;
  }

  // ============================================================================================
  // workflow_* (7)
  // ============================================================================================

  /** DES-149: the register→claim→insert→compensate sequence. `validateRegistration` (nothing
   *  written) → every trigger id located + ownership-checked → `claim()` each (first non-'claimed'
   *  releases the ids THIS call claimed, in reverse, and refuses) → `insertVersion` → on throw,
   *  release exactly the ids this call claimed. */
  async workflowRegister(a: { name: string; script: string; mermaid: string; triggers?: string[] }, principal: Principal): Promise<Record<string, unknown>> {
    const claimedThisCall: string[] = [];
    try {
      // v24 Gate 7.5 (D-2, REQ-110's last clause + adjudication #2 A-2): the pre-v24 workflow-wide
      // `defaults` ARGUMENT is retired (ADR-035). It was not declared on the schema and the schema
      // is open, so it arrived, was never forwarded anywhere, and the caller got
      // `status:"completed"` — a cold model working from an older example discovers from the BILL
      // that its knobs did nothing. Refused by name, exactly as `meta.params.knobs` already is.
      if (Object.hasOwn(a as object, 'defaults')) {
        throw codedError(
          'DEFAULTS_RETIRED',
          'DEFAULTS_RETIRED: the workflow-wide `defaults` argument is retired (ADR-035) — declare meta.params.agents.<label>.<key>.default instead',
          { param: 'defaults' },
        );
      }
      const triggers = a.triggers ?? [];
      if (new Set(triggers).size !== triggers.length) {
        throw codedError('INVALID_ARGUMENT', 'INVALID_ARGUMENT: duplicate ids in triggers[]');
      }
      const isAdmin = principal.kind === 'admin' || principal.kind === 'auth-disabled';
      const actorId = principal.kind === 'loopback-exempt' ? undefined : (principal as { id: string }).id;
      for (const id of triggers) {
        const owner = this._triggerOwner(id);
        if (owner === undefined) throw codedError('TRIGGER_NOT_FOUND', `TRIGGER_NOT_FOUND: ${id}`);
        // DES-139's stated operator consequence, matching `authorize()`'s own ownerless rule: an
        // OWNERLESS trigger (`createdBy NULL`, a migrated pre-v24 row) is ADMIN-ONLY — including a
        // re-registration naming a legacy trigger id. The removed `owner !== null` escape let any
        // caller adopt one (Gate 6.5+7 round 2; the arm was reached by no test at all).
        if (!isAdmin && owner !== actorId) throw codedError('NOT_TRIGGER_OWNER', `NOT_TRIGGER_OWNER: ${id}`);
      }
      const catalog = this.runManager.catalog as unknown as RegistrationCatalog;
      const { params } = await catalog.validateRegistration({ name: a.name, script: a.script, mermaid: a.mermaid, principal: attributionWithArg(principal, a) });
      for (const id of triggers) {
        const outcome = this._storeFor(id).claim(id, a.name);
        if (outcome === 'claimed') { claimedThisCall.push(id); continue; }
        if (outcome === 'held') continue; // already this workflow's from an earlier version — never released by compensation
        for (const rid of [...claimedThisCall].reverse()) this._storeFor(rid).release(rid, a.name);
        throw codedError(outcome === 'NOT_FOUND' ? 'TRIGGER_NOT_FOUND' : 'TRIGGER_ALREADY_CLAIMED', `${outcome}: ${id}`);
      }
      try {
        const { version } = await catalog.insertVersion({ name: a.name, script: a.script, mermaid: a.mermaid, triggers, params, principal: attributionWithArg(principal, a) });
        const versionNum = Number(version.replace(/^v/, '')) || 1;
        return { runId: '', status: 'completed', version: versionNum, result: { name: a.name, version } };
      } catch (err) {
        for (const id of [...claimedThisCall].reverse()) this._storeFor(id).release(id, a.name);
        throw err;
      }
    } catch (err) {
      const e = toErrEnvelope(err);
      return { runId: '', status: 'failed', code: e.code, error: e };
    }
  }

  /** DES-149 (ARCH-091): the catalog deletes; the facade releases each claimed trigger and reports
   *  the union as `releasedTriggers`. */
  async workflowDeregister(a: { name: string }, principal: Principal): Promise<Record<string, unknown>> {
    try {
      // v24 Gate 7.5 (D-1b, REQ-115/ADR-026): the catalog reports the ids the VERSION ROWS declare
      // — the claim door, and since adjudication #8 (H-2, issue #56) the only one a new trigger can
      // use. A trigger bound AT CREATION (`schedule_create({workflow})`, now reachable only as a
      // pre-v24 legacy row) never enters a version's `triggers[]`, so deregister released nothing, the row
      // kept pointing at the deleted name, and a same-name re-registration inherited it: live, a
      // real cron fired a run for the new registration 47 s later. `claimedIdsFor()` — the exact
      // reader `workflow_describe` already uses to SHOW both doors — is now consulted here too, so
      // what is released is what was shown.
      const { removed, claimedTriggers } = await this.runManager.catalog.deregister(a.name, bypassWithArg(principal, a));
      const releasedTriggers = [...new Set([
        ...claimedTriggers,
        ...(this.schedulerClaims.claimedIdsFor?.(a.name) ?? []),
        ...(this.webhookClaims.claimedIdsFor?.(a.name) ?? []),
      ])];
      for (const id of releasedTriggers) this._storeFor(id).release(id, a.name);
      // v24 Gate 7.5 (D-10, REQ-113): the catalog transaction deletes the workflow's `assets` ROWS;
      // the tree under `<assetRoot>/<name>/` is filesystem state no SQL statement can reach, and it
      // was surviving the delete — the next registrant of the freed name could declare a skill it
      // had never pushed and receive the previous owner's file, byte-identical, in its own agent
      // workspace. Only on an actual removal (`removed:false` deleted nothing and must delete
      // nothing here either), and optional-chained because a unit-constructed facade may have no
      // asset sync bound at all.
      if (removed) this.assetSync?.deleteWorkflowTree(a.name);
      // v25 (REQ-119, DES-166): and the rendered diagrams — same reason as the asset tree above.
      // The freed name is re-registrable at the SAME version number, so a surviving cache entry
      // would serve the deleted workflow's picture to the next owner of the name.
      if (removed) this.diagramCache?.invalidate(a.name);
      // v24 (integrator, REQ-118): the CATALOG method is deliberately total (`removed:false`, never
      // throws — catalog-v24.test.ts pins that contract, and it stays). The TOOL is not: its own
      // advertised `errors[]` promises `WORKFLOW_NOT_FOUND`, and a caller that deletes a name that
      // was never there must be told so rather than reading `removed:false` out of a success
      // envelope it has no schema reason to inspect.
      if (!removed) {
        const error: ErrEnvelope = { code: 'WORKFLOW_NOT_FOUND', message: `Unknown workflow: ${a.name}` };
        return { runId: '', status: 'failed', code: error.code, error };
      }
      return { runId: '', status: 'completed', name: a.name, removed, releasedTriggers, result: { name: a.name, removed, releasedTriggers } };
    } catch (err) {
      const e = toErrEnvelope(err);
      return { runId: '', status: 'failed', code: e.code, error: e };
    }
  }

  async workflowPublish(a: { name: string; version: string; channel?: Channel }, principal: Principal): Promise<Record<string, unknown>> {
    try {
      // v24 (integrator, REQ-097 — found by the Batch-B executor): the channel DEFAULTS to
      // 'release'. `catalog.publish` sends everything that is not the literal 'release' to
      // `beta_version`, so an omitted channel — which is exactly what the advertised schema allowed
      // — silently published to beta, and the caller's next `run_start` answered
      // CHANNEL_UNPUBLISHED. An unrecognised channel is now refused rather than quietly meaning
      // beta: "point the release pointer" is what this tool says it does.
      const channel = a.channel ?? 'release';
      if (channel !== 'release' && channel !== 'beta') {
        throw codedError('INVALID_CHANNEL', `INVALID_CHANNEL: '${String(channel)}' — the channel must be 'release' or 'beta'`);
      }
      const result = await this.runManager.catalog.publish(a.name, a.version, channel, bypassWithArg(principal, a));
      return { runId: '', status: 'completed', result };
    } catch (err) {
      const e = toErrEnvelope(err);
      return { runId: '', status: 'failed', code: e.code, error: e };
    }
  }

  /** v23 (REQ-101, DES-125/126, v24 rename of workflow_describe): the ONE response, same shape for
   *  every principal (DES-125 already dropped the owner/non-owner split — v24 threads `Principal`
   *  only for signature consistency, no masking decision here). */
  async workflowDescribe(a: { name: string; version?: string; channel?: 'beta' | 'release' }, _principal: Principal): Promise<Record<string, unknown>> {
    const catalog = this.runManager.catalog;
    const sel: VersionSelector = { version: a.version, channel: a.channel };
    let full: WorkflowDetail;
    try {
      full = await catalog.resolveDetail(a.name, sel);
    } catch (err) {
      return { runId: '', status: 'failed', ...catalogResolveFailure(err, a.name) };
    }
    const requested = resolveVersionRequest(sel, full.channels, new Set(full.versions));
    const meta = parseMeta(full.script);
    const check = catalog.validateCurrent(full.script);
    const ownerView: WorkflowOwnerView = {
      name: full.name, version: full.version,
      resolvedBy: requested.ok ? requested.requested.kind : 'default-release',
      channels: full.channels as unknown as Record<string, string>,
      versions: full.versions,
      description: meta.description, phases: meta.phases,
      // v24 (integrator): the RAW stored contract, deliberately NOT `readParams`-normalized here.
      // `readParams` turns an ABSENT contract into `{agents:{},args:{}}`, which erased the one
      // discriminator `projectWorkflowDescribe` uses to answer `runnableReason:'LEGACY_REREGISTER'`
      // — so a migrated pre-v22 row reported `runnable:true` while `run_start` refused it. The
      // projection applies `effectiveAgentBounds` itself (`projectAgentParams`), so nothing is lost
      // by handing it the raw value; `workflow_source`, which has no runnable field, keeps its own
      // `readParams` call.
      params: full.params, owner: full.owner, createdAt: full.createdAt,
      // v24 Gate 7.5 (D-8, REQ-111): the resolved version's own diagram, forwarded verbatim. The
      // projection has read `full.mermaid` since TASK-149 and this view never set it, so even after
      // the catalog started selecting the column the answer would still have been null — the two
      // halves of "author-supplied diagram, served back" are the read and this hand-off.
      mermaid: full.mermaid,
      reportProblem: reportProblemFor(full.name, full.owner),
      validation: check.ok ? { ok: true, errors: [] } : { ok: false, errors: check.errors },
      script: full.script,
    };
    // v24 (integrator; DES-156/REQ-103 — found by the Batch-E executor): `triggers` was a hardcoded
    // `[]` behind an "until TASK-149 wires the by-id lookup" comment, so a workflow's schedules and
    // webhooks were invisible on the ONE surface that is supposed to describe it. Resolved BY ID
    // (`scheduler.get(id) ?? webhooks.get(id)`) from the RESOLVED VERSION's own `triggers` column —
    // never by workflow, because `listByWorkflow` was retired with `trigger-bindings.ts` and
    // because a claim belongs to a version, not to a name.
    const view = projectWorkflowDescribe(ownerView, { ceilings: this.ceilings, triggers: this._resolveTriggers(full.name, full.triggers ?? []) });
    // v26 (DES-184, ARCH-119, TASK-189): `diagramContract` — added here rather than threading
    // through `WorkflowOwnerView`/`WorkflowDescribeView` (workflow-view.ts, no v26 task's file
    // list): `full.diagramContract` ('v1'/'v2', catalog-computed) is exactly the resolved version's
    // own value, so a spread over the projected view is the same fact, one hop shorter.
    // v26 integration (REQ-128 acceptance "dashboard 的 workflow 頁 … tools", clarification 24):
    // `toolSurface` — the literal `allowedTools` each label's `agent()` call declares, or
    // `'default'` when it declares none. Added here, on the `diagramContract` precedent one line
    // above, rather than on `WorkflowDescribeView`: it is derived from the SCRIPT (which the
    // projection deliberately never sees), read with the SAME `scanAgentCalls` the registration
    // checker and `deriveExpectedGraph` use, so the dashboard's tools column and the diagram's
    // `tools:` segment can never disagree. Names only — never a resolved list, never prompt text.
    const toolSurface: Record<string, string[] | 'default'> = {};
    for (const call of scanAgentCalls(full.script).calls) {
      if (call.label === '') continue;
      toolSurface[call.label] = call.allowedTools === undefined || call.allowedTools === 'absent'
        ? 'default'
        : [...call.allowedTools].sort();
    }
    // v27b (DES-197, ARCH-131, TASK-202, ADR-051): `phases[].agents` — predicted per-lane agent
    // labels, joined by lane ORDINAL against `view.phases` (the author-declared, registered
    // metadata). Served UNCONDITIONALLY to every caller; no masking predicate. A phase ordinal
    // with a derived lane gets its labels (`[]` when the lane is dynamic and declares none, never
    // absent); a phase ordinal with NO derived lane gets no `agents` key at all (never `[]`
    // standing in for "unavailable" — `describe.phases` is the author's contract and this
    // projection may not invent a row in it, so lanes beyond `phases.length` are dropped).
    const lanes = predictedLanes(full.script);
    const phases = view.phases.map((p, i) => {
      const lane = lanes.find((l) => l.index === i);
      return lane ? { ...p, agents: lane.agents } : p;
    });
    return { runId: '', status: 'completed', result: { ...view, phases, diagramContract: full.diagramContract, toolSurface } };
  }

  /** v24 rename of `workflow_get` (ARCH-091: "the former workflow_get") — owner/admin full,
   *  non-owner `author` gets the masked projection (`scriptWithheld:true, see:'workflow_describe'`). */
  async workflowSource(a: { name: string; version?: string }, principal: Principal): Promise<Record<string, unknown>> {
    let full: WorkflowDetail;
    try {
      full = await this.runManager.catalog.resolveDetail(a.name, { version: a.version });
    } catch (err) {
      if (err instanceof CatalogNotFoundError) {
        return { runId: '', status: 'failed', code: 'WORKFLOW_NOT_FOUND', error: { code: 'WORKFLOW_NOT_FOUND', message: `Unknown workflow: ${a.name}` } };
      }
      const e = toErrEnvelope(err);
      return { runId: '', status: 'failed', code: e.code, error: e };
    }
    const meta = parseMeta(full.script);
    const params = readParams(full.params, this.ceilings);
    const isOwnerOrAdmin = principal.kind === 'admin' || principal.kind === 'auth-disabled'
      || (principal.kind !== 'loopback-exempt' && principal.id === full.owner);
    const check = this.runManager.catalog.validateCurrent(full.script);
    const validation = check.ok ? { ok: true, errors: [] } : { ok: false, errors: check.errors };

    if (!isOwnerOrAdmin) {
      const ownerView: WorkflowOwnerView = {
        name: full.name, version: full.version,
        channels: full.channels as unknown as Record<string, string>,
        versions: full.versions,
        description: meta.description, phases: meta.phases,
        params, owner: full.owner, createdAt: full.createdAt,
        reportProblem: reportProblemFor(full.name, full.owner),
        validation,
        script: full.script,
      };
      return { runId: '', status: 'completed', result: projectWorkflowForRead(ownerView, false) };
    }
    const resultObj = {
      name: full.name, version: full.version, createdAt: full.createdAt,
      description: meta.description, phases: meta.phases, script: full.script,
      owner: full.owner, params, validation,
    };
    return { runId: '', status: 'completed', owner: full.owner, params, script: full.script, result: resultObj };
  }

  /** v24 (ARCH-091): "workflows only" — the mixed workflow+run listing moves to `run_list`. */
  async workflowList(a: { onlyRunnable?: boolean }, principal: Principal): Promise<ResultEnvelope<Array<{ name: string; owner: string | null; versions: string[]; channels: Record<string, string>; runnable: boolean }>>> {
    const workflows = await this.runManager.catalog.list();
    const onlyRunnable = a.onlyRunnable ?? (principal.kind === 'user');
    const rows = workflows
      // v24 adjudication #6 F-4: `w.owner` directly — the `as unknown as {owner?}` cast this line
      // used to carry is what let tsc stay green while `catalog.list()` had no `owner` field at all.
      .map((w) => ({ name: w.name, owner: w.owner, versions: w.versions, channels: w.channels as unknown as Record<string, string>, runnable: (w.channels as unknown as { release?: string | null })?.release != null }))
      .filter((w) => !onlyRunnable || w.runnable);
    return { runId: '', status: 'completed', result: rows };
  }

  /** v24 (DES-157/TASK-150 owns the full builder + GUIDE_EXAMPLES) — a minimal, real (not a stub)
   *  guide assembled from what already exists (ERROR_CATALOG-shaped rules stated in prose) so the
   *  tool is genuinely answerable today; TASK-150 replaces this body with the generated one. */
  /** v24 (integrator; DES-157/ADR-032, REQ-116/REQ-117 — the C-2 wiring class again): this served
   *  a HAND-TYPED nine-line paragraph while `buildAuthoringGuide()` — the 16 KB guide assembled
   *  from the engine's OWN enforcement constants, with the ten registered examples — sat with
   *  exactly one caller, `scripts/gen-authoring-md.ts`. DES-157 says in terms that this builder is
   *  "the ONE builder both `workflow_authoring_guide` (the MCP tool, over the composition root's
   *  RESOLVED ceilings) and `scripts/gen-authoring-md.ts` call". A cold model, whose only
   *  documentation is this tool, was being handed the summary instead of the guide — and the
   *  summary is hand-typed, i.e. exactly the drift ADR-032 introduced the builder to end.
   *  `this.ceilings` is the RESOLVED ServerConfig value (operator-overridable), not
   *  DEFAULT_CEILINGS — the distinction DES-157's own signature insists on. */
  async workflowAuthoringGuide(): Promise<ResultEnvelope<{ text: string }>> {
    // v24 Gate 7.5 (D-12): the alias names travel with the ceilings — both are "what THIS
    // deployment accepts", and the guide is the only place the surface states either.
    return { runId: '', status: 'completed', result: { text: buildAuthoringGuide({ ...this.ceilings, aliases: [...this.aliasNames], runConcurrency: this.runConcurrency }) } };
  }

  // ============================================================================================
  // run_* (8)
  // ============================================================================================

  /** v24 (adjudication #2 A-2, then #4's wiring sweep): the four seed entry points are declared on
   *  `run_start`'s inputSchema AND documented by the TASK-153 plugin, but this handler used to
   *  destructure only `{name,args,budget,version,overrides}` — so ajv admitted `seedManifestRef`
   *  and the facade silently dropped it on the floor, i.e. every seeded run started EMPTY and
   *  REQ-117's seed probe could never pass. Same built-but-unwired class as REQ-113's `assets`
   *  (C-2): the mechanism exists end to end except for the one line that hands the value over.
   *  `seedNamespace` is deliberately NOT accepted — ADR-028 derives the CAS namespace from the
   *  principal, and `run_start`'s schema is `additionalProperties:false` so a caller-supplied one
   *  is refused before reaching here. */
  async runStart(
    a: {
      name?: string; args?: unknown; budget?: number | null; version?: string; channel?: RunSpec['channel']; overrides?: unknown;
      seed?: RunSpec['seed']; seedManifest?: RunSpec['seedManifest']; seedRef?: RunSpec['seedRef']; seedManifestRef?: string;
    },
    principal: Principal,
  ): Promise<ResultEnvelope<{ runId: string }>> {
    const validation = await this.validator.validate({ name: a.name });
    if (!validation.ok) return { runId: '', status: 'failed', error: validation.errors[0] };
    try {
      const attributed = attributionPrincipal(principal);
      const runId = await this.runManager.start({
        name: a.name, args: normalizeArgs(a.args), budget: a.budget ?? null, version: a.version, startedBy: { type: 'client' },
        // v24 (integrator, REQ-097): `channel` was dropped here too — `RunSpec.channel` and
        // `run-manager.ts`'s resolve both consume it, and without this line the schema's channel
        // would be admitted and then ignored, which is worse than refusing it.
        ...(a.channel !== undefined ? { channel: a.channel } : {}),
        ...(a.seed !== undefined ? { seed: a.seed } : {}),
        ...(a.seedManifest !== undefined ? { seedManifest: a.seedManifest } : {}),
        ...(a.seedRef !== undefined ? { seedRef: a.seedRef } : {}),
        ...(a.seedManifestRef !== undefined ? { seedManifestRef: a.seedManifestRef } : {}),
        ...(attributed ? { principal: attributed } : {}),
      }, a.overrides);
      const view = await this.store.getRun(runId);
      return { runId, status: view?.status ?? 'queued', result: { runId } };
    } catch (err) {
      return { runId: '', status: 'failed', error: toErrEnvelope(err) };
    }
  }

  /** DES-151: `adminReads` is attached HERE, at this projection, only for the run's OWNER —
   *  never a field of `RunStatusView` itself (DES-162's ungated `/api/*` routes therefore cannot
   *  serve it by construction). */
  async runStatus(a: { runId: string }, principal: Principal, _crossPrincipalRead: boolean, _actor: string | null): Promise<ResultEnvelope<RunStatusView>> {
    const view = await this.store.getRun(a.runId);
    if (!view) return { runId: a.runId, status: 'failed', error: notFound(a.runId) };
    const merged = await this.runManager.status(a.runId).catch(() => view);
    const isOwner = merged.principal !== undefined && principal.kind !== 'auth-disabled' && principal.kind !== 'loopback-exempt' && principal.id === merged.principal;
    const adminReads = isOwner ? this.store.auditFor(a.runId) : undefined;
    return {
      runId: merged.runId, status: merged.status,
      ...(merged.principal ? { principal: merged.principal } : {}),
      ...(adminReads !== undefined ? { adminReads } : {}),
      result: merged,
    };
  }

  async runResult(a: { runId: string }, _principal: Principal, crossPrincipalRead: boolean, actor: string | null): Promise<ResultEnvelope> {
    const view = await this.store.getRun(a.runId);
    if (!view) return { runId: a.runId, status: 'failed', error: notFound(a.runId) };
    const owner = view.principal ?? 'local';
    const doRead = () => this.runManager.result(a.runId);
    const outcome = crossPrincipalRead
      ? await auditedWorkspaceRead({ appendAudit: (ev) => this.store.appendAudit(ev) }, { actor, action: 'run_result' as AuditAction, runId: a.runId, owner }, doRead)
      : await doRead();
    const o = outcome as Awaited<ReturnType<RunManager['result']>>;
    const meta = await this._resultMeta(a.runId, view);
    if (o.ok) return { runId: a.runId, status: view.status, result: o.value, meta };
    return { runId: a.runId, status: view.status, error: o.error, meta };
  }

  /** v26 (DES-183, ARCH-118, TASK-183, REQ-127): `run_result.meta` — the run's persisted usage
   *  (`store.getRun` already folds/snapshots it, mirroring `agents`) plus `budgetEnforceable`,
   *  derived at READ from the run's price pin — never stored twice. A pre-v26 run (no pin
   *  persisted) reports `usd:false`: "we cannot claim every reachable model is priced" is the
   *  honest answer, never a crash. */
  private async _resultMeta(runId: string, view: RunStatusView): Promise<{ usage: RunUsage; budgetEnforceable: { usd: boolean; tokens: boolean; unpricedModels: string[] } }> {
    const usage = view.usage ?? { tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, costUSD: 0, unpricedCalls: 0, unmappedMessages: {} };
    const priceBook = await this.store.getPriceBook(runId);
    const unpricedModels = priceBook ? Object.entries(priceBook.pinned).filter(([, e]) => e.price === null).map(([k]) => k) : [];
    const budgetEnforceable = { usd: priceBook !== null && unpricedModels.length === 0, tokens: true, unpricedModels };
    return { usage, budgetEnforceable };
  }

  async runSuspend(a: { runId: string }, _principal: Principal): Promise<ResultEnvelope> {
    return lifecycle(this.store, a.runId, () => this.runManager.suspend(a.runId));
  }

  async runResume(a: { runId: string }, _principal: Principal): Promise<ResultEnvelope> {
    return lifecycle(this.store, a.runId, () => this.runManager.resume(a.runId));
  }

  async runStop(a: { runId: string }, _principal: Principal): Promise<ResultEnvelope> {
    return lifecycle(this.store, a.runId, () => this.runManager.stop(a.runId));
  }

  async runAgentLog(a: { runId: string; agentId?: string; label?: string; limit?: number; offset?: number }, _principal: Principal, crossPrincipalRead: boolean, actor: string | null): Promise<AgentLogView> {
    const stored = await this.store.getRun(a.runId);
    if (!stored) return { runId: a.runId, status: 'failed', error: notFound(a.runId), harness: null, events: [], hasMore: false };
    const view = await this.runManager.status(a.runId).catch(() => stored);
    // v24 (integrator, REQ-118 + DES-161): `run_agent_log`'s ADVERTISED schema takes `{runId,
    // label}` and nothing else — a cold model has no way to learn an `agentId`, which is an
    // engine-minted counter. This used to read `a.agentId ?? a.label`, i.e. it looked the LABEL up
    // in the agentId column, so every schema-conformant call answered AGENT_LOG_NOT_FOUND. The
    // label column DES-161 added to `AgentRecord` had no reader until here. `agentId` stays
    // accepted for the pre-v24 callers that already had one (val-019 reads it off `run_status`).
    const requested = a.agentId ?? a.label ?? '';
    const agent = a.agentId !== undefined
      ? view.agents.find((ag) => ag.agentId === a.agentId)
      : view.agents.find((ag) => ag.label === a.label) ?? view.agents.find((ag) => ag.agentId === a.label);
    if (!agent) {
      return { runId: a.runId, status: view.status, error: { code: 'AGENT_LOG_NOT_FOUND', message: `Agent not found: ${requested}`, field: a.agentId !== undefined ? 'agentId' : 'label' }, harness: null, events: [], hasMore: false };
    }
    const agentId = agent.agentId;
    const owner = stored.principal ?? 'local';
    const doRead = () => this.store.getTranscript(a.runId, agentId);
    const transcript = crossPrincipalRead
      ? await auditedWorkspaceRead({ appendAudit: (ev) => this.store.appendAudit(ev) }, { actor, action: 'run_agent_log' as AuditAction, runId: a.runId, owner }, doRead)
      : await doRead();
    const harnessEvents = transcript.filter((e) => e.kind === 'harness');
    const lastHarness = harnessEvents[harnessEvents.length - 1];
    const harness: HarnessDescriptor | null = lastHarness
      ? ((lastHarness.data as { descriptor?: HarnessDescriptor }).descriptor ?? null)
      : null;
    const nonHarness = transcript.filter((e) => e.kind !== 'harness');
    const cap = a.limit ?? 50;
    const offset = a.offset ?? 0;
    const window = nonHarness.slice(offset, offset + cap);
    const hasMore = offset + cap < nonHarness.length;
    // v27b (DES-192/197, ARCH-131, TASK-202): `record` — the full `AgentRecord` this method already
    // resolved above (`agent`), added on the success branch only; the not-found/error branches above
    // return before this point and carry no `record`.
    return { runId: a.runId, status: view.status, harness, events: window, result: window, hasMore, record: agent };
  }

  /** DES-152: filtered/paginated in SQL — `principal` is set by the facade from the caller's own
   *  id, never from caller args (the tool schema does not even carry a `principal` key). */
  async runList(a: { workflow?: string; status?: string; limit?: number }, principal: Principal): Promise<ResultEnvelope<RunSummary[]>> {
    const filter: RunListFilter = { workflow: a.workflow, status: a.status as RunListFilter['status'], limit: a.limit };
    if (principal.kind !== 'admin' && principal.kind !== 'auth-disabled') {
      filter.principal = nsOf(principal);
    }
    const rows = await this.store.list(filter);
    return { runId: '', status: 'completed', result: rows };
  }

  // ============================================================================================
  // workspace_* (6)
  // ============================================================================================

  async workspaceDiff(a: { manifest?: Array<{ sha256: string }> }, principal: Principal): Promise<ResultEnvelope<{ missing: string[] }>> {
    const ns = nsOf(principal);
    const shas = (a.manifest ?? []).map((e) => e.sha256).filter(Boolean);
    const missing = this.cas ? await this.cas.missing(ns, shas) : shas;
    return { runId: '', status: 'completed', result: { missing } };
  }

  async workspacePush(a: Record<string, unknown>, principal: Principal): Promise<Record<string, unknown>> {
    try {
      if (typeof a['sha256'] === 'string' && typeof a['contentB64'] === 'string') {
        if (!this.cas) throw codedError('CAS_UNAVAILABLE', 'CAS_UNAVAILABLE: no content store configured');
        const ns = nsOf(principal);
        const r = await this.cas.putBlob(ns, a['sha256'] as string, Buffer.from((a['contentB64'] as string) ?? '', 'base64'));
        return { runId: '', status: 'completed', result: { sha256: r.sha256, accepted: r.accepted } };
      }
      const scope: AssetScope = a['scope'] === 'global' ? 'global' : 'workflow';
      const kind = a['kind'] as string;
      const name = a['name'] as string;
      if (!this.assetSync || !name || (kind !== 'skill' && kind !== 'mcp')) {
        throw codedError('INVALID_ARGUMENT', 'INVALID_ARGUMENT: workspace_push arguments matched no known mode (see workflow_authoring_guide)');
      }
      const pushedBy = attributionPrincipal(principal) ?? 'local';
      const body = kind === 'skill' ? { files: a['files'] } : { config: a['config'] };
      const req = scope === 'global'
        ? { scope: 'global' as const, kind: kind as AssetKind, name, pushedBy, ...body }
        : { scope: 'workflow' as const, workflow: a['workflow'] as string, kind: kind as AssetKind, name, pushedBy, ...body };
      const r = await this.assetSync.push(req as never);
      if ('error' in r) return { runId: '', status: 'failed', code: r.error, error: { code: r.error, message: r.error } };
      return { runId: '', status: 'completed', result: r };
    } catch (err) {
      const e = toErrEnvelope(err);
      return { runId: '', status: 'failed', code: e.code, error: e };
    }
  }

  async workspacePull(a: { runId: string; path: string; offset?: number; length?: number }, _principal: Principal, crossPrincipalRead: boolean, actor: string | null): Promise<ResultEnvelope<ChunkResult>> {
    const stored = await this.store.getRun(a.runId);
    if (!stored) return { runId: a.runId, status: 'failed', error: notFound(a.runId) };
    const owner = stored.principal ?? 'local';
    const doRead = async (): Promise<ChunkResult | { error: string }> => {
      const workspace = await this.runManager.workspacePath(a.runId);
      if (!workspace) return { error: 'RUN_WORKSPACE_MISSING' };
      return readArtifactChunk(workspace, String(a.path ?? ''), a.offset, a.length);
    };
    const r = crossPrincipalRead
      ? await auditedWorkspaceRead({ appendAudit: (ev) => this.store.appendAudit(ev) }, { actor, action: 'workspace_pull' as AuditAction, runId: a.runId, owner, path: a.path }, doRead)
      : await doRead();
    if ('error' in r) {
      const code = PULL_REASON_TO_CODE[r.error] ?? 'NOT_FOUND';
      return { runId: a.runId, status: stored.status, error: { code, message: `workspace_pull denied: ${r.error} (${a.path})` } };
    }
    return { runId: a.runId, status: stored.status, result: r };
  }

  async workspaceList(a: { runId?: string; workflow?: string; kind?: AssetKind }, _principal: Principal, crossPrincipalRead: boolean, actor: string | null): Promise<ResultEnvelope<ArtifactEntry[] | unknown[]>> {
    if (a.runId) {
      const stored = await this.store.getRun(a.runId);
      if (!stored) return { runId: a.runId, status: 'failed', error: notFound(a.runId) };
      const owner = stored.principal ?? 'local';
      const doRead = () => this.runManager.listArtifacts(a.runId!);
      const files = crossPrincipalRead
        ? await auditedWorkspaceRead({ appendAudit: (ev) => this.store.appendAudit(ev) }, { actor, action: 'workspace_list' as AuditAction, runId: a.runId, owner }, doRead)
        : await doRead();
      return { runId: a.runId, status: stored.status, result: files ?? [] };
    }
    // v24 (integrator, REQ-118): the asset-scope branch used to answer `[]` for a workflow that was
    // never registered, which reads identically to "registered, no assets" — and the row's own
    // advertised `errors[]` promises `WORKFLOW_NOT_FOUND`. An empty list is a fact about an
    // existing workflow, never an answer about a name the engine has never heard of.
    if (a.workflow !== undefined && !(await this.runManager.catalog.exists(a.workflow))) {
      return { runId: '', status: 'failed', error: { code: 'WORKFLOW_NOT_FOUND', message: `Unknown workflow: ${a.workflow}` } };
    }
    const rows = this.assetSync && a.workflow && a.kind ? await this.assetSync.list({ workflow: a.workflow, kind: a.kind }) : [];
    return { runId: '', status: 'completed', result: rows };
  }

  async workspaceDelete(a: { runId?: string; paths?: string[]; workflow?: string; kind?: AssetKind; name?: string; scope?: AssetScope }, _principal: Principal): Promise<Record<string, unknown>> {
    try {
      if (a.runId) {
        return await this.runManager.withTerminalRun(a.runId, async () => {
          const stored = await this.store.getRun(a.runId!);
          const workspace = await this.runManager.workspacePath(a.runId!);
          const paths = a.paths ?? [];
          const rejected: Array<{ path: string; reason: string }> = [];
          const resolved: string[] = [];
          for (const p of paths) {
            const v = workspace ? pathVerdict(workspace, p, undefined, 'run-workspace') : { kind: 'reject' as const, reason: 'ESCAPE' as const };
            if (v.kind === 'ok' && v.abs) resolved.push(v.abs);
            else rejected.push({ path: p, reason: v.kind !== 'ok' ? v.reason : 'ESCAPE' });
          }
          if (rejected.length > 0) return { runId: a.runId, status: stored?.status ?? 'unknown', result: { deleted: [], missing: [], rejected } };
          const deleted: string[] = [];
          const missing: string[] = [];
          for (let i = 0; i < resolved.length; i++) {
            const abs = resolved[i]!;
            if (!existsSync(abs)) { missing.push(paths[i]!); continue; }
            rmSync(abs, { recursive: true, force: true });
            deleted.push(paths[i]!);
          }
          return { runId: a.runId, status: stored?.status ?? 'unknown', result: { deleted, missing, rejected: [] } };
        });
      }
      if (!this.assetSync || !a.kind || !a.name) {
        throw codedError('INVALID_ARGUMENT', 'INVALID_ARGUMENT: workspace_delete arguments matched no known mode (see workflow_authoring_guide)');
      }
      if (a.scope === 'global') {
        await this.assetSync.delete({ scope: 'global', kind: a.kind, name: a.name });
      } else {
        await this.assetSync.delete({ scope: 'workflow', workflow: a.workflow!, kind: a.kind, name: a.name });
      }
      return { runId: '', status: 'completed', result: { deleted: true } };
    } catch (err) {
      const e = toErrEnvelope(err);
      return { runId: a.runId ?? '', status: 'failed', code: e.code, error: e };
    }
  }

  async workspacePurge(a: { runId: string }, _principal: Principal): Promise<ResultEnvelope<{ purged: boolean }>> {
    try {
      return await this.runManager.withTerminalRun(a.runId, async () => {
        const workspace = await this.runManager.workspacePath(a.runId);
        const existed = !!workspace && existsSync(workspace);
        if (workspace && existed) {
          try { rmSync(workspace, { recursive: true, force: true }); } catch { /* already gone — idempotent */ }
        }
        return { runId: a.runId, status: 'completed', result: { purged: existed } };
      });
    } catch (err) {
      const e = toErrEnvelope(err);
      return { runId: a.runId, status: 'failed', error: e };
    }
  }
}
