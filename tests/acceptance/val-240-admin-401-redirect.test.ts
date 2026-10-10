// Issue #117 (owner decision, 2026-10-10): the admin page's role/quota POSTs (`ui/admin.js`
// `changeRole`/`changeQuota`, and the service-accounts section's `postServiceAccounts`) used a bare
// `fetch` each, none of which checked the response for a 401 — a session that expired mid-edit just
// painted a generic "unavailable" error instead of sending the browser back to sign in, unlike every
// GET poll on the page (`ui/poll.js`'s `getJSON`, which already redirects on 401). All three now go
// through `postJSON` (poll.js), which applies the identical 401 -> `/dashboard/login?next=...`
// redirect. The unit-level behaviour of `postJSON` itself (never throws, redirects on exactly 401,
// not on other statuses) is covered by tests/unit/dashboard-lib-principals.test.js; this file is the
// end-to-end wiring check — a real auth-enabled server, a real admin session that genuinely expires
// mid-page, a real click.
//
// Mock policy (acceptance): real createServer() with auth enabled, a real TokenStore session (same
// `createSession`/`page.setCookie('rwe_session', ...)` pattern as val-238's auth-enabled cases),
// real Chromium. The session is invalidated server-side (`TokenStore.deleteSession`) — the same
// "session already gone when the next request arrives" shape a real expiry produces — rather than
// racing a short TTL.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { TokenStore } from '../../src/auth/token-store.js';
import { throwIfBrowserRequired } from '../helpers/require-browser.js';

function findChrome(): string | null {
  const explicit = process.env['PUPPETEER_EXECUTABLE_PATH'];
  if (explicit && existsSync(explicit)) return explicit;
  const root = join(homedir(), '.cache', 'puppeteer', 'chrome');
  if (!existsSync(root)) return null;
  for (const rev of readdirSync(root)) {
    for (const layout of ['chrome-linux64/chrome', 'chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
      const p = join(root, rev, layout);
      if (existsSync(p)) return p;
    }
  }
  return null;
}
const chrome = findChrome();
const reason = chrome ? null : 'SKIPPED: no puppeteer Chrome found (set PUPPETEER_EXECUTABLE_PATH)';
throwIfBrowserRequired(chrome);

const ADMIN_EMAIL = 'val240-admin@example.com';
let server: Server;
let baseUrl: string;
let tmpDir: string;
let tokenStore: TokenStore;
let adminSession: string;

beforeAll(async () => {
  if (reason) { console.log(`[val-240] ${reason}`); return; }
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-val240-'));
  server = await createServer({
    port: 0, bind: '127.0.0.1', workRoot: tmpDir,
    auth: {
      enabled: true, issuer: 'http://127.0.0.1:0',
      googleClientId: 'val240-client-id', googleClientSecret: 'val240-client-secret',
      googleBase: 'http://127.0.0.1:0', jwksFetch: async () => [],
    },
    principals: { [ADMIN_EMAIL]: { role: 'admin' } },
  } as never);
  baseUrl = `http://127.0.0.1:${server.port}`;
  const db = new Database(join(tmpDir, 'auth-tokens.db'));
  tokenStore = new TokenStore(db, { clock: () => Date.now(), csprng: (n: number) => randomBytes(n) });
  adminSession = tokenStore.createSession(ADMIN_EMAIL).token;
}, 30000);

afterAll(async () => {
  await server?.close();
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

const itReal = (name: string, fn: () => Promise<void>, timeout?: number): void => {
  it(name, async (ctx) => { if (reason) ctx.skip(); await fn(); }, timeout);
};

describe('admin page POSTs redirect to login on a 401, same as every GET poll (issue #117)', () => {
  itReal('a quota Set click, with the session expired server-side between page load and the click, redirects to /dashboard/login', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      page.on('dialog', (d) => { void d.accept(); }); // changeQuota's window.confirm
      await page.setCookie({ name: 'rwe_session', value: adminSession, url: baseUrl, httpOnly: true, sameSite: 'Lax' });
      await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle0', timeout: 10000 });
      await (await page.$('[data-tab="admin"]'))!.click();
      await page.waitForSelector('[data-admin-table] tbody tr', { timeout: 5000 });
      const row = await page.$(`[data-admin-row="${ADMIN_EMAIL}"]`);
      expect(row, 'the signed-in admin must see its own row in the admin table').not.toBeNull();

      // The session the browser's cookie still carries is now gone server-side — the SAME shape a
      // real mid-page expiry produces, without racing a short TTL.
      tokenStore.deleteSession(adminSession);

      const input = await page.$(`[data-admin-quota="${ADMIN_EMAIL}"] input`);
      await input!.type('1000');
      // `location.assign('/dashboard/login?next=...')` itself redirects on to this fixture's fake,
      // unreachable `googleBase` OAuth endpoint (irrelevant plumbing this test does not exercise),
      // so the browser's FINAL settled URL is a Chrome network-error page, not `/dashboard/login`
      // itself — the request admin.js's redirect produces is observed directly instead of waiting
      // for that whole chain to settle.
      const loginReq = page.waitForRequest((r) => new URL(r.url()).pathname === '/dashboard/login', { timeout: 5000 });
      await (await page.$(`[data-admin-quota="${ADMIN_EMAIL}"] [data-admin-quota-set]`))!.click();

      const req = await loginReq;
      const url = new URL(req.url());
      expect(url.pathname).toBe('/dashboard/login');
      expect(url.searchParams.get('next')).toBe('/dashboard');
    } finally {
      await browser.close();
    }
  }, 20000);
});
