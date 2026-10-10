// src/call-tool.ts (v24 DES-140, ARCH-089, TASK-147): one ToolDeps object, schema BEFORE authz,
// one switch. Replaces the pre-v24 `callTool` (server.ts:868-1043) that took 14 positional
// parameters plus a name/args/principal/authEnabled tail — the v24 tool surface is entirely new
// names (TOOL_SPECS, tool-specs.ts) so this is a fresh dispatcher, not an in-place edit.
import Ajv from 'ajv';
import { randomUUID } from 'node:crypto';
import { TOOL_SPECS } from './tool-specs.js';
import { parseBudget } from './run-guard.js';
import { authorize as realAuthorize, type Principal, type OwnerLookup, type AuthzVerdict } from './authz.js';
import type { McpFacade } from './mcp-facade.js';
import { INLINE_SCRIPT_CLOSED_MESSAGE } from './mcp-facade.js';
import type { SqliteSchedulerPort, NewSchedule } from './scheduler.js';
import type { WebhookRegistry } from './webhook-registry.js';
import type { CasStore } from './cas-store.js';
import type { AssetSyncService } from './asset-sync.js';
import type { McpProbe } from './mcp-probe.js';
import type { IssueReporter, IssueReportInput, IssueListFilter } from './github/issue-reporter.js';
import { auditedWorkspaceRead } from './audited-read.js';
import { matchesCatalogFilter, enrichModelEntry, type ModelEntry, type CatalogFilter } from './models/model-catalog.js';
import { queryModels, ModelsQueryError, type ModelsQuery } from './models/models-query.js';
import type { ModelBook } from './models/model-book.js';
import type { ModelProber, ProbeResult } from './models/model-probe.js';
import type { ObservedStatsProvider } from './models/observed-stats.js';
import { checkModelRef, PROVIDERS, type Provider } from './providers.js';
import { buildHarnessAnnounce } from './harness-info.js';
import { redactSystemInfoForRole, type SystemInfoSampler } from './system-info.js';
import type { RunStore } from './run-store.js';
import { recordRefusal } from './authz-refusal.js';
import { codedError, toErrEnvelope, type ErrorCode } from './errors.js';
import type { PrincipalAdmin } from './auth/principal-admin.js';
import type { ServiceAccountStore, ServiceAccountRow, ServiceAccountSecretRow } from './auth/service-account-store.js';

// Ajv instance shared by every validateArgs() call — same construction as agent-executor.ts's
// schema validation (D-V4): allErrors:false (first failure is enough to refuse), strict:false
// (TOOL_SPECS schemas are hand-authored JSON Schema, not meant to satisfy ajv's strict-mode lints).
const ajv = new Ajv({ allErrors: false, strict: false });

export type AuditWriter = Pick<RunStore, 'appendAudit' | 'auditFor'>;

/** DES-140's signature, minus the retired `continuations`/`mcpRegistry`/`graphAnalyzer` members —
 *  17 positional parameters collapse into this one object. `authorize` is an optional override
 *  (tests inject a spy to prove the schema-before-authz order); production callers never set it —
 *  the real `authorize()` from authz.ts is the default. */
export interface ToolDeps {
  facade: McpFacade;
  scheduler: SqliteSchedulerPort;
  webhooks: WebhookRegistry;
  webhookBaseUrl: string;
  cas: CasStore;
  assetSync: AssetSyncService;
  mcpProbe: McpProbe;
  issueReporter: IssueReporter;
  /** v26 (H-4 send-back repair, ARCH-116): `models_list` reads THIS, never a raw catalog builder —
   *  `ModelBook.snapshot()` is TTL'd and single-flight, so a burst of `models_list` calls fires at
   *  most one upstream fetch, and its `fetchedAt` becomes the served rows' `catalogFetchedAt`. */
  modelBook: ModelBook;
  /** Issue #73: latest probe result per (provider, model), merged into `models_list` rows; and the
   *  prober behind the admin `models_probe` tool. Optional so the many existing ToolDeps test
   *  fixtures compile unchanged — absent means "never probed" / "probing not wired". */
  probeLookup?: (provider: string, model: string) => ProbeResult | undefined;
  modelProber?: ModelProber;
  /** Issue #104: engine-measured per-model-ref call stats (src/models/observed-stats.ts),
   *  TTL-cached over the run store — `models_list`'s `observed` row field reads THIS, never a raw
   *  per-call scan. Optional for the same reason `probeLookup` is: the many existing `ToolDeps` test
   *  fixtures compile unchanged; absent means "not wired" (models_list falls back to `source:'none'`
   *  for every ref). */
  observedStats?: ObservedStatsProvider;
  /** pi harness v1 owner decision 2: set ONLY under `gateway:"pi"` — `models_list` filters its rows
   *  to this provider set so anthropic models never appear in the listing (users only see openrouter
   *  and ollama). Optional for the same reason `probeLookup`/`observedStats` are: absent -> every
   *  provider the catalog returns is listed, unchanged pre-pi behavior. */
  harnessProviders?: readonly Provider[];
  systemInfo: SystemInfoSampler;
  lookup: OwnerLookup;
  audit: AuditWriter;
  /** Issue #116 (OWNER DECISION b): every `authorize()` refusal, appended BEFORE the refusal is
   *  returned (never after — a crash writing it must not silently skip the record). Optional for
   *  the same reason `probeLookup`/`observedStats`/`principals` are: the ~250 existing `ToolDeps`
   *  fixtures compile unchanged; absent -> refusals are stamped with a requestId but not persisted
   *  (never a crash, never flips a refusal into a success). `server.ts` always wires it (the same
   *  `RunStore` `audit` already reads). */
  refusalAudit?: Pick<RunStore, 'appendRefusal' | 'queryRefusals'>;
  authorize?: (principal: Principal, spec: { name: string; key: string | null; authz: unknown }, args: Record<string, unknown>, lookup: OwnerLookup) => AuthzVerdict;
  /** v37 (DES-262, ARCH-181, REQ-218, ADR-083 owner_decision posture C): this engine's MEASURED
   *  confinement posture (src/gateway/confinement-probe.ts, set once at boot — never a config key).
   *  Both this field and `isRemoteSubmission` below default to the SAFE-for-the-existing-suite
   *  reading when omitted (`undefined` ⇒ "don't gate") — every one of this file's other ~250 test
   *  call sites constructs `ToolDeps` without either field and must keep passing unmodified; only
   *  `server.ts`'s real request handler sets both from real measurements. */
  confinementPosture?: 'confined' | 'unconfined';
  /** v37 (DES-262): true iff the caller's raw socket peer is NOT loopback (`net-guard.ts`'s
   *  `isLoopbackPeer`, the same primitive the D-BIND auth exemption already uses — never
   *  `Principal.kind`, which conflates auth state with physical locality, and never `ServerConfig`'s
   *  `bind`/`allowedHosts`, which are deployment-wide policy, not this one request's origin). */
  isRemoteSubmission?: boolean;
  /** Dashboard auth spec §A2: the role store behind `principals_list`/`principal_set_role` (and the
   *  dashboard admin page). Optional so the existing `ToolDeps` fixtures compile unchanged;
   *  `server.ts` always wires it (auth on or off). */
  principals?: PrincipalAdmin;
  /** Service accounts spec (owner decision 2026-10-03): the store behind the 6 service_account_*
   *  tools. Optional so existing ToolDeps fixtures compile unchanged; server.ts always wires it
   *  (auth on or off — same convention as `principals`). */
  serviceAccounts?: ServiceAccountStore;
  /** Revokes every bearer already issued to `principal` (e.g. "sa:ci-bot") — service_account_delete's
   *  "revokes all tokens" (spec §Management surface). Decoupled from TokenStore's concrete type the
   *  same way `principals`/`audit` are their own narrow capabilities. */
  revokeServiceAccountTokens?: (principal: string) => number;
}

