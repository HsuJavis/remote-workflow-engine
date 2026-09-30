// A doubled Google OIDC upstream (Google is an external dependency — the engine's own code path is
// real): POST /token reads the form `code` as "<email>|<nonce>" and answers a signed RS256
// id_token for that email; `jwksFetch` serves the matching public key. Plus `dashboardLogin()`,
// which drives the engine's browser login exactly as a browser would (login 302 → callback).
import http from 'node:http';
import { generateKeyPairSync, createSign } from 'node:crypto';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const KID = 'fake-google-k1';
const JWK = { ...(publicKey.export({ format: 'jwk' }) as object), alg: 'RS256', use: 'sig', kid: KID };

function b64u(s: string): string { return Buffer.from(s).toString('base64url'); }
function sign(payload: object): string {
  const h = b64u(JSON.stringify({ alg: 'RS256', kid: KID, typ: 'JWT' }));
  const p = b64u(JSON.stringify(payload));
  return `${h}.${p}.${createSign('SHA256').update(`${h}.${p}`).sign(privateKey, 'base64url')}`;
}

export const fakeJwksFetch = (): Promise<Record<string, unknown>[]> => Promise.resolve([JWK]);

export interface FakeGoogle { tokenUrl: string; close(): Promise<void> }

export async function startFakeGoogle(clientId: string): Promise<FakeGoogle> {
  const srv = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/token') { res.writeHead(404); res.end(); return; }
    let body = '';
    req.on('data', (c: Buffer) => { body += c.toString(); });
    req.on('end', () => {
      const [email, nonce] = (new URLSearchParams(body).get('code') ?? '').split('|');
      const now = Math.floor(Date.now() / 1000);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id_token: sign({ iss: 'https://accounts.google.com', aud: clientId, exp: now + 300, iat: now - 5, sub: `sub-${email}`, email, email_verified: true, nonce }) }));
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  const port = (srv.address() as { port: number }).port;
  return { tokenUrl: `http://127.0.0.1:${port}/token`, close: () => new Promise((r) => srv.close(() => r())) };
}

export interface LoginResult {
  /** `rwe_session=<token>` — ready for a Cookie header. */
  cookie: string;
  /** The full Set-Cookie header the callback answered. */
  setCookie: string;
  /** Where the callback redirected the browser. */
  location: string;
}

/** Drive GET /dashboard/login?next → the Google 302 → GET /oauth/google/callback, as a browser. */
export async function dashboardLogin(base: string, email: string, next?: string): Promise<LoginResult> {
  const q = next !== undefined ? `?next=${encodeURIComponent(next)}` : '';
  const login = await fetch(`${base}/dashboard/login${q}`, { redirect: 'manual' });
  if (login.status !== 302) throw new Error(`login answered ${login.status}: ${await login.text()}`);
  const g = new URL(login.headers.get('location')!);
  // verify-i LOW-1: the login binds its state to this browser with an `rwe_login` cookie — carry it.
  const loginCookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  const cb = await fetch(`${base}/oauth/google/callback?${new URLSearchParams({ state: g.searchParams.get('state')!, code: `${email}|${g.searchParams.get('nonce')}` })}`, { redirect: 'manual', headers: loginCookie ? { Cookie: loginCookie } : {} });
  const setCookie = cb.headers.get('set-cookie') ?? '';
  if (cb.status !== 302 || !setCookie) throw new Error(`callback answered ${cb.status}: ${await cb.text()}`);
  const session = setCookie.split(/,(?=\s*rwe_)/).find((c) => c.trim().startsWith('rwe_session=')) ?? setCookie;
  return { cookie: session.trim().split(';')[0]!, setCookie: session.trim(), location: cb.headers.get('location') ?? '' };
}
