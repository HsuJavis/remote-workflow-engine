// v27e Gate 7.5 RE-VALIDATION — real Chromium against a REAL deployed instance (post row-grouping
// fix, commits 23a909a..1a1746a). Re-checks the whole impact closure (REQ-131/132/133/134/135/136/
// 140/141), not only REQ-134, because the three fidelity sweeps touched shared dashboard surface
// (dashboard.css/ui/app.js/ui/home.js/ui/run.js/dashboard.ts) after the last real validation.
import puppeteer from 'puppeteer';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

function findChrome() {
  const root = join(homedir(), '.cache', 'puppeteer', 'chrome');
  const revs = readdirSync(root).sort().reverse();
  for (const rev of revs) {
    const p = join(root, rev, 'chrome-linux64', 'chrome');
    if (existsSync(p)) return p;
  }
  throw new Error('no chrome found');
}

const BASE = process.env.RWE_BASE || 'http://127.0.0.1:8935';
const EVDIR = '/home/user/Documents/remote-workflow/.sdlc/features/001-remote-workflow-engine/evidence/v27e';
const chrome = findChrome();
const out = {};

async function mcp(base, name, args) {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Math.random(), method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json();
  if (body.error) throw new Error(`${name} -> ${JSON.stringify(body.error)}`);
  return JSON.parse(body.result.content[0].text);
}

async function withPage(fn) {
  const browser = await puppeteer.launch({ headless: 'new', executablePath: chrome, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 1000 });
    return await fn(page, browser);
  } finally {
    await browser.close();
  }
}

// clipRatio — SAME formula as tests/helpers/spec-rows.ts's notClipped kind (the exact check that
// caught VAL-208's clip defect): rendered height / (font-size * line-height, 'normal' -> *1.2).
async function clipRatio(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    const fontSize = parseFloat(cs.fontSize) || 0;
    const lh = cs.lineHeight;
    const lineHeight = lh === 'normal' ? fontSize * 1.2 : (parseFloat(lh) || fontSize);
    if (lineHeight <= 0) return null;
    return el.getBoundingClientRect().height / lineHeight;
  }, selector);
}

async function run(key, fn) {
  try {
    const val = await fn();
    out[key] = val;
    console.log(`=== ${key} OK ===`);
    console.log(JSON.stringify(val, null, 2));
  } catch (e) {
    out[key] = { error: String(e && e.stack || e) };
    console.log(`=== ${key} ERROR ===`);
    console.log(String(e && e.stack || e));
  }
}

// ---- REQ-131: shell theme/lang/hue/nav/tabs/footer ----
await run('req131', () => withPage(async (page) => {
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle0', timeout: 15000 });
  const theme0 = await page.$eval('html', (el) => el.getAttribute('data-theme'));
  await page.screenshot({ path: `${EVDIR}/req131-shell-dark.png`, fullPage: true });

  await page.evaluate(() => localStorage.setItem('rwe-theme', 'light'));
  await page.reload({ waitUntil: 'networkidle0' });
  const theme1 = await page.$eval('html', (el) => el.getAttribute('data-theme'));
  await page.screenshot({ path: `${EVDIR}/req131-shell-light.png`, fullPage: true });

  await page.evaluate(() => localStorage.setItem('rwe-lang', 'zh'));
  await page.reload({ waitUntil: 'networkidle0' });
  const bodyTextZh = await page.evaluate(() => document.body.textContent ?? '');
  const hasCjk = /[一-鿿]/.test(bodyTextZh);

  // fidelity-sweep changes: tabs are underlined <a aria-current="page">, nav brand from strings.js,
  // footer with API base + clock, hue slider with a degrees readout.
  const tabsAreAnchors = await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('.rwe-tabs a, nav a[href^="/dashboard"]')];
    return tabs.length > 0 && tabs.every((a) => a.tagName === 'A');
  });
  const ariaCurrent = await page.evaluate(() => document.querySelector('[aria-current="page"]')?.textContent ?? null);
  const footerText = await page.evaluate(() => document.querySelector('footer')?.textContent ?? null);
  const brandText = await page.evaluate(() => document.querySelector('.rwe-brand, [data-brand]')?.textContent ?? null);
  const hueReadout = await page.evaluate(() => document.querySelector('[data-hue-value], .hue-readout')?.textContent ?? null);

  return { theme0, theme1, hasCjk, tabsAreAnchors, ariaCurrent, footerText, brandText, hueReadout };
}));