/** {code:number} marks the ONE case (unknown tool name) that lifts to a top-level JSON-RPC
 *  `error` rather than being wrapped in `result.content` — every other outcome (schema refusal,
 *  authz refusal, a handler's own envelope) carries a STRING error code inside the normal
 *  `{runId,status,result?,error?}` envelope shape every tool already returns. */
export interface UnknownToolResult {
  error: { code: number; message: string };
}

function unknownTool(name: string): UnknownToolResult {
  return { error: { code: -32601, message: `Unknown tool: ${name}` } };
}

// v37 Gate-8 send-back (finding C-1): `code` is `ErrorCode`, not `string` — a type closes the
// class (an ad-hoc, uncatalogued refusal code can no longer slip through this function) where a
// test closes one instance.
/** run_start's four seed sources (tool-specs.ts). A trigger stores none of them (issue #82) — the
 *  seed belongs to the workflow VERSION (`workflow_register({seedManifestRef})`). */
const TRIGGER_SEED_KEYS = ['seed', 'seedManifest', 'seedManifestRef', 'seedRef'] as const;

function refusalEnvelope(code: ErrorCode, message: string, detail?: Record<string, unknown>): Record<string, unknown> {
  return { runId: '', status: 'failed', code, error: { code, message, ...(detail ? { detail } : {}) } };
}

// Issue #116 (OWNER DECISION a): the two tool families whose GENUINE `*_NOT_FOUND` answer does
// NOT use `refusalEnvelope`'s own generic shape (`{runId:'', status:'failed', code, error}`) —
// `workflow_deregister`/`workflow_publish` DO use that exact shape already (verified against
// mcp-facade.ts), so a masked verdict for THEM needs no special envelope at all; these two families
// do, or the masked response would carry a tell (`runId:''` instead of the real id, or an extra
// top-level `code` key the real handler never sets) that the real not-found answer does not.
const MASKED_BARE_ENVELOPE = new Set(['issue_report', 'schedule_delete', 'schedule_setEnabled', 'webhook_delete']);
const MASKED_RUN_ENVELOPE = new Set(['run_status', 'run_result', 'run_suspend', 'run_resume', 'run_stop']);

/** Issue #116: builds the masked refusal in the SAME shape that tool's own genuine `*_NOT_FOUND`
 *  answer uses (mcp-facade.ts's shared `notFound()` for the run family — real `runId`, no
 *  top-level `code`; `run_agent_log`'s own three extra always-present fields; the bare `{error}`
 *  tool-by-tool pass-throughs for issue_report/schedule/webhook). Returns `undefined` for a tool
 *  `refusalEnvelope` already matches byte-for-byte (workflow_deregister/workflow_publish) or that
 *  authz.ts never masks for (notFoundTemplate's own documented scope) — the caller falls back to
 *  the generic `refusalEnvelope` either way, which is correct in both cases. */
function maskedRefusalEnvelope(toolName: string, args: Record<string, unknown>, code: ErrorCode, message: string): Record<string, unknown> | undefined {
  if (MASKED_BARE_ENVELOPE.has(toolName)) return { error: { code, message } };
  const runId = args['runId'];
  if (MASKED_RUN_ENVELOPE.has(toolName)) return { runId, status: 'failed', error: { code, message } };
  if (toolName === 'run_agent_log') return { runId, status: 'failed', error: { code, message }, harness: null, events: [], hasMore: false };
  return undefined;
}

/** Issue #116 (OWNER DECISION b): classifies + audits via the shared `authz-refusal.ts` (server.ts's
 *  dashboard `allowed()` uses the SAME function, so the masking/audit rule cannot drift between the
 *  two surfaces), then shapes THIS transport's own envelope: stamps `detail.requestId` on an
 *  UNMASKED refusal, or leaves the body byte-identical to that tool's genuine `*_NOT_FOUND` answer
 *  on a masked one (decision a) — see `recordRefusal`'s own doc for why the masked side carries no
 *  requestId. */
function buildRefusalEnvelope(
  deps: Pick<ToolDeps, 'refusalAudit'>,
  requestId: string,
  principal: Principal,
  toolName: string,
  args: Record<string, unknown>,
  verdict: AuthzVerdict,
): Record<string, unknown> {
  const { code, reason, masked } = recordRefusal(deps.refusalAudit, requestId, principal, toolName, args, verdict);
  if (masked) {
    return maskedRefusalEnvelope(toolName, args, code, reason) ?? refusalEnvelope(code, reason, verdict.detail);
  }
  return refusalEnvelope(code, reason, { ...verdict.detail, requestId });
}

