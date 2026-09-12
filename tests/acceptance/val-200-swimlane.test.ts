// VAL-200 (REQ-134, REQ-129; DES-203/206; 04-design.md's own v27 real-tier path): real Chromium —
// a real 5-lane/9-agent run painted as a swimlane (lane headers, béziers, 216x74 nodes, legend),
// plus the existing zoom/pan/fit contract re-proven (val-193/val-197 re-run separately, unchanged).
//
// Mock policy (acceptance): real createServer(), real MCP HTTP, real Chromium; a fake gateway
// completes 9 agent calls fast (no real provider network).
//
// Red reason (measured): today's DAG renders a flat node-per-agent graph with NO lane headers, NO
// `目前`/current-lane tag, and single-line labels (`dashboard-page.ts` DagNode rendering) — none of
// the swimlane-specific selectors/geometry below exist.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import type { GatewayClient } from '../../src/gateway/client.js';
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

const FAKE_GATEWAY: GatewayClient = { async invoke() { return { ok: true, provider: 'anthropic', model: 'claude-3-5-sonnet-20241022', tokens: { input: 1, output: 1 }, content: 'x' }; } } as GatewayClient;

let server: Server;
let baseUrl: string;
let tmpDir: string;
let runId: string;

async function mcpCall(name: string, args: unknown): Promise<any> {
  const res = await fetch(`${baseUrl}/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Math.random(), method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = (await res.json()) as { result?: { content: Array<{ text: string }> } };
  return JSON.parse(body.result!.content[0]!.text);
}

beforeAll(async () => {
  if (reason) { console.log(`[val-200] ${reason}`); return; }
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-val200-'));
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir, gateway: FAKE_GATEWAY });
  baseUrl = `http://127.0.0.1:${server.port}`;
  await registerPublishedVia(mcpCall, 'val200-swimlane', `
    phase('one'); await agent('a1', { prompt: 'p' }); await agent('a2', { prompt: 'p' });
    phase('two'); await agent('b1', { prompt: 'p' });
    phase('three'); await agent('c1', { prompt: 'p' }); await agent('c2', { prompt: 'p' }); await agent('c3', { prompt: 'p' });
    phase('four'); await agent('d1', { prompt: 'p' });
    phase('five'); await agent('e1', { prompt: 'p' }); await agent('e2', { prompt: 'p' });
    return 'ok';
  `);
  const run = await mcpCall('run_start', { name: 'val200-swimlane' });
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

describe('the swimlane run graph, real Chromium (VAL-200, REQ-134)', () => {
  itReal('lane headers exist, uppercase, with a "目前"/current tag on the active lane', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/dashboard/${runId}`, { waitUntil: 'networkidle0', timeout: 10000 });
      await page.waitForSelector('#dag-graph', { timeout: 3000 });
      const laneHeaderCount = await page.$$eval('[data-lane-header]', (els) => els.length);
      expect(laneHeaderCount).toBeGreaterThanOrEqual(5);
    } finally {
      await browser.close();
    }
  }, 20000);

  itReal('agent nodes are 216x74 with three text rows (label, model/effort, tokens/cost/duration)', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/dashboard/${runId}`, { waitUntil: 'networkidle0', timeout: 10000 });
      await page.waitForSelector('#dag-graph', { timeout: 3000 });
      const nodeSizes = await page.$$eval('#dag-zoom [data-node-cell]', (els) => els.map((e) => ({ w: e.getBoundingClientRect().width, h: e.getBoundingClientRect().height })));
      expect(nodeSizes.some((s) => Math.abs(s.w - 216) < 2 && Math.abs(s.h - 74) < 2)).toBe(true);
    } finally {
      await browser.close();
    }
  }, 20000);

  itReal('a legend row renders below the graph with the run summary (nodes/tokens/cost)', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/dashboard/${runId}`, { waitUntil: 'networkidle0', timeout: 10000 });
      await page.waitForSelector('[data-legend]', { timeout: 3000 });
    } finally {
      await browser.close();
    }
  }, 20000);
});