// ---- REQ-132: home search/filter/avg-cost/latestRunAt ----
await run('req132', () => withPage(async (page) => {
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle0', timeout: 15000 });
  await page.screenshot({ path: `${EVDIR}/req132-home.png`, fullPage: true });
  const cardText = await page.evaluate(() => {
    const card = [...document.querySelectorAll('.card')].find((c) => c.textContent.includes('val27-swimlane'));
    return card ? card.textContent : null;
  });
  const searchSel = 'input[type="search"], input[placeholder], [data-search]';
  const hasSearch = await page.$(searchSel) !== null;
  let filteredOut = null;
  if (hasSearch) {
    await page.type(searchSel, 'val27-swimlane');
    await new Promise((r) => setTimeout(r, 300));
    filteredOut = await page.evaluate(() => !document.body.textContent.includes('val27-neverrun'));
  }
  return { cardText, hasSearch, filteredOut };
}));

// ---- REQ-133: workflow detail (never-run predicted + real run history/chips) ----
await run('req133_neverrun', () => withPage(async (page) => {
  await page.goto(`${BASE}/dashboard/workflow/val27-neverrun`, { waitUntil: 'networkidle0', timeout: 15000 });
  await page.screenshot({ path: `${EVDIR}/req133-neverrun.png`, fullPage: true });
  const predictedCells = await page.evaluate(() => document.querySelectorAll('.cell.is-predicted').length);
  return { predictedCells };
}));
await run('req133_detail', () => withPage(async (page) => {
  await page.goto(`${BASE}/dashboard/workflow/val27-swimlane`, { waitUntil: 'networkidle0', timeout: 15000 });
  await page.screenshot({ path: `${EVDIR}/req133-detail.png`, fullPage: true });
  const chips = await page.evaluate(() => document.querySelectorAll('[data-run-chip]').length);
  const selectedChip = await page.evaluate(() => document.querySelector('[data-run-chip].is-selected')?.getAttribute('data-run-chip') ?? null);
  const tableRows = await page.evaluate(() => document.querySelectorAll('table tr').length);
  return { chips, selectedChip, tableRows };
}));

// ---- REQ-134: swimlane cell row-grouping fix + dot states + shortModel + duration ----
await run('req134_done', () => withPage(async (page) => {
  await page.goto(`${BASE}/dashboard/workflow/val27-swimlane`, { waitUntil: 'networkidle0', timeout: 15000 });
  await page.waitForSelector('[data-node-cell]', { timeout: 10000 });
  await page.screenshot({ path: `${EVDIR}/req134-swimlane.png`, fullPage: true });

  const info = await page.evaluate(() => {
    const el = document.querySelector('.cell.is-done[data-node-cell]');
    if (!el) return null;
    return {
      directChildren: el.children.length,
      childClasses: [...el.children].map((c) => c.className),
      dotBg: getComputedStyle(el.querySelector('.cell-dot')).backgroundColor,
      cellBg: getComputedStyle(el).backgroundColor,
      effortBg: getComputedStyle(el.querySelector('.cell-effort')).backgroundColor,
      modelText: el.querySelector('.cell-model')?.textContent,
      usageText: el.querySelector('.cell-usage')?.textContent,
    };
  });

  const labelRatio = await clipRatio(page, '.cell.is-done .cell-label');
  const modelRatio = await clipRatio(page, '.cell.is-done .cell-model');

  const handle = await page.$('.cell.is-done');
  const box = handle ? await handle.boundingBox() : null;
  if (box) await page.screenshot({ path: `${EVDIR}/req134-cell-zoom.png`, clip: box });

  return { info, labelRatio, modelRatio };
}));