/** issue #158 F1: for a property validated with `anyOf` (e.g. `budget`), ajv (even with
 *  `allErrors:false`) emits one error per failed branch plus a summary `anyOf`/`oneOf` error, IN
 *  BRANCH-DECLARATION ORDER — so `errors[0]` is always whichever branch the schema lists FIRST
 *  (here, the trivial `{type:'null'}` branch of `budget`'s anyOf), never the branch the caller's
 *  payload was actually closer to satisfying. Every budget refusal therefore read "/budget must be
 *  null" regardless of what was actually wrong.
 *
 *  Picks the most specific real error instead: drop the `anyOf`/`oneOf` summary row, then prefer
 *  the error with the DEEPEST `instancePath` (a violation one level into the object, e.g.
 *  `/budget/tokens`, is more specific than one about the `/budget` property itself); a tie is
 *  broken by dropping a `{type:'null'}` mismatch against a non-null value — matching a literal
 *  `null`/primitive branch is never informative once the caller supplied an object. Falls back to
 *  `errors[0]` when nothing survives these filters (a single-type schema's one error, unaffected). */
function pickBestError(errors: import('ajv').ErrorObject[]): import('ajv').ErrorObject | undefined {
  const real = errors.filter((e) => e.keyword !== 'anyOf' && e.keyword !== 'oneOf');
  if (real.length === 0) return errors[0];
  const maxDepth = Math.max(...real.map((e) => e.instancePath.length));
  const deepest = real.filter((e) => e.instancePath.length === maxDepth);
  const isNullTypeMismatch = (e: import('ajv').ErrorObject) => e.keyword === 'type' && (e.params as { type?: unknown })?.type === 'null';
  return deepest.find((e) => !isNullTypeMismatch(e)) ?? deepest[0];
}

/** DES-140: schema validation is whatever `spec.inputSchema` actually declares — no implicit
 *  `additionalProperties:false`. A tool whose schema needs to be CLOSED (e.g. reject an unknown
 *  key outright) declares that itself; this function does not paper over a schema that doesn't. */
function validateArgs(schema: Record<string, unknown>, args: unknown): string | null {
  const validate = ajv.compile(schema);
  if (validate(args)) return null;
  const err = pickBestError(validate.errors ?? []);
  if (!err) return 'invalid arguments';
  // issue #158 F1: ajv's own `additionalProperties` message never names the offending key — append
  // it so "unknown key" refusals are actionable instead of a bare "must NOT have additional properties".
  const extra = err.keyword === 'additionalProperties' ? ` (${(err.params as { additionalProperty?: string }).additionalProperty})` : '';
  return `${err.instancePath || '(root)'} ${err.message}${extra}`;
}

/** Service accounts spec (owner decision 2026-10-03): `expiresAt` is ISO-8601 on the wire, epoch ms
 *  in ServiceAccountStore. `undefined` (omitted) passes through unchanged; a non-parseable string
 *  is the sentinel 'INVALID' so the caller can refuse INVALID_ARGUMENT without a try/catch. */
function parseIsoOrUndefined(raw: unknown): number | undefined | 'INVALID' {
  if (raw === undefined) return undefined;
  const t = Date.parse(String(raw));
  return Number.isNaN(t) ? 'INVALID' : t;
}
/** Same as above, but `null` (explicit clear — service_account_update) passes through as `null`. */
function parseIsoOrNullOrUndefined(raw: unknown): number | null | undefined | 'INVALID' {
  if (raw === null) return null;
  return parseIsoOrUndefined(raw);
}
function renderServiceAccountSecret(s: ServiceAccountSecretRow): Record<string, unknown> {
  return { id: s.id, createdAt: new Date(s.createdAt).toISOString(), expiresAt: s.expiresAt !== null ? new Date(s.expiresAt).toISOString() : null, lastUsedAt: s.lastUsedAt !== null ? new Date(s.lastUsedAt).toISOString() : null };
}
/** Service accounts spec: the wire shape of an account — `clientId` ("sa:<name>") alongside `name`
 *  since every management tool's argument is the bare name but a caller using the credentials needs
 *  the client_id form; timestamps are ISO-8601; `secrets[]` never carries a hash or raw value. */
function renderServiceAccount(row: ServiceAccountRow): Record<string, unknown> {
  return {
    clientId: `sa:${row.name}`, name: row.name, description: row.description, role: row.role,
    workflows: row.workflows, expiresAt: row.expiresAt !== null ? new Date(row.expiresAt).toISOString() : null,
    createdBy: row.createdBy, createdAt: new Date(row.createdAt).toISOString(), disabled: row.disabled,
    lastUsedAt: row.lastUsedAt !== null ? new Date(row.lastUsedAt).toISOString() : null,
    secrets: row.secrets.map(renderServiceAccountSecret),
  };
}

/** The `*_list` scoping rule, declared ONCE (Gate 6.5+7 round 2 simplify): both trigger stores'
 *  list tools advertise "the caller's own …; unfiltered for the operator role", and it is a
 *  security-relevant predicate that must not drift between them. `auth-disabled` carries no actor
 *  id, so it is unfiltered for the same reason `admin` is: there is nobody to scope to. */
function scopeToActor<T extends { createdBy?: string | null }>(rows: T[], principal: Principal, actor: string | null): T[] {
  if (principal.kind === 'admin' || principal.kind === 'auth-disabled') return rows;
  return rows.filter((r) => r.createdBy === actor);
}

