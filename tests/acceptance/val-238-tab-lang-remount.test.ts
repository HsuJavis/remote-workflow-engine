// VAL-238 (owner-reported bug, 2026-10-02): "go to the Admin tab, press the language toggle
// (中文) -> it jumps back to the home (workflows) tab; then clicking Admin again shows an empty
// panel." Two distinct defects in `ui/app.js`, both pinned here:
//
// (1) The lang button's click handler calls `mountApp()` (a full remount) with no memory of which
//     tab was visible. `mountHomeRoot()` always activates `pendingTab || 'workflows'`, and
//     `pendingTab` is only ever set by cross-route navigation (`setTab`), never by the lang
//     toggle — so ANY tab (not just Admin) loses its selection on every language switch.
//
// (2) `activateTab`'s lazy-module branch only calls `mod.render(panel, {}, {})` when
//     `!tabModuleCache[tab]` — i.e. on a tab's FIRST ever mount. `mountHomeRoot()` rebuilds the
//     whole tab-panel DOM on every remount (`buildTabPanels()`), so a SECOND visit to an
//     already-cached tab gets a brand-new, never-rendered `<div data-tab-panel>`, and the cached
//     module's `render()` is never called on it. `admin.js`/`issues.js` have no lazy-init inside
//     their own `onTick` (they assume `render()` already built the chrome), so their second mount
//     stays permanently empty. (`models.js`/`system.js` happen to self-heal because their
//     `onTick` lazily builds its own shell via a per-container `WeakMap` when none exists yet —
//     covered here too, so a future regression in that lazy-init can't quietly reintroduce the
//     same class of bug.)
//
// Mock policy (acceptance): real createServer() (plain, for models/system/issues) + a SECOND,
// auth-enabled createServer() with an admin principal (same `TokenStore.createSession` +
// `page.setCookie` pattern as val-199's auth-enabled cases) for the Admin tab, which only exists
// for a signed-in admin. Real Chromium throughout.
//
// Red reason (measured): toggling language while on [data-tab="models"] (or system/issues/admin)
// leaves [data-tab="workflows"] with aria-current="page" instead; re-visiting Admin/Issues after a
// toggle finds their panel's `tbody`/groups empty (no `<tr>`/row content at all).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { TokenStore } from '../../src/auth/token-store.js';
import { registerPublishedVia } from '../helpers/workflow-fixtures.js';
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

let server: Server;
let baseUrl: string;
let tmpDir: string;

let authServer: Server;
let authBaseUrl: string;
let authTmpDir: string;
const ADMIN_EMAIL = 'val238-admin@example.com';
let adminSession: string;

async function mcpCall(name: string, args: unknown): Promise<any> {
  const res = await fetch(`${baseUrl}/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Math.random(), method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = (await res.json()) as { result?: { content: Array<{ text: string }> } };
  return JSON.parse(body.result!.content[0]!.text);
}

beforeAll(async () => {
  if (reason) { console.log(`[val-238] ${reason}`); return; }
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-val238-'));
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir });
  baseUrl = `http://127.0.0.1:${server.port}`;
  await registerPublishedVia(mcpCall, 'val238-detail', `return 'ok';`);

  authTmpDir = mkdtempSync(join(tmpdir(), 'rwe-val238-auth-'));
  authServer = await createServer({
    port: 0, bind: '127.0.0.1', workRoot: authTmpDir,
    auth: {
      enabled: true, issuer: 'http://127.0.0.1:0',
      googleClientId: 'val238-client-id', googleClientSecret: 'val238-client-secret',
      googleBase: 'http://127.0.0.1:0', jwksFetch: async () => [],
    },
    principals: { [ADMIN_EMAIL]: { role: 'admin' } },
  } as never);
  authBaseUrl = `http://127.0.0.1:${authServer.port}`;
  const db = new Database(join(authTmpDir, 'auth-tokens.db'));
  adminSession = new TokenStore(db, { clock: () => Date.now(), csprng: (n: number) => randomBytes(n) }).createSession(ADMIN_EMAIL).token;
  db.close();
}, 30000);

