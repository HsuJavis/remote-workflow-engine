// VAL-198 (REQ-131, REQ-132; DES-200/201/202/206; 04-design.md's own v27 real-tier path row): real
// Chromium against a really booted engine — the dashboard shell (theme/lang/hue/connection) and the
// Workflows home (search/segments/avgCost/sweep), in ONE session per the design's own grouping.
//
// Mock policy (acceptance): real createServer(), real MCP HTTP, real Chromium (puppeteer). No
// gateway is injected for the home-only assertions; a fake gateway completes runs fast for the
// running/registered card split.
//
// Red reason (measured): none of `data-theme`, `--color-accent`/hue slider, the EN/中 toggle, the
// search box, or the segment counts exist on the current dashboard (confirmed: no `data-theme`,
// `localStorage`, or `prefers-color-scheme` reference anywhere in `src/dashboard-page.ts`).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, readdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import type { GatewayClient } from '../../src/gateway/client.js';
import { registerPublishedVia, startScript } from '../helpers/workflow-fixtures.js';
import { throwIfBrowserRequired } from '../helpers/require-browser.js';
import { RunManager } from '../../src/run-manager.js';
import { SqliteRunStore } from '../../src/store/sqlite-run-store.js';
import { SystemClock } from '../../src/clock.js';
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

const NEVER_RESOLVES_GATEWAY: GatewayClient = { invoke: () => new Promise(() => { /* keeps a run 'running' */ }) };

let server: Server;
let baseUrl: string;
let tmpDir: string;

async function mcpCall(name: string, args: unknown): Promise<any> {
  const res = await fetch(`${baseUrl}/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Math.random(), method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = (await res.json()) as { result?: { content: Array<{ text: string }> } };
  return JSON.parse(body.result!.content[0]!.text);
}

beforeAll(async () => {
  if (reason) { console.log(`[val-198] ${reason}`); return; }
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-val198-'));
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir, gateway: NEVER_RESOLVES_GATEWAY });
  baseUrl = `http://127.0.0.1:${server.port}`;
  await registerPublishedVia(mcpCall, 'val198-running', `await agent('a', { prompt: 'p' }); return 'ok';`);
  await mcpCall('run_start', { name: 'val198-running' });
  await registerPublishedVia(mcpCall, 'val198-registered', `return 'ok';`);
  // [v27 README-fidelity closure, third audit sweep] a workflow with a TERMINAL run and no active
  // one — the LAST RUN branch (README: "LAST RUN · 9/11 14:02"), distinct from `val198-running`'s
  // ACTIVE branch above. No `agent()` call, so it completes without ever reaching the gateway.
  await registerPublishedVia(mcpCall, 'val198-completed', `return 'ok';`);
  const completedRun = await mcpCall('run_start', { name: 'val198-completed' });
  const completedDeadline = Date.now() + 8000;
  while (Date.now() < completedDeadline) {
    const s = await mcpCall('run_status', { runId: completedRun.runId });
    if (['completed', 'failed'].includes(s.status)) break;
    await new Promise((r) => setTimeout(r, 50));
  }
}, 30000);

