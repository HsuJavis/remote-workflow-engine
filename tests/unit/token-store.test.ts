// UT-093 (DES-093, ARCH-059, TASK-085): `TokenStore` — opaque sha256-at-rest bearer,
// single-use code/state, constructor-injected clock+CSPRNG.
//
// Cases:
//   issue / verifyByHash:
//     - issue() returns a raw token and expiresAt
//     - verifyByHash(rawToken) returns the principal for a valid non-expired token
//     - verifyByHash() returns null for an unknown token
//     - verifyByHash() returns null after expiry (via injected clock advance)
//   seam (D-CORE): raw token NEVER equals stored column (checked via direct db read)
//     - deterministic csprng → both raw token and stored hash are predictable in tests
//   mintAuthCode / consumeAuthCode (single-use atomic):
//     - consumeAuthCode(rawCode) returns {principal, codeChallenge, redirectUri} on first call
//     - consumeAuthCode(rawCode) returns null on second call (single-use)
//     - consumeAuthCode() returns null for an unknown code
//     - consumeAuthCode() returns null after ≤60s TTL (via injected clock advance)
//   putState / consumeState:
//     - consumeState(state) returns {nonce, codeChallenge, redirectUri} on first call
//     - consumeState(state) returns null on second call (single-use)
//   gcExpired:
//     - returns count of expired rows deleted
//     - clock advance past TTL → gcExpired cleans up
//
// Red reason: `src/auth/token-store.ts` does not exist → MODULE NOT FOUND → all tests fail
//   at collect time. Correct red for an unimplemented module.
//
// Mock policy (unit): in-memory SQLite (:memory:), injected deterministic clock + csprng.
//   No network, no filesystem.

import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { TokenStore } from '../../src/auth/token-store.js';

// ── test helpers ──────────────────────────────────────────────────────────────

/** A deterministic csprng: each call returns bytes derived from a counter. */
function makeFakeCsprng(seed = 0) {
  let counter = seed;
  return (n: number) => {
    const buf = Buffer.alloc(n);
    for (let i = 0; i < n; i++) buf[i] = (counter++ + i) & 0xff;
    return buf;
  };
}

function makeStore(nowMs: number = Date.UTC(2026, 0, 1)) {
  const db = new Database(':memory:');
  let now = nowMs;
  const clock = () => now;
  const csprng = makeFakeCsprng();
  const store = new TokenStore(db, { clock, csprng });
  return { store, db, clock, setNow: (t: number) => { now = t; } };
}

const BASE_MS = Date.UTC(2026, 0, 1);
const HOUR_MS = 3600_000;

// ── issue / verifyByHash ─────────────────────────────────────────────────────

describe('TokenStore.issue + verifyByHash (DES-093)', () => {
  it('issue() returns a raw token and a future expiresAt', () => {
    const { store } = makeStore(BASE_MS);
    const { token, expiresAt } = store.issue('alice@example.com', HOUR_MS);
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);
    expect(expiresAt).toBeGreaterThan(BASE_MS);
  });

  it('verifyByHash(rawToken) returns the principal for a valid token', () => {
    const { store } = makeStore(BASE_MS);
    const { token } = store.issue('alice@example.com', HOUR_MS);
    expect(store.verifyByHash(token)).toBe('alice@example.com');
  });

  it('verifyByHash() returns null for an unknown token', () => {
    const { store } = makeStore(BASE_MS);
    store.issue('alice@example.com', HOUR_MS);
    expect(store.verifyByHash('totally-unknown-token')).toBeNull();
  });

  it('verifyByHash() returns null after the token expires (clock advance)', () => {
    const { store, setNow } = makeStore(BASE_MS);
    const { token } = store.issue('alice@example.com', HOUR_MS);
    // advance clock past expiry
    setNow(BASE_MS + HOUR_MS + 1);
    expect(store.verifyByHash(token)).toBeNull();
  });

  it('raw token NEVER equals stored token_hash column (seam invariant)', () => {
    const { store, db } = makeStore(BASE_MS);
    const { token } = store.issue('alice@example.com', HOUR_MS);
    const row = db.prepare('SELECT token_hash FROM bearer_tokens LIMIT 1').get() as { token_hash: string };
    expect(row).not.toBeNull();
    // The stored value is sha256(token), never the token itself
    expect(row.token_hash).not.toBe(token);
  });

  it('two issue() calls produce two distinct tokens (csprng advances)', () => {
    const { store } = makeStore(BASE_MS);
    const { token: t1 } = store.issue('alice@example.com', HOUR_MS);
    const { token: t2 } = store.issue('bob@example.com', HOUR_MS);
    expect(t1).not.toBe(t2);
  });
});

