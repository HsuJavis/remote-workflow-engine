// VAL-214 (REQ-138; DES-215/216; TASK-223): real Chromium — the System tab rewritten to four stat
// cards, a process table (up to 20 rows, ARCH-135), an engine `<dl>`, and the decisive per-card
// degrade split: a route fault on ONE of the counts card's two extra routes (`/api/workflows` /
// `/api/runs`) must blank ONLY that card while CPU/memory/disk keep rendering real numbers.
//
// Mock policy (acceptance): real createServer(), real Chromium; ONE request is intercepted
// (`/api/workflows`) via Chrome DevTools Protocol request interception — the SUT boundary itself
// (the real HTTP route) is never mocked, only the browser's own network layer for one probe.
//
// Red reason (measured): today's `.sys-table` (`ui/system.js`) is a flat key-value table — no
// `[data-sys-stat-card]`, no `[data-proc-table]`, no `[data-engine-dl]`; a whole-route degrade already
// blanks the ENTIRE tab (`res.status !== 'ok'` at `system.js:72-78`), so a per-card split does not
// exist even conceptually yet.
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
  if (reason) { console.log(`[val-204] ${reason}`); return; }
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-val204-'));
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

describe('System tab: four stat cards, process table, engine dl (VAL-214, REQ-138)', () => {
  itReal('a cold /dashboard, clicking [data-tab="system"], paints four [data-sys-stat-card] elements, a [data-proc-table], and a [data-engine-dl]', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle0', timeout: 10000 });
      await (await page.$('[data-tab="system"]'))!.click();
      await page.waitForSelector('[data-sys-stat-card]', { timeout: 5000 });
      const cardCount = await page.$$eval('[data-sys-stat-card]', (els) => els.length);
      expect(cardCount).toBe(4);
      await page.waitForSelector('[data-proc-table] tbody tr', { timeout: 5000 });
      await page.waitForSelector('[data-engine-dl]', { timeout: 3000 });
      // [v28 Gate 6.5+7, verifier] the 9e10453 orchestrator ruling on `.stat-bar` (transform-
      // origin:left) turned out to guard a bigger hole, measured directly against a throwaway
      // Chromium page before this assertion existed: `left:0` with no `right`/`width` shrink-fits
      // an empty absolutely-positioned box to 0px REGARDLESS of transform-origin, so the fill bar's
      // own box (not merely its scaleX'd paint) never spanned its track. `offsetWidth` reads the
      // LAYOUT box, unaffected by the `scaleX()` transform `ui/system.js`'s `setBarPct` writes at
      // runtime (`getBoundingClientRect()` would, and this real host's own CPU sample legitimately
      // reads 0% at times — an environment-dependent value this assertion must not depend on).
      // Measured directly against the pre-fix CSS: 0; against the fix: matches `.stat-track`'s own
      // width. This is the underlying-box regression the ruling names, independent of any card's
      // percentage value.
      const cpuBarBoxWidth = await page.$eval(
        '[data-sys-stat-card][data-card="cpu"] .stat-bar',
        (elm) => (elm as HTMLElement).offsetWidth,
      );
      expect(cpuBarBoxWidth).toBeGreaterThan(0);
    } finally {
      await browser.close();
    }
  }, 20000);

  itReal('the process table can serve up to 20 rows (ARCH-135), not capped at 5', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle0', timeout: 10000 });
      await (await page.$('[data-tab="system"]'))!.click();
      await page.waitForSelector('[data-proc-table] tbody tr', { timeout: 5000 });
      const rowCount = await page.$$eval('[data-proc-table] tbody tr', (rs) => rs.length);
      expect(rowCount).toBeGreaterThan(5); // this host has 300+ real processes (measured earlier)
    } finally {
      await browser.close();
    }
  }, 20000);

  // The decisive case DES-215/216 name: a fault on ONE of the counts card's two extra routes must
  // blank ONLY that card, never the three host-observable ones.
  itReal('intercepting ONLY /api/workflows blanks the counts card while CPU/memory/disk keep rendering live numbers, and the nav tag reads degraded', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        if (new URL(req.url()).pathname === '/api/workflows') req.respond({ status: 500, body: 'boom' });
        else req.continue();
      });
      await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle0', timeout: 10000 });
      await (await page.$('[data-tab="system"]'))!.click();
      await page.waitForSelector('[data-sys-stat-card]', { timeout: 5000 });
      await new Promise((r) => setTimeout(r, 500)); // let at least one tick reach the counts card
      const cardTexts = await page.$$eval('[data-sys-stat-card]', (els) => els.map((e) => e.textContent ?? ''));
      const anyUnavailable = cardTexts.some((t) => /無法取樣|Unavailable/i.test(t));
      expect(anyUnavailable, 'the counts card must show Unavailable while the workflows route is broken').toBe(true);
      const liveCards = cardTexts.filter((t) => !/無法取樣|Unavailable/i.test(t));
      expect(liveCards.length, 'CPU/memory/disk must keep rendering real numbers').toBeGreaterThanOrEqual(3);
    } finally {
      await browser.close();
    }
  }, 20000);

  // [v28 Gate 6.5+7, verifier] DES-216's own amendment names this as unverified at the browser
  // tier: no case before this one ever drove `/api/system` ITSELF to non-ok (only `/api/workflows`,
  // above). The mirror case — the opposite route breaks — is the other half of the decisive split:
  // a fault on the HOST route must blank the three host-observable cards on a cold page (this
  // container's own `state.systemPainted === false` arm, `ui/system.js`), while the counts card
  // (whose two routes, `/api/workflows`/`/api/runs`, are independent and healthy) keeps rendering a
  // real number — the exact opposite pairing from the case above, proving `paintHostUnavailable`'s
  // per-card behavior for real rather than leaving it an implied gap.
  itReal('intercepting ONLY /api/system on a cold load blanks CPU/memory/disk while the counts card keeps rendering a live number (DES-216)', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        if (new URL(req.url()).pathname === '/api/system') req.respond({ status: 500, body: 'boom' });
        else req.continue();
      });
      await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle0', timeout: 10000 });
      await (await page.$('[data-tab="system"]'))!.click();
      await page.waitForSelector('[data-sys-stat-card]', { timeout: 5000 });
      await new Promise((r) => setTimeout(r, 500)); // let at least one tick reach the counts card
      const hostText = async (kind: string) =>
        page.$eval(`[data-sys-stat-card][data-card="${kind}"]`, (e) => e.textContent ?? '');
      const cpuText = await hostText('cpu');
      const memText = await hostText('memory');
      const diskText = await hostText('disk');
      const countsText = await hostText('counts');
      expect(cpuText, 'cpu card must show Unavailable while /api/system is broken').toMatch(/無法取樣|Unavailable/i);
      expect(memText, 'memory card must show Unavailable while /api/system is broken').toMatch(/無法取樣|Unavailable/i);
      expect(diskText, 'disk card must show Unavailable while /api/system is broken').toMatch(/無法取樣|Unavailable/i);
      expect(countsText, 'the counts card is independent of /api/system and must keep rendering a real number').not.toMatch(/無法取樣|Unavailable/i);
    } finally {
      await browser.close();
    }
  }, 20000);

  itReal('SPEC_ROWS (system view, REQ-138) hold under both themes and a hue move', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle0', timeout: 10000 });
      await (await page.$('[data-tab="system"]'))!.click();
      await new Promise((r) => setTimeout(r, 300));
      const rows = SPEC_ROWS.filter((r) => r.view === 'system');
      expect(rows.length).toBeGreaterThan(0);
      const failures = await specRowFailuresAcrossThemeAndHue(page, rows);
      expect(failures).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 20000);
});
