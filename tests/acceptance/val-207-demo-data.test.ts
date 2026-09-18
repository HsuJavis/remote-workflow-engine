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
import { registerPublishedVia, uniqueWorkflowName } from '../helpers/workflow-fixtures.js';

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

// [v28b, DES-220, TASK-226, REQ-143 amended clause] the two new cases below each need their OWN
// `workflow_register`/`workflow_publish` real MCP round-trip — same `${baseUrl}/mcp` shape every
// other acceptance file hand-rolls (val-199's own `mcpCall`), parameterized on a port because each
// case boots its OWN server/tmpDir rather than sharing the two cases above's module-scope one (a
// shared server's lifecycle is already fully spent by the second case above: it closes `server`,
// opens `recovered` on the same port, then closes `recovered` too in its own `finally` — reusing
// that state here would race against whichever case runs first).
async function mcpCallOn(basePort: number, name: string, args: unknown): Promise<any> {
  const res = await fetch(`http://127.0.0.1:${basePort}/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Math.random(), method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = (await res.json()) as { result?: { content: Array<{ text: string }> } };
  return JSON.parse(body.result!.content[0]!.text);
}

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

  // [v28b, DES-220, TASK-226] the AMENDED clause's `/api/workflows/:name/describe` arm — the owner's
  // 2026-09-17 ruling names this route as one of three with no demo entry (deliberately, DES-212),
  // so `workflow.js`'s `onTick` must paint the 「此路由無示範資料」disclosure on a demo miss instead
  // of doing nothing (today's "last-known render stays", confirmed at Gate 7.5 round 3 to freeze the
  // page with no indication anything changed). Own server/tmpDir/port (see `mcpCallOn`'s banner).
  //
  // Red reason (measured): `ui/workflow.js:396`'s describe-miss guard is `if (!describe || ...)
  // return {};` with no `tick` parameter at all — a demo miss simply skips the repaint, so
  // `[data-legend]` never reads the disclosure sentence and every other field stays whatever the
  // last LIVE tick painted, not cleared.
  itReal('the /api/workflows/:name/describe arm: a STOPPED engine on the workflow detail page paints 此路由無示範資料 and clears the figure, never lets a Live tag keep it after recovery (DES-220 B1)', async () => {
    const localTmp = mkdtempSync(join(tmpdir(), 'rwe-val207d-'));
    const localServer = await createServer({ port: 0, bind: '127.0.0.1', workRoot: localTmp });
    const localPort = localServer.port;
    const name = uniqueWorkflowName('val207wf');
    await registerPublishedVia((n, a) => mcpCallOn(localPort, n, a), name, `phase('one'); await agent('a', { prompt: 'p' }); return 'ok';`);
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    let recovered: Server | undefined;
    try {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${localPort}/dashboard/workflow/${encodeURIComponent(name)}`, { waitUntil: 'networkidle0', timeout: 10000 });
      await new Promise((r) => setTimeout(r, 300));
      const predictedLive = await page.evaluate(() => document.querySelector('[data-predicted-label]')?.textContent ?? '');
      expect(predictedLive.length, 'sanity: the live predicted-layout label is non-empty before the fault').toBeGreaterThan(0);

      await localServer.close();
      await new Promise((r) => setTimeout(r, 8000)); // same >=2-tick + demo-margin wait as the case above

      const legend = await page.evaluate(() => document.querySelector('[data-legend]')?.textContent ?? '');
      // [widened v28b, owner ruling 2026-09-18] the disclosure names its own route — a
      // colon-terminated prefix plus the literal route string, not the bare sentence.
      expect(legend, 'DES-220: the legend must read the exact named-route disclosure sentence').toBe('此路由無示範資料:/api/workflows/:name/describe');
      const triggers = await page.evaluate(() => document.querySelector('[data-triggers]')?.textContent ?? '');
      expect(triggers).toBe('');
      const desc = await page.evaluate(() => document.querySelector('.wf-desc')?.textContent ?? '');
      expect(desc).toBe('');
      const predictedDemo = await page.evaluate(() => document.querySelector('[data-predicted-label]')?.textContent ?? '');
      expect(predictedDemo).toBe('');
      const historyRows = await page.evaluate(() => document.querySelectorAll('[data-history-table] tbody tr').length);
      expect(historyRows).toBe(0);
      const navText = await page.evaluate(() => document.querySelector('.rwe-connection')?.textContent ?? '');
      expect(navText, 'the nav tag must show the demo/示範 label').toMatch(/示範|Demo/);
      expect(navText, 'Demo and Live must never both appear').not.toMatch(/連線中|Live/);

      // Recovery: a NEW engine on the SAME port + same workRoot (the catalog persists on disk).
      recovered = await createServer({ port: localPort, bind: '127.0.0.1', workRoot: localTmp });
      await new Promise((r) => setTimeout(r, 4000));
      const legendAfter = await page.evaluate(() => document.querySelector('[data-legend]')?.textContent ?? '');
      expect(legendAfter, 'DES-220 (B1): a Live tag must never keep the demo disclosure on screen').not.toBe('此路由無示範資料:/api/workflows/:name/describe');
    } finally {
      await browser.close();
      await localServer.close().catch(() => {});
      await recovered?.close().catch(() => {});
      rmSync(localTmp, { recursive: true, force: true });
    }
  }, 30000);

  // [v28b, DES-220, TASK-226] the AMENDED clause's `/api/issues` arm — measured at Gate 7.5 round 3
  // to FREEZE a previously-visited Issues tab on its stale pre-crash "GitHub not configured" text
  // through the entire demo window, with nothing distinguishing "live but degraded" from "frozen
  // because the engine died". `issues.js`'s `onTick` must gain a THIRD arm painting the disclosure
  // on a demo miss. Own server/tmpDir/port, no GitHub token configured (the default — matches the
  // real Gate 7.5 finding exactly, no extra config needed).
  //
  // Red reason (measured): `ui/issues.js:111`'s `onTick(container, bodies, _ctx)` has two arms
  // (`data.degraded` / `data`) and no `else` — a demo map-miss (`data` is `undefined`) hits neither,
  // so the stale degrade text painted by the last LIVE tick never changes.
  itReal('the /api/issues arm: a STOPPED engine on the Issues tab paints 此路由無示範資料 on both groups, replacing the stale pre-crash degrade text, and clears on recovery', async () => {
    const localTmp = mkdtempSync(join(tmpdir(), 'rwe-val207e-'));
    const localServer = await createServer({ port: 0, bind: '127.0.0.1', workRoot: localTmp });
    const localPort = localServer.port;
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    let recovered: Server | undefined;
    try {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${localPort}/dashboard`, { waitUntil: 'networkidle0', timeout: 10000 });
      await page.click('[data-tab="issues"]');
      await new Promise((r) => setTimeout(r, 500)); // the tab module's lazy import() + its first onTick

      const openLive = await page.evaluate(() => document.querySelector('#issues-open')?.textContent ?? '');
      expect(openLive, 'sanity: no GitHub token on this instance -> the pre-crash degrade text is showing').toContain('GitHub not configured');

      await localServer.close();
      await new Promise((r) => setTimeout(r, 8000));

      const openDemo = await page.evaluate(() => document.querySelector('#issues-open')?.textContent ?? '');
      const resolvedDemo = await page.evaluate(() => document.querySelector('#issues-resolved')?.textContent ?? '');
      // [widened v28b, owner ruling 2026-09-18] named-route disclosure, same prefix+route shape.
      expect(openDemo, 'DES-220: #issues-open must read the exact named-route disclosure sentence').toBe('此路由無示範資料:/api/issues');
      expect(resolvedDemo, 'DES-220: #issues-resolved must read the exact named-route disclosure sentence').toBe('此路由無示範資料:/api/issues');
      expect(openDemo, 'the stale pre-crash text must be GONE, not merely still present alongside the disclosure').not.toContain('GitHub not configured');
      const navText = await page.evaluate(() => document.querySelector('.rwe-connection')?.textContent ?? '');
      expect(navText).toMatch(/示範|Demo/);
      expect(navText).not.toMatch(/連線中|Live/);

      // Recovery: a NEW engine on the SAME port — same token-less config, so a genuine re-fetch
      // reproduces the SAME "GitHub not configured" degrade, proving this is a live re-fetch and
      // not the demo sentence merely lingering (DES-220's own B1 note: this view keeps no paint
      // memory, so the only way the sentence could outlive demo is a live tick with NO JSON body at
      // all, which never happens on a reachable server).
      recovered = await createServer({ port: localPort, bind: '127.0.0.1', workRoot: localTmp });
      await new Promise((r) => setTimeout(r, 4000));
      const openAfter = await page.evaluate(() => document.querySelector('#issues-open')?.textContent ?? '');
      expect(openAfter).not.toBe('此路由無示範資料:/api/issues');
      expect(openAfter).toContain('GitHub not configured');
    } finally {
      await browser.close();
      await localServer.close().catch(() => {});
      await recovered?.close().catch(() => {});
      rmSync(localTmp, { recursive: true, force: true });
    }
  }, 30000);

  // [v28b, DES-220, TASK-226, REQ-143 amended clause, owner ruling 2026-09-18] the THIRD, WIDENED
  // surface — the System tab's counts card (`ui/system.js`). Offered a choice between keeping
  // 無法取樣 on this card or switching it to the bare disclosure sentence, the owner declined both
  // and widened the ruling to name the route here too: `此路由無示範資料:/api/workflows`. Per DES-220
  // (B7) a LIVE degrade on this SAME card is UNCHANGED (still 無法取樣) — only a DEMO tick's version
  // of the miss gains the route name, so this case also re-proves DES-215/216's per-card
  // independence (CPU/memory/disk keep painting `/api/system`'s own real DEMO numbers) under the
  // new wording. No workflow registration needed (this arm never opens a workflow detail page); own
  // server/tmpDir/port, same real stopped-engine fault mechanism as the two cases above —
  // `page.setRequestInterception` is FORBIDDEN here too (DES-212).
  //
  // Red reason (measured): `ui/system.js:228`'s `paintCountsUnavailable(state)` takes no `text`
  // parameter and its one caller always passes `t(lang, 'unavailable')` regardless of
  // `tick.source` — a demo miss on `/api/workflows` reads 無法取樣, identically to a live one, never
  // the named-route sentence.
  itReal('the System tab counts card: a STOPPED engine paints 此路由無示範資料:/api/workflows on the counts card ONLY, while CPU/memory/disk keep live demo numbers, and recovers within one tick (DES-220 B7)', async () => {
    const localTmp = mkdtempSync(join(tmpdir(), 'rwe-val207f-'));
    const localServer = await createServer({ port: 0, bind: '127.0.0.1', workRoot: localTmp });
    const localPort = localServer.port;
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    let recovered: Server | undefined;
    try {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${localPort}/dashboard`, { waitUntil: 'networkidle0', timeout: 10000 });
      await (await page.$('[data-tab="system"]'))!.click(); // pre-warm the tab module WHILE the engine is alive (DES-220 B5(b))
      await page.waitForSelector('[data-sys-stat-card]', { timeout: 5000 });
      await new Promise((r) => setTimeout(r, 500));

      const countsLive = await page.$eval('[data-sys-stat-card][data-card="counts"] .stat-value', (e) => e.textContent ?? '');
      expect(countsLive, 'sanity: the live counts card shows a real number before the fault').not.toMatch(/無法取樣|示範|Unavailable/i);

      await localServer.close();
      await new Promise((r) => setTimeout(r, 8000)); // same >=2-tick + demo-margin wait as the cases above

      const countsDemo = await page.$eval('[data-sys-stat-card][data-card="counts"] .stat-value', (e) => e.textContent ?? '');
      expect(countsDemo, 'DES-220 (B7): the counts card must read the exact named-route disclosure').toBe('此路由無示範資料:/api/workflows');
      // DES-215/216 per-card independence, re-proven under the named-route wording: CPU/memory/disk
      // are pinned to the exact real numbers `src/dashboard/demo/dataset.js`'s `/api/system` entry
      // carries (utilizationPct 12, usedPct 25, usedPct 20) — a live re-derivation, not a leftover.
      const cpuDemo = await page.$eval('[data-sys-stat-card][data-card="cpu"] .stat-value', (e) => e.textContent ?? '');
      const memoryDemo = await page.$eval('[data-sys-stat-card][data-card="memory"] .stat-value', (e) => e.textContent ?? '');
      const diskDemo = await page.$eval('[data-sys-stat-card][data-card="disk"] .stat-value', (e) => e.textContent ?? '');
      expect(cpuDemo, 'the cpu card must keep painting the LIVE demo number, never the counts card disclosure').toBe('12%');
      expect(memoryDemo, 'the memory card must keep painting the LIVE demo number, never the counts card disclosure').toBe('25%');
      expect(diskDemo, 'the disk card must keep painting the LIVE demo number, never the counts card disclosure').toBe('20%');
      const navText = await page.evaluate(() => document.querySelector('.rwe-connection')?.textContent ?? '');
      expect(navText).toMatch(/示範|Demo/);
      expect(navText).not.toMatch(/連線中|Live/);

      // Recovery: a NEW engine on the SAME port — the next tick must return a real number.
      recovered = await createServer({ port: localPort, bind: '127.0.0.1', workRoot: localTmp });
      await new Promise((r) => setTimeout(r, 4000));
      const countsAfter = await page.$eval('[data-sys-stat-card][data-card="counts"] .stat-value', (e) => e.textContent ?? '');
      expect(countsAfter, 'DES-220: recovery must clear the disclosure within one tick').not.toBe('此路由無示範資料:/api/workflows');
    } finally {
      await browser.close();
      await localServer.close().catch(() => {});
      await recovered?.close().catch(() => {});
      rmSync(localTmp, { recursive: true, force: true });
    }
  }, 30000);
});
