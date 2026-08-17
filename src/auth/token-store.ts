// DES-093 (ARCH-059, TASK-085): opaque sha256-at-rest bearer + single-use auth-code/state.
// Constructor-injected clock+CSPRNG — no Date.now() or crypto.randomBytes() in this module.

import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';

export interface TokenStoreSeams {
  /** Returns current time in milliseconds (injected — never Date.now() in this module). */
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
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS oauth_state (
        state TEXT PRIMARY KEY,
        nonce TEXT NOT NULL,
        code_challenge TEXT NOT NULL,
        redirect_uri TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
    `);
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
  mintAuthCode(principal: string, codeChallenge: string, redirectUri: string): string {
    const code = genRandom(this._csprng);
    const now = this._clock();
    this._db.prepare(
      'INSERT INTO auth_codes (code_hash, principal, code_challenge, redirect_uri, expires_at) VALUES (?, ?, ?, ?, ?)'
    ).run(sha256hex(code), principal, codeChallenge, redirectUri, now + 60_000);
    return code;
  }

  /** Consume an auth code atomically (DELETE-then-check).  Returns payload or null. */
  consumeAuthCode(
    rawCode: string
  ): { principal: string; codeChallenge: string; redirectUri: string } | null {
    const now = this._clock();
    const codeHash = sha256hex(rawCode);
    const row = this._db.transaction(() => {
      const r = this._db.prepare(
        'SELECT principal, code_challenge, redirect_uri, expires_at FROM auth_codes WHERE code_hash = ?'
      ).get(codeHash) as {
        principal: string;
        code_challenge: string;
        redirect_uri: string;
        expires_at: number;
      } | undefined;
      if (!r) return undefined;
      this._db.prepare('DELETE FROM auth_codes WHERE code_hash = ?').run(codeHash);
      return r;
    })();
    if (!row) return null;
    if (row.expires_at <= now) return null;
    return { principal: row.principal, codeChallenge: row.code_challenge, redirectUri: row.redirect_uri };
  }

  /** Store a PKCE state blob (10-minute TTL).  State is the raw PKCE `state` param. */
  putState(params: {
    state: string;
    nonce: string;
    codeChallenge: string;
    redirectUri: string;
  }): void {
    const now = this._clock();
    this._db.prepare(
      'INSERT OR REPLACE INTO oauth_state (state, nonce, code_challenge, redirect_uri, expires_at) VALUES (?, ?, ?, ?, ?)'
    ).run(params.state, params.nonce, params.codeChallenge, params.redirectUri, now + 600_000);
  }

  /** Consume a state blob (single-use).  Returns payload or null. */
  consumeState(
    state: string
  ): { nonce: string; codeChallenge: string; redirectUri: string } | null {
    const now = this._clock();
    const row = this._db.transaction(() => {
      const r = this._db.prepare(
        'SELECT nonce, code_challenge, redirect_uri, expires_at FROM oauth_state WHERE state = ?'
      ).get(state) as {
        nonce: string;
        code_challenge: string;
        redirect_uri: string;
        expires_at: number;
      } | undefined;
      if (!r) return undefined;
      this._db.prepare('DELETE FROM oauth_state WHERE state = ?').run(state);
      return r;
    })();
    if (!row) return null;
    if (row.expires_at <= now) return null;
    return { nonce: row.nonce, codeChallenge: row.code_challenge, redirectUri: row.redirect_uri };
  }

  /** Delete expired rows from all three tables; returns total row count deleted. */
  gcExpired(): number {
    const now = this._clock();
    let n = 0;
    n += this._db.prepare('DELETE FROM bearer_tokens WHERE expires_at <= ?').run(now).changes;
    n += this._db.prepare('DELETE FROM auth_codes WHERE expires_at <= ?').run(now).changes;
    n += this._db.prepare('DELETE FROM oauth_state WHERE expires_at <= ?').run(now).changes;
    return n;
  }
}
