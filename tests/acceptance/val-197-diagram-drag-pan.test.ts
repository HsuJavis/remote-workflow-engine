// VAL-197 (v26 Gate 7.5 round 3, defect D10, REQ-129 / DES-186 / ARCH-120): the author's diagram
// must drag-pan under a REAL mouse, and must STOP when the button is released.
//
// What round 3 measured on the real deployment: `#diagram-img` is an `<img>` with the default
// `draggable`, so a real press-and-move starts the BROWSER's own image drag — `dragstart` fires,
// every later mousemove arrives as a `drag` event the page never sees, and no `mouseup` is
// delivered at all (only `dragend`). A (-180,-90) gesture therefore moved the figure by exactly one
// mousemove, `translate(-18px,-9px)`, and left `initZoomable`'s `dragging` flag stuck true: moving
// the mouse afterwards WITH NO BUTTON HELD panned the figure to `translate(200px,100px)`. The run
// DAG is an `<svg>`, has no native drag, and pans correctly — which is why VAL-193's single
// drag-pan line was true and still missed this.
//
// Only a real Chromium can see either half: a synthetic `dispatchEvent` sequence never starts a
// native image drag, so it passes against the broken page.
//
// Mock policy (acceptance): real createServer(), real MCP HTTP, real sandbox child, real dashboard
// page, real server-side mermaid render (mmdc + headless Chrome), real Chromium, real mouse input.
// Nothing about this case touches a provider, so no gateway is injected.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { resolveMmdcCli } from '../../src/diagram-render.js';
import { registerPublishedVia } from '../helpers/workflow-fixtures.js';
import { throwIfBrowserRequired } from '../helpers/require-browser.js';

/** Same probe val-169 / val-193 use. */
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
// v27 (DES-191, TASK-196, UT-232): fail instead of skip when the browser tier is required — only
// the Chrome half (mmdc's absence is a distinct, legitimately-skippable tool gap).
throwIfBrowserRequired(chrome);
const mmdc = resolveMmdcCli();
// Both are needed: with no mmdc the diagram route never answers an SVG, the <img> never gets a src,
// and there is nothing to drag — that must SKIP with a reason, not fail as if the fix regressed.
const reason = chrome ? (mmdc ? null : 'SKIPPED: no mermaid-cli (mmdc) on this host') : 'SKIPPED: no puppeteer Chrome found (set PUPPETEER_EXECUTABLE_PATH)';

const WF = 'val197-diagram';
let server: Server;
let tmpDir: string;

async function mcpCall(name: string, args: unknown): Promise<any> {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Math.random(), method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = (await res.json()) as { result?: { content: Array<{ text: string }> } };
  return JSON.parse(body.result!.content[0]!.text);
}

beforeAll(async () => {
  if (reason) { console.log(`[val-197] ${reason}`); return; }
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-val197-'));
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir });
  // Never run: this case is about the REGISTERED workflow's own figure, which needs no run at all.
  await registerPublishedVia(mcpCall, WF, `
    phase('one');
    await agent('alpha', { prompt: 'p' });
    await agent('bravo', { prompt: 'p' });
    phase('two');
    await agent('charlie', { prompt: 'p' });
    return 'ok';
  `);
}, 40000);

afterAll(async () => {
  await server?.close();
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

const itReal = (name: string, fn: () => Promise<void>, timeout?: number): void => {
  it(name, async (ctx) => { if (reason) ctx.skip(); await fn(); }, timeout);
};

describe("the author's diagram drag-pans under a real mouse, and stops on mouseup (VAL-197, D10, REQ-129)", () => {
  itReal('a real (-180,-90) drag moves the figure the FULL delta, and a no-button move afterwards moves nothing', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      // [v27 README-fidelity closure] height bumped 900->1000: the nav's own `flex-wrap` now
      // breaks one row earlier at 1100px width (measured — README "Header / chrome"'s hue-slider
      // degrees readout + the hue->lang->theme reorder leave `.rwe-nav` zero spare px at this
      // width even before either landed, so ANY addition here wraps one more row), which pushed
      // the diagram's centre to y=901, 1px past a 900px viewport. Not a drag-pan behaviour change
      // — the delta assertions below are untouched; only the window is taller so the real mouse
      // gesture below still lands ON the figure.
      await page.setViewport({ width: 1100, height: 1000 });
      await page.goto(`http://127.0.0.1:${server.port}/dashboard`, { waitUntil: 'networkidle0' });
      // A real click on the workflow's own home card — the only way into the author view.
      await page.waitForSelector('.card');
      const opened = await page.evaluate((wf: string) => {
        const cards = Array.from((globalThis as any).document.querySelectorAll('.card')) as any[];
        const card = cards.find((c) => (c.querySelector('.t')?.textContent ?? '') === wf);
        if (!card) return false;
        card.click();
        return true;
      }, WF);
      expect(opened).toBe(true);

      // The server-side mermaid render takes seconds; a mousedown on a zero-height img would miss.
      await page.waitForFunction(() => {
        const img = (globalThis as any).document.getElementById('diagram-img');
        return !!img && img.complete && img.naturalWidth > 0 && img.getBoundingClientRect().height > 20;
      }, { timeout: 60000 });

      const centre = await page.$eval('#diagram-img', (el: any) => {
        const r = el.getBoundingClientRect();
        return { cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2) };
      });
      const norm = (t: string): string => t.replace(/\s+/g, '');
      const transform = async (): Promise<string> => norm(await page.$eval('#diagram-zoom', (el: any) => el.style.transform as string));

      // A REAL drag: press, several moves, release.
      await page.mouse.move(centre.cx, centre.cy);
      await page.mouse.down();
      await page.mouse.move(centre.cx - 180, centre.cy - 90, { steps: 12 });
      await page.mouse.up();
      // The FULL requested delta — round 3 got translate(-18px,-9px), one mousemove, because the
      // browser's native image drag swallowed the rest.
      expect(await transform()).toBe('translate(-180px,-90px)scale(1)');

      // After the release the figure must not follow the cursor: round 3's `dragging` flag stayed
      // true because `mouseup` never arrived, and this move panned it to translate(200px,100px).
      const afterDrag = await transform();
      await page.mouse.move(centre.cx + 200, centre.cy + 100, { steps: 8 });
      expect(await transform()).toBe(afterDrag);
    } finally {
      await browser.close();
    }
  }, 120000);
});
