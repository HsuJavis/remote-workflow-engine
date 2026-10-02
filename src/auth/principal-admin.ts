// Dashboard auth spec §A2 (2026-09-30): the ONE backend behind `principals_list` /
// `principal_set_role` (MCP) and the dashboard admin page — and the per-request role resolver
// every authenticated request uses, so a change is effective on the very next call (no restart).
import { roleWithSource, checkRoleChange, type PrincipalRole as Role, type RoleSource } from '../authz.js';
import type { RoleStore } from './role-store.js';
import { CAS_QUOTA_DEFAULTS, parseByteSize, type ByteLimit, type CasQuotaConfig } from '../cas-quota.js';
// Service accounts spec (owner decision 2026-10-03): a `sa:<name>` id resolves its role/workflows
// from THIS store, never roleWithSource's principal_roles/config precedence (§Model).
import type { ServiceAccountStore } from './service-account-store.js';

const SA_PREFIX = 'sa:';
/** True for any `sa:<name>` id — the ONE place this prefix test lives for PrincipalAdmin. */
function isServiceAccountId(id: string): boolean {
  return id.startsWith(SA_PREFIX);
}
function serviceAccountName(id: string): string {
  return id.slice(SA_PREFIX.length);
}

/** Owner decision 2026-10-02: a principal's CAS quota as principals_list / /api/me show it. */
export interface QuotaView {
  usedBytes: number;
  /** null = unlimited. */
  limitBytes: ByteLimit;
  source: 'role-default' | 'override';
  /** Present only for an override. */
  updatedBy?: string;
  updatedAt?: string;
}

export interface PrincipalEntry {
  id: string;
  /** Service accounts spec (owner decision 2026-10-03): 'service' for a `sa:<name>` id, 'human'
   *  for everything else (a Google-signed-in email, or a config-only id). */
  kind: 'human' | 'service';
  role: Role;
  source: RoleSource;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  /** Present only for a `db` override row. */
  updatedBy?: string;
  updatedAt?: string;
  quota: QuotaView;
}

export type SetRoleOutcome =
  | { ok: true; entry: PrincipalEntry }
  | { ok: false; code: 'ROLE_LOCKED' | 'LAST_ADMIN' | 'INVALID_ARGUMENT'; reason: string };
export type SetQuotaOutcome =
  | { ok: true; entry: PrincipalEntry }
  | { ok: false; code: 'INVALID_ARGUMENT'; reason: string };

export class PrincipalAdmin {
  private readonly _store: RoleStore;
  private readonly _principals: Record<string, { role: Role }> | undefined;
  private readonly _quotaDefaults: CasQuotaConfig;
  private readonly _usage: (id: string) => number;
  private readonly _serviceAccounts: ServiceAccountStore | undefined;
  readonly authEnabled: boolean;

  constructor(deps: {
    store: RoleStore;
    principals: Record<string, { role: Role }> | undefined;
    authEnabled: boolean;
    /** Owner decision 2026-10-02: per-role CAS quota defaults + the CAS usage reader. */
    quota?: { defaults: CasQuotaConfig; usage: (id: string) => number };
    /** Service accounts spec (owner decision 2026-10-03): wired whenever the auth DB is open
     *  (same lifetime as `store` — server.ts constructs both unconditionally, auth on or off). */
    serviceAccounts?: ServiceAccountStore;
  }) {
    this._store = deps.store;
    this._principals = deps.principals;
    this.authEnabled = deps.authEnabled;
    this._quotaDefaults = deps.quota?.defaults ?? CAS_QUOTA_DEFAULTS;
    this._usage = deps.quota?.usage ?? (() => 0);
    this._serviceAccounts = deps.serviceAccounts;
  }

  /** Service accounts spec (owner decision 2026-10-03): the allowlist a `sa:<name>` principal
   *  carries (`Principal.workflows`), or `undefined` for a human id, an unknown service account, or
   *  one with no (or an empty) allowlist — "empty/absent = no restriction beyond role" (spec
   *  §Model). `server.ts`'s `principalFor` reads this to build the `Principal` object `authorize()`
   *  checks. */
  workflowsFor(id: string): string[] | undefined {
    if (!isServiceAccountId(id)) return undefined;
    const sa = this._serviceAccounts?.get(serviceAccountName(id));
    return sa?.workflows && sa.workflows.length > 0 ? sa.workflows : undefined;
  }

  /** The effective CAS quota for `id`: its override, else its role's default (a pending 'none'
   *  principal: 0). Read fresh on every call, so a change applies to the very next upload. */
  quotaFor(id: string): { limitBytes: ByteLimit; source: 'role-default' | 'override' } {
    const o = this._store.getQuotaOverride(id);
    if (o) return { limitBytes: o.limitBytes, source: 'override' };
    const role = this.resolve(id);
    return { limitBytes: role === 'none' ? 0 : this._quotaDefaults[role], source: 'role-default' };
  }

  /** The quota view (usage + effective limit + source) principals_list and GET /api/me show. */
  quotaView(id: string): QuotaView {
    const o = this._store.getQuotaOverride(id);
    const q = this.quotaFor(id);
    return { usedBytes: this._usage(id), ...q, ...(o ? { updatedBy: o.updatedBy, updatedAt: o.updatedAt } : {}) };
  }

