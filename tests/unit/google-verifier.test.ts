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

function fakeJwksFetch(_jwksUri: string): Promise<Jwk[]> {
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
  // v18: renamed from googleBase; value is the actual production JWKS URL
  jwksUri: 'https://www.googleapis.com/oauth2/v3/certs',
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

// ── v18 spy: verifyIdToken must pass deps.jwksUri (not deps.googleBase) ───────
//
// RED reason: pre-impl the call site is deps.jwksFetch(deps.googleBase); since
// VALID_DEPS no longer has googleBase, deps.googleBase === undefined → capturedUri
// captured by the spy is undefined, not the injected jwksUri → assertion fails.
// DES-094 v18 rename: after fix the call becomes deps.jwksFetch(deps.jwksUri).

describe('verifyIdToken — jwksUri seam (DES-094 v18)', () => {
  it('passes deps.jwksUri to jwksFetch (not deps.googleBase/undefined)', async () => {
    let capturedUri: string | undefined;
    const spyFetch = (uri: string): Promise<Jwk[]> => {
      capturedUri = uri;
      return fakeJwksFetch(uri);
    };
    const token = makeValidToken();
    const injectedUri = 'https://spy-injected.example.com/certs';
    await verifyIdToken(token, { ...VALID_DEPS, jwksUri: injectedUri, jwksFetch: spyFetch });
    // Pre-impl: impl calls deps.jwksFetch(deps.googleBase) = spyFetch(undefined) → capturedUri = undefined
    // Post-impl: impl calls deps.jwksFetch(deps.jwksUri) = spyFetch(injectedUri) → capturedUri = injectedUri
    expect(capturedUri).toBe(injectedUri);
  });
});

// ── v18 static pin: GOOGLE_TOKEN_URL and GOOGLE_JWKS_URL must be the CORRECT hosts ──
//
// RED reason: auth-service.ts does not yet export GOOGLE_TOKEN_URL / GOOGLE_JWKS_URL /
// GOOGLE_AUTHORIZE_URL → dynamic import gives undefined → assertions fail.
// DES-095 v18: this is the ONLY test tier that catches the fake-double-collapses-hosts
// class (every fake-Google IT/acceptance test serves all paths off one host; a unit
// static-pin of the production constants is the sole guard against the conflation).

describe('Google OAuth production URL constants — static pin (DES-095 v18)', () => {
  it('GOOGLE_AUTHORIZE_URL is accounts.google.com/o/oauth2/v2/auth', async () => {
    const m = await import('../../src/auth/auth-service.js');
    const { GOOGLE_AUTHORIZE_URL } = m as { GOOGLE_AUTHORIZE_URL?: string };
    expect(GOOGLE_AUTHORIZE_URL).toBe('https://accounts.google.com/o/oauth2/v2/auth');
  });

  it('GOOGLE_TOKEN_URL is oauth2.googleapis.com/token (NOT accounts.google.com/token)', async () => {
    const m = await import('../../src/auth/auth-service.js');
    const { GOOGLE_TOKEN_URL } = m as { GOOGLE_TOKEN_URL?: string };
    expect(GOOGLE_TOKEN_URL).toBe('https://oauth2.googleapis.com/token');
  });

  it('GOOGLE_JWKS_URL is www.googleapis.com/oauth2/v3/certs (NOT accounts.google.com/...)', async () => {
    const m = await import('../../src/auth/auth-service.js');
    const { GOOGLE_JWKS_URL } = m as { GOOGLE_JWKS_URL?: string };
    expect(GOOGLE_JWKS_URL).toBe('https://www.googleapis.com/oauth2/v3/certs');
  });
});
