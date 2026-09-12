// v27 README-fidelity closure (this pass): self-boots a real createServer() (same technique as
// req134-dot-fix-verify.mjs — no external instance/port 8935 dependency, no network cost) and
// re-runs the two named-for-reuse harnesses' OWN techniques (req131-nav-footer-tabs-harness.mjs's
// shell/both-themes screenshot; req134-cell-zoom-harness.mjs's node close-up crop) against it, so
// the four closed items are visually evidenced on a reproducible run rather than a stale hardcoded
// runId against a server that is no longer up. Also prints the raw computed-style facts for the
// four items plus the DOM-order/readout facts SPEC_ROWS cannot express.
import puppeteer from 'puppeteer';
import { readdirSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from '../../../../../src/server.js';
import { registerPublishedVia } from '../../../../../tests/helpers/workflow-fixtures.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const tmpDir = mkdtempSync(join(tmpdir(), 'rwe-req131-134-closure-'));

function findChrome() {
  const root = join(homedir(), '.cache', 'puppeteer', 'chrome');
  for (const rev of readdirSync(root)) {
    const p = join(root, rev, 'chrome-linux64', 'chrome');
    if (existsSync(p)) return p;
  }
  throw new Error('no chrome found');
}

const FAKE_GATEWAY = {
  async invoke() {
    return { ok: true, provider: 'anthropic', model: 'claude-3-5-sonnet-20241022', tokens: { input: 26000, output: 26000 }, costUSD: 0.31, content: 'x' };
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

await registerPublishedVia(call, 'req131-134-closure', `
  phase('one'); await agent('a1', { prompt: 'p' }); await agent('a2', { prompt: 'p' });
  phase('two'); await agent('b1', { prompt: 'p' });
  return 'ok';
`);
const run = await call('run_start', { name: 'req131-134-closure' });
const runId = run.runId;
{
  const deadline = Date.now() + 15000;
  let status;
  while (Date.now() < deadline) {
    status = await call('run_status', { runId });
    if (['completed', 'failed'].includes(status.status)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  console.log('run status:', status?.status);
}

const browser = await puppeteer.launch({ headless: 'new', executablePath: findChrome(), args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });

  // -- req131-nav-footer-tabs-harness.mjs's own technique: shell, both themes --
  await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle0', timeout: 15000 });
  const chromeFacts = await page.evaluate(() => {
    const nav = document.querySelector('.rwe-nav');
    const children = Array.from(nav.children);
    const hueEl = document.querySelector('.rwe-hue-slider');
    const hueValueEl = document.querySelector('[data-hue-value]');
    const cs = getComputedStyle(hueEl);
    return {
      order: {
        hue: children.indexOf(document.querySelector('.rwe-hue-wrap')),
        lang: children.indexOf(document.querySelector('.rwe-lang-group')),
        theme: children.indexOf(document.querySelector('.rwe-theme-group')),
      },
      hueBackgroundImage: cs.getPropertyValue('background-image'),
      hueValueText: hueValueEl ? hueValueEl.textContent : null,
    };
  });
  console.log('chrome facts (item 3 + 4):', JSON.stringify(chromeFacts, null, 2));
  await page.screenshot({ path: `${HERE}/req131-134-closure-shell-dark.png`, fullPage: true });
  await page.evaluate(() => localStorage.setItem('rwe-theme', 'light'));
  await page.reload({ waitUntil: 'networkidle0' });
  await page.screenshot({ path: `${HERE}/req131-134-closure-shell-light.png`, fullPage: true });

  // -- req134-cell-zoom-harness.mjs's own technique: node close-up, items 1+2 --
  await page.goto(`${baseUrl}/dashboard/${runId}`, { waitUntil: 'networkidle0', timeout: 15000 });
  await page.waitForSelector('#dag-graph', { timeout: 5000 });
  const node = await page.$('#dag-zoom [data-node-cell]');
  const box = await node.boundingBox();
  await page.screenshot({
    path: `${HERE}/req131-134-closure-node-zoom.png`,
    clip: { x: box.x - 20, y: box.y - 20, width: box.width + 40, height: box.height + 40 },
  });
  const cellFacts = await page.evaluate((el) => {
    const model = el.querySelector('.cell-model');
    const usage = el.querySelector('.cell-usage');
    return {
      cellModelOpacity: model ? getComputedStyle(model).getPropertyValue('opacity') : null,
      cellUsageOpacity: usage ? getComputedStyle(usage).getPropertyValue('opacity') : null,
    };
  }, node);
  console.log('cell facts (items 1 + 2):', JSON.stringify(cellFacts, null, 2));
} finally {
  await browser.close();
  await server.close();
  rmSync(tmpDir, { recursive: true, force: true });
}
