// Dashboard auth spec §A2 (2026-09-30): runtime role overrides + the principals-seen ledger, in
// the auth DB (`auth-tokens.db`). Config `principals` stay the bootstrap values and the locked
// admins; this store holds only what an admin changed at runtime (`principal_set_role`) and who
// has logged in. Opened on EVERY boot (auth on or off) so the admin tools answer the same way on
// both; with auth off the roles it stores are simply not consulted by anything.
import type Database from 'better-sqlite3';
import type { PrincipalRole as Role } from '../authz.js';

const ROLES: readonly Role[] = ['user', 'author', 'admin', 'none'];
/** A principal's lastSeenAt is written at most once per this interval (a request-rate write
 *  would turn every authenticated call into a DB write). */
const SEEN_WRITE_EVERY_MS = 60_000;

export interface RoleOverrideRow { id: string; role: Role; updatedBy: string; updatedAt: string }
export interface SeenRow { id: string; firstSeenAt: string; lastSeenAt: string }
/** Owner decision 2026-10-02: a per-principal CAS quota override. `limitBytes` null = unlimited. */
export interface QuotaOverrideRow { id: string; limitBytes: number | null; updatedBy: string; updatedAt: string }

export class RoleStore {
  private readonly _db: Database.Database;
  private readonly _clock: () => number;
  private readonly _lastSeenWrite = new Map<string, number>();

  constructor(db: Database.Database, seams: { clock: () => number }) {
    this._db = db;
    this._clock = seams.clock;
    this._db.exec(`
      CREATE TABLE IF NOT EXISTS principal_roles (
        id TEXT PRIMARY KEY,
        role TEXT NOT NULL,
        updatedBy TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS principals_seen (
        id TEXT PRIMARY KEY,
        firstSeenAt TEXT NOT NULL,
        lastSeenAt TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS principal_quotas (
        id TEXT PRIMARY KEY,
        limitBytes INTEGER,
        updatedBy TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );
    `);
  }

  private _iso(): string {
    return new Date(this._clock()).toISOString();
  }

  /** The DB override for `id`, or undefined. A row holding an unknown role string (hand-edited DB)
   *  is ignored — fail closed to the config/default role rather than trusting it. */
  getOverride(id: string): Role | undefined {
    const row = this._db.prepare('SELECT role FROM principal_roles WHERE id = ?').get(id) as { role: string } | undefined;
    return row && (ROLES as readonly string[]).includes(row.role) ? (row.role as Role) : undefined;
  }

  /** Set (`role`) or remove (`null`) the override for `id`. Lockout rules are the CALLER's job
   *  (`checkRoleChange` in authz.ts) — this is storage only. */
  setOverride(id: string, role: Role | null, updatedBy: string): void {
    if (role === null) {
      this._db.prepare('DELETE FROM principal_roles WHERE id = ?').run(id);
      return;
    }
    this._db.prepare(
      'INSERT INTO principal_roles (id, role, updatedBy, updatedAt) VALUES (?, ?, ?, ?) ' +
      'ON CONFLICT(id) DO UPDATE SET role = excluded.role, updatedBy = excluded.updatedBy, updatedAt = excluded.updatedAt'
    ).run(id, role, updatedBy, this._iso());
  }

  overrides(): RoleOverrideRow[] {
    const rows = this._db.prepare('SELECT id, role, updatedBy, updatedAt FROM principal_roles ORDER BY id').all() as RoleOverrideRow[];
    return rows.filter((r) => (ROLES as readonly string[]).includes(r.role));
  }

  /** Owner decision 2026-10-02: the CAS quota override for `id` (limitBytes null = unlimited), or
   *  undefined when none is set (the role default applies). */
  getQuotaOverride(id: string): QuotaOverrideRow | undefined {
    return this._db.prepare('SELECT id, limitBytes, updatedBy, updatedAt FROM principal_quotas WHERE id = ?').get(id) as QuotaOverrideRow | undefined;
  }

  /** Set a byte limit, `'unlimited'`, or remove (`null`) the quota override for `id`. Storage only. */
  setQuotaOverride(id: string, limit: number | 'unlimited' | null, updatedBy: string): void {
    if (limit === null) {
      this._db.prepare('DELETE FROM principal_quotas WHERE id = ?').run(id);
      return;
    }
    this._db.prepare(
      'INSERT INTO principal_quotas (id, limitBytes, updatedBy, updatedAt) VALUES (?, ?, ?, ?) ' +
      'ON CONFLICT(id) DO UPDATE SET limitBytes = excluded.limitBytes, updatedBy = excluded.updatedBy, updatedAt = excluded.updatedAt'
    ).run(id, limit === 'unlimited' ? null : limit, updatedBy, this._iso());
  }

  quotaOverrides(): QuotaOverrideRow[] {
    return this._db.prepare('SELECT id, limitBytes, updatedBy, updatedAt FROM principal_quotas ORDER BY id').all() as QuotaOverrideRow[];
  }

  /** Record that `id` authenticated just now (throttled per id). */
  markSeen(id: string): void {
    const now = this._clock();
    const last = this._lastSeenWrite.get(id);
    if (last !== undefined && now - last < SEEN_WRITE_EVERY_MS) return;
    this._lastSeenWrite.set(id, now);
    const iso = new Date(now).toISOString();
    this._db.prepare(
      'INSERT INTO principals_seen (id, firstSeenAt, lastSeenAt) VALUES (?, ?, ?) ' +
      'ON CONFLICT(id) DO UPDATE SET lastSeenAt = excluded.lastSeenAt'
    ).run(id, iso, iso);
  }

  seen(): SeenRow[] {
    return this._db.prepare('SELECT id, firstSeenAt, lastSeenAt FROM principals_seen ORDER BY id').all() as SeenRow[];
  }

  /** Every principal this DB knows of: role and quota overrides, the seen ledger, and — so principals who logged
   *  in before this ledger existed are not invisible — every holder of a bearer token, refresh
   *  token or dashboard session (those tables exist only when auth is enabled). */
  knownPrincipals(): string[] {
    const ids = new Set<string>();
    for (const r of this.overrides()) ids.add(r.id);
    for (const r of this.quotaOverrides()) ids.add(r.id);
    for (const r of this.seen()) ids.add(r.id);
    for (const table of ['bearer_tokens', 'refresh_tokens', 'dashboard_sessions']) {
      try {
        for (const r of this._db.prepare(`SELECT DISTINCT principal FROM ${table}`).all() as Array<{ principal: string }>) ids.add(r.principal);
      } catch { /* table absent: auth disabled on this DB */ }
    }
    return [...ids];
  }
}