// ── mintAuthCode / consumeAuthCode ───────────────────────────────────────────

describe('TokenStore.mintAuthCode + consumeAuthCode (DES-093)', () => {
  // v20: mintAuthCode gains a required 4th param `scope: string | null`
  // (null = no offline_access requested). Passing null leaves scope field absent pre-impl.
  it('consumeAuthCode returns {principal, codeChallenge, redirectUri, scope} on first call (v20 scope)', () => {
    const { store } = makeStore(BASE_MS);
    const code = store.mintAuthCode('alice@example.com', 'challenge-abc', 'http://localhost:3000/cb', null);
    const result = store.consumeAuthCode(code);
    expect(result).not.toBeNull();
    expect(result?.principal).toBe('alice@example.com');
    expect(result?.codeChallenge).toBe('challenge-abc');
    expect(result?.redirectUri).toBe('http://localhost:3000/cb');
    // v20: scope column in auth_codes — pre-impl: field absent → undefined ≠ null → FAIL
    expect(result?.scope).toBeNull();
  });

  it('consumeAuthCode with scope threads scope through (v20)', () => {
    const { store } = makeStore(BASE_MS);
    const code = store.mintAuthCode('alice@example.com', 'challenge-abc', 'http://localhost:3000/cb', 'openid email offline_access');
    const result = store.consumeAuthCode(code);
    expect(result).not.toBeNull();
    // v20: scope round-trips — pre-impl: scope absent → FAIL
    expect(result?.scope).toBe('openid email offline_access');
  });

  it('consumeAuthCode returns null on second call (single-use atomic)', () => {
    const { store } = makeStore(BASE_MS);
    const code = store.mintAuthCode('alice@example.com', 'challenge-abc', 'http://localhost:3000/cb', null);
    store.consumeAuthCode(code); // first consume
    expect(store.consumeAuthCode(code)).toBeNull(); // second → null
  });

  it('consumeAuthCode returns null for an unknown code', () => {
    const { store } = makeStore(BASE_MS);
    expect(store.consumeAuthCode('unknown-code')).toBeNull();
  });

  it('consumeAuthCode returns null after ≤60s TTL (clock advance)', () => {
    const { store, setNow } = makeStore(BASE_MS);
    const code = store.mintAuthCode('alice@example.com', 'challenge-abc', 'http://localhost:3000/cb', null);
    setNow(BASE_MS + 61_000); // 61 seconds later — past ≤60s TTL
    expect(store.consumeAuthCode(code)).toBeNull();
  });

  it('raw code NEVER equals stored code_hash column (seam invariant)', () => {
    const { store, db } = makeStore(BASE_MS);
    const code = store.mintAuthCode('alice@example.com', 'challenge-abc', 'http://localhost/cb', null);
    const row = db.prepare('SELECT code_hash FROM auth_codes LIMIT 1').get() as { code_hash: string };
    expect(row).not.toBeNull();
    expect(row.code_hash).not.toBe(code);
  });
});

// ── putState / consumeState scope threading (v20) ────────────────────────────

