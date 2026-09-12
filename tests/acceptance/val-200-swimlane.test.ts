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

// [v27c gate 6] REQ-134's is-running/is-queued/is-failed SPEC_ROWS need agents genuinely IN those
// states, at once, on one page — the base 9-agent run below always runs to completion before any
// test reads it, so it never carries one. `FAIL_MARKER` fails synchronously (a planted `ok:false`,
// same technique as val-201's stub); `HOLD_MARKER` blocks on a test-held deferred so a call stays
// `running` until the test releases it, and (behind `runConcurrency:1`) a sibling call queued
// behind it stays `queued` for the same window.
const FAIL_MARKER = 'FAIL-VAL200';
const HOLD_MARKER = 'HOLD-VAL200';
let releaseHold: (() => void) | null = null;
const FAKE_GATEWAY: GatewayClient = {
  async invoke(req) {
    if (req.prompt.includes(FAIL_MARKER)) {
      return { ok: false, provider: 'anthropic', reason: 'terminal', retryable: false, detail: 'planted failure (VAL-200 state cells)' };
    }
    if (req.prompt.includes(HOLD_MARKER)) {
      await new Promise<void>((resolve) => { releaseHold = resolve; });
    }
    return { ok: true, provider: 'anthropic', model: 'claude-3-5-sonnet-20241022', tokens: { input: 1, output: 1 }, content: 'x' };
  },
} as GatewayClient;

let server: Server;
let baseUrl: string;
let tmpDir: string;
let runId: string;
let stateRunId: string;

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
  // `runConcurrency:1` only matters to the state-cells run below (its own `parallel()` fan-out) —
  // the base run's phases already `await` each agent one at a time, so it is unaffected.
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir, gateway: FAKE_GATEWAY, runConcurrency: 1 } as never);
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

  // [v27c gate 6] a second, deliberately-NEVER-awaited-to-terminal run: phase one's `failer`
  // completes (failed) before phase two's `parallel()` starts, so by the time `runner` is
  // `running` and `waiter` is `queued` behind it, all three states coexist on one page. Left open
  // (not awaited past this point) until `afterAll` releases it — every test below that reads
  // `stateRunId` reads this same held snapshot.
  await registerPublishedVia(mcpCall, 'val200-state-cells', `
    phase('one'); await agent('failer', { prompt: '${FAIL_MARKER}' });
    phase('two'); await parallel([
      async () => agent('runner', { prompt: '${HOLD_MARKER}' }),
      async () => agent('waiter', { prompt: '${HOLD_MARKER}' }),
    ]);
    return 'ok';
  `);
  const stateRun = await mcpCall('run_start', { name: 'val200-state-cells' });
  stateRunId = stateRun.runId;
  const stateDeadline = Date.now() + 15000;
  while (Date.now() < stateDeadline) {
    const s = await mcpCall('run_status', { runId: stateRunId });
    const agents: Array<{ label?: string; state: string }> = (s.result && s.result.agents) || [];
    const failer = agents.find((a) => a.label === 'failer');
    const runner = agents.find((a) => a.label === 'runner');
    const waiter = agents.find((a) => a.label === 'waiter');
    if (failer?.state === 'failed' && runner?.state === 'running' && waiter?.state === 'queued') break;
    await new Promise((r) => setTimeout(r, 50));
  }
}, 40000);

afterAll(async () => {
  // Release the held call so the sandboxed child can exit cleanly before the server closes under
  // it — a bounded wait, not a hang: a timeout here still proceeds to `server.close()`. vitest's
  // default hook timeout is 10s, so this needs its own (passed below) wider than the internal wait.
  if (releaseHold) releaseHold();
  if (stateRunId) {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const s = await mcpCall('run_status', { runId: stateRunId }).catch(() => null);
      if (!s || ['completed', 'failed'].includes(s.status)) break;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  await server?.close();
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
}, 20000);

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

  // [v27c] DES-209's own promised oracle (ADR-053 「規格逐條核」): every SPEC_ROWS row for the
  // 'run' view, checked under BOTH data-theme values and once more after a hue-slider move. A row
  // whose anchor matches no element FAILS (never skips) — see spec-rows.ts.
  itReal('SPEC_ROWS (run view, REQ-134) hold under both themes and a hue move', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      const rows = SPEC_ROWS.filter((r) => r.view === 'run');
      // [v27c gate 6] the three state rows (is-running/is-queued/is-failed) need the LIVE,
      // held-open `stateRunId` snapshot — the base run above is always terminal by the time this
      // test runs, so it never carries one of these three states. Everything else stays checked
      // against the base run, same split val-201 already uses for its own `.detail-block` row.
      const stateRows = rows.filter((r) => r.anchor.includes('.is-running') || r.anchor.includes('.is-queued') || r.anchor.includes('.is-failed'));
      const otherRows = rows.filter((r) => !stateRows.includes(r));

      await page.goto(`${baseUrl}/dashboard/${stateRunId}`, { waitUntil: 'networkidle0', timeout: 10000 });
      await page.waitForSelector('#dag-graph', { timeout: 3000 });
      const stateFailures = await specRowFailuresAcrossThemeAndHue(page, stateRows);

      await page.goto(`${baseUrl}/dashboard/${runId}`, { waitUntil: 'networkidle0', timeout: 10000 });
      await page.waitForSelector('#dag-graph', { timeout: 3000 });
      const otherFailures = await specRowFailuresAcrossThemeAndHue(page, otherRows);

      expect([...stateFailures, ...otherFailures]).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 30000);
});
