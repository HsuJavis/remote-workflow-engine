// v27 README-fidelity closure, THIRD audit sweep: self-boots a real createServer() (same
// self-booting technique as req131-134-fidelity-closure-harness.mjs — no external instance/port
// dependency) and screenshots the five items this pass closed: (1) theme segment order
// system/light/dark, (2) node row 3's new duration + k abbreviation, (3) the home card's LAST RUN
// kicker as a timestamp (alongside an ACTIVE card showing a run id, so both states are visible on
// the same page), (4) `.is-live`'s accent tint, (5) `.card`'s removed fill plus its 5% hover tint
// (captured via a REAL `page.hover()`, not just the class/CSS existing — a screenshot is the only
// evidence a hover hover tint gets this pass, since spec-rows.ts's oracle never simulates `:hover`).
import puppeteer from 'puppeteer';
import { readdirSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from '../../../../../src/server.js';
import { registerPublishedVia } from '../../../../../tests/helpers/workflow-fixtures.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const tmpDir = mkdtempSync(join(tmpdir(), 'rwe-third-sweep-closure-'));

function findChrome() {
  const root = join(homedir(), '.cache', 'puppeteer', 'chrome');
  for (const rev of readdirSync(root)) {
    const p = join(root, rev, 'chrome-linux64', 'chrome');
    if (existsSync(p)) return p;
  }
  throw new Error('no chrome found');
}

const NEVER_RESOLVES_GATEWAY = { invoke: () => new Promise(() => { /* keeps a run 'running' */ }) };
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

// Two servers: one with a gateway that finishes fast (LAST RUN card + node close-up need a DONE
// agent with real tokens/cost/duration), one with a gateway that never resolves (ACTIVE card needs
// a genuinely 'running' agent). Both dashboards are otherwise identical chrome.
const doneServer = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir, gateway: FAKE_GATEWAY });
const doneBaseUrl = `http://127.0.0.1:${doneServer.port}`;
const doneCall = (name, args) => mcpCall(doneBaseUrl, name, args);

await registerPublishedVia(doneCall, 'closure-completed', `
  phase('one'); await agent('a1', { prompt: 'p' }); await agent('a2', { prompt: 'p' });
  return 'ok';
`);
const run = await doneCall('run_start', { name: 'closure-completed' });
const runId = run.runId;
{
  const deadline = Date.now() + 15000;
  let status;
  while (Date.now() < deadline) {
    status = await doneCall('run_status', { runId });
    if (['completed', 'failed'].includes(status.status)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  console.log('closure-completed run status:', status?.status);
}
// A second, never-run registered workflow — the plain (non-running, non-completed-yet) card whose
// hover tint this pass added.
await registerPublishedVia(doneCall, 'closure-registered', `return 'ok';`);

const tmpDir2 = mkdtempSync(join(tmpdir(), 'rwe-third-sweep-active-'));
const activeServer = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir2, gateway: NEVER_RESOLVES_GATEWAY });
const activeBaseUrl = `http://127.0.0.1:${activeServer.port}`;
const activeCall = (name, args) => mcpCall(activeBaseUrl, name, args);
await registerPublishedVia(activeCall, 'closure-active', `await agent('a', { prompt: 'p' }); return 'ok';`);
await activeCall('run_start', { name: 'closure-active' });

const browser = await puppeteer.launch({ headless: 'new', executablePath: findChrome(), args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });

  // -- items 1/3/4: theme segment order, LAST RUN timestamp, .is-live tint (dark) --
  await page.goto(`${doneBaseUrl}/dashboard`, { waitUntil: 'networkidle0', timeout: 15000 });
  await page.waitForFunction(() => document.querySelector('[data-status="live"]') !== null, { timeout: 5000 });
  const facts = await page.evaluate(() => {
    const themeOrder = Array.from(document.querySelectorAll('.rwe-theme-group button')).map((b) => b.dataset.theme);
    const status = document.querySelector('[data-status]');
    const card = Array.from(document.querySelectorAll('.card')).find((c) => (c.textContent ?? '').includes('closure-completed'));
    const kicker = card ? card.querySelector('.kicker').textContent : null;
    const cardCS = card ? getComputedStyle(card) : null;
    return {
      themeOrder,
      dataStatus: status ? status.dataset.status : null,
      isLiveBg: status ? getComputedStyle(status).getPropertyValue('background-color') : null,
      lastRunKicker: kicker,
      cardBackgroundAtRest: cardCS ? cardCS.getPropertyValue('background-color') : null,
    };
  });
  console.log('home facts (items 1, 3, 4, 5-at-rest):', JSON.stringify(facts, null, 2));
  await page.screenshot({ path: `${HERE}/third-sweep-home-dark.png`, fullPage: true });

  // item 5: a REAL hover, screenshotted (the .card:hover 5% tint spec-rows.ts cannot check).
  const registeredCard = await page.evaluateHandle(() =>
    Array.from(document.querySelectorAll('.card')).find((c) => (c.textContent ?? '').includes('closure-registered')));
  await registeredCard.asElement().hover();
  await new Promise((r) => setTimeout(r, 100));
  const hoverBg = await page.evaluate((el) => getComputedStyle(el).getPropertyValue('background-color'), registeredCard);
  console.log('registered card background ON HOVER (item 5):', hoverBg);
  await page.screenshot({ path: `${HERE}/third-sweep-card-hover-dark.png`, fullPage: true });

  // light theme, same page
  await page.evaluate(() => localStorage.setItem('rwe-theme', 'light'));
  await page.reload({ waitUntil: 'networkidle0' });
  await page.screenshot({ path: `${HERE}/third-sweep-home-light.png`, fullPage: true });

  // -- item 2: node row 3 close-up (duration + k abbreviation) --
  await page.goto(`${doneBaseUrl}/dashboard/${runId}`, { waitUntil: 'networkidle0', timeout: 15000 });
  await page.waitForSelector('#dag-graph', { timeout: 5000 });
  const node = await page.$('#dag-zoom [data-node-cell]');
  const box = await node.boundingBox();
  await page.screenshot({
    path: `${HERE}/third-sweep-node-row3-zoom.png`,
    clip: { x: box.x - 20, y: box.y - 20, width: box.width + 40, height: box.height + 40 },
  });
  const row3 = await page.evaluate((el) => el.querySelector('.cell-usage')?.textContent ?? null, node);
  console.log('node row 3 text (item 2):', row3);

  // -- ACTIVE card (second server) --
  await page.goto(`${activeBaseUrl}/dashboard`, { waitUntil: 'networkidle0', timeout: 15000 });
  await page.waitForFunction(() => Array.from(document.querySelectorAll('.card')).some((c) => (c.textContent ?? '').includes('closure-active')), { timeout: 5000 });
  const activeKicker = await page.evaluate(() => {
    const card = Array.from(document.querySelectorAll('.card')).find((c) => (c.textContent ?? '').includes('closure-active'));
    return card ? card.querySelector('.kicker').textContent : null;
  });
  console.log('ACTIVE card kicker (contrast with LAST RUN):', activeKicker);
  await page.screenshot({ path: `${HERE}/third-sweep-active-card-dark.png`, fullPage: true });
} finally {
  await browser.close();
  await doneServer.close();
  await activeServer.close();
  rmSync(tmpDir, { recursive: true, force: true });
  rmSync(tmpDir2, { recursive: true, force: true });
}
