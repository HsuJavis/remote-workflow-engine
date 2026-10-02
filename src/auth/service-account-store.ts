// Service accounts spec (owner decision 2026-10-03): non-interactive full-MCP principals. A
// service account's client_id is `sa:<name>` — the `sa:` prefix is what keeps it disjoint from an
// email principal id (RFC 5322 forbids an unquoted ':' in a local-part, so no real Google email
// can ever collide with it). Role resolution reads THIS row, never principal_roles/config
// (PrincipalAdmin special-cases `sa:` ids — see its own docblock).
//
// Same injected clock+csprng seam convention as TokenStore (DES-093): no Date.now()/randomBytes()
// in this module. Secrets are sha256-at-rest, exactly like TokenStore's bearer tokens — the raw
// value is returned ONCE (create/rotate) and never stored or logged.
import { createHash, timingSafeEqual } from 'node:crypto';
import type Database from 'better-sqlite3';

export type ServiceAccountRole = 'author' | 'user';

export interface ServiceAccountSecretRow {
  id: string;
  createdAt: number;
  expiresAt: number | null;
  lastUsedAt: number | null;
}

export interface ServiceAccountRow {
  name: string;
  description: string | null;
  role: ServiceAccountRole;
  /** null/empty = no restriction beyond role. */
  workflows: string[] | null;
  expiresAt: number | null;
  createdBy: string;
  createdAt: number;
  disabled: boolean;
  lastUsedAt: number | null;
  secrets: ServiceAccountSecretRow[];
}

export type ServiceAccountErrorCode = 'INVALID_ARGUMENT' | 'SERVICE_ACCOUNT_EXISTS' | 'SERVICE_ACCOUNT_NOT_FOUND' | 'SERVICE_ACCOUNT_SECRET_NOT_FOUND' | 'TOO_MANY_SECRETS';
export type ServiceAccountOutcome<T> = { ok: true } & T | { ok: false; code: ServiceAccountErrorCode; reason: string };

/** The spec's name grammar: `[a-z0-9][a-z0-9-]{1,40}` (2-41 chars total). */
const NAME_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;
/** Up to 2 active secrets per account (rotation overlap) — spec §Model. */
const MAX_ACTIVE_SECRETS = 2;

