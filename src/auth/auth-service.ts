// DES-095 (ARCH-059, TASK-086): OAuth route handlers + `resolvePrincipal` discriminated union.
// startAuthorize → 302 to Google; handleGoogleCallback → verify id_token → mint auth-code;
// tokenExchange → verify PKCE S256 → issue engine bearer; resolvePrincipal → union, NEVER throws.

import { createHash, randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { TokenStore } from './token-store.js';
import { verifyIdToken, type JwksPort } from './google-verifier.js';
import { buildProtectedResourceMetadata, buildAuthServerMetadata } from './oauth-metadata.js';

export interface AuthConfig {
  enabled: boolean;
  /** Base URL of this engine acting as its own OAuth AS (e.g. "http://host:port"). */
  issuer: string;
  googleClientId: string;
  googleClientSecret: string;
  /** Override for Google's base URL — used in tests to point at a fake Google server. */
  googleBase?: string;
  /** Injectable JWKS fetcher — overrides the default network fetch (tests inject a fake). */
  jwksFetch?: JwksPort;
}

export type PrincipalResult =
  | { principal: string }
  | { status: 401; wwwAuthenticate: string };

/**
 * Resolve principal from request Authorization header. Returns a discriminated union —
 * NEVER throws, even on malformed inputs. Uniform 401 on any failure (C-2: no wire
 * distinction between expired/unknown/malformed). Internal debug log `auth.resolve: {outcome}`.
 */
export async function resolvePrincipal(
  req: Pick<IncomingMessage, 'headers'>,
  tokenStore: Pick<TokenStore, 'verifyByHash'>,
  wwwChallenge = 'Bearer',
): Promise<PrincipalResult> {
  try {
    const auth = req.headers['authorization'];
    if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) {
      // eslint-disable-next-line no-console
      console.debug('[auth.resolve]', { outcome: 'no-bearer' });
      return { status: 401, wwwAuthenticate: wwwChallenge };
    }
    const rawToken = auth.slice(7); // strip 'Bearer '
    const principal = tokenStore.verifyByHash(rawToken);
    if (!principal) {
      // eslint-disable-next-line no-console
      console.debug('[auth.resolve]', { outcome: 'invalid-token' });
      return { status: 401, wwwAuthenticate: wwwChallenge };
    }
    return { principal };
  } catch {
    return { status: 401, wwwAuthenticate: wwwChallenge };
  }
}

/** Parse application/x-www-form-urlencoded body from a request stream. */
function readFormBody(req: IncomingMessage): Promise<URLSearchParams> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => { resolve(new URLSearchParams(body)); });
    req.on('error', reject);
  });
}

function localSendJson(res: ServerResponse, status: number, body: unknown, extra?: Record<string, string>): void {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', ...extra });
  res.end(json);
}

export interface AuthRouteHandlers {
  /** GET /.well-known/oauth-protected-resource */
  wellKnownProtectedResource(res: ServerResponse, effectiveIssuer: string): void;
  /** GET /.well-known/oauth-authorization-server */
  wellKnownAuthServer(res: ServerResponse, effectiveIssuer: string): void;
  /** GET /authorize?response_type=code&client_id=...&redirect_uri=...&code_challenge=...&code_challenge_method=S256 */
  authorize(req: IncomingMessage, res: ServerResponse, effectiveIssuer: string): void;
  /** GET /oauth/google/callback?state=...&code=... */
  googleCallback(req: IncomingMessage, res: ServerResponse, effectiveIssuer: string): Promise<void>;
  /** POST /token (application/x-www-form-urlencoded) */
  tokenExchange(req: IncomingMessage, res: ServerResponse): Promise<void>;
}

