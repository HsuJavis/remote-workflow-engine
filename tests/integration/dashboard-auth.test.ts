// Dashboard auth spec §A (2026-09-30): Google login for the dashboard, browser sessions, the gate
// on /dashboard* and /api/*, CSRF on state-changing dashboard calls, and the admin role endpoints
// (§A2) — all through a real auth-enabled createServer() on a LOOPBACK bind (so the D-BIND
// exemption is off and every credential is really checked). Google is the one doubled dependency
// (tests/helpers/fake-google.ts); the callback, id_token verification, token store and gate are real.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import { createServer, type Server } from '../../src/server.js';
import { TokenStore } from '../../src/auth/token-store.js';
import { startFakeGoogle, fakeJwksFetch, dashboardLogin, type FakeGoogle } from '../helpers/fake-google.js';

const CID = 'dash-auth-cid';
const ROOT = 'root@example.test';
const ALICE = 'alice@example.test';
const BOB = 'bob@example.test';

let google: FakeGoogle;
let server: Server;
let tmpDir: string;
let base: string;

function authDb(): Database.Database { return new Database(join(tmpDir, 'auth-tokens.db')); }
function count(table: string): number {
  const db = authDb();
  try { return (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n; } finally { db.close(); }
}
function mintBearer(email: string): string {
  const db = authDb();
  try { return new TokenStore(db, { clock: () => Date.now(), csprng: (n) => randomBytes(n) }).issue(email, 3600_000).token; } finally { db.close(); }
}
async function mcp(name: string, args: Record<string, unknown>, bearer: string): Promise<Record<string, any>> {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}');
}
const codeOf = (r: Record<string, any>) => r['code'] ?? r['error']?.code;

