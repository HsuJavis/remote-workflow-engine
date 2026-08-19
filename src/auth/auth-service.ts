// DES-095 (ARCH-059, TASK-086): OAuth route handlers + `resolvePrincipal` discriminated union.
// startAuthorize → 302 to Google; handleGoogleCallback → verify id_token → mint auth-code;
// tokenExchange → verify PKCE S256 → issue engine bearer; resolvePrincipal → union, NEVER throws.
// DES-094/095 v18: 3 distinct Google endpoint URLs (accounts vs oauth2 vs www subdomains).

import { createHash, randomBytes } from 'node:crypto';

/** Google's OAuth 2.0 authorization endpoint (accounts.google.com). DES-095 v18. */
export const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
/** Google's token endpoint (oauth2.googleapis.com). DES-095 v18. */
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
/** Google's JWKS endpoint (www.googleapis.com). DES-094 v18. */
export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
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
  /** @deprecated Use googleAuthorizeUrl/googleTokenUrl/googleJwksUrl. Kept for backward-compat. */
  googleBase?: string;
  /** Override for Google's authorization endpoint (full URL). DES-095 v18. */
  googleAuthorizeUrl?: string;
  /** Override for Google's token endpoint (full URL). DES-095 v18. */
  googleTokenUrl?: string;
  /** Override for Google's JWKS endpoint (full URL). DES-094 v18. */
  googleJwksUrl?: string;
  /** Injectable JWKS fetcher — overrides the default network fetch (tests inject a fake). */
  jwksFetch?: JwksPort;
}

/**
 * Returns true iff uri is a loopback-only http: URI per RFC 8252 §8.3.
 * Accepts http: scheme + hostname ∈ {127.0.0.1, localhost, [::1]}, any port/path.
 * Empty/missing/unparseable/non-http → false (parse in try/catch → false).
 * NOTE: WHATWG URL.hostname serializes IPv6 WITH brackets: new URL('http://[::1]:1/').hostname === '[::1]'.
 * Not merged with net-guard's isLoopbackPeer (socket-peer vs redirect-URL semantics — DES-097).
 */
export function isLoopbackRedirectUri(uri: string): boolean {
  if (!uri) return false;
  try {
    const u = new URL(uri);
    if (u.protocol !== 'http:') return false;
    const h = u.hostname;
    return h === '127.0.0.1' || h === 'localhost' || h === '[::1]';
  } catch {
    return false;
  }
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
  /** POST /register (RFC 7591 DCR — public endpoint, no auth required) */
  register(req: IncomingMessage, res: ServerResponse): Promise<void>;
}

