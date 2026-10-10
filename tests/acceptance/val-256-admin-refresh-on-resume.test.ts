// VAL-256 (issue #117, independent-verifier finding, 2026-10-10): issue #117's own "What to do"
// line pairs two distinct admin-page fixes — "過期" (session-expiry handling, fixed via
// `postJSON`'s 401 redirect, val-240's own territory) and "重新整理" (refresh handling on
// RETURNING to the page). Only the first was fixed. `admin.js`'s `onTick` was a no-op and
// `poll.js`'s `admin: () => []` (deliberately — the ambient 3s poll must never repaint this view
// mid-edit) meant NOTHING ever refreshed the principals table on return: not a browser-tab
// `visibilitychange` resume, not re-activating the in-app Admin tab after visiting another one.
// The prior round's report that this was "already resolved by design" conflated the ambient-poll
// rationale with a one-time resume refresh, which the header comment never actually covered.
//
// Mock policy (acceptance): real createServer() (auth-enabled, same pattern as val-238's Admin
// case), real Chromium. The out-of-band role change is a genuine HTTP POST to
// /api/principals/role (the same backend principal_set_role uses) from Node, simulating "a second
// admin, elsewhere" — never a mock of the SUT.
//
// Red reason (measured): pre-fix, `admin.js`'s `onTick` returns `undefined` unconditionally and
// `poll.js`'s `admin` route is `[]`, so BOB's row never refetches; both cases below time out with
// the stale 'user' role still on screen.
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

let authServer: Server;
let authBaseUrl: string;
let authTmpDir: string;
const ADMIN_EMAIL = 'val256-admin@example.com';
const BOB_EMAIL = 'val256-bob@example.com';
let adminSession: string;

async function setBobRole(role: string): Promise<void> {
  const res = await fetch(`${authBaseUrl}/api/principals/role`, {
    method: 'POST',
    headers: { Cookie: `rwe_session=${adminSession}`, Origin: authBaseUrl, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: BOB_EMAIL, role }),
  });
  if (!res.ok) throw new Error(`setBobRole(${role}) -> ${res.status} ${await res.text()}`);
}

beforeAll(async () => {
  if (reason) { console.log(`[val-256] ${reason}`); return; }
  authTmpDir = mkdtempSync(join(tmpdir(), 'rwe-val256-auth-'));
  authServer = await createServer({
    port: 0, bind: '127.0.0.1', workRoot: authTmpDir,
    auth: {
      enabled: true, issuer: 'http://127.0.0.1:0',
      googleClientId: 'val256-client-id', googleClientSecret: 'val256-client-secret',
      googleBase: 'http://127.0.0.1:0', jwksFetch: async () => [],
    },
    // BOB is a plain, non-locked 'user' by config (only the config ADMIN row is locked) — the
    // same shape dashboard-auth.test.ts's own role-administration suite relies on to prove a
    // config-declared non-admin role is still DB-overridable.
    principals: { [ADMIN_EMAIL]: { role: 'admin' }, [BOB_EMAIL]: { role: 'user' } },
  } as never);
  authBaseUrl = `http://127.0.0.1:${authServer.port}`;
  const db = new Database(join(authTmpDir, 'auth-tokens.db'));
  adminSession = new TokenStore(db, { clock: () => Date.now(), csprng: (n: number) => randomBytes(n) }).createSession(ADMIN_EMAIL).token;
  db.close();
}, 30000);

afterAll(async () => {
  await authServer?.close();
  if (authTmpDir) rmSync(authTmpDir, { recursive: true, force: true });
});

const itReal = (name: string, fn: () => Promise<void>, timeout?: number): void => {
  it(name, async (ctx) => { if (reason) ctx.skip(); await fn(); }, timeout);
};

async function bobRoleText(page: import('puppeteer').Page): Promise<string | null> {
  return page.evaluate((bobEmail) => {
    const row = document.querySelector(`[data-admin-row="${bobEmail}"]`);
    return row ? row.querySelector('td:nth-child(2) .tag')?.textContent ?? null : null;
  }, BOB_EMAIL);
}

describe('admin page refreshes its principals table on resume (VAL-256, issue #117)', () => {
  itReal('re-activating the Admin tab after visiting another tab picks up an out-of-band role change', async () => {
    await setBobRole('user');
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.setCookie({ name: 'rwe_session', value: adminSession, url: authBaseUrl, httpOnly: true, sameSite: 'Lax' });
      await page.goto(`${authBaseUrl}/dashboard`, { waitUntil: 'networkidle0', timeout: 10000 });
      await (await page.$('[data-tab="admin"]'))!.click();
      await page.waitForSelector(`[data-admin-row="${BOB_EMAIL}"]`, { timeout: 5000 });
      expect(await bobRoleText(page)).toBe('user');

      // "A second admin, elsewhere" promotes BOB while this page sits open and unaware.
      await setBobRole('author');

      // Switch away and back — re-activating the SAME in-app tab, not a reload.
      await (await page.$('[data-tab="models"]'))!.click();
      await page.waitForSelector('[data-model-table] tbody tr', { timeout: 5000 });
      await (await page.$('[data-tab="admin"]'))!.click();

      await page.waitForFunction(
        (bobEmail) => {
          const row = document.querySelector(`[data-admin-row="${bobEmail}"]`);
          return row?.querySelector('td:nth-child(2) .tag')?.textContent === 'author';
        },
        { timeout: 5000 },
        BOB_EMAIL,
      );
      expect(await bobRoleText(page)).toBe('author');
    } finally {
      await browser.close();
    }
  }, 20000);

  itReal('a browser-tab visibility resume (no navigation at all) picks up an out-of-band role change', async () => {
    await setBobRole('user');
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.setCookie({ name: 'rwe_session', value: adminSession, url: authBaseUrl, httpOnly: true, sameSite: 'Lax' });
      await page.goto(`${authBaseUrl}/dashboard`, { waitUntil: 'networkidle0', timeout: 10000 });
      await (await page.$('[data-tab="admin"]'))!.click();
      await page.waitForSelector(`[data-admin-row="${BOB_EMAIL}"]`, { timeout: 5000 });
      expect(await bobRoleText(page)).toBe('user');

      await setBobRole('author');

      // No tab click, no reload — only the document's own visibilitychange event, exactly as a
      // real alt-tab-away-and-back fires it (`visibilityState` stays 'visible' in a headless tab,
      // which is fine: `nextPoll`'s 'visible' branch returns 'fire' regardless of the PREVIOUS
      // state, so this one dispatch is enough to prove the wiring without simulating `hidden`).
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));

      await page.waitForFunction(
        (bobEmail) => {
          const row = document.querySelector(`[data-admin-row="${bobEmail}"]`);
          return row?.querySelector('td:nth-child(2) .tag')?.textContent === 'author';
        },
        { timeout: 5000 },
        BOB_EMAIL,
      );
      expect(await bobRoleText(page)).toBe('author');
    } finally {
      await browser.close();
    }
  }, 20000);
});