  /** The effective role for `id`, read fresh from the store on every call. Service accounts spec
   *  (owner decision 2026-10-03), §Model: a `sa:<name>` id resolves from ITS OWN row, never
   *  principal_roles/config precedence — an unknown/deleted account falls back to 'none' (the
   *  bearer-layer re-check in server.ts is what actually refuses a disabled/expired one with
   *  SERVICE_ACCOUNT_DISABLED before `principalFor`/this method ever run in production). */
  resolve(id: string): Role {
    if (isServiceAccountId(id)) {
      const live = this._serviceAccounts?.isLive(serviceAccountName(id));
      return live?.live ? live.role : 'none';
    }
    return roleWithSource(this._principals, id, this._store.getOverride(id)).role;
  }

  /** Record a successful authentication (bearer, session, or login) for the known-principals list. */
  markSeen(id: string): void {
    this._store.markSeen(id);
  }

  private _known(): string[] {
    const ids = new Set<string>(Object.keys(this._principals ?? {}));
    for (const id of this._store.knownPrincipals()) ids.add(id);
    // Service accounts spec: every registered account is listed even before its first token
    // exchange (pre-provisioning, same as a human pre-listed in rwe.config.json principals).
    for (const sa of this._serviceAccounts?.list() ?? []) ids.add(`${SA_PREFIX}${sa.name}`);
    ids.delete('*');
    return [...ids].sort();
  }

  private _entry(id: string): PrincipalEntry {
    const overrides = new Map(this._store.overrides().map((r) => [r.id, r]));
    const seen = new Map(this._store.seen().map((r) => [r.id, r]));
    return this._entryFrom(id, overrides, seen);
  }

  private _entryFrom(
    id: string,
    overrides: Map<string, { role: Role; updatedBy: string; updatedAt: string }>,
    seen: Map<string, { firstSeenAt: string; lastSeenAt: string }>,
  ): PrincipalEntry {
    if (isServiceAccountId(id)) {
      const s = seen.get(id);
      return {
        id, kind: 'service', role: this.resolve(id), source: 'service-account',
        firstSeenAt: s?.firstSeenAt ?? null,
        lastSeenAt: s?.lastSeenAt ?? null,
        quota: this.quotaView(id),
      };
    }
    const o = overrides.get(id);
    const { role, source } = roleWithSource(this._principals, id, o?.role);
    const s = seen.get(id);
    return {
      id, kind: 'human', role, source,
      firstSeenAt: s?.firstSeenAt ?? null,
      lastSeenAt: s?.lastSeenAt ?? null,
      ...(source === 'db' && o ? { updatedBy: o.updatedBy, updatedAt: o.updatedAt } : {}),
      quota: this.quotaView(id),
    };
  }

  list(): { authEnabled: boolean; principals: PrincipalEntry[] } {
    const overrides = new Map(this._store.overrides().map((r) => [r.id, r]));
    const seen = new Map(this._store.seen().map((r) => [r.id, r]));
    return { authEnabled: this.authEnabled, principals: this._known().map((id) => this._entryFrom(id, overrides, seen)) };
  }

  /** Set (`role`) or remove (`null`) the runtime override for `id`, after the lockout rules.
   *  Service accounts spec: a `sa:<name>` id is refused here — its role lives on the service
   *  account's own row (resolve() never consults this store's override for one), so silently
   *  accepting the write would look like it worked and do nothing. */
  setRole(id: string, role: Role | null, actor: string): SetRoleOutcome {
    if (isServiceAccountId(id)) {
      return { ok: false, code: 'INVALID_ARGUMENT', reason: `INVALID_ARGUMENT: '${id}' is a service account — change its role with service_account_update, not principal_set_role` };
    }
    const overrides = new Map(this._store.overrides().map((r) => [r.id, r.role]));
    const verdict = checkRoleChange({ principals: this._principals, overrides, known: this._known(), id, role });
    if (!verdict.ok) return verdict;
    const previous = this.resolve(id);
    this._store.setOverride(id, role, actor);
    const entry = this._entry(id);
    // Audit line (spec §A2): who changed whose role, from what to what. The DB row keeps
    // updatedBy/updatedAt; a removed override leaves only this line behind.
    console.log(JSON.stringify({ event: 'principal_role_changed', id, previous, role: entry.role, override: role, by: actor }));
    return { ok: true, entry };
  }

  /** Owner decision 2026-10-02: set (a byte count, a size string like "5GiB", or "unlimited") or
   *  remove (`null`) the CAS quota override for `id`. Audited like a role change: the row keeps
   *  updatedBy/updatedAt and a principal_quota_changed line is logged. */
  setQuota(id: string, limit: unknown, actor: string): SetQuotaOutcome {
    if (id === '*') return { ok: false, code: 'INVALID_ARGUMENT', reason: "INVALID_ARGUMENT: '*' has no quota of its own — set casQuota in rwe.config.json for the role defaults" };
    let value: number | 'unlimited' | null;
    if (limit === null) value = null;
    else {
      const n = parseByteSize(limit);
      if (n === undefined) return { ok: false, code: 'INVALID_ARGUMENT', reason: `INVALID_ARGUMENT: limit must be a byte count, a size like "5GiB", "unlimited", or null (got ${JSON.stringify(limit)})` };
      value = n === null ? 'unlimited' : n;
    }
    const previous = this.quotaFor(id).limitBytes;
    this._store.setQuotaOverride(id, value, actor);
    const entry = this._entry(id);
    console.log(JSON.stringify({ event: 'principal_quota_changed', id, previous, limitBytes: entry.quota.limitBytes, override: value, by: actor }));
    return { ok: true, entry };
  }
}
