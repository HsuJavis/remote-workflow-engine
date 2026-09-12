// v27 Gate 6 fix-pass verification (pending item "the status dot is invisible", REQ-134): self-boots
// a real createServer() (no external deployed instance required) and reuses val-200-swimlane.test.ts's
// own technique (`runConcurrency:1` + a FAIL_MARKER that fails synchronously + a HOLD_MARKER that
// blocks on a held deferred) so a failed / running / queued cell coexist on ONE page at once,
// alongside a normal completed run for the 'done' state — the four states `.cell-dot` needed a
// background/border for. Crops a hi-res close-up of the FIRST node in each state (same crop
// technique as `req134-cell-zoom-harness.mjs`) so the dot is visually evidenced, not just asserted.
import puppeteer from 'puppeteer';
import { readdirSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from '../../../../../src/server.js';
import { registerPublishedVia } from '../../../../../tests/helpers/workflow-fixtures.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const tmpDir = mkdtempSync(join(tmpdir(), 'rwe-req134-dot-verify-'));

function findChrome() {
  const root = join(homedir(), '.cache', 'puppeteer', 'chrome');
  for (const rev of readdirSync(root)) {
    const p = join(root, rev, 'chrome-linux64', 'chrome');
    if (existsSync(p)) return p;
  }
  throw new Error('no chrome found');
}

const FAIL_MARKER = 'FAIL-REQ134DOT';
const HOLD_MARKER = 'HOLD-REQ134DOT';
// Both `runner` AND `waiter` eventually call through this gateway (waiter only once it acquires
// the concurrency:1 slot `runner` released) — a single `releaseHold` variable only ever unblocks
// the FIRST one and leaves the second's own promise (and the sandboxed child holding it) alive
// forever, past `server.close()`, which is exactly what hung this script's first run (measured:
// the four PNGs below were already written to disk while the process sat there). Collect every
// hold in a list and release them all once, at the very end.
const pendingHolds = [];
const FAKE_GATEWAY = {
  async invoke(req) {
    if (req.prompt.includes(FAIL_MARKER)) {
      return { ok: false, provider: 'anthropic', reason: 'terminal', retryable: false, detail: 'planted failure (dot-fix verify)' };
    }
    if (req.prompt.includes(HOLD_MARKER)) {
      await new Promise((resolve) => { pendingHolds.push(resolve); });
    }
    return { ok: true, provider: 'anthropic', model: 'claude-3-5-sonnet-20241022', tokens: { input: 1, output: 1 }, content: 'x' };
  },
};

async function mcpCall(baseUrl, name, args) {
  const res = await fetch(`${baseUrl}/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Math.random(), method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json();
  return JSON.parse(body.result.content[0].text);
}

const server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir, gateway: FAKE_GATEWAY, runConcurrency: 1 });
const baseUrl = `http://127.0.0.1:${server.port}`;
const call = (name, args) => mcpCall(baseUrl, name, args);

// Run A: a plain 1-agent run that completes normally -> a 'done' cell.
await registerPublishedVia(call, 'req134-dot-done', `phase('one'); await agent('a1', { prompt: 'p' }); return 'ok';`);
const doneRun = await call('run_start', { name: 'req134-dot-done' });
const doneRunId = doneRun.runId;
{
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const s = await call('run_status', { runId: doneRunId });
    if (['completed', 'failed'].includes(s.status)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
}

// Run B: failer (phase one) -> failed; runner/waiter (phase two, concurrency:1) -> running/queued.
await registerPublishedVia(call, 'req134-dot-state-cells', `
  phase('one'); await agent('failer', { prompt: '${FAIL_MARKER}' });
  phase('two'); await parallel([
    async () => agent('runner', { prompt: '${HOLD_MARKER}' }),
    async () => agent('waiter', { prompt: '${HOLD_MARKER}' }),
  ]);
  return 'ok';
`);
const stateRun = await call('run_start', { name: 'req134-dot-state-cells' });
const stateRunId = stateRun.runId;
{
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const s = await call('run_status', { runId: stateRunId });
    const agents = (s.result && s.result.agents) || [];
    const failer = agents.find((a) => a.label === 'failer');
    const runner = agents.find((a) => a.label === 'runner');
    const waiter = agents.find((a) => a.label === 'waiter');
    if (failer?.state === 'failed' && runner?.state === 'running' && waiter?.state === 'queued') break;
    await new Promise((r) => setTimeout(r, 50));
  }
}

const browser = await puppeteer.launch({ headless: 'new', executablePath: findChrome(), args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 1000, deviceScaleFactor: 2 });

async function cropState(runId, stateClass, outFile) {
  await page.goto(`${baseUrl}/dashboard/${runId}`, { waitUntil: 'networkidle0', timeout: 15000 });
  await page.waitForSelector('#dag-graph', { timeout: 5000 });
  const node = await page.$(`#dag-zoom [data-node-cell].${stateClass}`);
  if (!node) { console.log(`NOT FOUND: ${stateClass} on run ${runId}`); return null; }
  const box = await node.boundingBox();
  await page.screenshot({ path: join(HERE, outFile), clip: { x: box.x - 16, y: box.y - 16, width: box.width + 32, height: box.height + 32 } });
  return page.evaluate((el) => {
    const dot = el.querySelector('.cell-dot');
    const cs = getComputedStyle(dot);
    return { backgroundColor: cs.backgroundColor, borderColor: cs.borderColor, borderWidth: cs.borderWidth };
  }, node);
}

const results = {};
results['is-done'] = await cropState(doneRunId, 'is-done', 'req134-dot-done-AFTER.png');
results['is-failed'] = await cropState(stateRunId, 'is-failed', 'req134-dot-failed-AFTER.png');
results['is-running'] = await cropState(stateRunId, 'is-running', 'req134-dot-running-AFTER.png');
results['is-queued'] = await cropState(stateRunId, 'is-queued', 'req134-dot-queued-AFTER.png');

console.log('=== .cell-dot computed style per state (want a real background or border, never both `rgba(0,0,0,0)`/`none`) ===');
console.log(JSON.stringify(results, null, 2));

for (const release of pendingHolds) release();
await browser.close();
await server.close();
rmSync(tmpDir, { recursive: true, force: true });
process.exit(0);
