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
  it('consumeAuthCode returns {principal, codeChallenge, redirectUri} on first call', () => {
    const { store } = makeStore(BASE_MS);
    const code = store.mintAuthCode('alice@example.com', 'challenge-abc', 'http://localhost:3000/cb');
    const result = store.consumeAuthCode(code);
    expect(result).not.toBeNull();
    expect(result?.principal).toBe('alice@example.com');
    expect(result?.codeChallenge).toBe('challenge-abc');
    expect(result?.redirectUri).toBe('http://localhost:3000/cb');
  });

  it('consumeAuthCode returns null on second call (single-use atomic)', () => {
    const { store } = makeStore(BASE_MS);
    const code = store.mintAuthCode('alice@example.com', 'challenge-abc', 'http://localhost:3000/cb');
    store.consumeAuthCode(code); // first consume
    expect(store.consumeAuthCode(code)).toBeNull(); // second → null
  });

  it('consumeAuthCode returns null for an unknown code', () => {
    const { store } = makeStore(BASE_MS);
    expect(store.consumeAuthCode('unknown-code')).toBeNull();
  });

  it('consumeAuthCode returns null after ≤60s TTL (clock advance)', () => {
    const { store, setNow } = makeStore(BASE_MS);
    const code = store.mintAuthCode('alice@example.com', 'challenge-abc', 'http://localhost:3000/cb');
    setNow(BASE_MS + 61_000); // 61 seconds later — past ≤60s TTL
    expect(store.consumeAuthCode(code)).toBeNull();
  });

  it('raw code NEVER equals stored code_hash column (seam invariant)', () => {
    const { store, db } = makeStore(BASE_MS);
    const code = store.mintAuthCode('alice@example.com', 'challenge-abc', 'http://localhost/cb');
    const row = db.prepare('SELECT code_hash FROM auth_codes LIMIT 1').get() as { code_hash: string };
    expect(row).not.toBeNull();
    expect(row.code_hash).not.toBe(code);
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