describe('TokenStore.putState + consumeState scope threading (DES-093 v20)', () => {
  it('consumeState returns scope:null when putState called without scope (v20)', () => {
    const { store } = makeStore(BASE_MS);
    store.putState({ state: 'st1', nonce: 'n', codeChallenge: 'c', redirectUri: 'http://localhost/cb' });
    const r = store.consumeState('st1');
    expect(r).not.toBeNull();
    // v20: oauth_state gains nullable scope column — pre-impl: field absent → undefined ≠ null → FAIL
    expect(r?.scope).toBeNull();
  });

  it('consumeState returns scope verbatim when putState called with scope (v20)', () => {
    const { store } = makeStore(BASE_MS);
    store.putState({ state: 'st2', nonce: 'n', codeChallenge: 'c', redirectUri: 'http://localhost/cb', scope: 'openid email offline_access' });
    const r = store.consumeState('st2');
    expect(r).not.toBeNull();
    // v20: scope round-trips — pre-impl: scope absent → FAIL
    expect(r?.scope).toBe('openid email offline_access');
  });
});

// ── issueRefresh / consumeRefresh (DES-093 v20) ──────────────────────────────
//
// Pre-impl: issueRefresh/consumeRefresh do not exist → calling them throws
//   "is not a function" → FAIL for the right reason.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyStore = any;

describe('TokenStore.issueRefresh + consumeRefresh (DES-093 v20)', () => {
  const REFRESH_TTL = 90 * 24 * 3600_000; // ~90 days

  it('issueRefresh returns a raw token and a future expiresAt (v20)', () => {
    const { store } = makeStore(BASE_MS);
    // Pre-impl: issueRefresh is not a function → TypeError → FAIL
    const { token, expiresAt } = (store as AnyStore).issueRefresh('alice@example.com', 'openid email offline_access', null, REFRESH_TTL);
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);
    expect(expiresAt).toBeGreaterThan(BASE_MS);
  });

  it('consumeRefresh returns {principal, scope, clientId} on first call (v20)', () => {
    const { store } = makeStore(BASE_MS);
    const { token } = (store as AnyStore).issueRefresh('alice@example.com', 'openid email offline_access', null, REFRESH_TTL);
    const result = (store as AnyStore).consumeRefresh(token);
    expect(result).not.toBeNull();
    expect(result?.principal).toBe('alice@example.com');
    expect(result?.scope).toBe('openid email offline_access');
    expect(result?.clientId).toBeNull();
  });

  it('consumeRefresh returns null on second call (single-use atomic) (v20)', () => {
    const { store } = makeStore(BASE_MS);
    const { token } = (store as AnyStore).issueRefresh('alice@example.com', null, null, REFRESH_TTL);
    (store as AnyStore).consumeRefresh(token); // first consume
    expect((store as AnyStore).consumeRefresh(token)).toBeNull(); // second → null
  });

  it('consumeRefresh returns null for unknown token (v20)', () => {
    const { store } = makeStore(BASE_MS);
    expect((store as AnyStore).consumeRefresh('unknown-refresh-token')).toBeNull();
  });

  it('consumeRefresh returns null after TTL expires (clock advance) (v20)', () => {
    const { store, setNow } = makeStore(BASE_MS);
    const { token } = (store as AnyStore).issueRefresh('alice@example.com', null, null, REFRESH_TTL);
    setNow(BASE_MS + REFRESH_TTL + 1);
    expect((store as AnyStore).consumeRefresh(token)).toBeNull();
  });

  it('raw refresh token NEVER equals stored hash (sha256-at-rest seam invariant) (v20)', () => {
    const { store, db } = makeStore(BASE_MS);
    const { token } = (store as AnyStore).issueRefresh('alice@example.com', null, null, REFRESH_TTL);
    // Pre-impl: table does not exist → SqliteError "no such table: refresh_tokens" → FAIL
    const row = db.prepare('SELECT token_hash FROM refresh_tokens LIMIT 1').get() as { token_hash: string };
    expect(row).not.toBeNull();
    expect(row.token_hash).not.toBe(token);
  });

  it('gcExpired covers refresh_tokens table (v20 5th table)', () => {
    const { store, setNow } = makeStore(BASE_MS);
    (store as AnyStore).issueRefresh('alice@example.com', null, null, HOUR_MS);
    // advance past TTL
    setNow(BASE_MS + HOUR_MS + 1);
    // Pre-impl: refresh_tokens table absent → SqliteError → FAIL
    // Post-impl: expired refresh token is deleted → count ≥ 1
    const deleted = store.gcExpired();
    expect(deleted).toBeGreaterThan(0);
  });
});