/** Create handlers for the 5 OAuth routes (DES-095). All side effects go through the injected TokenStore. */
export function createAuthRouteHandlers(cfg: AuthConfig, tokenStore: TokenStore): AuthRouteHandlers {
  // DES-094/095 v18: 3 distinct Google endpoint URLs.
  // Priority: specific field > googleBase-derived fallback (backward compat) > production constant.
  const googleAuthorizeUrl = cfg.googleAuthorizeUrl
    ?? (cfg.googleBase ? `${cfg.googleBase}/o/oauth2/v2/auth` : GOOGLE_AUTHORIZE_URL);
  const googleTokenUrl = cfg.googleTokenUrl
    ?? (cfg.googleBase ? `${cfg.googleBase}/token` : GOOGLE_TOKEN_URL);
  const googleJwksUrl = cfg.googleJwksUrl
    ?? (cfg.googleBase ? `${cfg.googleBase}/oauth2/v3/certs` : GOOGLE_JWKS_URL);
  const jwksFetch: JwksPort = cfg.jwksFetch ?? (async (jwksUri: string) => {
    const r = await fetch(jwksUri);
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
      const clientId = url.searchParams.get('client_id') ?? '';
      const codeChallenge = url.searchParams.get('code_challenge') ?? '';
      const codeChallengeMethod = url.searchParams.get('code_challenge_method') ?? '';
      if (codeChallengeMethod !== 'S256') {
        localSendJson(res, 400, { error: 'invalid_request', error_description: 'only code_challenge_method=S256 supported' });
        return;
      }
      // v17 (RFC 7591 DCR): if client_id is a registered DCR client, apply port-ignored binding.
      // RFC 8252 §7.3: scheme + hostname + pathname must match a registered uri (port ignored).
      // Unknown/absent client_id falls through to the existing loopback-only check below.
      const registered = clientId ? tokenStore.getClient(clientId) : null;
      if (registered) {
        let bindingMatch = false;
        try {
          const req_u = new URL(redirectUri);
          for (const regUri of registered.redirectUris) {
            const reg_u = new URL(regUri);
            if (req_u.protocol === reg_u.protocol &&
                req_u.hostname === reg_u.hostname &&
                req_u.pathname === reg_u.pathname) {
              bindingMatch = true;
              break;
            }
          }
        } catch { /* parse failure → no match */ }
        if (!bindingMatch) {
          localSendJson(res, 400, { error: 'invalid_request', error_description: 'redirect_uri does not match registered uri (port-ignored binding)' });
          return;
        }
      } else {
        // HIGH-1 (ARCH-059 inv.4, DES-095 v16): validate redirect_uri is loopback-only BEFORE
        // writing any state row — non-loopback/missing/unparseable → 400, no oauth_state row written.
        if (!isLoopbackRedirectUri(redirectUri)) {
          localSendJson(res, 400, { error: 'invalid_request', error_description: 'redirect_uri must be a loopback http: URI (RFC 8252)' });
          return;
        }
      }
      const state = randomBytes(16).toString('hex');
      const nonce = randomBytes(16).toString('hex');
      // v19 (DES-095): capture the CLIENT's state (RFC 6749 §4.1.2) to echo at final redirect.
      const clientState = url.searchParams.get('state');
      tokenStore.putState({ state, nonce, codeChallenge, redirectUri, clientState });
      // Redirect to Google's authorization endpoint with state + nonce
      const b = effectiveIssuer.replace(/\/$/, '');
      const gUrl = new URL(googleAuthorizeUrl);
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
      const { nonce, codeChallenge, redirectUri, clientState } = stateData;
      const b = effectiveIssuer.replace(/\/$/, '');
      // Exchange Google code for id_token
      let idToken: string;
      try {
        const tokenRes = await fetch(googleTokenUrl, {
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
          jwksUri: googleJwksUrl,
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
        // v19 (DES-095): echo client state (RFC 6749 §4.1.2) + RFC 9207 iss at final redirect.
        if (clientState) u.searchParams.set('state', clientState);
        u.searchParams.set('iss', effectiveIssuer);
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

    async register(req, res) {
      // RFC 7591 DCR — public endpoint, no auth required (DES-095 v17).
      // Parse JSON body; parse failure → 400 invalid_client_metadata.
      let body: Record<string, unknown>;
      try {
        const raw = await new Promise<string>((resolve, reject) => {
          let s = '';
          req.on('data', (c: Buffer) => { s += c.toString(); });
          req.on('end', () => resolve(s));
          req.on('error', reject);
        });
        body = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        localSendJson(res, 400, { error: 'invalid_client_metadata' });
        return;
      }
      // Validate redirect_uris: required, non-empty array, all loopback.
      const redirectUris = body['redirect_uris'];
      if (!Array.isArray(redirectUris) || redirectUris.length === 0 ||
          !redirectUris.every((u) => isLoopbackRedirectUri(String(u)))) {
        localSendJson(res, 400, { error: 'invalid_redirect_uri' });
        return;
      }
      // Clamp metadata (Decision B): accept any grant_types/token_endpoint_auth_method but respond
      // with our fixed public-PKCE values regardless (no client_secret issued).
      // TTL: 30 days (weeks-scale per DES-093 v17 bounding contract).
      const ttlMs = 30 * 24 * 3600_000;
      const { clientId, clientIdIssuedAt } = tokenStore.registerClient({
        redirectUris: redirectUris.map(String),
        ttlMs,
      });
      localSendJson(res, 201, {
        client_id: clientId,
        client_id_issued_at: clientIdIssuedAt,
        redirect_uris: redirectUris.map(String),
        grant_types: ['authorization_code'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      });
    },
  };
}
