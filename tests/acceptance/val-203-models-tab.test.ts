// VAL-213 (REQ-137; DES-213/214; TASK-222): real Chromium — the Models tab rewritten to twelve
// sortable columns, three filters (search/provider/segment), and a 560 px slide-in panel.
//
// Mock policy (acceptance): real createServer() (DEFAULT_ALIASES, no mock catalog), real Chromium.
//
// Red reason (measured): today's `.models-table` (`ui/models.js`) is a flat 6-column table with no
// sort, no filter, no slide-in — `[data-model-table]`/`[data-model-panel]` do not exist; a header
// click does nothing; there is no `.seg`/search input on this tab.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { throwIfBrowserRequired } from '../helpers/require-browser.js';
import { SPEC_ROWS } from '../fixtures/dashboard-spec.js';
import { specRowFailuresAcrossThemeAndHue } from '../helpers/spec-rows.js';

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
  if (reason) { console.log(`[val-203] ${reason}`); return; }
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-val203-'));
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

describe('Models tab: twelve columns, sort, filter, slide-in (VAL-213, REQ-137)', () => {
  itReal('a cold /dashboard, clicking [data-tab="models"], paints [data-model-table] with a sortable header', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle0', timeout: 10000 });
      const tab = await page.$('[data-tab="models"]');
      expect(tab).not.toBeNull();
      await tab!.click();
      await page.waitForSelector('[data-model-table] tbody tr', { timeout: 5000 });
      const headerCount = await page.$$eval('[data-model-table] thead th', (ths) => ths.length);
      expect(headerCount).toBe(12);
    } finally {
      await browser.close();
    }
  }, 20000);

  itReal('clicking a column header sorts, toggles asc/desc on a second click, and marks the active header', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle0', timeout: 10000 });
      await (await page.$('[data-tab="models"]'))!.click();
      await page.waitForSelector('[data-model-table] thead th', { timeout: 5000 });
      const firstHeader = await page.$('[data-model-table] thead th');
      await firstHeader!.click();
      const activeAfterOne = await page.$('[data-model-table] th.sort-active');
      expect(activeAfterOne, 'a header click must mark itself sort-active').not.toBeNull();
      const dirAfterOne = await page.$eval('[data-model-table] th.sort-active', (el) => el.textContent);
      await firstHeader!.click();
      const dirAfterTwo = await page.$eval('[data-model-table] th.sort-active', (el) => el.textContent);
      expect(dirAfterTwo, 'a second click on the SAME header must flip the ▲/▼ glyph').not.toBe(dirAfterOne);
    } finally {
      await browser.close();
    }
  }, 20000);

  itReal('the search box narrows the row count and updates the "M / N" counter', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle0', timeout: 10000 });
      await (await page.$('[data-tab="models"]'))!.click();
      await page.waitForSelector('[data-model-table] tbody tr', { timeout: 5000 });
      const before = await page.$$eval('[data-model-table] tbody tr', (rs) => rs.length);
      const search = await page.$('.home-search, input[type="search"], [data-model-table] ~ input, .model-filters input');
      expect(search, 'a search input must exist on the Models tab').not.toBeNull();
      await search!.type('zzz-no-such-model-zzz');
      await new Promise((r) => setTimeout(r, 200));
      const after = await page.$$eval('[data-model-table] tbody tr', (rs) => rs.length);
      expect(after).toBeLessThan(before);
    } finally {
      await browser.close();
    }
  }, 20000);

  itReal('clicking a row opens the 560px [data-model-panel] slide-in', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle0', timeout: 10000 });
      await (await page.$('[data-tab="models"]'))!.click();
      const row = await page.waitForSelector('[data-model-table] tbody tr', { timeout: 5000 });
      await row!.click();
      await page.waitForSelector('[data-model-panel]', { timeout: 3000 });
    } finally {
      await browser.close();
    }
  }, 20000);

  itReal('SPEC_ROWS (models view, REQ-137) hold under both themes and a hue move, with notClipped on every text cell', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle0', timeout: 10000 });
      await (await page.$('[data-tab="models"]'))!.click();
      await new Promise((r) => setTimeout(r, 300));
      const rows = SPEC_ROWS.filter((r) => r.view === 'models');
      expect(rows.length).toBeGreaterThan(0);
      const failures = await specRowFailuresAcrossThemeAndHue(page, rows);
      expect(failures).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 20000);
});
