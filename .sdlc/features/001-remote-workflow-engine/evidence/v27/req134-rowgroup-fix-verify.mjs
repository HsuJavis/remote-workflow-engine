// v27 Gate 6 fix-pass verification (VAL-208, REQ-134): self-boots a real createServer() (no
// external deployed instance required — the validator's own 8935 scratch box is gone), runs one
// real 9-agent 5-lane workflow (same shape as val-200's own fixture) PLUS a declared model/effort
// on one agent (so REQ-134 row 2's shortModel()/effort-tag join is genuinely exercised, not just
// the '—' fallback), then re-runs the SAME flex-shrink audit technique VAL-208's own harness used
// (`req134-flexshrink-audit-harness.mjs`) to numerically confirm the clip is gone, plus a direct
// check of the effort-tag/cell background contrast and the #run-usage spacing fix. Screenshots
// (full swimlane + a hi-res node crop, same crop technique as `req134-cell-zoom-harness.mjs`) are
// written alongside this script for visual evidence.
import puppeteer from 'puppeteer';
import { readdirSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from '../../../../../src/server.js';
import { registerPublishedVia } from '../../../../../tests/helpers/workflow-fixtures.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const tmpDir = mkdtempSync(join(tmpdir(), 'rwe-req134-verify-'));

function findChrome() {
  const root = join(homedir(), '.cache', 'puppeteer', 'chrome');
  for (const rev of readdirSync(root)) {
    const p = join(root, rev, 'chrome-linux64', 'chrome');
    if (existsSync(p)) return p;
  }
  throw new Error('no chrome found');
}

const FAKE_GATEWAY = {
  // Echoes back the REQUESTED model verbatim (real providers do this too) so the run view's
  // "applied model" (AgentRecord.model, which wins over the declared default per run.js's own
  // documented precedence) still carries the openrouter/anthropic/:free affixes shortModel() must
  // strip — proving the wiring against a REAL rendered cell, not just the unit test.
  async invoke(req) {
    return { ok: true, provider: 'anthropic', model: req.opts?.model, tokens: { input: 39, output: 2, cacheRead: 5, cacheWrite: 7 }, costUSD: 0.12, content: 'x' };
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

// One agent (`a1`) declares a routed/free model + a non-default effort so shortModel()/the effort
// tag are exercised for real, not just the '—' fallback.
await registerPublishedVia(call, 'req134-verify', `
export const meta = { params: { agents: {
  a1: { model: { type: 'string', default: 'openrouter/anthropic/claude-3.5-sonnet:free' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'high' }, timeoutMs: { type: 'number', default: 60000 } },
  a2: { model: { type: 'string', default: 'sonnet' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } },
  b1: { model: { type: 'string', default: 'sonnet' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } },
} } };
phase('one'); await agent('a1', { prompt: 'p' }); await agent('a2', { prompt: 'p' });
phase('two'); await agent('b1', { prompt: 'p' });
return 'ok';
`);
const run = await call('run_start', { name: 'req134-verify' });
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
await page.goto(`${baseUrl}/dashboard/${runId}`, { waitUntil: 'networkidle0', timeout: 15000 });
await page.waitForSelector('#dag-graph', { timeout: 5000 });

await page.screenshot({ path: join(HERE, 'req134-swimlane-dark-AFTER.png'), fullPage: true });

const node = await page.$('#dag-zoom [data-node-cell]');
const box = await node.boundingBox();
await page.screenshot({ path: join(HERE, 'req134-node-zoom-hires-AFTER.png'), clip: { x: box.x - 20, y: box.y - 20, width: box.width + 40, height: box.height + 40 } });

// 1) the flex-shrink clip ratio, same technique as req134-flexshrink-audit-harness.mjs.
const clipAudit = await page.evaluate(() => {
  const cell = document.querySelector('[data-node-cell]');
  const out = {};
  for (const cls of ['cell-label', 'cell-model']) {
    const el = cell.querySelector('.' + cls);
    const cs = getComputedStyle(el);
    const fs = parseFloat(cs.fontSize);
    const lh = cs.lineHeight === 'normal' ? fs * 1.2 : parseFloat(cs.lineHeight);
    const r = el.getBoundingClientRect();
    out[cls] = { text: el.textContent, rectH: r.height, expectMinH: lh, ratio: r.height / lh };
  }
  return out;
});

// 2) three grouped rows, not five flat siblings.
const rowGrouping = await page.evaluate(() => {
  const cell = document.querySelector('[data-node-cell]');
  return { directChildCount: cell.children.length, directChildClasses: Array.from(cell.children).map((c) => c.className) };
});

// 3) the effort tag is visually distinct from the cell (background contrast), not bare text.
const tagContrast = await page.evaluate(() => {
  const cell = document.querySelector('[data-node-cell]');
  const tag = cell.querySelector('.cell-effort');
  return { cellBg: getComputedStyle(cell).backgroundColor, tagBg: getComputedStyle(tag).backgroundColor, tagText: tag.textContent };
});

// 4) shortModel() actually applied (raw wire id would still say "openrouter/anthropic/...:free").
const modelText = await page.evaluate(() => document.querySelector('[data-node-cell] .cell-model').textContent);

// 5) #run-usage spacing: adjacent spans must not visually overlap (each span's left edge is at or
// past the previous span's right edge).
const usageLayout = await page.evaluate(() => {
  const spans = Array.from(document.querySelectorAll('#run-usage > span'));
  return spans.map((s) => ({ text: s.textContent, rect: s.getBoundingClientRect().toJSON() }));
});

console.log('=== clip ratio audit (want ratio >= 0.8) ===', JSON.stringify(clipAudit, null, 2));
console.log('=== row grouping (want 3 direct children: cell-head/cell-meta/cell-usage) ===', JSON.stringify(rowGrouping));
console.log('=== effort tag contrast (want tagBg !== cellBg) ===', JSON.stringify(tagContrast));
console.log('=== shortModel() applied (want "claude-3.5-sonnet (free)") ===', modelText);
console.log('=== #run-usage layout (want non-overlapping rects) ===', JSON.stringify(usageLayout, null, 2));

await browser.close();
await server.close();
rmSync(tmpDir, { recursive: true, force: true });