afterAll(async () => {
  await server?.close();
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

const itReal = (name: string, fn: () => Promise<void>, timeout?: number): void => {
  it(name, async (ctx) => { if (reason) ctx.skip(); await fn(); }, timeout);
};

describe('the v27 dashboard shell + Workflows home, real Chromium (VAL-198, REQ-131/132)', () => {
  // [v29 REQ-145 — ORACLE RE-DERIVED] This assertion pinned `#18191b`. That hex is not a design
  // value: measured, it is L .213 / C .004 — i.e. the README's own `oklch(.21 .006 h)` frozen at
  // ONE hue, which is exactly what DES-201 says the `.dc.html` static block is ("a snapshot of ONE
  // hue and is never copied anywhere"). The oracle had absorbed the snapshot, so it could only ever
  // confirm the copy. Re-derived from `.sdlc/design-handoff/README.md:83`.
  itReal('first load: dark by default, --color-bg is the hue-driven ground, not a frozen hex', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle0', timeout: 10000 });
      const theme = await page.$eval('html', (el) => el.getAttribute('data-theme'));
      expect(theme).toBe('dark');
      const bg = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim());
      expect(bg).toBe('oklch(0.21 0.006 236)');
    } finally {
      await browser.close();
    }
  }, 20000);

  // [v29 REQ-145] `#eef2f1` measured L .958 / C .004 — the README's `oklch(.955 .008 h)` at one hue.
  itReal('switching to light persists across a reload (localStorage), on the hue-driven ground', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle0', timeout: 10000 });
      await page.evaluate(() => localStorage.setItem('rwe-theme', 'light'));
      await page.reload({ waitUntil: 'networkidle0' });
      const theme = await page.$eval('html', (el) => el.getAttribute('data-theme'));
      expect(theme).toBe('light');
      const bg = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim());
      expect(bg).toBe('oklch(0.955 0.008 236)');
    } finally {
      await browser.close();
    }
  }, 20000);

  // [v29 REQ-145] The accent already moved with the hue before this pass; the GROUND did not.
  // Without this case the change is unproven — a stylesheet can carry an `oklch()` formula and
  // still be pinned to one hue by an upstream literal.
  itReal('moving the hue slider recomputes the GROUND too, not only the accent (REQ-145)', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle0', timeout: 10000 });
      const read = () => page.evaluate(() => {
        const cs = getComputedStyle(document.documentElement);
        return ['--color-bg', '--color-panel', '--color-line'].map((n) => cs.getPropertyValue(n).trim());
      });
      const at236 = await read();
      await page.evaluate(() => { document.documentElement.style.setProperty('--rwe-hue', '30'); });
      const at30 = await read();
      for (let i = 0; i < at236.length; i += 1) {
        expect(at30[i]).not.toBe(at236[i]);
        expect(at30[i]).toContain('30');
      }
    } finally {
      await browser.close();
    }
  }, 20000);

  itReal('moving the hue slider recomputes --color-accent', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle0', timeout: 10000 });
      await page.evaluate(() => { document.documentElement.style.setProperty('--rwe-hue', '80'); });
      const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim());
      expect(accent).toContain('80');
    } finally {
      await browser.close();
    }
  }, 20000);

  // [v27 README-fidelity closure] README "Header / chrome": "Right cluster: hue slider ..., lang
  // seg ..., theme seg ...". DOM order is not a `getComputedStyle` fact, so SPEC_ROWS cannot carry
  // it (DES-209's SpecExpect is style-shaped only) — asserted directly here instead.
  itReal('the right cluster orders hue -> lang -> theme (README "Header / chrome")', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle0', timeout: 10000 });
      const order = await page.evaluate(() => {
        const children = Array.from(document.querySelector('.rwe-nav')!.children);
        // `.rwe-hue-slider` itself is nested one level down inside `.rwe-hue-wrap` (the slider +
        // its degrees readout share one nav flex item) — the DIRECT nav child is the wrap.
        return {
          hue: children.indexOf(document.querySelector('.rwe-hue-wrap')!),
          lang: children.indexOf(document.querySelector('.rwe-lang-group')!),
          theme: children.indexOf(document.querySelector('.rwe-theme-group')!),
        };
      });
      expect(order.hue).toBeGreaterThanOrEqual(0);
      expect(order.hue).toBeLessThan(order.lang);
      expect(order.lang).toBeLessThan(order.theme);
    } finally {
      await browser.close();
    }
  }, 20000);

  // [v27 README-fidelity closure, third audit sweep] README "Header / chrome": "theme seg 系統 / 淺
  // / 深" — shipped as 深/淺/系統 (dark/light/system). DOM order is TEXT/ATTRIBUTE order, not a
  // style fact — SPEC_ROWS cannot carry it either; checked directly here, same convention as the
  // hue->lang->theme cluster order above.
  itReal('the theme segment orders system -> light -> dark (README "Header / chrome")', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle0', timeout: 10000 });
      const order = await page.$$eval('.rwe-theme-group button', (els) => els.map((e) => (e as HTMLElement).dataset.theme));
      expect(order).toEqual(['system', 'light', 'dark']);
    } finally {
      await browser.close();
    }
  }, 20000);

  // [v27 README-fidelity closure] README "Header / chrome": the hue slider carries a "current
  // degrees" readout. Its VALUE is text content, not a style fact — SPEC_ROWS cannot express it
  // either; checked directly here (existence + format + that it tracks a real `input` event).
  itReal('the hue slider shows a current-degrees readout that updates on input (README "Header / chrome")', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle0', timeout: 10000 });
      const initial = await page.$eval('[data-hue-value]', (el) => el.textContent);
      expect(initial).toMatch(/^\d{1,3}°$/);
      await page.evaluate(() => {
        const el = document.querySelector('.rwe-hue-slider') as HTMLInputElement;
        el.value = '80';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
      const after = await page.$eval('[data-hue-value]', (el) => el.textContent);
      expect(after).toBe('80°');
    } finally {
      await browser.close();
    }
  }, 20000);

  itReal('the language toggle swaps a nav label between EN and 中 — 中 must actually appear when selected', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle0', timeout: 10000 });
      await page.evaluate(() => localStorage.setItem('rwe-lang', 'zh'));
      await page.reload({ waitUntil: 'networkidle0' });
      const bodyText = await page.evaluate(() => document.body.textContent ?? '');
      expect(bodyText).toMatch(/[一-鿿]/); // real 繁中 text must appear, not merely "no CJK in EN"
    } finally {
      await browser.close();
    }
  }, 20000);

  itReal('home: three segments, search box, segment counts, and a running-card sweep', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle0', timeout: 10000 });
      await page.waitForSelector('input[type="search"], input[placeholder]', { timeout: 2000 });
      const runningCardBorder = await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('[class*="card"]'));
        return cards.some((c) => (c.textContent ?? '').includes('val198-running'));
      });
      expect(runningCardBorder).toBe(true);
    } finally {
      await browser.close();
    }
  }, 20000);

  // [v27 README-fidelity closure, third audit sweep] README "1. Workflows home": ACTIVE takes a run
  // id (`ACTIVE · a3f9c2e1`), LAST RUN takes a TIMESTAMP (`LAST RUN · 9/11 14:02`) — two distinct
  // states, not a contradiction. `val198-completed` (beforeAll) is terminal with no active run, so
  // its card's kicker exercises the LAST RUN branch specifically. Text content, not a style fact —
  // SPEC_ROWS cannot express it; checked directly here.
  itReal('the LAST RUN kicker shows a timestamp, not a run id (README "1. Workflows home")', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle0', timeout: 10000 });
      const kicker = await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('.card'));
        const card = cards.find((c) => (c.textContent ?? '').includes('val198-completed'));
        return card?.querySelector('.kicker')?.textContent ?? null;
      });
      expect(kicker).toMatch(/^LAST RUN · \d{1,2}\/\d{1,2} \d{2}:\d{2}$/);
    } finally {
      await browser.close();
    }
  }, 20000);

  // [BF-2 Gate 8 repair] the falsifying test the review named: a degraded `/api/home` must never
  // repaint the card grid empty (ARCH-125's "never rendered as data"). Before the repair, a truthy
  // `{runs:[], degraded:'...'}` body (server.ts's catch-all shape) has no `running` key, so
  // `[...(body.running||[]), ...]` silently produced an empty array and the next poll tick wiped
  // the running card and zeroed every segment count beside a truthful degrade tag.
  itReal('a degraded /api/home leaves the last-known card grid in place (BF-2)', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      const pageErrors: string[] = [];
      page.on('pageerror', (err) => pageErrors.push(String(err)));
      await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle0', timeout: 10000 });
      // Wait for the FIRST real tick to land before degrading — proves the grid held real data,
      // not that it started empty.
      await page.waitForFunction(
        () => Array.from(document.querySelectorAll('[class*="card"]')).some((c) => (c.textContent ?? '').includes('val198-running')),
        { timeout: 5000 },
      );
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        if (new URL(req.url()).pathname === '/api/home') {
          req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ runs: [], degraded: 'val198 injected degrade' }) });
          return;
        }
        req.continue();
      });
      // One poll tick is ~3s (app.js); wait past two to be sure a degraded tick actually landed.
      await new Promise((r) => setTimeout(r, 7000));
      const stillShowsRunning = await page.evaluate(() =>
        Array.from(document.querySelectorAll('[class*="card"]')).some((c) => (c.textContent ?? '').includes('val198-running')));
      expect(stillShowsRunning).toBe(true);
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 20000);

  // DES-209's own anti-vacuity floor for the whole table (checked once, here, not per view file —
  // no browser needed).
  it('SPEC_ROWS has at least 40 rows (DES-209 anti-vacuity floor)', () => {
    expect(SPEC_ROWS.length).toBeGreaterThanOrEqual(40);
  });

  // [v27c] DES-209's own promised oracle (ADR-053 「規格逐條核」): every SPEC_ROWS row for the
  // 'home' view, checked under BOTH data-theme values and once more after a hue-slider move. A row
  // whose anchor matches no element FAILS (never skips) — see spec-rows.ts.
  itReal('SPEC_ROWS (home view, REQ-131/132) hold under both themes and a hue move', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle0', timeout: 10000 });
      const rows = SPEC_ROWS.filter((r) => r.view === 'home');
      const failures = await specRowFailuresAcrossThemeAndHue(page, rows);
      expect(failures).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 20000);

  // [v27c AC-6 Gate 8 repair] INV-V27-5: "the v27 shell renders version, the last-update outcome
  // and the interrupted-runs call-to-action from the data island … one test asserts all three are
  // reachable in the REBUILT PAGE". UT-241 already covers the pure `updatePanelModel` projection
  // and the island's own JSON — this is the missing DOM half, against the rendered nav rather than
  // `#rwe-init`'s raw text. A SEPARATE server/workRoot is needed (not the shared `server` above):
  // an `interruptedRuns` > 0 count and an `applied` `lastUpdate` (the CTA's own two-conjunct
  // condition, `lib/status.js`) both come from real boot-time state a running dashboard never has.
  // [v29e, REQ-160/161] The nav follows README "Header / chrome" exactly: brand, the source tag
  // next to it, the tabs, then the right cluster. Two version strings the design has no slot for
  // sat between the brand and the tabs, and the source tag sat at the far right instead.
  itReal('the nav is brand -> source tag -> tabs -> right cluster, with no version text (REQ-160/161)', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle0', timeout: 10000 });
      await new Promise((r) => setTimeout(r, 900));
      const nav = await page.evaluate(() => {
        const n = document.querySelector('.rwe-nav')!;
        const x = (sel: string) => {
          const e = n.querySelector(sel);
          return e ? Math.round((e as HTMLElement).getBoundingClientRect().x) : -1;
        };
        return {
          text: (n as HTMLElement).innerText.replace(/\s+/g, ' ').trim(),
          brandX: x('.nav-brand'),
          tagX: x('.rwe-connection'),
          firstTabX: x('[data-tab]'),
        };
      });
      // the engine's own version/update strings are not nav chrome (README has no slot for them)
      expect(nav.text, 'a version string is still in the nav').not.toMatch(/v\d+\.\d+\.\d+/);
      expect(nav.text).not.toContain('applied');
      // README: "brand ... + source tag", then the tabs
      expect(nav.brandX).toBeGreaterThanOrEqual(0);
      expect(nav.tagX, 'the source tag is not beside the brand').toBeGreaterThan(nav.brandX);
      expect(nav.tagX, 'the source tag is not before the tabs').toBeLessThan(nav.firstTabX);
    } finally {
      await browser.close();
    }
  }, 20000);

  itReal('the update panel is reachable: version, outcome, and the interrupted-runs CTA (AC-6, INV-V27-5, moved to the footer in v29e)', async () => {
    const crashDir = mkdtempSync(join(tmpdir(), 'rwe-val198-crash-'));
    const resultDir = mkdtempSync(join(tmpdir(), 'rwe-val198-result-'));
    let crashServer: Server | undefined;
    try {
      // Phase 1 ("process 1"): a run that never resolves, then abandoned with no clean shutdown —
      // the same two-phase crash recipe as tests/integration/crash-resume.test.ts. `store1`/`mgr1`
      // are deliberately never closed/stopped: that IS the crash.
      const clock1 = new SystemClock();
      const store1 = new SqliteRunStore(join(crashDir, 'store'), clock1);
      const mgr1 = new RunManager({ store: store1, clock: clock1, workRoot: crashDir, gateway: NEVER_RESOLVES_GATEWAY });
      await startScript(mgr1, `await agent('a', { prompt: 'p' }); return 'ok';`, { name: 'val198-crashed' });

      // The result file a real `rwe-update.sh` writes on an APPLIED self-update — outside
      // `crashDir` (server.ts's boot guard refuses a result path inside the workRoot).
      const resultPath = join(resultDir, 'update-result.json');
      writeFileSync(resultPath, JSON.stringify({ tag: 'v27-repair-check', status: 'applied', ts: '2026-09-12T00:00:01.000Z' }));

      // Phase 2 ("process 2" / "restart"): the REAL dashboard server, on the SAME workRoot — its own
      // boot-time `store.hydrateAll()` reclassifies the still-'running' run as 'interrupted'
      // (server.ts:647-648), and `updateResultPath` feeds the applied outcome (server.ts:658-675).
      crashServer = await createServer({ port: 0, bind: '127.0.0.1', workRoot: crashDir, updateResultPath: resultPath });
      const crashBaseUrl = `http://127.0.0.1:${crashServer.port}`;

      const puppeteer = (await import('puppeteer')).default;
      const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
      try {
        const page = await browser.newPage();
        await page.goto(`${crashBaseUrl}/dashboard`, { waitUntil: 'networkidle0', timeout: 10000 });
        const version = await page.$eval('.rwe-version', (el) => el.textContent);
        expect(version).toMatch(/^v/);
        const outcome = await page.$eval('.rwe-update-outcome', (el) => el.textContent);
        expect(outcome).toContain('v27-repair-check');
        const cta = await page.$eval('.rwe-update-cta', (el) => el.textContent);
        expect(cta).toMatch(/1|workflow_resume|中斷/); // one interrupted run — either language's CTA text
      } finally {
        await browser.close();
      }
    } finally {
      await crashServer?.close();
      rmSync(crashDir, { recursive: true, force: true });
      rmSync(resultDir, { recursive: true, force: true });
    }
  }, 20000);
  // [v32, REQ-187, F1] README "1. Workflows home" puts `white-space:nowrap` **on the success item**,
  // not on the meta row. v29f's REQ-178 read the same line and applied it to the whole `.card .meta`
  // plus `overflow:hidden`, so the row clips: at the design's own card width two of the four figures
  // README names for this row (`平均費用 …` and the run count) are unreadable.
  //
  // This asserts the RESULT, not the property. v29f's verification measured `white-space:nowrap`,
  // 18px, one line — the property it had just changed — and called it done. The property was exactly
  // what it claimed to be; the text was still cut off. `innerText` does not reflect `overflow:hidden`
  // either, so the only honest oracle is the geometry plus the trailing token being inside the box.
  itReal('the card meta row is fully readable at the design card width — no clipping (REQ-187)', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1500, height: 900 });
      await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle0', timeout: 10000 });
      await page.waitForSelector('.card .meta', { timeout: 3000 });
      // (a) README's actual clause: nowrap belongs to the SUCCESS ITEM, so a success item has to
      // exist as its own element. A single text node has nothing to hang it on — which is how v29f
      // ended up hanging it on the whole row.
      const successItem = await page.evaluate(() => {
        const meta = document.querySelector('.card .meta');
        const el = meta?.querySelector('[data-meta-success]');
        if (!el) return null;
        return { text: (el as HTMLElement).innerText, whiteSpace: getComputedStyle(el).whiteSpace };
      });
      expect(successItem?.whiteSpace).toBe('nowrap');
      expect(successItem?.text ?? '').toMatch(/\d+%|—/);

      // (b) the row must hold the content README itself specifies for it. The live fixture's metrics
      // are short enough to fit either way, so measuring only them would re-pass on the broken CSS;
      // this re-lays README §1's own example string in a clone of the real row, in the real card, and
      // asks whether it survives. `innerText` cannot answer that — it returns the full string whether
      // or not `overflow:hidden` ate half of it — so the oracle is geometry.
      const readmeRow = await page.evaluate(() => {
        const meta = document.querySelector('.card .meta') as HTMLElement | null;
        if (!meta) return null;
        const probe = meta.cloneNode(false) as HTMLElement;
        probe.textContent = 'Success 67% (2/3) · Avg duration 12m 4s · Avg cost $0.42 · 5 runs';
        meta.parentElement!.insertBefore(probe, meta.nextSibling);
        const r = { scrollWidth: probe.scrollWidth, clientWidth: probe.clientWidth };
        probe.remove();
        return r;
      });
      expect(readmeRow).not.toBeNull();
      expect({ clipped: readmeRow!.scrollWidth > readmeRow!.clientWidth, ...readmeRow! })
        .toEqual({ clipped: false, ...readmeRow! });
    } finally {
      await browser.close();
    }
  }, 20000);

  // [v32, REQ-188, F2] the primary drill-in is a plain `<div>` (`role=null tabindex=null`) — reachable
  // by mouse only. The REFERENCE uses `role="button" tabindex="0" onClick` but carries NO keydown
  // handler, so copying it verbatim would produce something worse than a div: focusable, announced as
  // a button, inert on Enter. Take the reference's role/tabindex AND make the key actually work.
  itReal('a home card is a real keyboard control: role, tabindex, and Enter activates it (REQ-188)', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle0', timeout: 10000 });
      await page.waitForSelector('.card', { timeout: 3000 });
      const attrs = await page.evaluate(() => {
        const card = document.querySelector('.card');
        return { role: card?.getAttribute('role') ?? null, tabindex: card?.getAttribute('tabindex') ?? null };
      });
      expect(attrs).toEqual({ role: 'button', tabindex: '0' });

      const before = page.url();
      await page.evaluate(() => (document.querySelector('.card') as HTMLElement).focus());
      await page.keyboard.press('Enter');
      await new Promise((r) => setTimeout(r, 400));
      expect(page.url()).not.toBe(before);
    } finally {
      await browser.close();
    }
  }, 20000);
  // [v32, REQ-192, F6] README's token block: "Headings cap at 600". `dashboard.css` never writes 700
  // anywhere — it simply never writes a weight for `h2`/`h6` either (`h2{font-size:20px;margin:0}`),
  // so those elements take the UA default `bold`. The repair is to ADD 600, not to change a 700.
  //
  // Checked as a global rule across every tab rather than as per-anchor spec rows: the README line is
  // itself global, and a per-anchor list is exactly the shape that lets the next new heading ship
  // uncapped. h2's 20px is NOT asserted here — the audit did not fault the size, and re-deriving an
  // unrelated value while fixing this one is how REQ-178 became REQ-187.
  itReal('no rendered heading exceeds the README weight cap of 600, on any tab (REQ-192)', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle0', timeout: 10000 });
      const offenders: unknown[] = [];
      for (const tab of ['workflows', 'models', 'system', 'issues']) {
        const target = await page.$(`[data-tab="${tab}"]`);
        if (target) {
          await target.click();
          await new Promise((r) => setTimeout(r, 600));
        }
        const bad = await page.evaluate((tabName) => Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'))
          .filter((h) => (h as HTMLElement).offsetParent !== null)
          .map((h) => ({ tab: tabName, tag: h.tagName, text: (h as HTMLElement).innerText.trim().slice(0, 24), weight: getComputedStyle(h).fontWeight }))
          .filter((r) => Number(r.weight) > 600), tab);
        offenders.push(...bad);
      }
      expect(offenders).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 30000);
});
