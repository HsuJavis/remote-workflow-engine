// UT-094 (DES-094, ARCH-059, TASK-085): `verifyIdToken` — Google id_token verification with
// injected JWKS+clock+base (zero network in UT).
//
// Cases:
//   accept: valid token with correct iss/aud/exp/sig/nonce/email_verified → {email}
//   reject — bad iss (e.g. 'evil.example.com')
//   reject — bad aud (not clientId)
//   reject — expired exp (via injected now)
//   reject — bad signature (different key than in jwksFetch)
//   reject — wrong nonce
//   reject — email_verified === false  (critical invariant: must check before adopting email)
//   reject — email_verified missing
//   reject — email claim missing
//   reject — token with alg=none (must still reject; implementation checks signature)
//
// Red reason: `src/auth/google-verifier.ts` does not exist → MODULE NOT FOUND → all tests fail
//   at collect time. Correct red for an unimplemented module.
//
// Mock policy (unit): RS256 key pair via node:crypto; jwksFetch and `now` injected; no real fetch.

import { describe, it, expect } from 'vitest';
import { generateKeyPairSync, createSign } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { verifyIdToken } from '../../src/auth/google-verifier.js';

// ── RS256 test helpers ────────────────────────────────────────────────────────

type Jwk = Record<string, unknown>;

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const KID = 'test-key-1';

function b64u(s: string): string {
  return Buffer.from(s).toString('base64url');
}

function signRS256(header: object, payload: object, key: KeyObject): string {
  const h = b64u(JSON.stringify(header));
  const p = b64u(JSON.stringify(payload));
  const sig = createSign('SHA256').update(`${h}.${p}`).sign(key, 'base64url');
  return `${h}.${p}.${sig}`;
}

function makeTestJwk(key: KeyObject, kid: string): Jwk {
  return { ...(key.export({ format: 'jwk' }) as object), alg: 'RS256', use: 'sig', kid };
}

const REAL_JWK = makeTestJwk(publicKey, KID);

function fakeJwksFetch(_googleBase: string): Promise<Jwk[]> {
  return Promise.resolve([REAL_JWK]);
}

const NOW_S = 1_750_000_000; // arbitrary fixed second in the future

function makeValidToken(overrides: Record<string, unknown> = {}, keyOverride?: KeyObject): string {
  const payload = {
    iss: 'https://accounts.google.com',
    aud: 'test-client-id',
    exp: NOW_S + 300,
    iat: NOW_S - 5,
    sub: 'google-uid-123',
    email: 'alice@example.com',
    email_verified: true,
    nonce: 'test-nonce',
    ...overrides,
  };
  return signRS256({ alg: 'RS256', kid: KID, typ: 'JWT' }, payload, keyOverride ?? privateKey);
}

const VALID_DEPS = {
  clientId: 'test-client-id',
  jwksFetch: fakeJwksFetch,
  now: () => NOW_S * 1000, // injected now in ms
  googleBase: 'https://accounts.google.com',
  expectedNonce: 'test-nonce',
};

// ── acceptance case ───────────────────────────────────────────────────────────

describe('verifyIdToken — accept (DES-094)', () => {
  it('returns {email} for a fully valid RS256 id_token', async () => {
    const token = makeValidToken();
    const result = await verifyIdToken(token, VALID_DEPS);
    expect(result).toEqual({ email: 'alice@example.com' });
  });

  it('accepts iss === "accounts.google.com" (without https:// prefix)', async () => {
    const token = makeValidToken({ iss: 'accounts.google.com' });
    const result = await verifyIdToken(token, VALID_DEPS);
    expect(result).toEqual({ email: 'alice@example.com' });
  });
});

// ── rejection cases ───────────────────────────────────────────────────────────

describe('verifyIdToken — reject (DES-094)', () => {
  it('throws AuthError for bad iss', async () => {
    const token = makeValidToken({ iss: 'https://evil.example.com' });
    await expect(verifyIdToken(token, VALID_DEPS)).rejects.toThrow();
  });

  it('throws AuthError for bad aud (not clientId)', async () => {
    const token = makeValidToken({ aud: 'wrong-client-id' });
    await expect(verifyIdToken(token, VALID_DEPS)).rejects.toThrow();
  });

  it('throws AuthError for expired exp (via injected now)', async () => {
    const token = makeValidToken({ exp: NOW_S - 1 }); // expired 1 second ago
    await expect(verifyIdToken(token, VALID_DEPS)).rejects.toThrow();
  });

  it('throws AuthError for bad signature (different RSA key)', async () => {
    const { privateKey: otherPriv } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const token = makeValidToken({}, otherPriv); // signed with a different key
    await expect(verifyIdToken(token, VALID_DEPS)).rejects.toThrow();
  });

  it('throws AuthError for wrong nonce', async () => {
    const token = makeValidToken({ nonce: 'wrong-nonce' });
    await expect(verifyIdToken(token, VALID_DEPS)).rejects.toThrow();
  });

  it('throws AuthError when email_verified === false (critical invariant)', async () => {
    // email_verified:false means the email address was NOT verified by Google
    // Accepting it would let anyone with an unverified alias impersonate an owner
    const token = makeValidToken({ email_verified: false });
    await expect(verifyIdToken(token, VALID_DEPS)).rejects.toThrow();
  });

  it('throws AuthError when email_verified is missing', async () => {
    const token = makeValidToken({ email_verified: undefined });
    await expect(verifyIdToken(token, VALID_DEPS)).rejects.toThrow();
  });

  it('throws AuthError when email claim is missing', async () => {
    const token = makeValidToken({ email: undefined });
    await expect(verifyIdToken(token, VALID_DEPS)).rejects.toThrow();
  });

  it('throws AuthError for a malformed JWT (not 3 segments)', async () => {
    await expect(verifyIdToken('not.a.valid.jwt.at.all', VALID_DEPS)).rejects.toThrow();
  });
});