beforeAll(async () => {
  google = await startFakeGoogle(CID);
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-dash-auth-'));
  server = await createServer({
    port: 0,
    bind: '127.0.0.1',
    workRoot: tmpDir,
    auth: { enabled: true, issuer: 'http://127.0.0.1:0', googleClientId: CID, googleClientSecret: 'cs', googleAuthorizeUrl: 'http://127.0.0.1:9/auth', googleTokenUrl: google.tokenUrl, jwksFetch: fakeJwksFetch },
    // BOB is a plain 'user' by config (an UNLISTED principal is 'none' = pending approval since
    // 2026-09-30; tests/integration/pending-approval.test.ts covers that).
    principals: { [ROOT]: { role: 'admin' }, [ALICE]: { role: 'author' }, [BOB]: { role: 'user' } },
  } as never);
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(async () => {
  await server?.close();
  await google?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('dashboard login flow', () => {
  it('an anonymous GET /dashboard/... is redirected to /dashboard/login carrying next', async () => {
    const r = await fetch(`${base}/dashboard/workflow/x`, { redirect: 'manual' });
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe('/dashboard/login?next=%2Fdashboard%2Fworkflow%2Fx');
  });

  it('GET /dashboard/login 302s to Google with the engine client id and the shared callback', async () => {
    const r = await fetch(`${base}/dashboard/login`, { redirect: 'manual' });
    expect(r.status).toBe(302);
    const g = new URL(r.headers.get('location')!);
    expect(g.origin + g.pathname).toBe('http://127.0.0.1:9/auth');
    expect(g.searchParams.get('client_id')).toBe(CID);
    expect(g.searchParams.get('redirect_uri')).toBe(`${base}/oauth/google/callback`);
    expect(g.searchParams.get('scope')).toBe('openid email');
    expect(g.searchParams.get('state')).toMatch(/^[0-9a-f]{32}$/);
  });

  it('the callback creates a session cookie and redirects to next — no DCR client, no bearer, no auth code', async () => {
    const before = { clients: count('registered_clients'), bearers: count('bearer_tokens'), codes: count('auth_codes') };
    const r = await dashboardLogin(base, ALICE, '/dashboard/workflow/demo');
    expect(r.location).toBe('/dashboard/workflow/demo');
    expect(r.cookie).toMatch(/^rwe_session=[0-9a-f]{64}$/);
    expect(r.setCookie).toMatch(/HttpOnly/i);
    expect(r.setCookie).toMatch(/SameSite=Lax/i);
    expect(r.setCookie).toMatch(/Path=\//);
    expect(r.setCookie).toMatch(/Max-Age=604800/);
    expect(r.setCookie).not.toMatch(/Secure/i); // http issuer: a Secure cookie would never be sent back
    expect({ clients: count('registered_clients'), bearers: count('bearer_tokens'), codes: count('auth_codes') }).toEqual(before);
    const page = await fetch(`${base}/dashboard`, { headers: { Cookie: r.cookie }, redirect: 'manual' });
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain(ALICE);
    expect(html).toContain('"role":"author"');
  });

  it.each([
    ['//evil.example/x'], ['https://evil.example/'], ['/\\evil.example'], ['/api/runs'], ['dashboard'], ['/dashboard/../api/runs'], ['/dashboardx'], ['/dashboard/login'],
  ])('next=%s is not followed (no open redirect) — the login lands on /dashboard', async (next) => {
    const r = await dashboardLogin(base, ALICE, next);
    expect(r.location).toBe('/dashboard');
  });

  it('a next with a query string under /dashboard is kept', async () => {
    const r = await dashboardLogin(base, ALICE, '/dashboard/abc?tab=x');
    expect(r.location).toBe('/dashboard/abc?tab=x');
  });

  it('the MCP /authorize flow through the SAME callback is unchanged (200 HTML carrying the client redirect, no cookie)', async () => {
    const auth = await fetch(`${base}/authorize?${new URLSearchParams({ response_type: 'code', redirect_uri: 'http://127.0.0.1:5999/cb', code_challenge: 'x'.repeat(43), code_challenge_method: 'S256', state: 'cs' })}`, { redirect: 'manual' });
    const g = new URL(auth.headers.get('location')!);
    const cb = await fetch(`${base}/oauth/google/callback?${new URLSearchParams({ state: g.searchParams.get('state')!, code: `${ALICE}|${g.searchParams.get('nonce')}` })}`, { redirect: 'manual' });
    expect(cb.status).toBe(200);
    expect(cb.headers.get('set-cookie')).toBeNull();
    expect(await cb.text()).toContain('http://127.0.0.1:5999/cb?code=');
  });
});

describe('the gate', () => {
  it('/api/* without credentials is 401 JSON; with a session or a bearer it is served', async () => {
    const anon = await fetch(`${base}/api/runs`);
    expect(anon.status).toBe(401);
    expect(await anon.json()).toMatchObject({ error: 'unauthorized' });
    for (const p of ['/api/home', '/api/system', '/api/models', '/api/workflows', '/api/issues', '/api/workflows/x/describe', '/api/runs/x', '/api/principals']) {
      expect((await fetch(`${base}${p}`)).status, p).toBe(401);
    }
    const { cookie } = await dashboardLogin(base, BOB);
    expect((await fetch(`${base}/api/runs`, { headers: { Cookie: cookie } })).status).toBe(200);
    expect((await fetch(`${base}/api/runs`, { headers: { Authorization: `Bearer ${mintBearer(BOB)}` } })).status).toBe(200);
    expect((await fetch(`${base}/api/runs`, { headers: { Cookie: 'rwe_session=' + 'a'.repeat(64) } })).status).toBe(401);
  });

  it('the liveness probes /api/version and /api/status, and the static assets, stay public', async () => {
    expect((await fetch(`${base}/api/version`)).status).toBe(200);
    expect((await fetch(`${base}/api/status`)).status).toBe(200);
    expect((await fetch(`${base}/static/dashboard/dashboard.css`)).status).toBe(200);
  });
});

describe('logout and CSRF', () => {
  it('POST /dashboard/logout needs a same-origin Origin (or X-Requested-With); it then deletes the session and clears the cookie', async () => {
    const { cookie } = await dashboardLogin(base, BOB);
    const noOrigin = await fetch(`${base}/dashboard/logout`, { method: 'POST', headers: { Cookie: cookie }, redirect: 'manual' });
    expect(noOrigin.status).toBe(403);
    expect((await fetch(`${base}/api/runs`, { headers: { Cookie: cookie } })).status).toBe(200);
    const foreign = await fetch(`${base}/dashboard/logout`, { method: 'POST', headers: { Cookie: cookie, Origin: 'http://evil.example' }, redirect: 'manual' });
    expect(foreign.status).toBe(403);
    const ok = await fetch(`${base}/dashboard/logout`, { method: 'POST', headers: { Cookie: cookie, Origin: base }, redirect: 'manual' });
    expect(ok.status).toBe(303);
    expect(ok.headers.get('location')).toBe('/dashboard/signed-out');
    expect(ok.headers.get('set-cookie')).toMatch(/^rwe_session=;.*Max-Age=0/);
    expect((await fetch(`${base}/api/runs`, { headers: { Cookie: cookie } })).status).toBe(401);
    const out = await fetch(`${base}/dashboard/signed-out`, { redirect: 'manual' });
    expect(out.status).toBe(200);
    expect(await out.text()).toContain('/dashboard/login');
  });
});

describe('role administration over HTTP (same backend as principal_set_role)', () => {
  it('a non-admin session is refused 403 on the principals endpoints', async () => {
    const { cookie } = await dashboardLogin(base, ALICE);
    expect((await fetch(`${base}/api/principals`, { headers: { Cookie: cookie } })).status).toBe(403);
    const r = await fetch(`${base}/api/principals/role`, { method: 'POST', headers: { Cookie: cookie, 'X-Requested-With': 'rwe-dashboard', 'Content-Type': 'application/json' }, body: JSON.stringify({ id: BOB, role: 'admin' }) });
    expect(r.status).toBe(403);
    expect(await r.json()).toMatchObject({ code: 'FORBIDDEN_ROLE' });
  });

  it('an admin change through the dashboard is effective on the target\'s very next MCP call', async () => {
    const { cookie } = await dashboardLogin(base, ROOT);
    const bobBearer = mintBearer(BOB);
    expect(codeOf(await mcp('principals_list', {}, bobBearer))).toBe('FORBIDDEN_ROLE');
    const noCsrf = await fetch(`${base}/api/principals/role`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: BOB, role: 'admin' }) });
    expect(noCsrf.status).toBe(403);
    const set = await fetch(`${base}/api/principals/role`, { method: 'POST', headers: { Cookie: cookie, Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: BOB, role: 'admin' }) });
    expect(set.status).toBe(200);
    expect(await set.json()).toMatchObject({ id: BOB, role: 'admin', source: 'db', updatedBy: ROOT });
    const listed = await mcp('principals_list', {}, bobBearer);
    expect(listed.status).toBe('completed');
    const ids = (listed.result.principals as Array<{ id: string }>).map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining([ROOT, ALICE, BOB]));
    // and back: bob is demoted again, next call refused again
    await fetch(`${base}/api/principals/role`, { method: 'POST', headers: { Cookie: cookie, Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: BOB, role: null }) });
    expect(codeOf(await mcp('principals_list', {}, bobBearer))).toBe('FORBIDDEN_ROLE');
  });

  it('the config admin is locked: 409 ROLE_LOCKED', async () => {
    const { cookie } = await dashboardLogin(base, ROOT);
    const r = await fetch(`${base}/api/principals/role`, { method: 'POST', headers: { Cookie: cookie, Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: ROOT, role: 'user' }) });
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ code: 'ROLE_LOCKED' });
  });

  it('GET /api/principals lists everyone who logged in, with lastSeenAt', async () => {
    const { cookie } = await dashboardLogin(base, ROOT);
    const r = await fetch(`${base}/api/principals`, { headers: { Cookie: cookie } });
    expect(r.status).toBe(200);
    const body = await r.json() as { authEnabled: boolean; principals: Array<{ id: string; lastSeenAt: string | null }> };
    expect(body.authEnabled).toBe(true);
    expect(body.principals.find((p) => p.id === BOB)?.lastSeenAt).toEqual(expect.any(String));
  });
});

