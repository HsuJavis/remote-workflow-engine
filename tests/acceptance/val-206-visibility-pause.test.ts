// VAL-216 (REQ-142; DES-211; TASK-218): real Chromium — REQ-142's browser-observable acceptance:
// a hidden tab issues ZERO `/api/*` requests for 30s, and re-showing it fires one immediately.
//
// DES-211's own pre-agreed oracle LADDER (written so this measurement has a pre-agreed
// consequence, per REQ-142's acceptance forbidding the "grep for visibilitychange in the source"
// escape hatch): rung 1 — two real pages, `bringToFront()`, count `/api/*` on the backgrounded page
// over 30s; rung 2 — CDP override if rung 1's signal never fires; rung 3 — record UNVERIFIED and
// raise to the owner if neither exists.
//
// RUNG 0 MEASUREMENT (performed before writing this file): a first probe using two `data:` URL
// pages for BOTH sides showed zero `visibilitychange` events under any launch flags — but that
// probe's own methodology was the confound, not the platform: `data:` pages do not participate in
// Chromium's page-visibility/occlusion tracking the way a page loaded from a REAL HTTP origin does.
// Re-measured against a real `http://127.0.0.1:<port>/` page (i.e. exactly this file's own
// `/dashboard` subject) with a `data:` sibling brought to front: `visibilitychange` fires
// (`'hidden'` then `'visible'` on return), confirmed twice. RUNG 1 THEREFORE WORKS in this harness
// — no CDP override, no owner escalation needed. (Left here as a recorded correction, not erased,
// per this ledger's own "measure, don't assume" discipline — the wrong first measurement is exactly
// the kind of thing a later reader should be able to see was caught, not silently fixed.)
//
// Mock policy (acceptance): real createServer(), real Chromium, a real second (`data:`) page as the
// backgrounding mechanism — no mock of the SUT's own visibility wiring.
//
// Red reason (measured): `app.js` has no `visibilitychange` listener at all today (`grep -c
// visibilitychange src/dashboard/ui/app.js` = 0) — its poll loop is an unconditional
// `setTimeout(loop, 3000)` regardless of tab visibility, so the assertion below (0 requests over a
// 30s hidden window) is false: this file's own first run measured 10 requests over the window.
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
  if (reason) { console.log(`[val-206] ${reason}`); return; }
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-val206-'));
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

describe('REQ-142: pause polling when hidden (VAL-216, DES-211) — real Chromium, RUNG 1', () => {
  itReal('a backgrounded tab issues zero /api/* requests over 30s; re-showing it fires one within ~1s', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const dashboard = await browser.newPage();
      const apiRequestTimes: number[] = [];
      dashboard.on('request', (req) => {
        if (new URL(req.url()).pathname.startsWith('/api/')) apiRequestTimes.push(Date.now());
      });
      await dashboard.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle0', timeout: 10000 });

      const distractor = await browser.newPage();
      await distractor.goto('data:text/html,<title>distractor</title>');
      await distractor.bringToFront();
      await new Promise((r) => setTimeout(r, 200));
      // Sanity: the environment precondition this whole test relies on — confirmed real above and
      // asserted here as a normal expectation (not a special-cased throw) so a genuine environment
      // regression still reads as a clear, located assertion failure.
      expect(await dashboard.evaluate(() => document.visibilityState), 'the dashboard page must actually be hidden for this test to mean anything').toBe('hidden');

      const before = apiRequestTimes.length;
      await new Promise((r) => setTimeout(r, 30000));
      const during = apiRequestTimes.slice(before);
      expect(during, '0 requests must reach /api/* while the tab is hidden').toEqual([]);

      const t0 = Date.now();
      await dashboard.bringToFront();
      await new Promise((r) => setTimeout(r, 800));
      const firstAfterResume = apiRequestTimes.find((t) => t >= t0);
      expect(firstAfterResume, 'a request must fire promptly on re-show').toBeDefined();
      expect(firstAfterResume! - t0).toBeLessThan(1000);
    } finally {
      await browser.close();
    }
  }, 35000);
});
