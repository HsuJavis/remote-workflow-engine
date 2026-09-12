// VAL-193 (v26 Gate 7.5 round 1, defects D8 + REQ-129's fit clause): the two dashboard findings
// round 1 left red, locked in a REAL browser.
//
// (1) REQ-129 「並有『fit』重置」 — after a real drag-pan on the run DAG, a real MOUSE click on
//     `#dag-fit` must reset the transform. Round 1 found it does nothing: `#dag-zoom` is a
//     TRANSFORMED element, which paints in the positioned layer above the in-flow button that
//     precedes it, so once the pan translates the graph upward it covers the control.
//     `document.elementFromPoint(<centre of #dag-fit>)` returned `svg#dag-graph`. A programmatic
//     `.click()` still reset — which is exactly why only a real click can see this.
// (2) D8 — the dashboard rendered the four-column token SUM and nothing else, while both API
//     surfaces show all four. REQ-127 names the dashboard among the surfaces where a human must be
//     able to read input / output / cacheRead / cacheWrite without leaving the page.
//
// Mock policy (acceptance): real createServer(), real MCP HTTP, real sandbox child process, real
// dashboard page, real Chromium, real mouse events. The gateway's provider network is the one
// genuinely un-runnable third-party boundary and is faked through the SAME `createServer({gateway})`
// seam IT-148 / dag-masking-auth use — the agent RECORDS this test reads are produced by the real
// capture path from that result, not hand-written into the store.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import type { GatewayClient } from '../../src/gateway/client.js';
import { registerPublishedVia } from '../helpers/workflow-fixtures.js';
import { throwIfBrowserRequired } from '../helpers/require-browser.js';

/** Same probe val-169-diagram-render.test.ts uses: puppeteer's own executable override first, then
 *  whatever revision its cache holds. A host with no Chrome skips with the reason printed. */
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
// v27 (DES-191, TASK-196, UT-232): fail instead of skip when the browser tier is required.
throwIfBrowserRequired(chrome);

/** Four distinct, non-zero, mutually distinguishable columns — a sum-only render cannot fake them. */
const TOKENS = { input: 39, output: 2, cacheRead: 5, cacheWrite: 7 };
const FAKE_GATEWAY: GatewayClient = {
  async invoke() {
    return { ok: true, provider: 'anthropic', model: 'claude-3-5-sonnet-20241022', tokens: { ...TOKENS }, content: 'x' };
  },
} as GatewayClient;

let server: Server;
let baseUrl: string;
let tmpDir: string;
let runId: string;

async function mcpCall(name: string, args: unknown): Promise<any> {
  const res = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Math.random(), method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = (await res.json()) as { result?: { content: Array<{ text: string }> } };
  return JSON.parse(body.result!.content[0]!.text);
}

beforeAll(async () => {
  if (reason) { console.log(`[val-193] ${reason}`); return; }
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-val193-'));
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir, gateway: FAKE_GATEWAY });
  baseUrl = `http://127.0.0.1:${server.port}`;
  await registerPublishedVia(mcpCall, 'val193', `
    phase('one');
    await agent('a', { prompt: 'p' });
    await agent('b', { prompt: 'p' });
    phase('two');
    await agent('c', { prompt: 'p' });
    await agent('d', { prompt: 'p' });
    return 'ok';
  `);
  const run = await mcpCall('run_start', { name: 'val193' });
  runId = run.runId;
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const s = await mcpCall('run_status', { runId });
    if (['completed', 'failed'].includes(s.status)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
}, 40000);

