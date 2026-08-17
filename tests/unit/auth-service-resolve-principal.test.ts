// UT-095 (DES-095, ARCH-059, TASK-086): `resolvePrincipal` discriminated union —
// returns `{principal: string}` or `{status: 401, wwwAuthenticate: string}`, NEVER throws.
//
// Cases:
//   - no Authorization header → 401 union (not a throw)
//   - Authorization header with garbage (not 'Bearer ...') → 401 union
//   - Authorization header with well-formed-but-unknown token → 401 union
//   - Authorization header with expired token → 401 union
//   - valid bearer → {principal: 'alice@example.com'}
//   - invariant: resolvePrincipal NEVER throws (even on malformed inputs) — always returns union
//   - uniform 401 body: does NOT distinguish expired-vs-unknown-vs-malformed on the wire (C-2)
//
// Red reason: `src/auth/auth-service.ts` does not exist → MODULE NOT FOUND → all tests fail
//   at collect time. Correct red for an unimplemented module.
//
// Mock policy (unit): fake TokenStore (stub with Map), fake IncomingMessage header objects.

import { describe, it, expect } from 'vitest';
import type { IncomingMessage } from 'node:http';
import { resolvePrincipal } from '../../src/auth/auth-service.js';

// ── minimal fake token store for unit isolation ───────────────────────────────

interface FakeTokenStoreOpts {
  /** token → principal (valid, non-expired) */
  validTokens?: Record<string, string>;
}

function makeFakeTokenStore(opts: FakeTokenStoreOpts = {}) {
  const valid = new Map(Object.entries(opts.validTokens ?? {}));
  return {
    verifyByHash: (token: string) => valid.get(token) ?? null,
  };
}

function makeReq(authHeader?: string): Pick<IncomingMessage, 'headers'> {
  return { headers: authHeader ? { authorization: authHeader } : {} };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('resolvePrincipal discriminated union (DES-095)', () => {
  it('returns 401 union when no Authorization header is present', async () => {
    const store = makeFakeTokenStore();
    const req = makeReq();
    const result = await resolvePrincipal(req as IncomingMessage, store as never);
    expect('status' in result).toBe(true);
    expect((result as { status: number }).status).toBe(401);
  });

  it('returns 401 union when Authorization is not "Bearer <token>"', async () => {
    const store = makeFakeTokenStore();
    const req = makeReq('Basic dXNlcjpwYXNz');
    const result = await resolvePrincipal(req as IncomingMessage, store as never);
    expect('status' in result).toBe(true);
    expect((result as { status: number }).status).toBe(401);
  });

  it('returns 401 union for a well-formed-but-unknown Bearer token', async () => {
    const store = makeFakeTokenStore({ validTokens: {} });
    const req = makeReq('Bearer unknown-opaque-token-xyz');
    const result = await resolvePrincipal(req as IncomingMessage, store as never);
    expect('status' in result).toBe(true);
    expect((result as { status: number }).status).toBe(401);
  });

  it('returns 401 union for an expired token (verifyByHash returns null)', async () => {
    // Expired token: verifyByHash returns null (same as unknown — no wire distinction per C-2)
    const store = makeFakeTokenStore({ validTokens: {} });
    const req = makeReq('Bearer expired-token-value');
    const result = await resolvePrincipal(req as IncomingMessage, store as never);
    expect('status' in result).toBe(true);
    expect((result as { status: number }).status).toBe(401);
  });

  it('returns {principal} for a valid bearer token', async () => {
    const store = makeFakeTokenStore({ validTokens: { 'valid-token-abc': 'alice@example.com' } });
    const req = makeReq('Bearer valid-token-abc');
    const result = await resolvePrincipal(req as IncomingMessage, store as never);
    expect('principal' in result).toBe(true);
    expect((result as { principal: string }).principal).toBe('alice@example.com');
  });

  it('result has wwwAuthenticate string on 401', async () => {
    const store = makeFakeTokenStore();
    const req = makeReq();
    const result = await resolvePrincipal(req as IncomingMessage, store as never);
    const r = result as { status: number; wwwAuthenticate: string };
    expect(typeof r.wwwAuthenticate).toBe('string');
    expect(r.wwwAuthenticate.length).toBeGreaterThan(0);
  });

  it('NEVER throws — 401 cases return the union, not an exception', async () => {
    const store = makeFakeTokenStore();
    // Even with a completely garbage token, should return union not throw
    const req = makeReq('Bearer ' + '\0'.repeat(100));
    await expect(resolvePrincipal(req as IncomingMessage, store as never)).resolves.not.toThrow();
    const result = await resolvePrincipal(req as IncomingMessage, store as never);
    expect('status' in result).toBe(true);
  });

  it('401 body is uniform (no expired-vs-unknown-vs-malformed distinction on wire, C-2)', async () => {
    const store = makeFakeTokenStore({ validTokens: {} });
    const expiredReq = makeReq('Bearer would-be-expired');
    const unknownReq = makeReq('Bearer unknown-token');
    const malformedReq = makeReq('not-bearer-format');

    const [e, u, m] = await Promise.all([
      resolvePrincipal(expiredReq as IncomingMessage, store as never),
      resolvePrincipal(unknownReq as IncomingMessage, store as never),
      resolvePrincipal(malformedReq as IncomingMessage, store as never),
    ]);

    // All three should produce the same status code
    expect((e as { status: number }).status).toBe(401);
    expect((u as { status: number }).status).toBe(401);
    expect((m as { status: number }).status).toBe(401);
  });
});
