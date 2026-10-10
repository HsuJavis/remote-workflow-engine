// src/authz.ts (DES-139, ARCH-088, TASK-133): Principal, resolveRole, authorize() — total over
// kind x role x ownership x mode. One `authorize()` call, made once per tool dispatch (DES-140),
// replaces a role check duplicated across 35 `case` arms.
//
// Pure: no I/O, no clock — ownership reads go through the injected, SYNC `OwnerLookup` port so
// this module never touches a store directly (ARCH-088's testability lens).
import type { Role, AuthzRow, ToolAuthz, ToolSpec } from './tool-specs.js';
// v24 Gate 8 (AF-3, TASK-162): TYPE-ONLY — erases at compile time, adds no runtime edge, and
// makes `AUTHZ_ERROR_CODES` below checkable against the closed catalog at its declaration.
import type { ErrorCode } from './errors.js';

export type { Role };

/** A principal's RESOLVED role (owner decision 2026-09-30, verify-i MEDIUM-1): the three tool roles
 *  plus `'none'` = signed in but not yet granted anything ("pending approval"). `'none'` is never a
 *  tool's `minRole`; `authorize()` refuses it ACCOUNT_PENDING_APPROVAL before any other check. */
export type PrincipalRole = Role | 'none';

/** v24 (DES-139): the role IS the `kind` for an identified caller — there is no separate `role`
 *  field to drift out of step with it. Two special kinds carry no role/id at all: `auth-disabled`
 *  (single-operator mode, short-circuits everything) and `loopback-exempt` (an unauthenticated
 *  local caller allowed through ONLY for the narrowest tools). */
// Service accounts spec (owner decision 2026-10-03): `workflows`, set ONLY for a service-account-
// resolved principal (server.ts's `principalFor`) that was created with a non-empty allowlist — a
// human principal never carries it. Absent/undefined means "no restriction beyond role", same as an
// empty array (PrincipalAdmin never sets an empty array — see its own doc).
export type Principal =
  | { kind: 'user'; id: string; workflows?: string[] }
  | { kind: 'author'; id: string; workflows?: string[] }
  | { kind: 'admin'; id: string }
  | { kind: 'none'; id: string }
  | { kind: 'auth-disabled' }
  | { kind: 'loopback-exempt' };

/** SYNC by design (DES-139) — `authorize` is a pure decision function, so the three ownership
 *  reads it needs are injected rather than awaited. `triggerOwner` takes the ONE unprefixed id
 *  (not a `(kind, id)` pair) and itself checks both the schedule and webhook stores — a schedule
 *  id and a webhook id are drawn from disjoint UUID spaces, so a single lookup is total. Each
 *  method is TRI-STATE: `undefined` = the resource does not exist, `null` = it exists and is
 *  ownerless (legacy/migrated row). REQUIRED, not optional (ADR-028 fail-closed): a lookup wired
 *  with a missing method must be a compile error, never a silent "does not exist" that lets
 *  ownership enforcement bypass itself — a unit test exercising only one branch supplies the other
 *  two methods as `() => undefined`. */
export interface OwnerLookup {
  runOwner(runId: string): string | null | undefined;
  workflowOwner(name: string): string | null | undefined;
  triggerOwner(id: string): string | null | undefined;
}

// v24 Gate 8 (AF-3, TASK-162): the union is now DERIVED from a runtime array that is itself
// `satisfies readonly ErrorCode[]`, which closes the CLASS the D-14 fix left open. Before this,
// `AuthzErrorCode` was a hand-typed string union with no relationship to `ERROR_CATALOG`, so
// `PRINCIPAL_REQUIRED` could be declared here, returned by `authorize()` (line ~89) and copied
// unremapped to the wire by `call-tool.ts` (`verdict.code ?? 'FORBIDDEN_ROLE'` only covers a
// verdict with NO code) while being absent from the catalog: no `see` pointer, in no generated
// documentation, and invisible to every closure test. Two locks now, not one:
//   - COMPILE TIME: `satisfies readonly ErrorCode[]` — a member that is not a catalog key is a
//     type error at this declaration, before any test runs.
//   - RUNTIME: the array is enumerable, so `tests/unit/error-catalog-closed.test.ts` can assert
//     membership for EVERY code instead of for the three or four somebody remembered.
// Gate 7.5 round 3 fixed this exact defect for three trigger codes one function away; fixing the
// instance rather than the class is why it came back (adjudication #7 G-3).
export const AUTHZ_ERROR_CODES = [
  'FORBIDDEN_ROLE',
  'NOT_RUN_OWNER',
  'NOT_WORKFLOW_OWNER',
  'NOT_TRIGGER_OWNER',
  'PRINCIPAL_REQUIRED',
  'ACCOUNT_PENDING_APPROVAL',
  // Service accounts spec (owner decision 2026-10-03): a service account created with a
  // `workflows` allowlist, naming a workflow outside it.
  'WORKFLOW_NOT_ALLOWED',
] as const satisfies readonly ErrorCode[];

