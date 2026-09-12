// v27 Gate 7.5 round 2 fix verification (REQ-135): self-boots a real createServer() (no external
// deployed instance required), registers ONE real 4-phase/4-lane workflow under an EXPLICIT name
// (`/dashboard/workflow/:name` needs the name; `run_start` never returns the auto-generated one),
// runs it to completion, then proves BOTH round-2 defects are fixed against the REAL rendered page:
//   (1) a click on a real agent cell on `/dashboard/workflow/:name` (the PRIMARY route,
//       `ui/workflow.js`) opens the slide-in panel — it did not before this pass, because
//       `ui/workflow.js`'s two `paintSwimlane` calls never passed `onSelectAgent`.
//   (2) the slide SIDE follows the clicked node's real on-screen position: the first lane's cell
//       (left half of the graph) slides in from the RIGHT (no `.from-left`); the last lane's cell
//       (right half) slides in from the LEFT (`.from-left`) — the previous computation read
//       `window.event` after an `await`, always `undefined`, so it always defaulted to 'right'.
// Screenshots (both states) are written alongside this script for visual evidence.
import puppeteer from 'puppeteer';
import { readdirSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from '../../../../../src/server.js';
import { registerPublishedVia } from '../../../../../tests/helpers/workflow-fixtures.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const tmpDir = mkdtempSync(join(tmpdir(), 'rwe-req135-verify-'));

function findChrome() {
  const root = join(homedir(), '.cache', 'puppeteer', 'chrome');
  for (const rev of readdirSync(root)) {
    const p = join(root, rev, 'chrome-linux64', 'chrome');
    if (existsSync(p)) return p;
  }
  throw new Error('no chrome found');
}

const FAKE_GATEWAY = {
  async invoke(req) {
    return { ok: true, provider: 'anthropic', model: req.opts?.model, tokens: { input: 3, output: 2 }, costUSD: 0.01, content: 'x' };
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

const server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir, gateway: FAKE_GATEWAY });
const baseUrl = `http://127.0.0.1:${server.port}`;
const call = (name, args) => mcpCall(baseUrl, name, args);

const WF_NAME = 'req135-side-verify';
await registerPublishedVia(call, WF_NAME, `
phase('one'); await agent('leftAgent', { prompt: 'p' });
phase('two'); await agent('midAgentA', { prompt: 'p' });
phase('three'); await agent('midAgentB', { prompt: 'p' });
phase('four'); await agent('rightAgent', { prompt: 'p' });
return 'ok';
`);
const run = await call('run_start', { name: WF_NAME });
const runId = run.runId;
const deadline = Date.now() + 15000;
while (Date.now() < deadline) {
  const s = await call('run_status', { runId });
  if (['completed', 'failed'].includes(s.status)) break;
  await new Promise((r) => setTimeout(r, 100));
}

const browser = await puppeteer.launch({ headless: 'new', executablePath: findChrome(), args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 1000, deviceScaleFactor: 2 });

// The PRIMARY route — never `/dashboard/<runId>`.
await page.goto(`${baseUrl}/dashboard/workflow/${WF_NAME}`, { waitUntil: 'networkidle0', timeout: 15000 });
await page.waitForSelector('[data-node-cell]', { timeout: 5000 });

const nodeCount = await page.$$eval('[data-node-cell]', (els) => els.length);

// (1) click the FIRST cell (leftmost lane) — opens the panel at all, and slides from the right.
const nodes = await page.$$('[data-node-cell]');
await nodes[0].click();
await page.waitForSelector('[data-agent-panel]', { timeout: 3000 });
const statCardCount = await page.$$eval('[data-agent-panel] [data-stat-card]', (els) => els.length);
const leftClickClass = await page.$eval('[data-agent-panel]', (el) => el.className);
await page.screenshot({ path: join(HERE, 'req135-workflow-route-panel-right-slide.png'), fullPage: true });

await page.keyboard.press('Escape');
await page.waitForSelector('[data-agent-panel]', { hidden: true, timeout: 3000 });

// (2) click the LAST cell (rightmost lane) — slides from the left.
const nodes2 = await page.$$('[data-node-cell]');
await nodes2[nodes2.length - 1].click();
await page.waitForSelector('[data-agent-panel]', { timeout: 3000 });
const rightClickClass = await page.$eval('[data-agent-panel]', (el) => el.className);
await page.screenshot({ path: join(HERE, 'req135-workflow-route-panel-left-slide.png'), fullPage: true });

console.log('=== route ===', `${baseUrl}/dashboard/workflow/${WF_NAME}`);
console.log('=== node cell count (want 4) ===', nodeCount);
console.log('=== panel opened on primary route, stat card count (want 6) ===', statCardCount);
console.log('=== left-lane click panel class (want NOT to contain from-left) ===', leftClickClass);
console.log('=== right-lane click panel class (want to contain from-left) ===', rightClickClass);
console.log('=== PASS ===', nodeCount === 4 && statCardCount === 6 && !leftClickClass.includes('from-left') && rightClickClass.includes('from-left'));

await browser.close();
await server.close();
rmSync(tmpDir, { recursive: true, force: true });