// ── registerClient / getClient grant_types persistence (issue #86) ────────────
//
// The /token authorization_code branch needs to know whether the DCR-registered client
// declared grant_types including 'refresh_token' so it can issue a refresh token even when
// the requested scope omits offline_access. That requires the client store to actually
// persist grant_types (previously only redirect_uris were persisted).
const DAY_MS = 24 * 3600_000;

describe('TokenStore.registerClient + getClient grant_types (issue #86)', () => {
  it('getClient returns the grantTypes passed to registerClient', () => {
    const { store } = makeStore(BASE_MS);
    // Pre-impl: registerClient has no grantTypes param; getClient has no grantTypes field →
    // `result?.grantTypes` is undefined → FAILS.
    const { clientId } = (store as AnyStore).registerClient({
      redirectUris: ['http://127.0.0.1:4000/cb'],
      ttlMs: 30 * DAY_MS,
      grantTypes: ['authorization_code'],
    });
    const result = (store as AnyStore).getClient(clientId);
    expect(result?.grantTypes).toEqual(['authorization_code']);
  });

  it('getClient defaults grantTypes to ["authorization_code","refresh_token"] when registerClient omits it', () => {
    const { store } = makeStore(BASE_MS);
    const { clientId } = store.registerClient({
      redirectUris: ['http://127.0.0.1:4001/cb'],
      ttlMs: 30 * DAY_MS,
    });
    // Pre-impl: getClient has no grantTypes field → undefined → FAILS.
    const result = (store as AnyStore).getClient(clientId);
    expect(result?.grantTypes).toEqual(['authorization_code', 'refresh_token']);
  });

  // Legacy-row migration: a client row written BEFORE this fix has no grant_types column value.
  // Per issue #86's decision, a missing value is treated as what /register would have stored
  // (i.e. the DCR default), so pre-existing installs get a refresh token without re-registering.
  it('getClient defaults grantTypes for a legacy row predating the grant_types column', () => {
    const { store, db } = makeStore(BASE_MS);
    // Simulate a v-pre-86 row: insert directly, bypassing registerClient, with no grant_types.
    // (the INSERT's column list omits grant_types, so the column is NULL for this row —
    // same as a real pre-#86 row would be after the idempotent ALTER TABLE migration runs)
    db.prepare(
      'INSERT INTO registered_clients (client_id, redirect_uris, client_id_issued_at, expires_at) VALUES (?, ?, ?, ?)'
    ).run('legacy-client-id', JSON.stringify(['http://127.0.0.1:4002/cb']), Math.floor(BASE_MS / 1000), BASE_MS + 30 * DAY_MS);
    // Pre-impl: getClient() doesn't return a grantTypes field at all → undefined → FAILS.
    const result = (store as AnyStore).getClient('legacy-client-id');
    expect(result?.grantTypes).toEqual(['authorization_code', 'refresh_token']);
  });

  // The test above inserts into a DB whose schema (via this TokenStore's own CREATE TABLE)
  // already HAS the grant_types column — it proves NULL-handling, but never actually runs the
  // idempotent `ALTER TABLE registered_clients ADD COLUMN grant_types` migration against a real
  // pre-#86 table shape. If that ALTER ever silently failed to apply, `getClient`'s
  // `SELECT ... grant_types` would throw against a genuinely old table (no such column) — a
  // real production auth-tokens.db predates this fix, so this path matters on next boot.
  it('idempotent ALTER TABLE migration: a genuinely pre-#86 table (no grant_types column at all) still works after construction', () => {
    const db = new Database(':memory:');
    // Hand-build the exact pre-#86 schema (no grant_types column) — no CREATE TABLE IF NOT
    // EXISTS from TokenStore has run yet, so the constructor below must ALTER this real table.
    db.exec(`
      CREATE TABLE registered_clients (
        client_id TEXT PRIMARY KEY,
        redirect_uris TEXT NOT NULL,
        client_id_issued_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
    `);
    db.prepare(
      'INSERT INTO registered_clients (client_id, redirect_uris, client_id_issued_at, expires_at) VALUES (?, ?, ?, ?)'
    ).run('legacy-client-id', JSON.stringify(['http://127.0.0.1:4003/cb']), Math.floor(BASE_MS / 1000), BASE_MS + 30 * DAY_MS);

    // Constructing TokenStore against this pre-existing table must ALTER it in place, not throw.
    const store = new TokenStore(db, { clock: () => BASE_MS, csprng: makeFakeCsprng() });

    // The migrated legacy row reads back with the default grant_types (no column value stored).
    const legacy = (store as AnyStore).getClient('legacy-client-id');
    expect(legacy?.grantTypes).toEqual(['authorization_code', 'refresh_token']);

    // And the now-altered table accepts a fresh registerClient() write with an explicit
    // grant_types value (proves the ALTER'd column is actually writable, not just readable).
    const { clientId } = store.registerClient({
      redirectUris: ['http://127.0.0.1:4004/cb'],
      ttlMs: 30 * DAY_MS,
      grantTypes: ['authorization_code'],
    });
    const fresh = (store as AnyStore).getClient(clientId);
    expect(fresh?.grantTypes).toEqual(['authorization_code']);
  });
});

