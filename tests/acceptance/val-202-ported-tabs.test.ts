// VAL-202 (REQ-067/076/077/078; DES-207, TASK-212; non-regression obligation of the rebuild): the
// three shipped tabs (Models/System/Issues) are PORTED, not redesigned — after ARCH-122 empties the
// shell of executable JS, they must still render real data from their existing endpoints via the
// NEW tab-based navigation this iteration introduces.
//
// Mock policy (acceptance): real createServer(), real MCP HTTP, real Chromium.
//
// Red reason (measured): no "tab" navigation UI exists at all today — Models/System are static
// sections stacked on the home page (`#models-panel`/`#system-panel`, `dashboard-page.ts:190-192`)
// and Issues is a SEPARATE route (`/dashboard/issues`), not a tab; the tab selectors below don't
// exist yet.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
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

beforeAll(async () => {
  if (reason) { console.log(`[val-202] ${reason}`); return; }
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-val202-'));
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir });
  baseUrl = `http://127.0.0.1:${server.port}`;
});

afterAll(async () => {
  await server?.close();
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

const itReal = (name: string, fn: () => Promise<void>, timeout?: number): void => {
  it(name, async (ctx) => { if (reason) ctx.skip(); await fn(); }, timeout);
};

describe('Models/System/Issues are PORTED to tabs, not redesigned (VAL-202, REQ-067/076/077/078)', () => {
  itReal('a Models tab exists and renders real /api/models rows', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle0', timeout: 10000 });
      const modelsTab = await page.$('[data-tab="models"]');
      expect(modelsTab).not.toBeNull();
      if (modelsTab) await modelsTab.click();
      await page.waitForSelector('.models-table tr', { timeout: 3000 });
    } finally {
      await browser.close();
    }
  }, 20000);

  // [v27c AC-5 Gate 8 repair] the falsifying test the review named: before this repair, `app.js`'s
  // ONE poll timer stayed pointed at 'home' forever — a tab switch mounted the module and rendered
  // it ONCE (this file's case above), but never joined it to the recurring tick, so `/api/models`
  // was fetched exactly once no matter how long the tab stayed open (ARCH-125's "the fetch set of
  // the VISIBLE view only" was false of the shipped page). `activateTab` now sets `currentView` to
  // the visible tab, so `/api/models` keeps refetching on the SAME 3s-after-settle timer every
  // other view uses.
  itReal('the Models tab keeps polling once it is the visible tab (AC-5): /api/models refetches on the timer, not just once at mount', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      const modelsRequestTimes: number[] = [];
      page.on('request', (req) => {
        if (new URL(req.url()).pathname === '/api/models') modelsRequestTimes.push(Date.now());
      });
      await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle0', timeout: 10000 });
      const modelsTab = await page.$('[data-tab="models"]');
      expect(modelsTab).not.toBeNull();
      if (modelsTab) await modelsTab.click();
      await page.waitForSelector('.models-table tr', { timeout: 3000 });
      const afterMount = modelsRequestTimes.length;
      // One full extra tick cycle (`app.js`'s `setTimeout(loop, 3000)`, re-armed AFTER the previous
      // tick settles) — 7s comfortably covers a second fetch without making the suite flaky.
      await new Promise((r) => setTimeout(r, 7000));
      expect(modelsRequestTimes.length).toBeGreaterThan(afterMount);
    } finally {
      await browser.close();
    }
  }, 20000);

  itReal('a System tab exists and renders /api/system data, with a degraded section showing the Unavailable component (never 0)', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle0', timeout: 10000 });
      const systemTab = await page.$('[data-tab="system"]');
      expect(systemTab).not.toBeNull();
      if (systemTab) await systemTab.click();
      await page.waitForSelector('#system-panel', { timeout: 3000 });
    } finally {
      await browser.close();
    }
  }, 20000);

  itReal('an Issues tab exists (not a separate route) and lists open/resolved from /api/issues', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle0', timeout: 10000 });
      const issuesTab = await page.$('[data-tab="issues"]');
      expect(issuesTab).not.toBeNull();
    } finally {
      await browser.close();
    }
  }, 20000);
});
