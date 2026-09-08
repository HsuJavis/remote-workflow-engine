// DES-093 (ARCH-059, TASK-085): opaque sha256-at-rest bearer + single-use auth-code/state.
// Constructor-injected clock+CSPRNG — no Date.now() or crypto.randomBytes() in this module.

import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';

export interface TokenStoreSeams {
  /** Returns current time in milliseconds (injected — never Date.now() in this module). det:allow — the seam's own doc naming what it replaces; this module calls none of it */
  clock: () => number;
  /** Returns `n` cryptographically random bytes (injected — never randomBytes() in this module). */
  csprng: (n: number) => Buffer;
}

function sha256hex(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Generate a random opaque token string using the injected CSPRNG. */
function genRandom(csprng: (n: number) => Buffer): string {
  return csprng(32).toString('hex');
}

/** 3-table SQLite store for OAuth bearer tokens, single-use auth codes, and PKCE state blobs.
 *  Raw tokens/codes are NEVER persisted — only their sha256 hashes are stored (DES-093 seam). */
export class TokenStore {
  private readonly _db: Database.Database;
  private readonly _clock: () => number;
  private readonly _csprng: (n: number) => Buffer;

  constructor(db: Database.Database, seams: TokenStoreSeams) {
    this._db = db;
    this._clock = seams.clock;
    this._csprng = seams.csprng;
    this._init();
  }

  private _init(): void {
    this._db.exec(`
      CREATE TABLE IF NOT EXISTS bearer_tokens (
        token_hash TEXT PRIMARY KEY,
        principal TEXT NOT NULL,
        issued_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS auth_codes (
        code_hash TEXT PRIMARY KEY,
        principal TEXT NOT NULL,
        code_challenge TEXT NOT NULL,
        redirect_uri TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        scope TEXT
      );
      CREATE TABLE IF NOT EXISTS oauth_state (
        state TEXT PRIMARY KEY,
        nonce TEXT NOT NULL,
        code_challenge TEXT NOT NULL,
        redirect_uri TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        client_state TEXT,
        scope TEXT
      );
      CREATE TABLE IF NOT EXISTS registered_clients (
        client_id TEXT PRIMARY KEY,
        redirect_uris TEXT NOT NULL,
        client_id_issued_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        token_hash TEXT PRIMARY KEY,
        principal TEXT NOT NULL,
        scope TEXT,
        client_id TEXT,
        issued_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
    `);
    // v19 idempotent migration: add client_state column to existing oauth_state tables.
    try { this._db.exec('ALTER TABLE oauth_state ADD COLUMN client_state TEXT'); } catch { /* already exists */ }
    // v20 idempotent migrations: add scope column to auth_codes and oauth_state.
    try { this._db.exec('ALTER TABLE auth_codes ADD COLUMN scope TEXT'); } catch { /* already exists */ }
    try { this._db.exec('ALTER TABLE oauth_state ADD COLUMN scope TEXT'); } catch { /* already exists */ }
  }

  /** Issue a new opaque bearer token.  Returns the RAW token (show once) + expiry timestamp. */
  issue(principal: string, ttlMs: number): { token: string; expiresAt: number } {
    const token = genRandom(this._csprng);
    const now = this._clock();
    const expiresAt = now + ttlMs;
    this._db.prepare(
      'INSERT INTO bearer_tokens (token_hash, principal, issued_at, expires_at) VALUES (?, ?, ?, ?)'
    ).run(sha256hex(token), principal, now, expiresAt);
    return { token, expiresAt };
  }

  /** Verify a raw bearer token; returns the principal or null (expired/unknown). */
  verifyByHash(rawToken: string): string | null {
    const now = this._clock();
    const row = this._db.prepare(
      'SELECT principal, expires_at FROM bearer_tokens WHERE token_hash = ?'
    ).get(sha256hex(rawToken)) as { principal: string; expires_at: number } | undefined;
    if (!row) return null;
    if (row.expires_at <= now) return null;
    return row.principal;
  }

  /** Mint a single-use auth code (≤60 s TTL).  Returns the RAW code. */
  mintAuthCode(principal: string, codeChallenge: string, redirectUri: string, scope?: string | null): string {
    const code = genRandom(this._csprng);
    const now = this._clock();
    this._db.prepare(
      'INSERT INTO auth_codes (code_hash, principal, code_challenge, redirect_uri, expires_at, scope) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(sha256hex(code), principal, codeChallenge, redirectUri, now + 60_000, scope ?? null);
    return code;
  }

  /** Consume an auth code atomically (DELETE-then-check).  Returns payload or null. */
  consumeAuthCode(
    rawCode: string
  ): { principal: string; codeChallenge: string; redirectUri: string; scope: string | null } | null {
    const now = this._clock();
    const codeHash = sha256hex(rawCode);
    const row = this._db.transaction(() => {
      const r = this._db.prepare(
        'SELECT principal, code_challenge, redirect_uri, expires_at, scope FROM auth_codes WHERE code_hash = ?'
      ).get(codeHash) as {
        principal: string;
        code_challenge: string;
        redirect_uri: string;
        expires_at: number;
        scope: string | null;
      } | undefined;
      if (!r) return undefined;
      this._db.prepare('DELETE FROM auth_codes WHERE code_hash = ?').run(codeHash);
      return r;
    })();
    if (!row) return null;
    if (row.expires_at <= now) return null;
    return { principal: row.principal, codeChallenge: row.code_challenge, redirectUri: row.redirect_uri, scope: row.scope };
  }

  /** Store a PKCE state blob (10-minute TTL).  State is the raw PKCE `state` param. */
  putState(params: {
    state: string;
    nonce: string;
    codeChallenge: string;
    redirectUri: string;
    /** The CLIENT's OAuth2 state (RFC 6749 §4.1.2) — distinct from `state` (the engine-leg CSRF token). v19. */
    clientState?: string | null;
    /** The CLIENT's requested OAuth2 scope string (verbatim). v20. */
    scope?: string | null;
  }): void {
    const now = this._clock();
    this._db.prepare(
      'INSERT OR REPLACE INTO oauth_state (state, nonce, code_challenge, redirect_uri, expires_at, client_state, scope) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(params.state, params.nonce, params.codeChallenge, params.redirectUri, now + 600_000, params.clientState ?? null, params.scope ?? null);
  }

  /** Consume a state blob (single-use).  Returns payload or null. */
  consumeState(
    state: string
  ): { nonce: string; codeChallenge: string; redirectUri: string; clientState: string | null; scope: string | null } | null {
    const now = this._clock();
    const row = this._db.transaction(() => {
      const r = this._db.prepare(
        'SELECT nonce, code_challenge, redirect_uri, expires_at, client_state, scope FROM oauth_state WHERE state = ?'
      ).get(state) as {
        nonce: string;
        code_challenge: string;
        redirect_uri: string;
        expires_at: number;
        client_state: string | null;
        scope: string | null;
      } | undefined;
      if (!r) return undefined;
      this._db.prepare('DELETE FROM oauth_state WHERE state = ?').run(state);
      return r;
    })();
    if (!row) return null;
    if (row.expires_at <= now) return null;
    return { nonce: row.nonce, codeChallenge: row.code_challenge, redirectUri: row.redirect_uri, clientState: row.client_state, scope: row.scope };
  }

  /** Issue a new opaque refresh token (~90d TTL).  Returns the RAW token (show once) + expiry timestamp. */
  issueRefresh(principal: string, scope: string | null, clientId: string | null, ttlMs: number): { token: string; expiresAt: number } {
    const token = genRandom(this._csprng);
    const now = this._clock();
    const expiresAt = now + ttlMs;
    this._db.prepare(
      'INSERT INTO refresh_tokens (token_hash, principal, scope, client_id, issued_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(sha256hex(token), principal, scope, clientId, now, expiresAt);
    return { token, expiresAt };
  }

  /** Consume a refresh token atomically (single-use).  Returns payload or null (expired/unknown/already-consumed). */
  consumeRefresh(rawToken: string): { principal: string; scope: string | null; clientId: string | null } | null {
    const now = this._clock();
    const tokenHash = sha256hex(rawToken);
    const row = this._db.transaction(() => {
      const r = this._db.prepare(
        'SELECT principal, scope, client_id, expires_at FROM refresh_tokens WHERE token_hash = ?'
      ).get(tokenHash) as {
        principal: string;
        scope: string | null;
        client_id: string | null;
        expires_at: number;
      } | undefined;
      if (!r) return undefined;
      this._db.prepare('DELETE FROM refresh_tokens WHERE token_hash = ?').run(tokenHash);
      return r;
    })();
    if (!row) return null;
    if (row.expires_at <= now) return null;
    return { principal: row.principal, scope: row.scope, clientId: row.client_id };
  }

  /** Mint a new RFC 7591 client_id; persists redirect_uris and returns the issued-at timestamp in seconds. */
  registerClient(params: { redirectUris: string[]; ttlMs: number }): { clientId: string; clientIdIssuedAt: number } {
    const clientId = genRandom(this._csprng);
    const nowMs = this._clock();
    const clientIdIssuedAt = Math.floor(nowMs / 1000);
    const expiresAt = nowMs + params.ttlMs;
    this._db.prepare(
      'INSERT INTO registered_clients (client_id, redirect_uris, client_id_issued_at, expires_at) VALUES (?, ?, ?, ?)'
    ).run(clientId, JSON.stringify(params.redirectUris), clientIdIssuedAt, expiresAt);
    return { clientId, clientIdIssuedAt };
  }

  /** Look up a registered client by id; returns its redirect_uris or null if unknown/expired. */
  getClient(clientId: string): { redirectUris: string[] } | null {
    const now = this._clock();
    const row = this._db.prepare(
      'SELECT redirect_uris, expires_at FROM registered_clients WHERE client_id = ?'
    ).get(clientId) as { redirect_uris: string; expires_at: number } | undefined;
    if (!row) return null;
    if (row.expires_at <= now) return null;
    return { redirectUris: JSON.parse(row.redirect_uris) as string[] };
  }

  /** Delete expired rows from all five tables; returns total row count deleted. */
  gcExpired(): number {
    const now = this._clock();
    let n = 0;
    n += this._db.prepare('DELETE FROM bearer_tokens WHERE expires_at <= ?').run(now).changes;
    n += this._db.prepare('DELETE FROM auth_codes WHERE expires_at <= ?').run(now).changes;
    n += this._db.prepare('DELETE FROM oauth_state WHERE expires_at <= ?').run(now).changes;
    n += this._db.prepare('DELETE FROM registered_clients WHERE expires_at <= ?').run(now).changes;
    n += this._db.prepare('DELETE FROM refresh_tokens WHERE expires_at <= ?').run(now).changes;
    return n;
  }
}