// ── putState / consumeState ───────────────────────────────────────────────────

describe('TokenStore.putState + consumeState (DES-093)', () => {
  it('consumeState returns {nonce, codeChallenge, redirectUri} on first call', () => {
    const { store } = makeStore(BASE_MS);
    const state = 'test-state-value';
    store.putState({ state, nonce: 'nonce-xyz', codeChallenge: 'challenge-xyz', redirectUri: 'http://localhost/cb' });
    const r = store.consumeState(state);
    expect(r).not.toBeNull();
    expect(r?.nonce).toBe('nonce-xyz');
    expect(r?.codeChallenge).toBe('challenge-xyz');
    expect(r?.redirectUri).toBe('http://localhost/cb');
  });

  it('consumeState returns null on second call (single-use)', () => {
    const { store } = makeStore(BASE_MS);
    const state = 'test-state-single-use';
    store.putState({ state, nonce: 'n', codeChallenge: 'c', redirectUri: 'http://localhost/cb' });
    store.consumeState(state);
    expect(store.consumeState(state)).toBeNull();
  });

  it('consumeState returns null for unknown state', () => {
    const { store } = makeStore(BASE_MS);
    expect(store.consumeState('unknown-state')).toBeNull();
  });
});

// ── gcExpired ─────────────────────────────────────────────────────────────────

describe('TokenStore.gcExpired (DES-093)', () => {
  it('gcExpired returns 0 when nothing is expired', () => {
    const { store } = makeStore(BASE_MS);
    store.issue('alice@example.com', HOUR_MS);
    expect(store.gcExpired()).toBe(0);
  });

  it('gcExpired returns count of expired rows after clock advance', () => {
    const { store, setNow } = makeStore(BASE_MS);
    store.issue('alice@example.com', HOUR_MS); // bearer TTL 1hr
    store.mintAuthCode('alice@example.com', 'c', 'http://localhost/cb'); // code TTL ≤60s
    setNow(BASE_MS + HOUR_MS + 1); // advance past both
    const deleted = store.gcExpired();
    expect(deleted).toBeGreaterThan(0);
  });

  it('gcExpired is idempotent: second call returns 0 after first cleans up', () => {
    const { store, setNow } = makeStore(BASE_MS);
    store.issue('alice@example.com', HOUR_MS);
    setNow(BASE_MS + HOUR_MS + 1);
    store.gcExpired();
    expect(store.gcExpired()).toBe(0);
  });
});