export type AuthzErrorCode = (typeof AUTHZ_ERROR_CODES)[number];

// Flat, not a discriminated union: callers read `verdict.code`/`.crossPrincipalRead`/`.detail`
// straight off an `ok`-checked verdict without a narrowing type guard in between (`expect(...)`
// is not one) — a discriminated union forces every caller through an `if (!verdict.ok)` before
// TypeScript will allow the read, which is more ceremony than this total function's callers need.
export interface AuthzVerdict {
  ok: boolean;
  // Issue #116 (OWNER DECISION a): widened from `AuthzErrorCode` to `ErrorCode` — for a non-admin
  // ownership refusal on a tool `NOT_FOUND_TEMPLATES` covers (below), `code`/`reason` are the
  // MASKED `*_NOT_FOUND` code/message (byte-identical to that tool's own genuine not-found arm),
  // never `NOT_RUN_OWNER`/`NOT_WORKFLOW_OWNER`/`NOT_TRIGGER_OWNER` — so callers reading `.code`
  // straight off an `ok`-checked verdict (this interface's own stated reason for staying a flat
  // shape, not a discriminated union) still get a code their own `ErrorCode`-typed plumbing accepts.
  code?: ErrorCode;
  reason?: string;
  see?: 'workflow_authoring_guide' | null;
  detail?: { mode?: string };
  crossPrincipalRead?: true;
  // Issue #116 (OWNER DECISION b): the TRUE internal reason, ALWAYS an `AuthzErrorCode` and ALWAYS
  // set alongside `ok:false` — identical to `code` unless masking (decision a) substituted a
  // `*_NOT_FOUND` code/message for a non-admin caller, in which case this keeps the real one
  // (`NOT_RUN_OWNER` etc.) for the audit row while `code`/`reason` carry what the caller sees.
  // `call-tool.ts`/`server.ts` read this to audit the REAL reason even when the response is masked.
  internalReason?: AuthzErrorCode;
}

const ROLE_RANK: Record<Role, number> = { user: 0, author: 1, admin: 2 };

/** Where an effective role came from (dashboard auth spec §A2, 2026-09-30). `config-locked`: a
 *  config admin — cannot be changed at runtime. `db`: a runtime override (principal_set_role).
 *  `config`: the id's own `principals[id]` entry. `default`: no entry of its own — the config `'*'`
 *  role, else `'user'`. */
// Service accounts spec (owner decision 2026-10-03): 'service-account' is a `sa:<name>` id's own
// row (never principal_roles/config) — PrincipalAdmin sets it, this module never produces it itself
// (roleWithSource is never called for an `sa:` id).
export type RoleSource = 'config-locked' | 'db' | 'config' | 'default' | 'service-account';

type PrincipalsMap = Record<string, { role: PrincipalRole }> | undefined;

/** Precedence (spec §A2): config admin (LOCKED) > DB override > config `principals[id]` > config
 *  `'*'` > `'none'`. With auth enabled an unlisted id (and a missing/undefined `principals` map)
 *  resolves to `'none'` — signed in, pending approval, refused by every tool (owner decision
 *  2026-09-30; before it was `'user'`, ADR-028) — never a silent admin default. The
 *  override is PASSED IN (this module stays pure — the caller reads the store). */
