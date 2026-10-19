// DES-094 (ARCH-059, TASK-085): Google id_token RS256 verifier — injected JWKS+clock+base.
// Zero network in the module: all external calls go through injected deps.

import { createPublicKey, createVerify } from 'node:crypto';
import type { JsonWebKey } from 'node:crypto';

export type Jwk = Record<string, unknown>;
export type JwksPort = (jwksUri: string) => Promise<Jwk[]>;

export interface VerifyIdTokenDeps {
  clientId: string;
  jwksFetch: JwksPort;
  /** Returns current time in milliseconds (the only time read — seam). */
  now: () => number;
  /** Full JWKS URL (e.g. https://www.googleapis.com/oauth2/v3/certs). DES-094 v18 rename. */
  jwksUri: string;
  expectedNonce: string;
}

export class AuthError extends Error {
  constructor(reason: string) {
    super(`id_token verification failed: ${reason}`);
    this.name = 'AuthError';
  }
}

/** Valid Google issuer values per the OpenID Connect discovery spec. */
const VALID_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);

function b64uDecode(s: string): Buffer {
  return Buffer.from(s, 'base64url');
}

/** Verify a Google RS256 id_token.  Returns {email} on success; throws AuthError on any violation.
 *  Verification order: iss → aud → exp → signature → nonce → email_verified → email. */
export async function verifyIdToken(
  idToken: string,
  deps: VerifyIdTokenDeps
): Promise<{ email: string }> {
  // 1. Parse — exactly 3 dot-separated segments.
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new AuthError('malformed JWT: not 3 segments');

  const [headerB64, payloadB64, sigB64] = parts;

  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(b64uDecode(headerB64).toString('utf8'));
    payload = JSON.parse(b64uDecode(payloadB64).toString('utf8'));
  } catch {
    throw new AuthError('malformed JWT: cannot decode header/payload');
  }

  // 2. iss check.
  if (typeof payload['iss'] !== 'string' || !VALID_ISSUERS.has(payload['iss'])) {
    throw new AuthError(`bad iss: ${String(payload['iss'])}`);
  }

  // 3. aud check.
  if (payload['aud'] !== deps.clientId) {
    throw new AuthError(`bad aud: ${String(payload['aud'])}`);
  }

  // 4. exp check (exp is in seconds; injected now() returns ms).
  const exp = payload['exp'];
  if (typeof exp !== 'number' || exp * 1000 <= deps.now()) {
    throw new AuthError('token expired or missing exp');
  }

  // 5. Signature verification via injected jwksFetch.
  if (typeof header['alg'] !== 'string' || header['alg'] !== 'RS256') {
    throw new AuthError(`unsupported alg: ${String(header['alg'])}`);
  }
  const kid = header['kid'];
  const jwks = await deps.jwksFetch(deps.jwksUri);
  const jwk = jwks.find((k) => !kid || k['kid'] === kid);
  if (!jwk) throw new AuthError(`no matching JWK for kid=${String(kid)}`);

  try {
    const pubKey = createPublicKey({ key: jwk as JsonWebKey, format: 'jwk' });
    const verifier = createVerify('SHA256');
    verifier.update(`${headerB64}.${payloadB64}`);
    const valid = verifier.verify(pubKey, sigB64, 'base64url');
    if (!valid) throw new AuthError('signature invalid');
  } catch (err) {
    if (err instanceof AuthError) throw err;
    throw new AuthError(`signature verification error: ${String(err)}`);
  }

  // 6. Nonce check.
  if (payload['nonce'] !== deps.expectedNonce) {
    throw new AuthError(`nonce mismatch`);
  }

  // 7. email_verified must be boolean true (strictly) before adopting email.
  if (payload['email_verified'] !== true) {
    throw new AuthError('email_verified is not true');
  }

  // 8. email must be present.
  const email = payload['email'];
  if (typeof email !== 'string' || email.length === 0) {
    throw new AuthError('email claim missing or empty');
  }

  return { email };
}