afterAll(async () => {
  await server?.close();
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

const itReal = (name: string, fn: () => Promise<void>, timeout?: number): void => {
  it(name, async (ctx) => { if (reason) ctx.skip(); await fn(); }, timeout);
};

describe('the run DAG: Fit survives a pan, and the four token columns are readable (VAL-193, D8/REQ-129)', () => {
  itReal('a REAL mouse click on Fit resets the transform after a REAL drag-pan', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1100, height: 900 });
      await page.goto(`${baseUrl}/dashboard/${runId}`, { waitUntil: 'networkidle0' });
      await page.waitForSelector('#dag-fit');
      // The graph has to have real height, or nothing can cover anything.
      const svgHeight = await page.$eval('#dag-graph', (el: any) => el.getBoundingClientRect().height);
      expect(svgHeight).toBeGreaterThan(60);

      const box = await page.$eval('#dag-fit', (el: any) => {
        const r = el.getBoundingClientRect();
        return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
      });

      // A REAL drag-pan: press inside the graph, move up-left, release.
      await page.mouse.move(600, 400);
      await page.mouse.down();
      await page.mouse.move(400, 300, { steps: 12 });
      await page.mouse.up();
      // Chromium normalizes the inline transform it re-serializes, so compare with spaces stripped.
      const norm = (t: string): string => t.replace(/\s+/g, '');
      const panned = norm(await page.$eval('#dag-zoom', (el: any) => el.style.transform as string));
      expect(panned).not.toBe('translate(0px,0px)scale(1)');

      // The control must still be the topmost element at its own centre.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const hit = await page.evaluate(({ cx, cy }: { cx: number; cy: number }) => {
        const el = (globalThis as any).document.elementFromPoint(cx, cy);
        return el ? `${el.tagName.toLowerCase()}#${el.id}` : 'none';
      }, box);
      expect(hit).toBe('button#dag-fit');

      // A REAL mouse click — never `.click()`, which reset even while the bug was live.
      await page.mouse.click(box.cx, box.cy);
      const afterFit = norm(await page.$eval('#dag-zoom', (el: any) => el.style.transform as string));
      expect(afterFit).toBe('translate(0px,0px)scale(1)');
    } finally {
      await browser.close();
    }
  }, 60000);

  itReal('all four token columns are readable on the run page, not just their sum', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1100, height: 900 });
      await page.goto(`${baseUrl}/dashboard/${runId}`, { waitUntil: 'networkidle0' });
      await page.waitForSelector('#run-usage span');

      // The run total over four agents of {input:39, output:2, cacheRead:5, cacheWrite:7}. Four
      // DISTINCT numbers: a sum-only render (191 tok) cannot satisfy all four.
      const usageText = await page.$eval('#run-usage', (el: any) => el.textContent ?? '');
      expect(usageText).toMatch(/in\D*156/);
      expect(usageText).toMatch(/out\D*8/);
      expect(usageText).toMatch(/cache[^0-9]*r?\D*20/);
      expect(usageText).toMatch(/28/);
      // The cost and the honest-absence marker stay (REQ-127's own clause).
      expect(usageText).toMatch(/\$/);
    } finally {
      await browser.close();
    }
  }, 60000);

  // M-4 send-back repair (ARCH-118, REQ-127): the RUN-LEVEL total above already carried all four
  // columns; the PER-CELL cost attribution on the DAG itself did not — `run_status.agents[]` and
  // the dashboard agent detail both name the surface. Extends this same case rather than a new
  // file, per its own header's "real Chromium, real mouse events" scope.
  // [v27c] Re-pointed under the orchestrator's Gate 1 C2 authorization (state.yaml `pending:`):
  // DES-209 moves this line out of SVG `<text>` into an HTML `.cell-usage` element sitting in
  // `.cell-layer`, a sibling of `#dag-graph` inside `#dag-zoom` — `#dag-graph` itself is untouched
  // and still the lane hairlines + edges. Only the selector changes; the proof (own token count AND
  // cost per cell, not the run sum) is identical.
  itReal('each agent cell on the run DAG shows its own token count and cost, not just the run total', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1100, height: 900 });
      await page.goto(`${baseUrl}/dashboard/${runId}`, { waitUntil: 'networkidle0' });
      await page.waitForSelector('#dag-graph'); // the anchor survives; only its text descendant moved.
      await page.waitForSelector('.cell-usage');

      const cellTexts = await page.$$eval('.cell-usage', (nodes: any[]) => nodes.map((n) => n.textContent ?? ''));
      // At least one per-cell line (distinct from the label lines and the warnings badge) names a
      // token count AND a dollar figure — the per-agent cost attribution this repair adds.
      const usageLines = cellTexts.filter((t: string) => /tok/.test(t) && /\$/.test(t));
      expect(usageLines.length).toBeGreaterThan(0);
      // The per-agent sum (53 = 39+2+5+7) is readable on at least one cell — proves it reads the
      // REAL per-call record, not a repeated/hardcoded figure.
      expect(usageLines.some((t: string) => /53\s*tok/.test(t))).toBe(true);
    } finally {
      await browser.close();
    }
  }, 60000);
});
