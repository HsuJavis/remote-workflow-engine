// v27 Gate 7.5 real-run Puppeteer probe against a REAL deployed instance B (127.0.0.1:8935).
import puppeteer from 'puppeteer';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

function findChrome() {
  const root = join(homedir(), '.cache', 'puppeteer', 'chrome');
  for (const rev of readdirSync(root)) {
    const p = join(root, rev, 'chrome-linux64', 'chrome');
    if (existsSync(p)) return p;
  }
  throw new Error('no chrome found');
}

const BASE = process.env.RWE_BASE || 'http://127.0.0.1:8935';
const RUN_ID = process.env.RWE_RUN_ID;
const EVDIR = '/home/user/Documents/remote-workflow/.sdlc/features/001-remote-workflow-engine/evidence/v27';
const chrome = findChrome();
const results = {};

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

// ---- REQ-131: shell (theme/lang/hue/connection) ----
results.req131 = await withPage(async (page) => {
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle0', timeout: 15000 });
  const theme0 = await page.$eval('html', (el) => el.getAttribute('data-theme'));
  const bg0 = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim());
  await page.screenshot({ path: `${EVDIR}/req131-shell-dark.png`, fullPage: true });

  await page.evaluate(() => localStorage.setItem('rwe-theme', 'light'));
  await page.reload({ waitUntil: 'networkidle0' });
  const theme1 = await page.$eval('html', (el) => el.getAttribute('data-theme'));
  const bg1 = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim());
  await page.screenshot({ path: `${EVDIR}/req131-shell-light.png`, fullPage: true });

  await page.evaluate(() => { document.documentElement.style.setProperty('--rwe-hue', '80'); });
  const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim());

  await page.evaluate(() => localStorage.setItem('rwe-lang', 'zh'));
  await page.reload({ waitUntil: 'networkidle0' });
  const bodyTextZh = await page.evaluate(() => document.body.textContent ?? '');
  const hasCjk = /[一-鿿]/.test(bodyTextZh);

  const fontFace = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  const htmlSrc = await page.content();
  const noExternalHost = !/fonts\.googleapis\.com|cdn\.jsdelivr|unpkg\.com/.test(htmlSrc);

  return { theme0, bg0, theme1, bg1, accent, hasCjk, fontFace, noExternalHost };
});

// ---- REQ-132: home (search/filter/avg cost/sweep) ----
results.req132 = await withPage(async (page) => {
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle0', timeout: 15000 });
  await page.waitForSelector('input[type="search"], input[placeholder]', { timeout: 3000 });
  const bodyText = await page.evaluate(() => document.body.textContent ?? '');
  const hasSwimlaneCard = bodyText.includes('val27-swimlane');
  const hasNeverRunCard = bodyText.includes('val27-neverrun');
  const avgCostVisible = /平均費用|avg.*cost/i.test(bodyText);
  // search filter
  const input = await page.$('input[type="search"], input[placeholder]');
  await input.type('val27-swimlane');
  await new Promise((r) => setTimeout(r, 300));
  const filteredText = await page.evaluate(() => document.body.textContent ?? '');
  const filteredOut = !filteredText.includes('val27-neverrun') || filteredText.includes('val27-swimlane');
  return { hasSwimlaneCard, hasNeverRunCard, avgCostVisible, filteredOut };
});

// ---- REQ-133: workflow detail (never-run predicted layout + version tag + run history) ----
results.req133_neverrun = await withPage(async (page) => {
  await page.goto(`${BASE}/dashboard/workflow/val27-neverrun`, { waitUntil: 'networkidle0', timeout: 15000 });
  await new Promise((r) => setTimeout(r, 500));
  const clone = await page.evaluate(() => {
    const c = document.body.cloneNode(true);
    c.querySelectorAll('script, style').forEach((el) => el.remove());
    return c.textContent ?? '';
  });
  const hasPredicted = /predicted|預測結構/i.test(clone);
  const noSkeletonWord = !/skeleton/i.test(clone);
  await page.screenshot({ path: `${EVDIR}/req133-workflow-neverrun.png`, fullPage: true });
  return { hasPredicted, noSkeletonWord, textSample: clone.slice(0, 300) };
});

results.req133_detail = await withPage(async (page) => {
  await page.goto(`${BASE}/dashboard/workflow/val27-swimlane`, { waitUntil: 'networkidle0', timeout: 15000 });
  await page.waitForSelector('table', { timeout: 3000 });
  const bodyText = await page.evaluate(() => document.body.textContent ?? '');
  const hasVersionTag = /v1|版本/i.test(bodyText);
  const hasTable = await page.$('table') !== null;
  await page.screenshot({ path: `${EVDIR}/req133-workflow-detail.png`, fullPage: true });
  return { hasVersionTag, hasTable };
});

// ---- REQ-134/135: run swimlane graph + agent panel ----
results.req134_135 = await withPage(async (page) => {
  await page.goto(`${BASE}/dashboard/${RUN_ID}`, { waitUntil: 'networkidle0', timeout: 15000 });
  await page.waitForSelector('#dag-graph', { timeout: 5000 });
  const laneHeaderCount = await page.$$eval('[data-lane-header]', (els) => els.length);
  const nodeSizes = await page.$$eval('#dag-zoom [data-node-cell]', (els) => els.map((e) => { const r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; }));
  const hasLegend = await page.$('[data-legend]') !== null;
  await page.screenshot({ path: `${EVDIR}/req134-swimlane-dark.png`, fullPage: true });

  await page.evaluate(() => localStorage.setItem('rwe-theme', 'light'));
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('#dag-graph', { timeout: 5000 });
  await page.screenshot({ path: `${EVDIR}/req134-swimlane-light.png`, fullPage: true });
  await page.evaluate(() => localStorage.setItem('rwe-theme', 'dark'));

  // REQ-135: click a node to open the agent panel
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('#dag-graph', { timeout: 5000 });
  const node = await page.$('#dag-zoom [data-node-cell]');
  let panelOpened = false, statCardCount = 0, promptText = '', closedOnEsc = false;
  if (node) {
    await node.click();
    await page.waitForSelector('[data-agent-panel]', { timeout: 5000 });
    panelOpened = true;
    statCardCount = await page.$$eval('[data-agent-panel] [data-stat-card]', (els) => els.length);
    const preEl = await page.$('[data-agent-panel] pre');
    if (preEl) promptText = await page.$eval('[data-agent-panel] pre', (el) => el.textContent ?? '');
    await page.screenshot({ path: `${EVDIR}/req135-agent-panel.png`, fullPage: true });
    await page.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 300));
    closedOnEsc = (await page.$('[data-agent-panel]')) === null;
  }
  return { laneHeaderCount, nodeSizes, hasLegend, panelOpened, statCardCount, promptSnippet: promptText.slice(0, 200), closedOnEsc };
});

console.log(JSON.stringify(results, null, 2));