function sha256hex(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Constant-time string compare, length-safe (unequal lengths never call timingSafeEqual) — the
 *  same pattern self-update-webhook.ts's safeStringEquals / webhook-registry.ts already use. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** A fixed-length dummy hash compared against on an unknown client_id — keeps `verifyCredentials`
 *  on the same comparison code path (one sha256 + one timingSafeEqual) whether the id is known or
 *  not, rather than returning null before any comparison at all. Not a perfect timing guarantee
 *  (DB lookup cost still differs), but closes the cheap, observable gap. */
const DUMMY_HASH = sha256hex('rwe-service-account-dummy-comparand');

function genSecret(csprng: (n: number) => Buffer): string {
  // >=256 bits of entropy, base64url — spec §Model.
  return 'rwe_sa_' + csprng(32).toString('base64url');
}

function genSecretId(csprng: (n: number) => Buffer): string {
  return csprng(16).toString('hex');
}

export interface ServiceAccountStoreSeams {
  clock: () => number;
  csprng: (n: number) => Buffer;
}

export class ServiceAccountStore {
  private readonly _db: Database.Database;
  private readonly _clock: () => number;
  private readonly _csprng: (n: number) => Buffer;

  constructor(db: Database.Database, seams: ServiceAccountStoreSeams) {
    this._db = db;
    this._clock = seams.clock;
    this._csprng = seams.csprng;
    this._init();
  }

  private _init(): void {
    this._db.exec(`
      CREATE TABLE IF NOT EXISTS service_accounts (
        name TEXT PRIMARY KEY,
        description TEXT,
        role TEXT NOT NULL,
        workflows TEXT,
        expires_at INTEGER,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        disabled INTEGER NOT NULL DEFAULT 0,
        last_used_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS service_account_secrets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        secret_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER,
        last_used_at INTEGER
      );
    `);
  }

  private _row(name: string): ServiceAccountRow | undefined {
    const r = this._db.prepare(
      'SELECT name, description, role, workflows, expires_at, created_by, created_at, disabled, last_used_at FROM service_accounts WHERE name = ?'
    ).get(name) as { name: string; description: string | null; role: string; workflows: string | null; expires_at: number | null; created_by: string; created_at: number; disabled: number; last_used_at: number | null } | undefined;
    if (!r) return undefined;
    const secrets = (this._db.prepare('SELECT id, created_at, expires_at, last_used_at FROM service_account_secrets WHERE name = ? ORDER BY created_at').all(name) as Array<{ id: string; created_at: number; expires_at: number | null; last_used_at: number | null }>)
      .map((s) => ({ id: s.id, createdAt: s.created_at, expiresAt: s.expires_at, lastUsedAt: s.last_used_at }));
    return {
      name: r.name, description: r.description, role: r.role as ServiceAccountRole,
      workflows: r.workflows ? (JSON.parse(r.workflows) as string[]) : null,
      expiresAt: r.expires_at, createdBy: r.created_by, createdAt: r.created_at,
      disabled: !!r.disabled, lastUsedAt: r.last_used_at, secrets,
    };
  }

  /** Validates name/role shared by create() and update(). `role` is validated only when present
   *  (update() patches may omit it) — 'admin' is refused for either caller (spec §Model: NEVER
   *  admin). */
  private _validatePatch(name: string | null, role: unknown): string | null {
    if (name !== null && !NAME_RE.test(name)) {
      return `INVALID_ARGUMENT: name must match ${NAME_RE} (got ${JSON.stringify(name)})`;
    }
    if (role !== undefined && role !== 'author' && role !== 'user') {
      return `INVALID_ARGUMENT: role must be 'author' or 'user' (a service account may never be 'admin'; got ${JSON.stringify(role)})`;
    }
    return null;
  }

  create(params: { name: string; description?: string | null; role: ServiceAccountRole; workflows?: string[]; expiresAt?: number | null; createdBy: string }): ServiceAccountOutcome<{ clientId: string; clientSecret: string; account: ServiceAccountRow }> {
    const err = this._validatePatch(params.name, params.role);
    if (err) return { ok: false, code: 'INVALID_ARGUMENT', reason: err };
    if (this._row(params.name)) {
      return { ok: false, code: 'SERVICE_ACCOUNT_EXISTS', reason: `SERVICE_ACCOUNT_EXISTS: a service account named '${params.name}' already exists` };
    }
    const now = this._clock();
    const workflows = params.workflows && params.workflows.length > 0 ? params.workflows : null;
    this._db.prepare(
      'INSERT INTO service_accounts (name, description, role, workflows, expires_at, created_by, created_at, disabled, last_used_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL)'
    ).run(params.name, params.description ?? null, params.role, workflows ? JSON.stringify(workflows) : null, params.expiresAt ?? null, params.createdBy, now);
    const clientSecret = genSecret(this._csprng);
    const secretId = genSecretId(this._csprng);
    this._db.prepare(
      'INSERT INTO service_account_secrets (id, name, secret_hash, created_at, expires_at, last_used_at) VALUES (?, ?, ?, ?, NULL, NULL)'
    ).run(secretId, params.name, sha256hex(clientSecret), now);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ event: 'service_account_created', name: params.name, role: params.role, by: params.createdBy }));
    return { ok: true, clientId: `sa:${params.name}`, clientSecret, account: this._row(params.name)! };
  }

  get(name: string): ServiceAccountRow | undefined {
    return this._row(name);
  }

  list(): ServiceAccountRow[] {
    const names = (this._db.prepare('SELECT name FROM service_accounts ORDER BY name').all() as Array<{ name: string }>).map((r) => r.name);
    return names.map((n) => this._row(n)!);
  }

  update(name: string, patch: { role?: ServiceAccountRole; workflows?: string[] | null; description?: string | null; disabled?: boolean; expiresAt?: number | null }, updatedBy: string): ServiceAccountOutcome<{ account: ServiceAccountRow }> {
    const existing = this._row(name);
    if (!existing) return { ok: false, code: 'SERVICE_ACCOUNT_NOT_FOUND', reason: `SERVICE_ACCOUNT_NOT_FOUND: no service account named '${name}'` };
    const err = this._validatePatch(null, patch.role);
    if (err) return { ok: false, code: 'INVALID_ARGUMENT', reason: err };
    const role = patch.role ?? existing.role;
    const workflows = patch.workflows !== undefined ? (patch.workflows && patch.workflows.length > 0 ? patch.workflows : null) : existing.workflows;
    const description = patch.description !== undefined ? patch.description : existing.description;
    const disabled = patch.disabled !== undefined ? patch.disabled : existing.disabled;
    const expiresAt = patch.expiresAt !== undefined ? patch.expiresAt : existing.expiresAt;
    this._db.prepare(
      'UPDATE service_accounts SET role = ?, workflows = ?, description = ?, disabled = ?, expires_at = ? WHERE name = ?'
    ).run(role, workflows ? JSON.stringify(workflows) : null, description, disabled ? 1 : 0, expiresAt, name);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ event: 'service_account_updated', name, by: updatedBy, patch: { ...patch, workflows: patch.workflows } }));
    return { ok: true, account: this._row(name)! };
  }

  rotateSecret(name: string, expiresAt: number | undefined, updatedBy: string): ServiceAccountOutcome<{ secretId: string; clientSecret: string }> {
    const existing = this._row(name);
    if (!existing) return { ok: false, code: 'SERVICE_ACCOUNT_NOT_FOUND', reason: `SERVICE_ACCOUNT_NOT_FOUND: no service account named '${name}'` };
    if (existing.secrets.length >= MAX_ACTIVE_SECRETS) {
      return { ok: false, code: 'TOO_MANY_SECRETS', reason: `TOO_MANY_SECRETS: '${name}' already has ${MAX_ACTIVE_SECRETS} active secrets — revoke one first (service_account_revoke_secret)` };
    }
    const clientSecret = genSecret(this._csprng);
    const secretId = genSecretId(this._csprng);
    this._db.prepare(
      'INSERT INTO service_account_secrets (id, name, secret_hash, created_at, expires_at, last_used_at) VALUES (?, ?, ?, ?, ?, NULL)'
    ).run(secretId, name, sha256hex(clientSecret), this._clock(), expiresAt ?? null);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ event: 'service_account_secret_rotated', name, secretId, by: updatedBy }));
    return { ok: true, secretId, clientSecret };
  }

  revokeSecret(name: string, secretId: string, updatedBy: string): ServiceAccountOutcome<object> {
    const existing = this._row(name);
    if (!existing) return { ok: false, code: 'SERVICE_ACCOUNT_NOT_FOUND', reason: `SERVICE_ACCOUNT_NOT_FOUND: no service account named '${name}'` };
    if (!existing.secrets.some((s) => s.id === secretId)) {
      return { ok: false, code: 'SERVICE_ACCOUNT_SECRET_NOT_FOUND', reason: `SERVICE_ACCOUNT_SECRET_NOT_FOUND: '${name}' has no secret '${secretId}'` };
    }
    this._db.prepare('DELETE FROM service_account_secrets WHERE name = ? AND id = ?').run(name, secretId);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ event: 'service_account_secret_revoked', name, secretId, by: updatedBy }));
    return { ok: true };
  }

  delete(name: string, deletedBy: string): ServiceAccountOutcome<object> {
    if (!this._row(name)) return { ok: false, code: 'SERVICE_ACCOUNT_NOT_FOUND', reason: `SERVICE_ACCOUNT_NOT_FOUND: no service account named '${name}'` };
    this._db.transaction(() => {
      this._db.prepare('DELETE FROM service_account_secrets WHERE name = ?').run(name);
      this._db.prepare('DELETE FROM service_accounts WHERE name = ?').run(name);
    })();
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ event: 'service_account_deleted', name, by: deletedBy }));
    return { ok: true };
  }

  /** `/token` client_credentials: verifies `clientId` ("sa:<name>") + the raw `secret` against
   *  every one of that account's (unexpired) secret hashes, constant-time. Returns null for an
   *  unknown client, a wrong/expired secret, a disabled account, or an expired account — spec
   *  §Token exchange's no-oracle rule: every failure looks the same from here (the /token handler
   *  answers the SAME 401 invalid_client body for all of them). Stamps lastUsedAt on success. */
  verifyCredentials(clientId: string, secret: string): { name: string; role: ServiceAccountRole; workflows: string[] | null } | null {
    if (!clientId.startsWith('sa:')) return null;
    const name = clientId.slice(3);
    const secretHash = sha256hex(secret);
    const row = this._row(name);
    const now = this._clock();
    if (!row || row.disabled || (row.expiresAt !== null && row.expiresAt <= now)) {
      // Still perform a comparison (against the dummy hash) so an unknown/disabled/expired account
      // takes the same code path as a live one before answering — see DUMMY_HASH's own doc.
      safeEqual(secretHash, DUMMY_HASH);
      return null;
    }
    const raw = this._db.prepare('SELECT id, secret_hash, expires_at FROM service_account_secrets WHERE name = ?').all(name) as Array<{ id: string; secret_hash: string; expires_at: number | null }>;
    let matchedId: string | null = null;
    for (const s of raw) {
      const hashOk = safeEqual(secretHash, s.secret_hash);
      const liveOk = s.expires_at === null || s.expires_at > now;
      if (hashOk && liveOk) matchedId = s.id;
    }
    if (matchedId === null) return null;
    this._db.prepare('UPDATE service_accounts SET last_used_at = ? WHERE name = ?').run(now, name);
    this._db.prepare('UPDATE service_account_secrets SET last_used_at = ? WHERE id = ?').run(now, matchedId);
    return { name: row.name, role: row.role, workflows: row.workflows };
  }

  /** The per-request re-check an already-issued bearer needs (spec §Model: "on each request the SA
   *  row is re-checked") — live:false for missing/disabled/expired, never throws. */
  isLive(name: string): { live: true; role: ServiceAccountRole; workflows: string[] | null } | { live: false } {
    const row = this._row(name);
    if (!row || row.disabled || (row.expiresAt !== null && row.expiresAt <= this._clock())) return { live: false };
    return { live: true, role: row.role, workflows: row.workflows };
  }
}