/** DES-140: `find spec ?? unknownTool(name)` → `validateArgs` → `authorize()` → the one switch. */
export async function callTool(
  deps: ToolDeps,
  name: string,
  args: unknown,
  principal: Principal,
): Promise<unknown> {
  const spec = TOOL_SPECS.find((s) => s.name === name);
  if (!spec) return unknownTool(name);

  const a = (args && typeof args === 'object' ? args : {}) as Record<string, unknown>;
  // [更正 2026-09-26, issue #93 item 2] The remote-submission door USED to live here (v37 DES-262,
  // ARCH-181, REQ-218, ADR-083 owner_decision posture C), ahead of ajv/authorize — a bare
  // CONFINEMENT_UNAVAILABLE regardless of whether the submission's args were even well-formed or
  // its workflow existed. That was wrong for a REMOTE caller specifically: it could never learn
  // "workflow does not exist" or "bad argument" from this door, only ever CONFINEMENT_UNAVAILABLE
  // — a permanent, migration-shaped refusal that gave no signal about its OWN mistake. The door is
  // REMOVED, not relocated here, for both tools it used to gate:
  //  - `run_start`: `RunManager.start()` already threads `isRemoteSubmission` through as
  //    `RunSpec.origin` (`facade.runStart`, below) and now carries the SAME confinement check
  //    itself, deferred to just before its first durable write — see `admissionRefusal()`'s two
  //    call sites in run-manager.ts. Ajv (`argErr`, below), `authorize()`, and
  //    `SubmissionValidator`/`catalog.resolve()`'s existence checks all run first.
  //  - `run_resume`: `McpFacade.runResume()` now takes the same `isRemoteSubmission` flag (mirrors
  //    `runStart`'s signature) and refuses AFTER its own RUN_NOT_FOUND check but before
  //    `RunManager.resume()` is ever called — the sole remaining cover for a remote peer resuming a
  //    run whose PINNED version was registered locally (INV-V37-5(c)'s "pinned path stays
  //    ungated" — `RunManager.resume()` itself only gates the legacy-substitution case).
  // v24 (integrator; REQ-098 + DES-142): `run_start`'s schema is CLOSED, so a caller still using the
  // RETIRED inline door (`{script}`) would be answered a bare `INVALID_ARGUMENT: (root) must NOT
  // have additional properties` — technically true and completely useless. The whole point of
  // REQ-098's typed code is that the caller is TOLD to register first. `script` is deliberately not
  // a declared property (the advertised schema stays the clean v24 one a new caller reads), so the
  // migration answer is given here, ahead of ajv, for the one retired key that has one.
  // `run_resume` is included for the reason its own case is WORSE than run_start's: its schema is
  // open, so ajv admitted the key and the facade silently ignored it — a caller with a real
  // suspended runId was told the resume succeeded having had its script dropped on the floor
  // (found by the Batch-E executor).
  if ((spec.name === 'run_start' || spec.name === 'run_resume') && a['script'] !== undefined) {
    return refusalEnvelope('INLINE_SCRIPT_CLOSED', INLINE_SCRIPT_CLOSED_MESSAGE);
  }
  // v26 (DES-181, ARCH-118, ADR-037, TASK-181): the SAME precedent, one door down — `budget` was a
  // bare number pre-v26 (a token-only limit); `tool-specs.ts`'s advertised schema no longer accepts
  // one at all, so ajv's own complaint would be the generic "must be object" a cold caller cannot
  // act on. `parseBudget`'s own message (naming the USD/tokens migration) is reused here rather than
  // duplicated — it is the one door budget values pass through on the store side too.
  if (spec.name === 'run_start' && typeof a['budget'] === 'number') {
    try {
      parseBudget(a['budget'], { source: 'wire' });
    } catch (err) {
      const e = err as { message?: string; detail?: Record<string, unknown> };
      return refusalEnvelope('INVALID_ARGUMENT', e.message ?? 'INVALID_ARGUMENT: budget', e.detail);
    }
  }
  // v24 (integrator; DES-104 rule (a), found by the Batch-A executor): "the PRESENCE of an
  // `overrides` field on resume is a typed error, full stop — no absent-vs-`{}`-vs-equal semantics
  // to get subtly wrong". It had never been implemented on any surface: `schema()` sets no
  // `additionalProperties:false`, so ajv dropped the key and `runResume` never looked for it — the
  // caller was told the resume succeeded while its override reached nothing, which is the exact
  // silent-drop class this iteration keeps finding. A resume replays the run's PINNED admission
  // snapshot by design (ARCH-066); re-parameterising it is not a thing the engine can honour.
  if (spec.name === 'run_resume' && a['overrides'] !== undefined) {
    return refusalEnvelope(
      'INVALID_ARGUMENT',
      'INVALID_ARGUMENT: run_resume does not accept `overrides` — a resumed run replays the parameter snapshot pinned at admission (start a new run to change parameters)',
    );
  }
  // v24 orchestrator adjudication #8 (H-2, issue #56): the create-time trigger-binding door is
  // closed. `workflow` is off both create rows' inputSchema, but removal alone would make this
  // WORSE, not better — `schema()` declares no `additionalProperties:false`, so ajv would admit the
  // undeclared key and both handlers spread their args straight into the store, self-claiming
  // exactly as before while no longer advertising it. The refusal is given here, ahead of ajv, for
  // the same reason `run_resume`'s `overrides` is: the key has a migration answer, and a bare schema
  // complaint would not carry it. Gate 7.5's D-1 removed the create-time catalog check (REQ-115
  // moves it to `workflow_register`) and left the argument behind, which turned a documented leftover
  // into an unguarded path: a trigger could bind to a name that will never exist, and the id was then
  // unclaimable forever. The store's own `create({workflow})` is unchanged — pre-v24 rows keep firing
  // on their legacy binding; only this door closes.
  if ((spec.name === 'schedule_create' || spec.name === 'webhook_create') && a['workflow'] !== undefined) {
    return refusalEnvelope(
      'INVALID_ARGUMENT',
      `INVALID_ARGUMENT: ${spec.name} names no workflow — create the trigger unclaimed, then bind its id with workflow_register({name, script, mermaid, triggers:[id]})`,
    );
  }
  // Issue #82: a trigger stores no seed, so `schedule_create({…, seed})` used to succeed and the
  // fired run got an empty workspace. Both schemas are now closed, but a bare "must NOT have
  // additional properties" would not say why or what to do instead — so the seed keys are refused
  // here, ahead of ajv, with that answer (same reason as the `workflow` door above).
  if (spec.name === 'schedule_create' || spec.name === 'webhook_create') {
    const seedKey = TRIGGER_SEED_KEYS.find((k) => a[k] !== undefined);
    if (seedKey !== undefined) {
      return refusalEnvelope(
        'INVALID_ARGUMENT',
        `INVALID_ARGUMENT: ${spec.name} does not accept \`${seedKey}\` — a trigger cannot carry a seed, and the key would be silently dropped. ` +
          'Bind the seed to the workflow VERSION instead: upload the files (POST /assets/blob/<sha>, then POST /assets/manifest) and register with workflow_register({name, script, mermaid, seedManifestRef}) — every run of that version that brings no seed of its own, scheduled and webhook-fired runs included, starts with those files. ' +
          "Per-agent skill files can also ship as skill assets (workspace_push({workflow, kind:'skill', name, files})). " +
          'Or start the run yourself with run_start({name, seed | seedManifest | seedManifestRef | seedRef}).',
      );
    }
  }
  // v24 (integrator): `system_info.topN` is the one place two live design statements collide.
  // DES-077 names the behaviour "clamp-not-reject" (IT-069) AND requires the advertised schema to
  // carry `minimum:1, maximum:50` so a schema-only consumer knows the range (IT-072/VAL-088);
  // DES-140 then made the advertised schema authoritative ("validation is whatever
  // `spec.inputSchema` actually declares"), which turns the documented maximum into a refusal.
  // Clamping HERE, before validation, honours both: the range stays documented where a cold model
  // reads it, and an over-range request still succeeds with the 50 rows DES-077 promises. Scoped to
  // this one field; nothing else in the surface clamps, and nothing else should.
  if (spec.name === 'system_info' && typeof a['topN'] === 'number') {
    a['topN'] = Math.min(50, Math.max(1, Math.floor(a['topN'])));
  }
  const argErr = validateArgs(spec.inputSchema, a);
  if (argErr !== null) return refusalEnvelope('INVALID_ARGUMENT', `INVALID_ARGUMENT: ${argErr}`);

  const authorize = deps.authorize ?? realAuthorize;
  const verdict = authorize(principal, spec, a, deps.lookup);
  if (!verdict.ok) {
    // Issue #116 (OWNER DECISIONS a+b): one audit row + (for an unmasked refusal) a requestId
    // echoed on the envelope — see buildRefusalEnvelope's own doc for why a MASKED refusal's
    // envelope is left untouched instead.
    return buildRefusalEnvelope(deps, randomUUID(), principal, spec.name, a, verdict);
  }
  const crossPrincipalRead = verdict.crossPrincipalRead === true;
  // `auth-disabled` carries no actor id — DES-151's audited handlers must never write a row for it.
  const actor = principal.kind === 'auth-disabled' || principal.kind === 'loopback-exempt' ? null : principal.id;

  const { facade } = deps;
  switch (spec.name) {
    // ---- workflow (7) ----
    case 'workflow_register': return facade.workflowRegister(a as never, principal, deps.isRemoteSubmission === true);
    case 'workflow_deregister': return facade.workflowDeregister(a as never, principal);
    case 'workflow_publish': return facade.workflowPublish(a as never, principal);
    case 'workflow_describe': return facade.workflowDescribe(a as never, principal, deps.isRemoteSubmission === true);
    case 'workflow_source': return facade.workflowSource(a as never, principal);
    case 'workflow_list': return facade.workflowList(a as never, principal, deps.isRemoteSubmission === true);
    case 'workflow_authoring_guide': return facade.workflowAuthoringGuide();

    // ---- run (8) ----
    // v37 (ARCH-182, DES-263, TASK-258): threads this request's own remoteness fact through to
    // RunManager.start()'s admission predicate — the ONE tools/call-driven admission site.
    case 'run_start': return facade.runStart(a as never, principal, deps.isRemoteSubmission === true);
    case 'run_status': return facade.runStatus(a as never, principal, crossPrincipalRead, actor);
    case 'run_result': return facade.runResult(a as never, principal, crossPrincipalRead, actor);
    case 'run_suspend': return facade.runSuspend(a as never, principal);
    case 'run_resume': return facade.runResume(a as never, principal, deps.isRemoteSubmission === true);
    case 'run_stop': return facade.runStop(a as never, principal);
    case 'run_agent_log': return facade.runAgentLog(a as never, principal, crossPrincipalRead, actor);
    case 'run_list': return facade.runList(a as never, principal);

    // ---- workspace (6) ----
    case 'workspace_diff': return facade.workspaceDiff(a as never, principal);
    case 'workspace_push': return facade.workspacePush(a as never, principal);
    case 'workspace_prune_blobs': return facade.workspacePruneBlobs(a as never, principal);
    case 'workspace_pull': return facade.workspacePull(a as never, principal, crossPrincipalRead, actor);
    case 'workspace_list': return facade.workspaceList(a as never, principal, crossPrincipalRead, actor);
    case 'workspace_delete': return facade.workspaceDelete(a as never, principal);
    case 'workspace_purge': return facade.workspacePurge(a as never, principal);

    // ---- schedule (4) — thin pass-through to SqliteSchedulerPort, unchanged since v2 (DES-016)
    // except for the v24 principal-scoped list. ----
    case 'schedule_create': {
      const createdBy = actor ?? undefined;
      // v24 (integrator, adjudication #4 C-1): `NewSchedule` is a union DISCRIMINATED on `kind`,
      // but `schedule_create`'s advertised inputSchema is `{workflow, cron}` — "Register a
      // cron-style trigger". A cold model reading `tools/list` therefore sends no `kind` and the
      // INSERT died on `NOT NULL constraint failed: schedules.kind`, a raw SQLite string no caller
      // can act on. The discriminant is supplied here so the advertised schema is TRUE; an explicit
      // `kind` (the `resident`/`once` callers that predate this row) still wins.
      // Gate 6.5+7 round 2 (verifier): the SAME defect class one rung down. `enabled` is an
      // OPTIONAL boolean on the advertised schema and `SqliteSchedulerPort.create` stores
      // `s.enabled ? 1 : 0`, so the row's own happy fixture — `{workflow, cron}` — created a
      // schedule born DISABLED, which `tick()` never selects: "Register a time trigger" registered
      // one that could never fire, in silence. Defaulted here, next to `kind`, for the same reason:
      // so the advertised schema is TRUE. An explicit `enabled:false` still wins.
      const raw = a as unknown as Partial<NewSchedule> & Record<string, unknown>;
      const withKind = (raw.kind === undefined ? { ...raw, kind: 'cron' } : raw) as NewSchedule;
      const enabled = raw.enabled === undefined ? true : raw.enabled;
      // v37 (ARCH-182, DES-263, TASK-258): the creation stamp, from the SAME isRemoteSubmission
      // the door (DES-262) already reads — both tools are dispatched inside this file, which
      // already holds the flag, so no new plumbing to the HTTP layer. `claim()` (invoked from
      // `workflow_register`, `:212` below) re-stamps this monotonically afterwards — this is not
      // the only writer.
      return deps.scheduler.create({ ...withKind, enabled, createdBy, createdRemote: deps.isRemoteSubmission === true });
    }
    case 'schedule_list': return { result: scopeToActor(await deps.scheduler.list(), principal, actor) };
    case 'schedule_delete': return deps.scheduler.delete(a['id'] as string);
    case 'schedule_setEnabled': return deps.scheduler.setEnabled(a['id'] as string, a['enabled'] as boolean);

    // ---- webhook (3) ----
    case 'webhook_create': {
      // v37 (ARCH-182, DES-263, TASK-258): same createdRemote stamping as schedule_create above.
      const r = await deps.webhooks.create({ ...(a as unknown as { workflow?: string; enabled?: boolean }), createdBy: actor ?? undefined, createdRemote: deps.isRemoteSubmission === true });
      if ('error' in r) return { error: r.error };
      return { result: { webhookId: r.webhookId, url: `${deps.webhookBaseUrl}/hooks/${r.webhookId}`, secret: r.secret } };
    }
    // v24 (DES-139, TASK-142): principal-scoped exactly as `schedule_list` is — the row's own
    // description ("the caller's own webhooks; unfiltered for the operator role") is only true
    // once `webhooks.createdBy` exists to filter on.
    case 'webhook_list': return { result: scopeToActor(deps.webhooks.list(), principal, actor) };
    case 'webhook_delete': {
      // v24 (integrator, REQ-118): the registry method is total (`{deleted:false}`); the TOOL
      // advertises `TRIGGER_NOT_FOUND`, so deleting an id that never existed is a refusal here —
      // not a success envelope whose only signal is a boolean nothing told the caller to read.
      const r = deps.webhooks.delete(a['id'] as string);
      if (!r.deleted) return { error: { code: 'TRIGGER_NOT_FOUND', message: `Unknown webhook: ${String(a['id'])}` } };
      return { result: r };
    }

    // ---- issue (5) — envelope-not-throw, unchanged from the pre-v24 surface bar the renames. ----
    case 'issue_report': {
      // Issue #130: `authorize()` above already refused a non-owner/non-admin NOT_RUN_OWNER (and
      // let an ownerless/legacy run through to admin-only, per the `ownership:'run'` tri-state —
      // see authz.ts). What it does NOT refuse is a `runId` that does not exist at all (tri-state
      // `undefined` ⇒ "let the handler answer NOT_FOUND", same as every other `ownership:'run'`
      // tool) — `issue_report` had no handler-side existence check of its own, so a bogus runId
      // used to file silently with no diagnostics rather than refuse, unlike run_status. `deps.
      // lookup.runOwner` is the SAME sync port authorize() just read — no second oracle.
      const runId = (a as { runId?: unknown }).runId;
      const owner = typeof runId === 'string' ? deps.lookup.runOwner(runId) : undefined;
      if (typeof runId === 'string' && owner === undefined) {
        return { error: { code: 'RUN_NOT_FOUND', message: `Run not found: ${runId}` } };
      }
      // Issue #134: issue_report publishes a run's diagnostics (transcript tail) to the PUBLIC
      // tracker — the same cross-principal exposure run_result/run_agent_log/workspace_list already
      // audit via `auditedWorkspaceRead`. issue_report doesn't go through any of mcp-facade.ts's own
      // audited methods (it calls `IssueReporter.report()` directly), so the SAME row is appended
      // here instead, before the report is filed — gated on the SAME `crossPrincipalRead` flag
      // `authorize()` already raised above (now that issue_report's `run` row carries
      // `adminCrossRead:true`, tool-specs.ts). An ownerless run's admin-only read never sets the
      // flag (authz.ts), so it stays unaudited exactly like every other audited tool's ownerless case.
      const doReport = () => deps.issueReporter.report(a as unknown as IssueReportInput, actor);
      const res = typeof runId === 'string' && crossPrincipalRead
        ? await auditedWorkspaceRead(deps.audit, { actor, action: 'issue_report', runId, owner: owner ?? 'local' }, doReport)
        : await doReport();
      return res.ok ? { result: { issueNumber: res.issueNumber, url: res.url, deduped: res.deduped } } : { error: res.error };
    }
    case 'issue_get': {
      const res = await deps.issueReporter.getIssue(Number((a as { number?: unknown }).number));
      return res.ok ? { result: res.issue } : { error: res.error };
    }
    case 'issue_list': {
      const res = await deps.issueReporter.listIssues(a as unknown as IssueListFilter);
      return res.ok ? { result: res.issues } : { error: res.error };
    }
    case 'issue_get_comments': {
      const res = await deps.issueReporter.getComments(Number((a as { number?: unknown }).number));
      return res.ok ? { result: res.comments } : { error: res.error };
    }
    case 'issue_comment_post': {
      const res = await deps.issueReporter.postComment(Number((a as { number?: unknown }).number), (a as { body?: unknown }).body as string);
      return res.ok ? { result: { commentId: res.commentId, url: res.url } } : { error: res.error };
    }
    case 'issue_reopen': {
      // issue #164: "original reporter or admin" is checked inside IssueReporter.reopen() itself
      // (it needs the issue's body, an async GitHub read — authorize()/OwnerLookup are pure/sync by
      // design). `auth-disabled`/`loopback-exempt` carry no actor id (`actor` is already null for
      // both, set above) and are NOT treated as admin here — only a genuine `kind:'admin'` principal
      // bypasses the reporter-marker check, so a loopback-exempt caller can reopen only an issue it
      // itself reported (actor null never matches a marker, which is also never null-valued).
      const isAdmin = principal.kind === 'admin';
      const res = await deps.issueReporter.reopen(
        Number((a as { number?: unknown }).number),
        (a as { reason?: unknown }).reason as string,
        { actor, isAdmin },
      );
      return res.ok ? { result: { issueNumber: res.issueNumber } } : { error: res.error };
    }

    // ---- environment (2) ----
    case 'models_list': {
      // v26 (H-4 send-back repair, ARCH-116): through `ModelBook.snapshot()` (TTL'd, single-flight)
      // rather than a raw catalog fetch per call — `entries` is really `ModelEntry[]` at the one
      // production wiring site (server.ts's `buildModelCatalog` is `ModelBook`'s own `source()`).
      const snapshot = await deps.modelBook.snapshot();
      // pi harness v1 owner decision 2: filtered BEFORE the catalog-level filter below, so an
      // anthropic row never reaches enrichment/pagination — models_list never returns anthropic
      // models under gateway:"pi".
      const entries = (snapshot.entries as ModelEntry[]).filter(
        (e) => deps.harnessProviders === undefined || (deps.harnessProviders as readonly string[]).includes(e.provider),
      );
      // Issue #104: catalog-level filters first (on the raw rows, exactly as before), then the
      // enriched-row query — selection filters, sort, cursor page, field projection. `limit` now
      // pages (default 50, clamped to 200) instead of truncating, and the reply is a page wrapper.
      // ObservedStats: ONE consistent snapshot per call (`getAll()`), joined by ref.
      const observed = deps.observedStats?.getAll();
      const rows = entries
        .filter((e) => matchesCatalogFilter(e, a as CatalogFilter))
        .map((e) => enrichModelEntry(e, snapshot.fetchedAt, deps.probeLookup?.(e.provider, e.model), observed?.get(`${e.provider}/${e.model}`), deps.harnessProviders));
      try {
        return { result: queryModels(rows, a as ModelsQuery) };
      } catch (err) {
        if (err instanceof ModelsQueryError) return refusalEnvelope('INVALID_ARGUMENT', `INVALID_ARGUMENT: ${err.message}`);
        throw err;
      }
    }
    case 'models_probe': {
      const model = a['model'] as string | undefined;
      // review M7: refused BEFORE the "no gateway configured" door below (and before ever reaching
      // `ModelProber`) — the SAME gate `checkModelRef`'s own harnessProviders check and
      // `models_list`'s filter apply (owner decision 2, above), so an explicit anthropic/* ref under
      // gateway:"pi" is never probed, regardless of whether a prober is even wired on this engine.
      if (model !== undefined) {
        // issue #136: the SAME TTL'd, single-flight snapshot `models_list` reads just above (not a
        // second live fetch) — so a PROVIDER_UNSUPPORTED_BY_HARNESS hint here can name a real,
        // catalog-linked OpenRouter ref (providers.ts's `harnessUnsupportedSuggestion`) instead of
        // the `{entries:[]}` placeholder, which could only ever fall back to generic guidance.
        const snapshot = await deps.modelBook.snapshot();
        const verdict = checkModelRef(model, { entries: snapshot.entries as ModelEntry[], source: snapshot.source, harnessProviders: deps.harnessProviders });
        if (!verdict.ok && verdict.code === 'PROVIDER_UNSUPPORTED_BY_HARNESS') {
          return refusalEnvelope('PROVIDER_UNSUPPORTED_BY_HARNESS', verdict.message);
        }
      }
      if (!deps.modelProber) return refusalEnvelope('INVALID_ARGUMENT', 'model probing is not available on this engine (no gateway configured)');
      const results = await deps.modelProber.probeNow(model, a['timeoutMs'] as number | undefined);
      if (results === null) {
        // review M7 (accuracy): lists only the providers THIS deployment actually accepts, not
        // always the static full three — matches `checkModelRef`'s own malformed-ref message shape.
        const providers = deps.harnessProviders ?? PROVIDERS;
        return refusalEnvelope('UNKNOWN_MODEL', `UNKNOWN_MODEL: "${model}" is not a valid <provider>/<model-id> ref (providers: ${providers.join(', ')})`);
      }
      return { result: results };
    }
    case 'system_info': {
      const topN = a['topN'] !== undefined ? Math.floor(Number(a['topN'])) : 5;
      try {
        const rawView = await deps.systemInfo.get({ topN });
        // issue #123: below-admin callers (`user`/`author`, or an unauthenticated
        // loopback-exempt caller) get CPU/memory/disk and process COUNTS only — never the top-N
        // process list (OS `comm` names/command detail). `auth-disabled` (single-operator mode,
        // where no caller is any less trusted than any other) is treated as admin, same as a real
        // `admin` principal. The SAME redactSystemInfoForRole is applied by GET /api/system.
        const isAdmin = principal.kind === 'admin' || principal.kind === 'auth-disabled';
        const view = redactSystemInfoForRole(rawView, isAdmin);
        // pi harness v1 (spec "Disclosure"): the self-describing MCP surface states the harness,
        // its provider set, unsupported tools, and effort/usage semantics — same source
        // (harness-info.ts) the authoring guide and DEPLOY.md read, so the three can never drift.
        return { status: 'ok', result: { ...view, harness: buildHarnessAnnounce(deps.harnessProviders) } };
      } catch (err) {
        // Round-3 reverify (#166 decision 3, low): used to answer the raw caught error's own
        // `.message` directly — bypassing the central `toErrEnvelope` scrub every OTHER
        // MCP-facing envelope funnels through, which is exactly what could leak a host path from
        // an underlying fs/probe error. `PROBE_ERROR` is a real `ERROR_CATALOG` member now, so
        // `toErrEnvelope` scrubs its message the same way it already scrubbed `INTERNAL_ERROR`'s,
        // while still reporting `PROBE_ERROR` (not folded onto `INTERNAL_ERROR`) to the caller.
        const rawCode = (err as { code?: unknown } | null)?.code;
        const envelope = toErrEnvelope(codedError('PROBE_ERROR', String(err), typeof rawCode === 'string' ? { rawCode } : undefined));
        return { status: 'error', error: envelope };
      }
    }
    case 'principals_list': {
      if (!deps.principals) return refusalEnvelope('INTERNAL_ERROR', 'INTERNAL_ERROR: the principal role store is not wired on this engine');
      return { runId: '', status: 'completed', result: deps.principals.list() };
    }
    case 'principal_set_role': {
      if (!deps.principals) return refusalEnvelope('INTERNAL_ERROR', 'INTERNAL_ERROR: the principal role store is not wired on this engine');
      const out = deps.principals.setRole(a['id'] as string, (a['role'] ?? null) as 'admin' | 'author' | 'user' | 'none' | null, actor ?? 'local');
      if (!out.ok) return refusalEnvelope(out.code, out.reason);
      return { runId: '', status: 'completed', result: out.entry };
    }
    case 'principal_set_quota': {
      if (!deps.principals) return refusalEnvelope('INTERNAL_ERROR', 'INTERNAL_ERROR: the principal role store is not wired on this engine');
      const out = deps.principals.setQuota(a['id'] as string, a['limit'] ?? null, actor ?? 'local');
      if (!out.ok) return refusalEnvelope(out.code, out.reason);
      return { runId: '', status: 'completed', result: out.entry };
    }
    // Issue #116 (OWNER DECISION b): admin-only query over the refusal audit trail.
    case 'audit_refusals_list': {
      if (!deps.refusalAudit) return refusalEnvelope('INTERNAL_ERROR', 'INTERNAL_ERROR: the refusal audit store is not wired on this engine');
      const filter = {
        ...(typeof a['actor'] === 'string' ? { actor: a['actor'] as string } : {}),
        ...(typeof a['tool'] === 'string' ? { tool: a['tool'] as string } : {}),
        ...(typeof a['since'] === 'string' ? { since: a['since'] as string } : {}),
        ...(typeof a['limit'] === 'number' ? { limit: a['limit'] as number } : {}),
      };
      return { runId: '', status: 'completed', result: deps.refusalAudit.queryRefusals(filter) };
    }

    // ---- service accounts (6) — owner decision 2026-10-03 ----
    case 'service_account_create': {
      if (!deps.serviceAccounts) return refusalEnvelope('INTERNAL_ERROR', 'INTERNAL_ERROR: the service account store is not wired on this engine');
      const expiresAt = parseIsoOrUndefined(a['expiresAt']);
      if (expiresAt === 'INVALID') return refusalEnvelope('INVALID_ARGUMENT', 'INVALID_ARGUMENT: expiresAt must be a parseable ISO-8601 timestamp');
      const out = deps.serviceAccounts.create({
        name: a['name'] as string, description: (a['description'] as string | undefined) ?? null,
        role: a['role'] as 'author' | 'user', workflows: a['workflows'] as string[] | undefined,
        expiresAt, createdBy: actor ?? 'local',
      });
      if (!out.ok) return refusalEnvelope(out.code, out.reason);
      return { runId: '', status: 'completed', result: { clientId: out.clientId, clientSecret: out.clientSecret, account: renderServiceAccount(out.account) } };
    }
    case 'service_account_list': {
      if (!deps.serviceAccounts) return refusalEnvelope('INTERNAL_ERROR', 'INTERNAL_ERROR: the service account store is not wired on this engine');
      return { runId: '', status: 'completed', result: deps.serviceAccounts.list().map(renderServiceAccount) };
    }
    case 'service_account_update': {
      if (!deps.serviceAccounts) return refusalEnvelope('INTERNAL_ERROR', 'INTERNAL_ERROR: the service account store is not wired on this engine');
      const expiresAt = parseIsoOrNullOrUndefined(a['expiresAt']);
      if (expiresAt === 'INVALID') return refusalEnvelope('INVALID_ARGUMENT', 'INVALID_ARGUMENT: expiresAt must be a parseable ISO-8601 timestamp or null');
      const patch: Parameters<ServiceAccountStore['update']>[1] = {};
      if (a['role'] !== undefined) patch.role = a['role'] as 'author' | 'user';
      if (a['workflows'] !== undefined) patch.workflows = a['workflows'] as string[] | null;
      if (a['description'] !== undefined) patch.description = a['description'] as string | null;
      if (a['disabled'] !== undefined) patch.disabled = a['disabled'] as boolean;
      if (expiresAt !== undefined) patch.expiresAt = expiresAt;
      const out = deps.serviceAccounts.update(a['name'] as string, patch, actor ?? 'local');
      if (!out.ok) return refusalEnvelope(out.code, out.reason);
      return { runId: '', status: 'completed', result: renderServiceAccount(out.account) };
    }
    case 'service_account_rotate_secret': {
      if (!deps.serviceAccounts) return refusalEnvelope('INTERNAL_ERROR', 'INTERNAL_ERROR: the service account store is not wired on this engine');
      const expiresAt = parseIsoOrUndefined(a['expiresAt']);
      if (expiresAt === 'INVALID') return refusalEnvelope('INVALID_ARGUMENT', 'INVALID_ARGUMENT: expiresAt must be a parseable ISO-8601 timestamp');
      const out = deps.serviceAccounts.rotateSecret(a['name'] as string, expiresAt, actor ?? 'local');
      if (!out.ok) return refusalEnvelope(out.code, out.reason);
      return { runId: '', status: 'completed', result: { secretId: out.secretId, clientSecret: out.clientSecret } };
    }
    case 'service_account_revoke_secret': {
      if (!deps.serviceAccounts) return refusalEnvelope('INTERNAL_ERROR', 'INTERNAL_ERROR: the service account store is not wired on this engine');
      const out = deps.serviceAccounts.revokeSecret(a['name'] as string, a['secretId'] as string, actor ?? 'local');
      if (!out.ok) return refusalEnvelope(out.code, out.reason);
      return { runId: '', status: 'completed', result: { revoked: true } };
    }
    case 'service_account_delete': {
      if (!deps.serviceAccounts) return refusalEnvelope('INTERNAL_ERROR', 'INTERNAL_ERROR: the service account store is not wired on this engine');
      const name = a['name'] as string;
      const out = deps.serviceAccounts.delete(name, actor ?? 'local');
      if (!out.ok) return refusalEnvelope(out.code, out.reason);
      deps.revokeServiceAccountTokens?.(`sa:${name}`);
      return { runId: '', status: 'completed', result: { deleted: true } };
    }
    default: {
      // Exhaustiveness: every TOOL_SPECS row is handled above. Attempted a compile-time
      // `default: never` check here (DES-140) after TASK-155's `as const`, but `spec.name`
      // resolves to `any` at this call site (not the ToolName literal union `.find()` would
      // suggest) — reported as a defect rather than forced; this stays a runtime guard.
      return unknownTool(name);
    }
  }
}
