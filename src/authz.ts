// src/authz.ts (DES-139, ARCH-088, TASK-133): Principal, resolveRole, authorize() — total over
// kind x role x ownership x mode. One `authorize()` call, made once per tool dispatch (DES-140),
// replaces a role check duplicated across 35 `case` arms.
//
// Pure: no I/O, no clock — ownership reads go through the injected, SYNC `OwnerLookup` port so
// this module never touches a store directly (ARCH-088's testability lens).
import type { Role, AuthzRow, ToolAuthz, ToolSpec } from './tool-specs.js';

export type { Role };

/** v24 (DES-139): the role IS the `kind` for an identified caller — there is no separate `role`
 *  field to drift out of step with it. Two special kinds carry no role/id at all: `auth-disabled`
 *  (single-operator mode, short-circuits everything) and `loopback-exempt` (an unauthenticated
 *  local caller allowed through ONLY for the narrowest tools). */
export type Principal =
  | { kind: 'user'; id: string }
  | { kind: 'author'; id: string }
  | { kind: 'admin'; id: string }
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

export type AuthzErrorCode = 'FORBIDDEN_ROLE' | 'NOT_RUN_OWNER' | 'NOT_WORKFLOW_OWNER' | 'NOT_TRIGGER_OWNER' | 'PRINCIPAL_REQUIRED';

// Flat, not a discriminated union: callers read `verdict.code`/`.crossPrincipalRead`/`.detail`
// straight off an `ok`-checked verdict without a narrowing type guard in between (`expect(...)`
// is not one) — a discriminated union forces every caller through an `if (!verdict.ok)` before
// TypeScript will allow the read, which is more ceremony than this total function's callers need.
export interface AuthzVerdict {
  ok: boolean;
  code?: AuthzErrorCode;
  reason?: string;
  see?: 'workflow_authoring_guide' | null;
  detail?: { mode?: string };
  crossPrincipalRead?: true;
}

const ROLE_RANK: Record<Role, number> = { user: 0, author: 1, admin: 2 };

/** `principals` keyed by principal id; `'*'` supplies the role for any id not listed. With auth
 *  enabled an unlisted id (and a missing/undefined `principals` map) resolves to `'user'`
 *  (ADR-028: fail closed and loud) — never a silent admin default. */
export function resolveRole(principals: Record<string, { role: Role }> | undefined, id: string): Role {
  return principals?.[id]?.role ?? principals?.['*']?.role ?? 'user';
}

function resolveRow(authz: ToolAuthz, args: unknown): { row: AuthzRow; mode?: string } {
  if ('mode' in authz) {
    const mode = authz.mode(args);
    return { row: authz.rows[mode]!, mode };
  }
  return { row: authz };
}

function refuse(code: AuthzErrorCode, reason: string, mode?: string): AuthzVerdict {
  return { ok: false, code, reason, see: 'workflow_authoring_guide', ...(mode !== undefined ? { detail: { mode } } : {}) };
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

  if (principal.kind === 'loopback-exempt') {
    if (row.minRole === 'user' && row.ownership === 'none') return { ok: true };
    return refuse('PRINCIPAL_REQUIRED', 'this tool requires an authenticated principal', mode);
  }

  const role = principal.kind;
  if (ROLE_RANK[role] < ROLE_RANK[row.minRole]) {
    return refuse('FORBIDDEN_ROLE', `role '${role}' is below the required '${row.minRole}'`, mode);
  }

  if (row.ownership === 'none') return { ok: true };

  // Subject + owner resolution: args[spec.key] by default, except the two named exceptions
  // (DES-139) — 'asset' keys off args.workflow (global scope is role-only, already passed above)
  // and 'trigger' keys off args.id through the ONE triggerOwner method.
  let owner: string | null | undefined;
  let ownerCode: AuthzErrorCode;
  if (row.ownership === 'asset') {
    if (args.scope === 'global') return { ok: true };
    owner = lookup.workflowOwner(args.workflow as string);
    ownerCode = 'NOT_WORKFLOW_OWNER';
  } else if (row.ownership === 'trigger') {
    owner = lookup.triggerOwner(args.id as string);
    ownerCode = 'NOT_TRIGGER_OWNER';
  } else {
    // DES-139's subject rule is `args[spec.key]`. The three MODED workspace_* tools carry
    // `key: null` at the SPEC level because their subject differs per mode, so the resolved ROW's
    // ownership names the argument its own `mode()` predicate already required to be present:
    // `runId` for run ownership, `workflow` for workflow ownership. Without this fallback the
    // subject was `undefined`, the lookup answered "does not exist", and the non-leak rule below
    // returned ok — a silent ownership BYPASS on workspace_list/workspace_delete/workspace_push
    // (Gate 6.5+7 round 1 defect (b), IT-105).
    const subject = (spec.key !== null ? args[spec.key] : args[row.ownership === 'run' ? 'runId' : 'workflow']) as string;
    if (row.ownership === 'workflow') {
      owner = lookup.workflowOwner(subject);
      ownerCode = 'NOT_WORKFLOW_OWNER';
    } else {
      owner = lookup.runOwner(subject);
      ownerCode = 'NOT_RUN_OWNER';
    }
  }

  // Tri-state (DES-139 boundary): undefined = does not exist ⇒ ok, the handler answers *_NOT_FOUND
  // downstream — authz never leaks existence by refusing before that check runs.
  if (owner === undefined) return { ok: true };

  const isAdmin = role === 'admin';
  if (owner === null) {
    // Ownerless (legacy/migrated row): admin-only.
    return isAdmin ? { ok: true } : refuse(ownerCode, 'this resource has no owner; only admin may act on it', mode);
  }

  if (owner === principal.id) return { ok: true };

  if (isAdmin) {
    const adminCrossRead = 'adminCrossRead' in row && row.adminCrossRead === true;
    return adminCrossRead ? { ok: true, crossPrincipalRead: true } : { ok: true };
  }

  return refuse(ownerCode, `owned by ${owner}, not ${principal.id}`, mode);
}