export function roleWithSource(principals: PrincipalsMap, id: string, override?: PrincipalRole): { role: PrincipalRole; source: RoleSource } {
  const own = principals?.[id]?.role;
  if (own === 'admin') return { role: 'admin', source: 'config-locked' };
  if (override !== undefined) return { role: override, source: 'db' };
  if (own !== undefined) return { role: own, source: 'config' };
  return { role: principals?.['*']?.role ?? 'none', source: 'default' };
}

export function resolveRole(principals: PrincipalsMap, id: string, override?: PrincipalRole): PrincipalRole {
  return roleWithSource(principals, id, override).role;
}

export type RoleChangeVerdict =
  | { ok: true }
  | { ok: false; code: 'ROLE_LOCKED' | 'LAST_ADMIN' | 'INVALID_ARGUMENT'; reason: string };

/** The two lockout rules (spec §A2) for a runtime role change of `id` to `role` (`null` = remove
 *  the override): a config admin is locked (ROLE_LOCKED), and a change that DEMOTES an admin is
 *  refused when no admin would remain among the known principals (LAST_ADMIN). A change that
 *  demotes nobody is always allowed, even on a deployment with no admin at all. */
export function checkRoleChange(a: {
  principals: PrincipalsMap;
  overrides: ReadonlyMap<string, PrincipalRole>;
  known: readonly string[];
  id: string;
  role: PrincipalRole | null;
}): RoleChangeVerdict {
  if (a.id === '*') {
    return { ok: false, code: 'INVALID_ARGUMENT', reason: "INVALID_ARGUMENT: '*' is the config default role, not a principal — edit rwe.config.json to change it" };
  }
  if (a.principals?.[a.id]?.role === 'admin') {
    return { ok: false, code: 'ROLE_LOCKED', reason: `ROLE_LOCKED: '${a.id}' is an admin in rwe.config.json principals and cannot be changed at runtime` };
  }
  const after = new Map(a.overrides);
  if (a.role === null) after.delete(a.id); else after.set(a.id, a.role);
  const ids = new Set([...a.known, a.id]);
  ids.delete('*');
  const wasAdmin = resolveRole(a.principals, a.id, a.overrides.get(a.id)) === 'admin';
  const staysAdmin = resolveRole(a.principals, a.id, after.get(a.id)) === 'admin';
  if (wasAdmin && !staysAdmin) {
    const remaining = [...ids].filter((id) => resolveRole(a.principals, id, after.get(id)) === 'admin');
    if (remaining.length === 0) {
      return { ok: false, code: 'LAST_ADMIN', reason: `LAST_ADMIN: '${a.id}' is the last admin; promote another principal first` };
    }
  }
  return { ok: true };
}

function resolveRow(authz: ToolAuthz, args: unknown): { row: AuthzRow; mode?: string } {
  if ('mode' in authz) {
    const mode = authz.mode(args);
    return { row: authz.rows[mode]!, mode };
  }
  return { row: authz };
}

function refuse(code: AuthzErrorCode, reason: string, mode?: string): AuthzVerdict {
  // Issue #116: `internalReason` always equals `code` here — this is the ONE constructor every
  // refusal in this module goes through BEFORE any masking decision, so it is always the true
  // reason at the point it's built. The ownership branch below may still overwrite `code`/`reason`
  // (never `internalReason`) afterward for a non-admin caller on a templated tool (decision a).
  return { ok: false, code, internalReason: code, reason, see: 'workflow_authoring_guide', ...(mode !== undefined ? { detail: { mode } } : {}) };
}