afterAll(async () => {
  await server?.close();
  await authServer?.close();
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  if (authTmpDir) rmSync(authTmpDir, { recursive: true, force: true });
});

const itReal = (name: string, fn: () => Promise<void>, timeout?: number): void => {
  it(name, async (ctx) => { if (reason) ctx.skip(); await fn(); }, timeout);
};

describe('a language toggle preserves the current tab and re-populates it (VAL-238)', () => {
  itReal('toggling language while on Models keeps Models active and populated, in the new language', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle0', timeout: 10000 });
      await (await page.$('[data-tab="models"]'))!.click();
      await page.waitForSelector('[data-model-table] tbody tr', { timeout: 5000 });
      await (await page.$('[data-lang="en"]'))!.click();
      await page.waitForFunction(
        () => document.querySelector('[data-tab="models"]')?.getAttribute('aria-current') === 'page',
        { timeout: 5000 },
      );
      const current = await page.evaluate(() =>
        [...document.querySelectorAll('.rwe-tabs a')].map((a) => ({ tab: a.getAttribute('data-tab'), current: a.getAttribute('aria-current') })));
      expect(current).toContainEqual({ tab: 'models', current: 'page' });
      expect(current).toContainEqual({ tab: 'workflows', current: null });
      await page.waitForSelector('[data-model-table] thead th', { timeout: 5000 });
      const headerText = await page.$eval('[data-model-table] thead th', (th) => th.textContent);
      expect(headerText).toMatch(/^Model\b/); // en label (zh is '模型'; the default sort column also carries a ▲/▼ marker)
      const rowCount = await page.$$eval('[data-model-table] tbody tr', (trs) => trs.length);
      expect(rowCount).toBeGreaterThan(0);
    } finally {
      await browser.close();
    }
  }, 20000);

  // Dispatch item (1)'s second clause: a lang toggle on a route page (not the tab strip at all —
  // `mountRoute()` takes the `mountLazy('./workflow.js', ...)` branch, never `mountHomeRoot()`)
  // must keep the URL and repaint in the new language. `mountLazy` always calls `mod.render()`
  // fresh (no `tabModuleCache`/`dataset.mounted` gate), and `workflow.js`'s own labels are read via
  // `currentLang()` -> `document.documentElement.lang` at render time, so this is expected to pass
  // already — pinned here so a future regression in either mechanism is caught.
  itReal('toggling language on a workflow detail route keeps the URL and repaints in the new language', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/dashboard/workflow/val238-detail`, { waitUntil: 'networkidle0', timeout: 10000 });
      const bodyTextBefore = await page.evaluate(() => document.body.textContent ?? '');
      expect(bodyTextBefore).toContain('總覽'); // zh default
      await (await page.$('[data-lang="en"]'))!.click();
      await page.waitForFunction(() => (document.body.textContent ?? '').includes('Overview'), { timeout: 5000 });
      expect(new URL(page.url()).pathname).toBe('/dashboard/workflow/val238-detail');
      const bodyTextAfter = await page.evaluate(() => document.body.textContent ?? '');
      expect(bodyTextAfter).not.toContain('總覽');
    } finally {
      await browser.close();
    }
  }, 20000);

  itReal('toggling language while on System keeps System active and populated', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle0', timeout: 10000 });
      await (await page.$('[data-tab="system"]'))!.click();
      await page.waitForSelector('[data-sys-stat-card]', { timeout: 5000 });
      await (await page.$('[data-lang="en"]'))!.click();
      await page.waitForFunction(
        () => document.querySelector('[data-tab="system"]')?.getAttribute('aria-current') === 'page',
        { timeout: 5000 },
      );
      const cardCount = await page.$$eval('[data-sys-stat-card]', (els) => els.length);
      expect(cardCount).toBeGreaterThan(0);
      const cpuLabel = await page.$eval('[data-sys-stat-card][data-card="cpu"] .stat-label', (el) => el.textContent);
      expect(cpuLabel).toBe('CPU %'); // en label (zh is 'CPU 使用率')
    } finally {
      await browser.close();
    }
  }, 20000);

  itReal('toggling language while on Issues keeps Issues active and re-renders its chrome', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle0', timeout: 10000 });
      await (await page.$('[data-tab="issues"]'))!.click();
      await page.waitForSelector('#issues h2', { timeout: 5000 });
      await (await page.$('[data-lang="en"]'))!.click();
      await page.waitForFunction(
        () => document.querySelector('[data-tab="issues"]')?.getAttribute('aria-current') === 'page',
        { timeout: 5000 },
      );
      // The second mount must repaint the chrome at all — pre-fix this panel stays empty
      // (`admin.js`'s/`issues.js`'s own `render()` is never called a second time).
      await page.waitForSelector('#issues h2', { timeout: 5000 });
      const headings = await page.$$eval('#issues h2', (hs) => hs.map((h) => h.textContent));
      expect(headings).toEqual(['Open', 'Resolved']); // en labels (zh: 未解決/已解決)
    } finally {
      await browser.close();
    }
  }, 20000);

  itReal('Admin: toggling language keeps Admin active and still shows principal rows, in the new language (the exact owner report)', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.setCookie({ name: 'rwe_session', value: adminSession, url: authBaseUrl, httpOnly: true, sameSite: 'Lax' });
      await page.goto(`${authBaseUrl}/dashboard`, { waitUntil: 'networkidle0', timeout: 10000 });
      await (await page.$('[data-tab="admin"]'))!.click();
      await page.waitForSelector('[data-admin-table] tbody tr', { timeout: 5000 });
      const beforeRows = await page.$$eval('[data-admin-table] tbody tr', (trs) => trs.length);
      expect(beforeRows).toBeGreaterThan(0);

      await (await page.$('[data-lang="en"]'))!.click();
      await page.waitForFunction(
        () => document.querySelector('[data-tab="admin"]')?.getAttribute('aria-current') === 'page',
        { timeout: 5000 },
      );
      // The owner's second clause: "clicking Admin again shows an empty panel" — assert the
      // populated row survives the remount (pre-fix: 0 rows, `render()` never called again).
      await page.waitForSelector('[data-admin-table] tbody tr', { timeout: 5000 });
      const afterRows = await page.$$eval('[data-admin-table] tbody tr', (trs) => trs.length);
      expect(afterRows).toBeGreaterThan(0);
      const headerText = await page.$eval('[data-admin-table] thead th', (th) => th.textContent);
      expect(headerText).toBe('Account'); // en label (zh: 帳號) — proves it repainted in English
    } finally {
      await browser.close();
    }
  }, 20000);

  itReal('toggling language while on Workflows (home), every lazy tab visited afterward is populated', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.setCookie({ name: 'rwe_session', value: adminSession, url: authBaseUrl, httpOnly: true, sameSite: 'Lax' });
      await page.goto(`${authBaseUrl}/dashboard`, { waitUntil: 'networkidle0', timeout: 10000 });
      // First visit every tab once (so each module gets cached), back to workflows, THEN toggle.
      for (const tab of ['models', 'system', 'issues', 'admin', 'workflows']) {
        await (await page.$(`[data-tab="${tab}"]`))!.click();
        await new Promise((r) => setTimeout(r, 400));
      }
      await (await page.$('[data-lang="zh"]'))!.click(); // toggle back to zh (already zh by default — proves a no-op toggle path works too) then to en below
      await new Promise((r) => setTimeout(r, 300));
      await (await page.$('[data-lang="en"]'))!.click();
      await page.waitForFunction(
        () => document.querySelector('[data-tab="workflows"]')?.getAttribute('aria-current') === 'page',
        { timeout: 5000 },
      );
      for (const [tab, selector] of [
        ['models', '[data-model-table] tbody tr'],
        ['system', '[data-sys-stat-card]'],
        ['issues', '#issues h2'],
        ['admin', '[data-admin-table] tbody tr'],
      ] as const) {
        await (await page.$(`[data-tab="${tab}"]`))!.click();
        await page.waitForSelector(selector, { timeout: 5000 });
        const count = await page.$$eval(selector, (els) => els.length);
        expect(count, `tab "${tab}" is empty after the earlier language toggle`).toBeGreaterThan(0);
      }
    } finally {
      await browser.close();
    }
  }, 30000);
});
