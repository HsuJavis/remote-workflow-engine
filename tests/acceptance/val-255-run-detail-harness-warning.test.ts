// VAL-255 (issue #117, independent-verifier finding, 2026-10-10): the run detail page
// (`/dashboard/:runId`) must show agent/harness warnings — `run_status.warnings`
// (`AgentWarningSummary[]`, run-manager.ts `summarizeAgentWarnings`, rolled up from
// `AgentRecord.warnings`, e.g. `MCP_SERVER_NOT_CONNECTED`). `/api/runs/:id` already serves
// `warnings` unredacted (`toPublicRunView` strips only `principal`), but no `ui/*.js` module ever
// read or rendered it — `ui/run.js`'s `renderLegend` only rendered the DAG route's own
// LAYOUT-derivation warnings (`payload.warnings`, a completely different stream, DES-198).
//
// Real harness network dependency: reproducing a genuine `MCP_SERVER_NOT_CONNECTED` needs the
// real SDK/CLI harness and a stub MCP server (`tests/integration/mcp-first-turn-tools.test.ts`'s
// own `it.skipIf(CLI === undefined)` gate) — not appropriate for a dashboard-rendering acceptance
// test. Following val-199's own established pattern (intercept ONE real route and inject a field
// into the otherwise-real body), this test runs a genuine completed run (FAKE_GATEWAY, same
// technique as val-200) and intercepts ONLY `/api/runs/:runId` (never `/dag`, never the plain
// `/api/runs` list) to merge a `warnings` entry onto the real, measured response — proving the UI
// reads and renders the field, not that the engine can produce it (that is run-manager.ts's own
// unit-tier job, already covered: `tests/unit/...summarizeAgentWarnings...` if present, or
// run-manager tests generally).
//
// Red reason (measured): pre-fix, `renderLegend` never reads `view.warnings` at all — this test's
// `[data-agent-warning]` selector times out (0 matches) with the warning text nowhere on the page.
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

const FAKE_GATEWAY: GatewayClient = {
  async invoke() {
    return { ok: true, provider: 'anthropic', model: 'claude-3-5-sonnet-20241022', tokens: { input: 1, output: 1 }, content: 'x' };
  },
} as GatewayClient;

let server: Server;
let baseUrl: string;
let tmpDir: string;
let runId: string;
let realAgentId: string;

async function mcpCall(name: string, args: unknown): Promise<any> {
  const res = await fetch(`${baseUrl}/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Math.random(), method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = (await res.json()) as { result?: { content: Array<{ text: string }> } };
  return JSON.parse(body.result!.content[0]!.text);
}

beforeAll(async () => {
  if (reason) { console.log(`[val-255] ${reason}`); return; }
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-val255-'));
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir, gateway: FAKE_GATEWAY } as never);
  baseUrl = `http://127.0.0.1:${server.port}`;
  await registerPublishedVia(mcpCall, 'val255-run-warning', `phase('one'); await agent('researcher', { prompt: 'p' }); return 'ok';`);
  const run = await mcpCall('run_start', { name: 'val255-run-warning' });
  runId = run.runId;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const s = await mcpCall('run_status', { runId });
    if (['completed', 'failed'].includes(s.status)) {
      realAgentId = (s.result?.agents?.[0]?.agentId) ?? s.agents?.[0]?.agentId;
      break;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}, 20000);

afterAll(async () => {
  await server?.close();
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

const itReal = (name: string, fn: () => Promise<void>, timeout?: number): void => {
  it(name, async (ctx) => { if (reason) ctx.skip(); await fn(); }, timeout);
};

describe('run detail page shows agent/harness warnings (VAL-255, issue #117)', () => {
  itReal('a run with an MCP_SERVER_NOT_CONNECTED warning on an agent shows it in the legend', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.setRequestInterception(true);
      page.on('request', async (req) => {
        const path = new URL(req.url()).pathname;
        // Exact-match ONLY `/api/runs/:runId` — never its `/dag` sibling, never the plain list.
        if (path === `/api/runs/${runId}`) {
          const real = await fetch(`${baseUrl}${path}`).then((r) => r.json());
          real.warnings = [{ code: 'MCP_SERVER_NOT_CONNECTED', server: 'search-mcp', status: 'timeout', message: 'raw fallback — should not render', label: 'researcher', agentId: realAgentId }];
          req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(real) });
          return;
        }
        req.continue();
      });
      await page.goto(`${baseUrl}/dashboard/${runId}`, { waitUntil: 'networkidle0', timeout: 10000 });
      await page.waitForSelector('[data-agent-warning]', { timeout: 5000 });
      const text = await page.$eval('[data-agent-warning]', (el) => el.textContent);
      expect(text).toContain('search-mcp');
      expect(text).toContain('researcher');
      expect(text).not.toContain('raw fallback'); // mapped through the string table, not the raw message
      const code = await page.$eval('[data-agent-warning]', (el) => el.getAttribute('data-agent-warning'));
      expect(code).toBe('MCP_SERVER_NOT_CONNECTED');
    } finally {
      await browser.close();
    }
  }, 20000);
});