/** Issue #116 (OWNER DECISION a): for a NON-ADMIN caller, "exists but not yours" must be
 *  indistinguishable from "does not exist" — same code AND same message/detail shape as the
 *  corresponding `*_NOT_FOUND` the tool's OWN handler would answer for a genuinely absent id
 *  (byte-identical apart from the id itself, which the caller already supplied). The handlers'
 *  real not-found messages are heterogeneous (grep confirms: `mcp-facade.ts`'s shared `notFound()`
 *  says `Run not found: X` for every run-ownership tool; `workflow_deregister` says
 *  `Unknown workflow: X`; `workflow_publish`'s `CatalogNotFoundError` says
 *  `Workflow not found in catalog: X`; `scheduler.ts` says `Unknown schedule: X`; the webhook
 *  registry says `Unknown webhook: X`) — so this is a per-TOOL template, not one generic shape.
 *  Admin is never looked up here: `authorize()`'s ownership branch already returns `ok:true` for
 *  admin before this function could be reached (an ownerless resource is the one exception, and
 *  that branch's own `isAdmin` guard already keeps admin out of this path too) — "admin keeps the
 *  precise code" therefore falls out of control flow, not a check duplicated in this table.
 *
 *  Scope (documented, not silently partial): covers every tool whose ownership subject is `run`
 *  (run_status/result/suspend/resume/stop/agent_log, issue_report's `run` mode) plus the two
 *  `ownership:'workflow'` tools (workflow_deregister, workflow_publish) and the three
 *  `ownership:'trigger'` tools (schedule_delete, schedule_setEnabled, webhook_delete) — the tools
 *  the dashboard API and the acceptance tests exercise. NOT templated (residual risk, documented
 *  in the task report, not silently dropped): workspace_pull/list/push/delete's `workflow`/`asset`
 *  ownership MODE (a different, less-consistent WORKFLOW_NOT_FOUND wording per call site) and
 *  workflow_register's own internal ownership/trigger-claim checks (workflow-catalog.ts,
 *  mcp-facade.ts) — the latter has no `*_NOT_FOUND` sibling to mask TOWARD at all for a brand-new
 *  name (registering a free name succeeds; there is nothing to disclose-as-absent), so decision a's
 *  own framing does not apply there. An untemplated tool keeps today's `NOT_*_OWNER` behavior
 *  unchanged — this function returns `undefined` and the caller falls through to the old refusal. */
function notFoundTemplate(toolName: string, resourceId: string): { code: ErrorCode; message: string } | undefined {
  const RUN_TOOLS = new Set(['run_status', 'run_result', 'run_suspend', 'run_resume', 'run_stop', 'run_agent_log', 'issue_report']);
  if (RUN_TOOLS.has(toolName)) return { code: 'RUN_NOT_FOUND', message: `Run not found: ${resourceId}` };
  if (toolName === 'workflow_deregister') return { code: 'WORKFLOW_NOT_FOUND', message: `Unknown workflow: ${resourceId}` };
  if (toolName === 'workflow_publish') return { code: 'WORKFLOW_NOT_FOUND', message: `Workflow not found in catalog: ${resourceId}` };
  if (toolName === 'schedule_delete' || toolName === 'schedule_setEnabled') return { code: 'TRIGGER_NOT_FOUND', message: `Unknown schedule: ${resourceId}` };
  if (toolName === 'webhook_delete') return { code: 'TRIGGER_NOT_FOUND', message: `Unknown webhook: ${resourceId}` };
  return undefined;
}

/** Issue #116: the ONE place both ownership-refusal arms below call — builds the plain `NOT_*_OWNER`
 *  verdict via `refuse()` (which stamps `internalReason`), then, for a non-admin caller on a
 *  templated tool, overwrites `code`/`reason` to the masked `*_NOT_FOUND` shape and drops `detail`
 *  entirely (the real not-found arm carries none — `detail.mode` would itself be a tell). */
function ownershipRefusal(toolName: string, ownerCode: AuthzErrorCode, message: string, resourceId: string, mode?: string): AuthzVerdict {
  const plain = refuse(ownerCode, message, mode);
  const masked = notFoundTemplate(toolName, resourceId);
  if (!masked) return plain;
  // `see` is kept (not stripped): `call-tool.ts`'s own envelope builders never serialize `.see`
  // onto the wire for EITHER an unmasked or a masked refusal (verified: `refusalEnvelope`/
  // `maskedRefusalEnvelope` read only `code`/`reason`/`detail`) — it is this module's own internal
  // contract field, asserted by authz.test.ts's generated matrix independently of wire behavior,
  // so leaving it unchanged here costs decision a's byte-identity nothing.
  return { ok: false, code: masked.code, internalReason: ownerCode, reason: masked.message, see: 'workflow_authoring_guide' };
}