describe('D-BIND: a raw loopback peer on a non-loopback bind is the local rescue path (same as /mcp)', () => {
  let s2: Server;
  let dir2: string;
  beforeAll(async () => {
    dir2 = mkdtempSync(join(tmpdir(), 'rwe-dash-dbind-'));
    s2 = await createServer({ port: 0, bind: '0.0.0.0', workRoot: dir2, auth: { enabled: true, issuer: 'http://127.0.0.1:0', googleClientId: CID, googleClientSecret: 'cs', googleTokenUrl: google.tokenUrl, jwksFetch: fakeJwksFetch } } as never);
  });
  afterAll(async () => { await s2?.close(); rmSync(dir2, { recursive: true, force: true }); });

  it('no credentials: the page and the principal-free routes are served; an admin route is refused PRINCIPAL_REQUIRED', async () => {
    const b2 = `http://127.0.0.1:${s2.port}`;
    expect((await fetch(`${b2}/dashboard`, { redirect: 'manual' })).status).toBe(200);
    expect((await fetch(`${b2}/api/system`)).status).toBe(200);
    const p = await fetch(`${b2}/api/principals`);
    expect(p.status).toBe(403);
    expect(await p.json()).toMatchObject({ code: 'PRINCIPAL_REQUIRED' });
  });

  it('a tunnel-forwarded request is NOT exempt', async () => {
    const b2 = `http://127.0.0.1:${s2.port}`;
    expect((await fetch(`${b2}/api/system`, { headers: { 'X-Forwarded-For': '203.0.113.9' } })).status).toBe(401);
  });
});

describe('CSRF behind a proxy that rewrites Host: the engine\'s own public origin counts as same-origin', () => {
  let s3: Server;
  let dir3: string;
  beforeAll(async () => {
    dir3 = mkdtempSync(join(tmpdir(), 'rwe-dash-pub-'));
    s3 = await createServer({ port: 0, bind: '127.0.0.1', workRoot: dir3, publicBaseUrl: 'https://rwe.example.test', auth: { enabled: true, issuer: 'https://rwe.example.test', googleClientId: CID, googleClientSecret: 'cs', googleTokenUrl: google.tokenUrl, jwksFetch: fakeJwksFetch } } as never);
  });
  afterAll(async () => { await s3?.close(); rmSync(dir3, { recursive: true, force: true }); });

  it('Origin = the public URL while Host = the local listener (cloudflared httpHostHeader) -> accepted; any other Origin -> 403', async () => {
    const b3 = `http://127.0.0.1:${s3.port}`;
    const ok = await fetch(`${b3}/dashboard/logout`, { method: 'POST', headers: { Origin: 'https://rwe.example.test' }, redirect: 'manual' });
    expect(ok.status).toBe(303);
    // https issuer: the cleared cookie is Secure
    expect(ok.headers.get('set-cookie')).toMatch(/; Secure/);
    const other = await fetch(`${b3}/dashboard/logout`, { method: 'POST', headers: { Origin: 'https://other.example.test' }, redirect: 'manual' });
    expect(other.status).toBe(403);
  });
});