// A run whose one and only agent has a 50ms real timeout against real local Ollama -> real 'failed'.
await run('req134_failed', () => withPage(async (page) => {
  const reg = await mcp(BASE, 'workflow_register', {
    name: 'val27e-failer',
    script: `export const meta = { description: 'v27e failure probe', phases: [{title:'X'}], params: { agents: { z1: { model: { type:'string', default:'local' }, effort:{type:'enum',enum:['low','medium','high'],default:'low'}, timeoutMs:{type:'number',default:50} } } } };\nphase('X');\nawait agent('z1', { prompt: 'hi' });\nreturn { ok: true };`,
    mermaid: 'graph LR\nsubgraph "X"\nz1(["z1"])\nend',
  });
  if (reg.status === 'failed') throw new Error('register val27e-failer failed: ' + JSON.stringify(reg.error));
  await mcp(BASE, 'workflow_publish', { name: 'val27e-failer', version: reg.result.version, channel: 'release' });
  const started = await mcp(BASE, 'run_start', { name: 'val27e-failer' });
  const deadline = Date.now() + 30000;
  let status;
  while (Date.now() < deadline) {
    status = await mcp(BASE, 'run_status', { runId: started.runId });
    if (['completed', 'failed'].includes(status.status)) break;
    await new Promise((r) => setTimeout(r, 300));
  }
  await page.goto(`${BASE}/dashboard/workflow/val27e-failer`, { waitUntil: 'networkidle0', timeout: 15000 });
  await page.waitForSelector('[data-node-cell]', { timeout: 10000 });
  await page.screenshot({ path: `${EVDIR}/req134-failed-cell.png`, fullPage: true });
  const dotBg = await page.evaluate(() => {
    const el = document.querySelector('.cell.is-failed .cell-dot');
    return el ? getComputedStyle(el).backgroundColor : null;
  });
  return { runStatus: status?.status, dotBg };
}));

// Try to catch a live 'running' cell mid-flight: a workflow with ONE slow-ish local-model call.
await run('req134_running', () => withPage(async (page) => {
  const reg = await mcp(BASE, 'workflow_register', {
    name: 'val27e-slow',
    script: `export const meta = { description: 'v27e running-state probe', phases: [{title:'X'}], params: { agents: { s1: { model: { type:'string', default:'local' }, effort:{type:'enum',enum:['low','medium','high'],default:'low'}, timeoutMs:{type:'number',default:60000} } } } };\nphase('X');\nawait agent('s1', { prompt: 'Write a detailed 150 word paragraph about distributed systems.' });\nreturn { ok: true };`,
    mermaid: 'graph LR\nsubgraph "X"\ns1(["s1"])\nend',
  });
  if (reg.status === 'failed') throw new Error('register val27e-slow failed: ' + JSON.stringify(reg.error));
  await mcp(BASE, 'workflow_publish', { name: 'val27e-slow', version: reg.result.version, channel: 'release' });
  const started = await mcp(BASE, 'run_start', { name: 'val27e-slow' });
  const deadline = Date.now() + 20000;
  let caught = null;
  while (Date.now() < deadline) {
    await page.goto(`${BASE}/dashboard/workflow/val27e-slow`, { waitUntil: 'domcontentloaded', timeout: 5000 }).catch(() => {});
    const found = await page.evaluate(() => {
      const el = document.querySelector('.cell.is-running .cell-dot');
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { bg: cs.backgroundColor, animation: cs.animationName };
    }).catch(() => null);
    if (found) { caught = found; await page.screenshot({ path: `${EVDIR}/req134-running-cell.png`, fullPage: true }); break; }
  }
  const finalStatus = await mcp(BASE, 'run_status', { runId: started.runId });
  return { caught, finalStatus: finalStatus.status };
}));

// ---- REQ-135: agent slide-in panel (click -> panel -> Esc) ----
await run('req135', () => withPage(async (page) => {
  await page.goto(`${BASE}/dashboard/workflow/val27-swimlane`, { waitUntil: 'networkidle0', timeout: 15000 });
  await page.waitForSelector('[data-node-cell][data-agent-id]', { timeout: 10000 });
  const target = await page.$('[data-node-cell][data-agent-id]');
  const box = await target.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await new Promise((r) => setTimeout(r, 300));
  const panelExists = await page.evaluate(() => !!document.querySelector('[data-agent-panel]'));
  if (!panelExists) {
    const bodyHtmlSnippet = await page.evaluate(() => document.body.innerHTML.slice(-2000));
    return { panelExists, bodyHtmlSnippet };
  }
  const panelText = await page.evaluate(() => document.querySelector('[data-agent-panel]')?.textContent ?? null);
  const hasBackdrop = await page.evaluate(() => !!document.querySelector('[data-agent-panel-backdrop]'));
  await page.screenshot({ path: `${EVDIR}/req135-agent-panel.png`, fullPage: true });
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 200));
  const goneAfterEsc = await page.evaluate(() => !document.querySelector('[data-agent-panel]'));
  return { panelExists, panelTextSnippet: (panelText || '').slice(0, 300), hasBackdrop, goneAfterEsc };
}));

console.log('=== FULL OUTPUT ===');
console.log(JSON.stringify(out, null, 2));