/** Service accounts spec (owner decision 2026-10-03): the workflow name a row's allowlist check
 *  applies to, or `undefined` for a row the allowlist does not restrict.
 *   - `row.workflowArg` set: `args[row.workflowArg]` (the create-shaped tools — see AuthzRow's doc).
 *   - `ownership:'workflow'`: `args[spec.key]`, or `args.workflow` for a moded row (`key:null`) —
 *     the SAME subject resolution `authorize()`'s own ownership branch below uses.
 *   - `ownership:'asset'` with `scope !== 'global'`: `args.workflow` (global scope is admin-only
 *     already, via `row.minRole`, and a service account is never admin).
 *   - `ownership:'run'`/`'trigger'`: `undefined`, deliberately. By the time a principal can act on
 *     an EXISTING run/trigger, ownership already restricts it to that principal's own (checked
 *     below); it could only have been created in the first place through a workflow-scoped tool
 *     this allowlist already gated. Re-deriving the workflow name from a runId/triggerId would need
 *     a new synchronous OwnerLookup method for no additional safety. */
function workflowNameSubject(row: AuthzRow, spec: { key: ToolSpec['key'] }, args: Record<string, unknown>): string | undefined {
  if ('workflowArg' in row && row.workflowArg) return args[row.workflowArg] as string | undefined;
  if (row.ownership === 'workflow') {
    return (spec.key !== null ? args[spec.key] : args['workflow']) as string | undefined;
  }
  if (row.ownership === 'asset' && args['scope'] !== 'global') return args['workflow'] as string | undefined;
  return undefined;
}

/** Total over `Principal.kind x row.minRole x row.ownership x (mode ? resolved row : the row)`.
 *  Order: `auth-disabled` short-circuits first (no actor id ⇒ never an audit row); row resolution
 *  (`'mode' in spec.authz`) next, so a `loopback-exempt`/role refusal on a moded tool still carries
 *  `detail.mode`; then `loopback-exempt`'s narrow allowance; then role; then ownership. */
