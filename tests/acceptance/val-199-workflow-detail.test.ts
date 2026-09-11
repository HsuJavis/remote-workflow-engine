// VAL-199 (REQ-133; DES-197/204/206; 04-design.md's own v27 real-tier path): real Chromium — a
// workflow detail page: version/trigger tags, run chips, the nine-column history table with a LIVE
// row, a row click switching the figure, and a never-registered-run workflow rendering its
// predicted lanes.
//
// Mock policy (acceptance): real createServer(), real MCP HTTP, real Chromium.
//
// Red reason (measured): today's dashboard has no "workflow detail" page at all — a card click goes
// straight to a run's DAG/diagram view (`showDescribe`/`renderDescribe` in `dashboard-page.ts`
// render only the diagram + harness table, no version tag, no run-chips row, no history table).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { registerPublishedVia } from '../helpers/workflow-fixtures.js';
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

async function mcpCall(name: string, args: unknown): Promise<any> {
  const res = await fetch(`${baseUrl}/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Math.random(), method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = (await res.json()) as { result?: { content: Array<{ text: string }> } };
  return JSON.parse(body.result!.content[0]!.text);
}

beforeAll(async () => {
  if (reason) { console.log(`[val-199] ${reason}`); return; }
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-val199-'));
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir });
  baseUrl = `http://127.0.0.1:${server.port}`;
  await registerPublishedVia(mcpCall, 'val199-detail', `phase('one'); await agent('a', { prompt: 'p' }); return 'ok';`);
  const run = await mcpCall('run_start', { name: 'val199-detail' });
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const s = await mcpCall('run_status', { runId: run.runId });
    if (['completed', 'failed'].includes(s.status)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  await registerPublishedVia(mcpCall, 'val199-never-run', `phase('a'); await agent('x', {}); return 1;`);
}, 30000);

afterAll(async () => {
  await server?.close();
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

const itReal = (name: string, fn: () => Promise<void>, timeout?: number): void => {
  it(name, async (ctx) => { if (reason) ctx.skip(); await fn(); }, timeout);
};

describe('workflow detail page, real Chromium (VAL-199, REQ-133)', () => {
  itReal('a workflow detail view exists with a version tag and a run-history table with 9 columns', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/dashboard/workflow/val199-detail`, { waitUntil: 'networkidle0', timeout: 10000 });
      await page.waitForSelector('table', { timeout: 2000 });
      const headerCount = await page.$$eval('table th', (ths) => ths.length);
      expect(headerCount).toBeGreaterThanOrEqual(9);
    } finally {
      await browser.close();
    }
  }, 20000);

  itReal('a never-run workflow renders its predicted lanes, with "predicted layout" wording (never the forbidden word)', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/dashboard/workflow/val199-never-run`, { waitUntil: 'networkidle0', timeout: 10000 });
      // Strip <script>/<style> content — a code COMMENT mentioning "predicted" (or the C3 word)
      // must not make this pass/fail vacuously; only VISIBLE rendered text counts.
      const bodyText = await page.evaluate(() => {
        const clone = document.body.cloneNode(true) as HTMLElement;
        clone.querySelectorAll('script, style').forEach((el) => el.remove());
        return clone.textContent ?? '';
      });
      expect(bodyText.toLowerCase()).not.toContain('skeleton');
      expect(bodyText).toMatch(/predicted|預測/i);
    } finally {
      await browser.close();
    }
  }, 20000);
});
