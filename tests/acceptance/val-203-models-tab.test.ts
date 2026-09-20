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
      // Scoped to the Models tab's OWN panel (`app.js:210`'s `[data-tab-panel="models"]`, set
      // `display:none` while inactive but never removed) — the previous unscoped selector list
      // matched the Home tab's `.home-search` (`home.js:171`) FIRST in document order, since
      // `page.$()`/`querySelector` return the first document-order match across the WHOLE list, not
      // a match of the first listed selector. Typing into that hidden, off-tab input silently did
      // nothing to the Models table (measured: `matchModels`/`paint` themselves filter correctly
      // once the right, visible input receives the keystrokes).
      const search = await page.$('[data-tab-panel="models"] input[type="search"]');
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
      // `data-model-panel`/`.bench-row` only exist once a row is clicked open (`renderPanel`,
      // models.js:235-241 — README §4 "Row click -> right slide-in panel"); the agent panel's own
      // SPEC_ROWS case (val-201-agent-panel.test.ts:307) clicks its node open before checking for
      // the same reason. Table-only rows (`data-model-table`, `th.sort-active` — active by default,
      // `models.js`'s initial sort is `{key:'model'}`) hold with or without the click.
      const row = await page.waitForSelector('[data-model-table] tbody tr', { timeout: 5000 });
      await row!.click();
      await page.waitForSelector('[data-model-panel]', { timeout: 3000 });
      const rows = SPEC_ROWS.filter((r) => r.view === 'models');
      expect(rows.length).toBeGreaterThan(0);
      const failures = await specRowFailuresAcrossThemeAndHue(page, rows);
      expect(failures).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 20000);
  // [v32, REQ-191, F5] README §4 lists the columns and marks exactly one of them: "Context **(right)**".
  // `.table td,.table th` sets `text-align:left` for every cell and nothing narrows it back, so the
  // one column README singles out is the one rendered like all the others.
  itReal('the Context column is right-aligned — the one alignment README names (REQ-191)', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle0', timeout: 10000 });
      await page.click('[data-tab="models"]');
      await page.waitForSelector('[data-model-table] tbody tr', { timeout: 5000 });
      const align = await page.evaluate(() => {
        const ths = Array.from(document.querySelectorAll('[data-model-table] thead th'));
        const i = ths.findIndex((th) => (th as HTMLElement).dataset.col === 'context');
        if (i < 0) return null;
        const firstRow = document.querySelector('[data-model-table] tbody tr');
        const td = firstRow?.children[i];
        return {
          header: getComputedStyle(ths[i]!).textAlign,
          cell: td ? getComputedStyle(td).textAlign : null,
        };
      });
      expect(align).toEqual({ header: 'right', cell: 'right' });
    } finally {
      await browser.close();
    }
  }, 20000);

  // [v32, REQ-193, F7] README §4 gives the search box "max 280". The rule sets `max-width:280px` but
  // no `width`, so the input falls back to its intrinsic size and never reaches it — measured 178px.
  // Identical to the already-ruled REQ-183 repair on the HOME search (`max-width 320`, same cause).
  itReal('the models search box actually reaches its README width, not just its max-width (REQ-193)', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1500, height: 900 });
      await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle0', timeout: 10000 });
      await page.click('[data-tab="models"]');
      await page.waitForSelector('.model-filters .input[type="search"]', { timeout: 5000 });
      const width = await page.$eval('.model-filters .input[type="search"]', (el) => el.getBoundingClientRect().width);
      expect(Math.round(width)).toBe(280);
    } finally {
      await browser.close();
    }
  }, 20000);

  // [v32, REQ-194, F8] the panel tail renders `<span class="tag">remote</span><span class="tag">stable</span>`
  // — raw wire words in a zh UI, and both already appear LOCALIZED higher up the same panel (the
  // kicker `OPENROUTER · 遠端`, and the `穩定度 穩定` row). README §4 assigns that slot to "supported
  // parameters as neutral tags"; that payload is deliberately dropped upstream (`model-catalog.ts:427`,
  // ruled), so the slot has no content — which makes filling it with untranslated duplicates of data
  // shown elsewhere the defect. Nothing to translate; the tags go.
  itReal('the model panel carries no raw wire words duplicating its own localized rows (REQ-194)', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle0', timeout: 10000 });
      await page.click('[data-tab="models"]');
      await page.waitForSelector('[data-model-table] tbody tr', { timeout: 5000 });
      await page.click('[data-model-table] tbody tr');
      await page.waitForSelector('[data-model-panel]', { timeout: 5000 });
      const rawTags = await page.evaluate(() => Array.from(document.querySelectorAll('[data-model-panel] .tag'))
        .map((el) => (el as HTMLElement).innerText.trim())
        .filter((t) => /^(remote|local|stable|beta|experimental|deprecated)$/i.test(t)));
      expect(rawTags).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 20000);
});
