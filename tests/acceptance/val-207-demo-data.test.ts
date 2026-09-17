// VAL-217 (REQ-143; DES-212/ADR-058; TASK-220): real Chromium — demo data self-labels and engages
// ONLY on a genuinely stopped engine under an ALREADY-OPEN page (never an HTTP-error storm, which
// is REQ-131's Offline case, val-198's own — building either as the other silently stops testing
// anything, per DES-212's own binding constraint).
//
// Mock policy (acceptance): real createServer(), real Chromium, a REAL `server.close()` /
// re-`listen()` on the SAME port as the fault/recovery mechanism — no mocked transport.
//
// Red reason (measured): `app.js` never imports `../demo/dataset.js` today (`grep -c
// "demo/dataset" src/dashboard/ui/app.js` = 0), so the "exactly one GET per page load" assertion
// below is false (0 GETs); the nav tag has no `is-demo`/Demo-data text path at all; a stopped
// engine today just shows Offline, forever, with no demo body.
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
let tmpDir: string;
let port: number;

beforeAll(async () => {
  if (reason) { console.log(`[val-207] ${reason}`); return; }
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-val207-'));
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir });
  port = server.port;
});

afterAll(async () => {
  await server?.close().catch(() => {});
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

const itReal = (name: string, fn: () => Promise<void>, timeout?: number): void => {
  it(name, async (ctx) => { if (reason) ctx.skip(); await fn(); }, timeout);
};

describe('REQ-143: demo data self-labels, engages on a STOPPED engine, retires on recovery (VAL-217, DES-212)', () => {
  itReal('boot: exactly ONE GET of /static/dashboard/demo/dataset.js per page load, on a LIVE engine', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      const datasetGets: string[] = [];
      page.on('request', (req) => {
        if (new URL(req.url()).pathname === '/static/dashboard/demo/dataset.js') datasetGets.push(req.url());
      });
      await page.goto(`http://127.0.0.1:${port}/dashboard`, { waitUntil: 'networkidle0', timeout: 10000 });
      await new Promise((r) => setTimeout(r, 300)); // the boot import is fire-and-forget, not awaited by networkidle0
      expect(datasetGets.length, 'exactly one GET of the dataset key per page load (REQ-143\'s positive observable)').toBe(1);
      // And on a LIVE engine the nav tag must NOT show the demo tag at all.
      const navText = await page.evaluate(() => document.querySelector('.rwe-connection')?.textContent ?? '');
      expect(navText).not.toMatch(/示範|Demo/);
    } finally {
      await browser.close();
    }
  }, 15000);

  itReal('a STOPPED engine under an ALREADY-OPEN page engages demo mode: the nav tag shows 示範資料/Demo data, never simultaneously with Live', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    let recovered: Server | undefined;
    try {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${port}/dashboard`, { waitUntil: 'networkidle0', timeout: 10000 });
      await new Promise((r) => setTimeout(r, 300));

      // The fault IS a stopped engine under an already-open page — never an HTTP-error storm.
      await server.close();

      // REQ-131's own >=2-consecutive-fail rule before "offline", then ADR-058's demo predicate on
      // top of that — two 3s ticks plus margin.
      await new Promise((r) => setTimeout(r, 8000));

      const navText = await page.evaluate(() => document.querySelector('.rwe-connection')?.textContent ?? '');
      expect(navText, 'the nav tag must show the demo/示範 label once the engine has genuinely stopped').toMatch(/示範|Demo/);
      expect(navText, 'Demo and Live must never both appear (DES-210\'s ONE if/else on demoTick)').not.toMatch(/連線中|Live/);

      // Every tab's visible area must show demo mode, not only the nav (REQ-143's own clause).
      const bodyHasDemoMarker = await page.evaluate(() => document.body.textContent?.includes('示範') || document.body.textContent?.includes('Demo') || false);
      expect(bodyHasDemoMarker, 'demo mode must be visible in the page body, not only the nav tag').toBe(true);

      // Recovery: a NEW engine on the SAME port, and the next poll flips back to Live.
      recovered = await createServer({ port, bind: '127.0.0.1', workRoot: tmpDir });
      await new Promise((r) => setTimeout(r, 4000));
      const navAfterRecovery = await page.evaluate(() => document.querySelector('.rwe-connection')?.textContent ?? '');
      expect(navAfterRecovery, 'the next poll after recovery must flip back to Live').toMatch(/連線中|Live/);
      expect(navAfterRecovery).not.toMatch(/示範|Demo/);
    } finally {
      await browser.close();
      await recovered?.close().catch(() => {});
      // `server` (module scope) was already closed above, mid-test — afterAll's own
      // `server?.close().catch(() => {})` tolerates the double-close safely. `recovered` is this
      // test's own responsibility to close, never afterAll's (it never reads that variable).
    }
  }, 20000);
});