export function authorize(
  principal: Principal,
  spec: { name: string; key: ToolSpec['key']; authz: ToolAuthz },
  args: Record<string, unknown>,
  lookup: OwnerLookup,
): AuthzVerdict {
  if (principal.kind === 'auth-disabled') return { ok: true };

  const { row, mode } = resolveRow(spec.authz, args);

  // Owner decision 2026-09-30: a signed-in principal with no granted role is refused by EVERY tool
  // — before role/ownership, so no lookup runs and nothing about the resource is disclosed.
  if (principal.kind === 'none') {
    return refuse('ACCOUNT_PENDING_APPROVAL', 'ACCOUNT_PENDING_APPROVAL: this account has signed in but has no role yet — an administrator must grant one (principal_set_role or the dashboard admin page)', mode);
  }

  if (principal.kind === 'loopback-exempt') {
    if (row.minRole === 'user' && row.ownership === 'none') return { ok: true };
    return refuse('PRINCIPAL_REQUIRED', 'this tool requires an authenticated principal', mode);
  }

  const role = principal.kind;
  if (ROLE_RANK[role] < ROLE_RANK[row.minRole]) {
    return refuse('FORBIDDEN_ROLE', `role '${role}' is below the required '${row.minRole}'`, mode);
  }

  // Service accounts spec (owner decision 2026-10-03), §Authorization: a service account created
  // with a `workflows` allowlist is refused on any workflow-scoped tool naming a workflow outside
  // it — checked BEFORE the ownership tri-state below, so a disallowed name is refused the same way
  // whether or not it happens to exist yet (the existence-disclosure rule the ownership branch
  // already follows applies here too: this must not become a second, inconsistent oracle).
  // 'workflows' is set ONLY on a service-account-resolved `user`/`author` principal (never admin —
  // a service account can never hold that role). 'run'/'trigger' ownership rows are deliberately
  // NOT re-checked here: see workflowNameSubject's own doc.
  if ((principal.kind === 'user' || principal.kind === 'author') && principal.workflows && principal.workflows.length > 0) {
    const subject = workflowNameSubject(row, spec, args);
    if (subject !== undefined && !principal.workflows.includes(subject)) {
      return refuse('WORKFLOW_NOT_ALLOWED', `WORKFLOW_NOT_ALLOWED: this caller is restricted to workflows [${principal.workflows.join(', ')}]`, mode);
    }
  }

  if (row.ownership === 'none') return { ok: true };

  // Subject + owner resolution: args[spec.key] by default, except the two named exceptions
  // (DES-139) — 'asset' keys off args.workflow (global scope is role-only, already passed above)
  // and 'trigger' keys off args.id through the ONE triggerOwner method.
  let owner: string | null | undefined;
  let ownerCode: AuthzErrorCode;
  // issue #90 (verification finding 4): the resource's OWN label/id, named in the refusal message
  // below the same way `workflow-catalog.ts`'s own `NOT_WORKFLOW_OWNER` refusals already do
  // (`` `${code}: workflow '${name}' is not owned by the caller` ``) — the caller's OWN request
  // argument, never the owner's identity, so this carries no new disclosure.
  let resourceLabel: 'run' | 'workflow' | 'trigger';
  let resourceId: string;
  if (row.ownership === 'asset') {
    if (args.scope === 'global') return { ok: true };
    resourceId = args.workflow as string;
    owner = lookup.workflowOwner(resourceId);
    ownerCode = 'NOT_WORKFLOW_OWNER';
    resourceLabel = 'workflow';
  } else if (row.ownership === 'trigger') {
    resourceId = args.id as string;
    owner = lookup.triggerOwner(resourceId);
    ownerCode = 'NOT_TRIGGER_OWNER';
    resourceLabel = 'trigger';
  } else {
    // DES-139's subject rule is `args[spec.key]`. The three MODED workspace_* tools carry
    // `key: null` at the SPEC level because their subject differs per mode, so the resolved ROW's
    // ownership names the argument its own `mode()` predicate already required to be present:
    // `runId` for run ownership, `workflow` for workflow ownership. Without this fallback the
    // subject was `undefined`, the lookup answered "does not exist", and the non-leak rule below
    // returned ok — a silent ownership BYPASS on workspace_list/workspace_delete/workspace_push
    // (Gate 6.5+7 round 1 defect (b), IT-105).
    const subject = (spec.key !== null ? args[spec.key] : args[row.ownership === 'run' ? 'runId' : 'workflow']) as string;
    resourceId = subject;
    if (row.ownership === 'workflow') {
      owner = lookup.workflowOwner(subject);
      ownerCode = 'NOT_WORKFLOW_OWNER';
      resourceLabel = 'workflow';
    } else {
      owner = lookup.runOwner(subject);
      ownerCode = 'NOT_RUN_OWNER';
      resourceLabel = 'run';
    }
  }

  // Tri-state (DES-139 boundary): undefined = does not exist ⇒ ok, the handler answers *_NOT_FOUND
  // downstream — authz never leaks existence by refusing before that check runs.
  if (owner === undefined) return { ok: true };

  const isAdmin = role === 'admin';
  if (owner === null) {
    // Ownerless (legacy/migrated row): admin-only.
    return isAdmin
      ? { ok: true }
      : ownershipRefusal(spec.name, ownerCode, `${ownerCode}: ${resourceLabel} '${resourceId}' has no owner; only admin may act on it`, resourceId, mode);
  }

  if (owner === principal.id) return { ok: true };

  if (isAdmin) {
    const adminCrossRead = 'adminCrossRead' in row && row.adminCrossRead === true;
    return adminCrossRead ? { ok: true, crossPrincipalRead: true } : { ok: true };
  }

  // Issue #90: this reason string reaches the REFUSED CALLER verbatim — `authorize()` is called
  // from exactly one place, call-tool.ts:232, whose `refusalEnvelope(verdict.code ?? ..., verdict.
  // reason ?? ..., ...)` puts it straight on the wire — so it must never name the owner. The
  // caller's own id is not disclosive (they already know who they are), but there is no reason to
  // echo it either, so the message names neither. Issue #90 (verification finding 4): the message
  // now starts with its own code, `${resourceLabel} '${resourceId}'` and all, matching the SAME
  // shape `workflow-catalog.ts`'s own `NOT_WORKFLOW_OWNER` refusals already use.
  return ownershipRefusal(spec.name, ownerCode, `${ownerCode}: ${resourceLabel} '${resourceId}' is not owned by the caller`, resourceId, mode);
}