/** Create handlers for the 5 OAuth routes (DES-095). All side effects go through the injected TokenStore. */
export function createAuthRouteHandlers(cfg: AuthConfig, tokenStore: TokenStore): AuthRouteHandlers {
  const googleBase = cfg.googleBase ?? 'https://accounts.google.com';
  const jwksFetch: JwksPort = cfg.jwksFetch ?? (async (base: string) => {
    const r = await fetch(`${base}/oauth2/v3/certs`);
    const j = await r.json() as { keys?: Record<string, unknown>[] };
    return j.keys ?? [];
  });

  return {
    wellKnownProtectedResource(res, effectiveIssuer) {
      localSendJson(res, 200, buildProtectedResourceMetadata({ issuer: effectiveIssuer }));
    },

    wellKnownAuthServer(res, effectiveIssuer) {
      localSendJson(res, 200, buildAuthServerMetadata({ issuer: effectiveIssuer }));
    },

    authorize(req, res, effectiveIssuer) {
      const url = new URL(req.url ?? '/', 'http://x');
      const redirectUri = url.searchParams.get('redirect_uri') ?? '';
      const codeChallenge = url.searchParams.get('code_challenge') ?? '';
      const codeChallengeMethod = url.searchParams.get('code_challenge_method') ?? '';
      if (codeChallengeMethod !== 'S256') {
        localSendJson(res, 400, { error: 'invalid_request', error_description: 'only code_challenge_method=S256 supported' });
        return;
      }
      const state = randomBytes(16).toString('hex');
      const nonce = randomBytes(16).toString('hex');
      tokenStore.putState({ state, nonce, codeChallenge, redirectUri });
      // Redirect to Google's authorization endpoint with state + nonce
      const b = effectiveIssuer.replace(/\/$/, '');
      const gUrl = new URL(`${googleBase}/o/oauth2/v2/auth`);
      gUrl.searchParams.set('response_type', 'code');
      gUrl.searchParams.set('client_id', cfg.googleClientId);
      gUrl.searchParams.set('redirect_uri', `${b}/oauth/google/callback`);
      gUrl.searchParams.set('scope', 'openid email');
      gUrl.searchParams.set('state', state);
      gUrl.searchParams.set('nonce', nonce);
      res.writeHead(302, { 'Location': gUrl.toString() });
      res.end();
    },

    async googleCallback(req, res, effectiveIssuer) {
      const url = new URL(req.url ?? '/', 'http://x');
      const state = url.searchParams.get('state') ?? '';
      const googleCode = url.searchParams.get('code') ?? '';
      const stateData = tokenStore.consumeState(state);
      if (!stateData) {
        localSendJson(res, 400, { error: 'invalid_state' });
        return;
      }
      const { nonce, codeChallenge, redirectUri } = stateData;
      const b = effectiveIssuer.replace(/\/$/, '');
      // Exchange Google code for id_token
      let idToken: string;
      try {
        const tokenRes = await fetch(`${googleBase}/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code: googleCode,
            client_id: cfg.googleClientId,
            client_secret: cfg.googleClientSecret,
            redirect_uri: `${b}/oauth/google/callback`,
            grant_type: 'authorization_code',
          }).toString(),
        });
        const tokenBody = await tokenRes.json() as { id_token?: string };
        idToken = tokenBody.id_token ?? '';
        if (!idToken) throw new Error('no id_token in Google response');
      } catch {
        localSendJson(res, 502, { error: 'google_token_error' });
        return;
      }
      // Verify id_token (DES-094: email_verified===true required before adopting email)
      let email: string;
      try {
        const verified = await verifyIdToken(idToken, {
          clientId: cfg.googleClientId,
          jwksFetch,
          now: () => Date.now(),
          googleBase,
          expectedNonce: nonce,
        });
        email = verified.email;
      } catch {
        localSendJson(res, 401, { error: 'invalid_id_token' });
        return;
      }
      // Mint engine auth-code and redirect to client's redirect_uri
      const authCode = tokenStore.mintAuthCode(email, codeChallenge, redirectUri);
      // Build the redirect Location (redirectUri may be relative or absolute)
      let location: string;
      try {
        const u = new URL(redirectUri);
        u.searchParams.set('code', authCode);
        location = u.toString();
      } catch {
        const sep = redirectUri.includes('?') ? '&' : '?';
        location = `${redirectUri}${sep}code=${encodeURIComponent(authCode)}`;
      }
      res.writeHead(302, { 'Location': location });
      res.end();
    },

    async tokenExchange(req, res) {
      let params: URLSearchParams;
      try {
        params = await readFormBody(req);
      } catch {
        localSendJson(res, 400, { error: 'invalid_request' });
        return;
      }
      const grantType = params.get('grant_type') ?? '';
      if (grantType !== 'authorization_code') {
        localSendJson(res, 400, { error: 'unsupported_grant_type' });
        return;
      }
      const code = params.get('code') ?? '';
      const codeVerifier = params.get('code_verifier') ?? '';
      const redirectUri = params.get('redirect_uri') ?? '';
      // Consume auth code (single-use, atomic — TokenStore.consumeAuthCode)
      const codeData = tokenStore.consumeAuthCode(code);
      if (!codeData) {
        localSendJson(res, 400, { error: 'invalid_grant' });
        return;
      }
      // Verify PKCE S256: sha256(code_verifier) base64url must equal stored challenge
      const computedChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
      if (computedChallenge !== codeData.codeChallenge) {
        localSendJson(res, 400, { error: 'invalid_grant', error_description: 'PKCE verification failed' });
        return;
      }
      // Verify redirect_uri matches stored value (if provided)
      if (redirectUri && redirectUri !== codeData.redirectUri) {
        localSendJson(res, 400, { error: 'invalid_grant', error_description: 'redirect_uri mismatch' });
        return;
      }
      // Issue bearer token (weeks-scale TTL per DES-095)
      const ttlMs = 7 * 24 * 3600_000; // 1 week
      const { token, expiresAt } = tokenStore.issue(codeData.principal, ttlMs);
      const expiresIn = Math.floor((expiresAt - Date.now()) / 1000);
      localSendJson(res, 200, {
        access_token: token,
        token_type: 'Bearer',
        expires_in: expiresIn,
      });
    },
  };
}
