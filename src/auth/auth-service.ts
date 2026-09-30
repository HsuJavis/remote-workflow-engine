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
/** Sliding-window refresh-token TTL (~90 days). DES-095 v20. */
export const REFRESH_TTL_MS = 90 * 24 * 3600_000;
import type { IncomingMessage, ServerResponse } from 'node:http';
import { DEFAULT_DCR_GRANT_TYPES, SESSION_TTL_MS, type TokenStore } from './token-store.js';
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

/** The dashboard browser-session cookie (spec §A). */
export const SESSION_COOKIE = 'rwe_session';

/** Validate a login `next` target (spec §A: no open redirect). Only a same-origin RELATIVE path at
 *  or under `/dashboard` is kept — anything else (absolute/scheme-relative URLs, backslashes,
 *  dot-segments, control characters, other engine paths, the login route itself) collapses to
 *  `/dashboard`. Checked when the login starts AND again when the callback redirects. */
export function safeDashboardNext(raw: string | null | undefined): string {
  const fallback = '/dashboard';
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2048) return fallback;
  // Printable ASCII only (verify-i LOW-2): anything else — whitespace, controls, backslash, and any
  // non-Latin1 character that would make the Location header throw after the session was created.
  if (/[^\x21-\x7e]/.test(raw) || raw.includes('\\')) return fallback;
  const pathEnd = raw.search(/[?#]/);
  const path = pathEnd === -1 ? raw : raw.slice(0, pathEnd);
  if (path !== '/dashboard' && !path.startsWith('/dashboard/')) return fallback;
  if (path.includes('//')) return fallback;
  const segments = path.split('/');
  if (segments.some((seg) => seg === '.' || seg === '..' || /^%2e/i.test(seg) || /%2f|%5c/i.test(seg))) return fallback;
  if (path === '/dashboard/login' || path.startsWith('/dashboard/login/') || path === '/dashboard/logout' || path === '/dashboard/signed-out') return fallback;
  return raw.replace(/#.*$/, '');
}

/** verify-i LOW-1: the cookie binding a dashboard login's `state` to the browser that started it
 *  (double-submit at the callback). Scoped to the callback path, 10 minutes (the state's own TTL). */
export const LOGIN_COOKIE = 'rwe_login';

function loginCookie(state: string, effectiveIssuer: string, maxAgeSec: number): string {
  const secure = effectiveIssuer.startsWith('https:') ? '; Secure' : '';
  return `${LOGIN_COOKIE}=${state}; Path=/oauth/google/callback; Max-Age=${maxAgeSec}; HttpOnly; SameSite=Lax${secure}`;
}

function readCookie(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const i = part.indexOf('=');
    if (i !== -1 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/** verify-i LOW-3: a per-client token bucket for anonymous `GET /dashboard/login` (each call writes
 *  an oauth_state row). Injected clock; the key map is pruned so it cannot grow without bound. */
export class LoginRateLimiter {
  private readonly _buckets = new Map<string, { tokens: number; at: number }>();
  constructor(
    private readonly _capacity = 30,
    private readonly _refillPerMs = 30 / 60_000,
    private readonly _clock: () => number = () => Date.now(),
  ) {}

  take(key: string): boolean {
    const now = this._clock();
    const b = this._buckets.get(key) ?? { tokens: this._capacity, at: now };
    b.tokens = Math.min(this._capacity, b.tokens + (now - b.at) * this._refillPerMs);
    b.at = now;
    if (this._buckets.size > 10_000) {
      for (const [k, v] of this._buckets) if (Math.min(this._capacity, v.tokens + (now - v.at) * this._refillPerMs) >= this._capacity) this._buckets.delete(k);
    }
    if (b.tokens < 1) { this._buckets.set(key, b); return false; }
    b.tokens -= 1;
    this._buckets.set(key, b);
    return true;
  }
}

/** Global cap on live dashboard state rows (verify-i LOW-3) — bounds the table even when many
 *  distinct client keys are used. */
export const MAX_LIVE_DASHBOARD_STATES = 1000;

/** Set-Cookie value for a new/extended session. `Secure` iff the engine's public issuer is https
 *  (an http deployment would otherwise never get the cookie back). */
export function sessionCookie(token: string, effectiveIssuer: string, maxAgeMs: number = SESSION_TTL_MS): string {
  const secure = effectiveIssuer.startsWith('https:') ? '; Secure' : '';
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${Math.floor(maxAgeMs / 1000)}; HttpOnly; SameSite=Lax${secure}`;
}

/** Set-Cookie value that clears the session cookie (logout). */
export function clearSessionCookie(effectiveIssuer: string): string {
  const secure = effectiveIssuer.startsWith('https:') ? '; Secure' : '';
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`;
}

/** The raw session token from a Cookie header, or null. */
export function readSessionCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    if (part.slice(0, i).trim() === SESSION_COOKIE) {
      const v = part.slice(i + 1).trim();
      return /^[0-9a-f]{64}$/.test(v) ? v : null;
    }
  }
  return null;
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
  /** GET /dashboard/login?next=... — the dashboard's browser login (spec §A): a state row marked
   *  `flow:'dashboard'`, then 302 to Google through the SAME client + callback MCP uses. */
  dashboardLogin(req: IncomingMessage, res: ServerResponse, effectiveIssuer: string): void;
  /** GET /oauth/google/callback?state=...&code=... */
  googleCallback(req: IncomingMessage, res: ServerResponse, effectiveIssuer: string): Promise<void>;
  /** POST /token (application/x-www-form-urlencoded) */
  tokenExchange(req: IncomingMessage, res: ServerResponse): Promise<void>;
  /** POST /register (RFC 7591 DCR — public endpoint, no auth required) */
  register(req: IncomingMessage, res: ServerResponse): Promise<void>;
}

/** Create handlers for the 5 OAuth routes (DES-095). All side effects go through the injected TokenStore. */
export function createAuthRouteHandlers(
  cfg: AuthConfig,
  tokenStore: TokenStore,
  /** Called with the verified email on every successful sign-in (both flows) — the server records
   *  it in the known-principals ledger. */
  onSignIn: (email: string) => void = () => {},
): AuthRouteHandlers {
  // DES-094/095 v18: 3 distinct Google endpoint URLs.
  // Priority: specific field > googleBase-derived fallback (backward compat) > production constant.
  const googleAuthorizeUrl = cfg.googleAuthorizeUrl
    ?? (cfg.googleBase ? `${cfg.googleBase}/o/oauth2/v2/auth` : GOOGLE_AUTHORIZE_URL);
  const googleTokenUrl = cfg.googleTokenUrl
    ?? (cfg.googleBase ? `${cfg.googleBase}/token` : GOOGLE_TOKEN_URL);
  const googleJwksUrl = cfg.googleJwksUrl
    ?? (cfg.googleBase ? `${cfg.googleBase}/oauth2/v3/certs` : GOOGLE_JWKS_URL);
  const loginLimiter = new LoginRateLimiter();
  const jwksFetch: JwksPort = cfg.jwksFetch ?? (async (jwksUri: string) => {
    const r = await fetch(jwksUri);
    const j = await r.json() as { keys?: Record<string, unknown>[] };
    return j.keys ?? [];
  });

  function redirectToGoogle(res: ServerResponse, effectiveIssuer: string, state: string, nonce: string): void {
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
  }

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
      // v20a (DES-095): capture the CLIENT's requested scope to thread through to /token.
      const scope = url.searchParams.get('scope');
      tokenStore.putState({ state, nonce, codeChallenge, redirectUri, clientState, scope });
      // Redirect to Google's authorization endpoint with state + nonce
      redirectToGoogle(res, effectiveIssuer, state, nonce);
    },

    dashboardLogin(req, res, effectiveIssuer) {
      // verify-i LOW-3: each call writes a state row — rate-limited per client (Cloudflare's
      // CF-Connecting-IP behind the tunnel, else the socket peer) and globally capped.
      const cf = req.headers['cf-connecting-ip'];
      const key = typeof cf === 'string' && cf ? cf : (req.socket?.remoteAddress ?? 'unknown');
      if (!loginLimiter.take(key) || tokenStore.countLiveStates('dashboard') >= MAX_LIVE_DASHBOARD_STATES) {
        localSendJson(res, 429, { error: 'too_many_requests', hint: 'too many sign-in attempts; wait a minute and try again' }, { 'Retry-After': '60' });
        return;
      }
      const url = new URL(req.url ?? '/', 'http://x');
      // The validated `next` rides the state row's redirect_uri column; no PKCE (the engine itself
      // is the client here and the code never leaves the engine), no DCR client.
      const next = safeDashboardNext(url.searchParams.get('next'));
      const state = randomBytes(16).toString('hex');
      const nonce = randomBytes(16).toString('hex');
      tokenStore.putState({ state, nonce, codeChallenge: '', redirectUri: next, flow: 'dashboard' });
      res.setHeader('Set-Cookie', loginCookie(state, effectiveIssuer, 600));
      redirectToGoogle(res, effectiveIssuer, state, nonce);
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
      const { nonce, codeChallenge, redirectUri, clientState, scope } = stateData;
      // verify-i LOW-1: a dashboard login must be completed by the browser that started it — its
      // `rwe_login` cookie must name this state (login CSRF). The MCP flow is unchanged (PKCE).
      if (stateData.flow === 'dashboard' && readCookie(req.headers.cookie, LOGIN_COOKIE) !== state) {
        localSendJson(res, 400, { error: 'invalid_state', hint: 'this sign-in was started in a different browser (or its cookie expired); start again at /dashboard/login' }, { 'Set-Cookie': loginCookie('', effectiveIssuer, 0) });
        return;
      }
      const b = effectiveIssuer.replace(/\/$/, '');
      // Exchange Google code for id_token. Distinguish network failure (fetch() itself threw) vs
      // a non-2xx from Google (read its `error` field — never `error_description`, which is
      // unverified to be free of request-derived values, and never the code/secret we sent) vs
      // a 2xx response with no id_token — each gets its own operator-facing reason/hint and a
      // `[auth.google_token]` log line (fix/2026-09-29-google-token-log; was one undifferentiated
      // 502 with no log line at all).
      let idToken: string;
      try {
        let tokenRes: Response;
        try {
          tokenRes = await fetch(googleTokenUrl, {
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
        } catch {
          // eslint-disable-next-line no-console
          console.warn('[auth.google_token]', { outcome: 'network_error' });
          localSendJson(res, 502, {
            error: 'google_token_error',
            reason: 'network_error',
            hint: 'the engine could not reach Google\'s token endpoint - check outbound network/DNS connectivity',
          });
          return;
        }
        const tokenBody = await tokenRes.json().catch(() => ({} as Record<string, unknown>)) as
          { id_token?: string; error?: string };
        if (!tokenRes.ok) {
          const googleError = typeof tokenBody.error === 'string' ? tokenBody.error : 'unknown_error';
          // eslint-disable-next-line no-console
          console.warn('[auth.google_token]', { outcome: 'google_error', status: tokenRes.status, error: googleError });
          const hint = googleError === 'invalid_client'
            ? 'the engine\'s Google client secret is rejected by Google - check auth.googleClientSecret / RWE_SECRET_GOOGLE_CLIENT_SECRET; new secrets can take minutes to hours to become active'
            : googleError === 'invalid_grant'
            ? 'the authorization code was invalid, expired, or already used - retry the sign-in flow'
            : 'Google rejected the token exchange - see the engine log for the error code';
          localSendJson(res, 502, { error: 'google_token_error', reason: 'google_rejected', google_error: googleError, hint });
          return;
        }
        idToken = tokenBody.id_token ?? '';
        if (!idToken) {
          // eslint-disable-next-line no-console
          console.warn('[auth.google_token]', { outcome: 'no_id_token', status: tokenRes.status });
          localSendJson(res, 502, {
            error: 'google_token_error',
            reason: 'no_id_token',
            hint: 'Google returned a token response without an id_token - verify the requested scope includes "openid"',
          });
          return;
        }
      } catch {
        // Defensive catch-all for anything unforeseen above (e.g. a thrown non-Error value).
        // eslint-disable-next-line no-console
        console.warn('[auth.google_token]', { outcome: 'unexpected_error' });
        localSendJson(res, 502, {
          error: 'google_token_error',
          reason: 'unexpected_error',
          hint: 'an unexpected error occurred during the Google token exchange - see the engine log',
        });
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
      onSignIn(email);
      if (stateData.flow === 'dashboard') {
        // Spec §A: a browser session, never an auth code or bearer. `next` was validated when the
        // login started and is re-validated here (defence in depth — the row is ours, but cheap).
        // verify-i LOW-2: the Location value is computed (and validated) BEFORE the session exists.
        const location = safeDashboardNext(redirectUri);
        const { token } = tokenStore.createSession(email);
        res.writeHead(302, {
          'Location': location,
          'Set-Cookie': [sessionCookie(token, effectiveIssuer), loginCookie('', effectiveIssuer, 0)],
          'Cache-Control': 'no-store',
        });
        res.end();
        return;
      }
      // v20a: thread client-requested scope through to auth-code (for /token to issue refresh_token).
      const authCode = tokenStore.mintAuthCode(email, codeChallenge, redirectUri, scope);
      // Build the client callback URL
      let callbackUrl: string;
      try {
        const u = new URL(redirectUri);
        u.searchParams.set('code', authCode);
        // v19 (DES-095): echo client state (RFC 6749 §4.1.2) + RFC 9207 iss at final redirect.
        if (clientState) u.searchParams.set('state', clientState);
        u.searchParams.set('iss', effectiveIssuer);
        callbackUrl = u.toString();
      } catch {
        const sep = redirectUri.includes('?') ? '&' : '?';
        callbackUrl = `${redirectUri}${sep}code=${encodeURIComponent(authCode)}`;
      }
      // v20b (DES-095): return 200 HTML success page instead of 302 redirect.
      // Page auto-forwards via meta-refresh; also shows a copyable URL for headless use.
      const metaUrl = callbackUrl.replace(/&/g, '&amp;');
      const html = `<!DOCTYPE html><html lang="en"><head>\n<meta charset="utf-8">\n<meta http-equiv="refresh" content="0;url=${metaUrl}">\n<title>Authorization Complete</title>\n</head><body>\n<p>Authorization complete. Redirecting&#8230;</p>\n<p id="callback-url">${callbackUrl}</p>\n<button onclick="navigator.clipboard&&navigator.clipboard.writeText(document.getElementById('callback-url').textContent)">Copy URL</button>\n<script>try{window.location.replace(document.getElementById('callback-url').textContent)}catch(e){}</script>\n</body></html>`;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
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

      // v20a (DES-095): grant_type=refresh_token branch (no PKCE, rotating single-use).
      if (grantType === 'refresh_token') {
        const refreshToken = params.get('refresh_token') ?? '';
        const clientId = params.get('client_id') ?? null;
        const row = tokenStore.consumeRefresh(refreshToken);
        if (!row) {
          localSendJson(res, 400, { error: 'invalid_grant' });
          return;
        }
        // Decision C: client_id binding — enforce if stored, skip if null.
        if (row.clientId !== null && row.clientId !== clientId) {
          localSendJson(res, 400, { error: 'invalid_grant' });
          return;
        }
        const bearerTtlMs = 7 * 24 * 3600_000;
        const { token: newBearer } = tokenStore.issue(row.principal, bearerTtlMs);
        // `issue()` stamps `expiresAt = <its injected clock> + bearerTtlMs`, so the lifetime IS
        // `bearerTtlMs` — re-deriving it by subtracting the WALL clock from that expiry mixed two
        // different clocks (the store's is injected) and could report one second short.
        const expiresIn = Math.floor(bearerTtlMs / 1000);
        const { token: newRefresh } = tokenStore.issueRefresh(row.principal, row.scope, row.clientId, REFRESH_TTL_MS);
        localSendJson(res, 200, {
          access_token: newBearer,
          token_type: 'Bearer',
          expires_in: expiresIn,
          scope: row.scope ?? '',
          refresh_token: newRefresh,
        });
        return;
      }

      if (grantType !== 'authorization_code') {
        localSendJson(res, 400, { error: 'unsupported_grant_type' });
        return;
      }
      const code = params.get('code') ?? '';
      const codeVerifier = params.get('code_verifier') ?? '';
      const redirectUri = params.get('redirect_uri') ?? '';
      const clientId = params.get('client_id') ?? null;
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
      const bearerTtlMs = 7 * 24 * 3600_000; // 1 week
      const { token } = tokenStore.issue(codeData.principal, bearerTtlMs);
      // Same as the refresh arm above: the lifetime is `bearerTtlMs`, not a wall-clock subtraction
      // against an expiry the store stamped with its own injected clock.
      const expiresIn = Math.floor(bearerTtlMs / 1000);
      // v20a: scope ALWAYS echoed (stored null → ''); refresh_token issued iff offline_access
      // granted OR (issue #86) the DCR-registered client declared grant_types incl.
      // refresh_token — that's how a real MCP client that never asks for offline_access (its
      // resolved scope is "" unless it reads PRM scopes_supported / the 401 challenge scope)
      // still gets a refresh token instead of hard-expiring after one bearer TTL.
      // The echoed `scope` stays honest to what was actually requested either way — a
      // refresh-token grant here does NOT synthesize offline_access into the response.
      const scope = codeData.scope ?? '';
      const responseBody: Record<string, unknown> = {
        access_token: token,
        token_type: 'Bearer',
        expires_in: expiresIn,
        scope,
      };
      const registeredClient = clientId ? tokenStore.getClient(clientId) : null;
      const clientDeclaresRefresh = registeredClient?.grantTypes.includes('refresh_token') ?? false;
      if (scope.split(' ').includes('offline_access') || clientDeclaresRefresh) {
        const { token: refreshToken } = tokenStore.issueRefresh(codeData.principal, codeData.scope, clientId, REFRESH_TTL_MS);
        responseBody.refresh_token = refreshToken;
      }
      localSendJson(res, 200, responseBody);
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
      // issue #86: persist the clamped grant_types (always includes refresh_token) so /token's
      // authorization_code branch can issue a refresh token to this client even when the
      // client's requested scope omits offline_access.
      // TTL: 30 days (weeks-scale per DES-093 v17 bounding contract).
      const ttlMs = 30 * 24 * 3600_000;
      const grantTypes = DEFAULT_DCR_GRANT_TYPES;
      const { clientId, clientIdIssuedAt } = tokenStore.registerClient({
        redirectUris: redirectUris.map(String),
        ttlMs,
        grantTypes,
      });
      localSendJson(res, 201, {
        client_id: clientId,
        client_id_issued_at: clientIdIssuedAt,
        redirect_uris: redirectUris.map(String),
        grant_types: grantTypes,
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      });
    },
  };
}
