import puppeteer from 'puppeteer';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const BASE = 'http://127.0.0.1:8937';
const WF_NAME = 'val209-round3-1789241927495';

function findChrome() {
  const root = join(homedir(), '.cache', 'puppeteer', 'chrome');
  for (const rev of readdirSync(root)) {
    const p = join(root, rev, 'chrome-linux64', 'chrome');
    if (existsSync(p)) return p;
  }
  throw new Error('no chrome found');
}

const browser = await puppeteer.launch({ headless: 'new', executablePath: findChrome(), args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 1000, deviceScaleFactor: 2 });
await page.goto(`${BASE}/dashboard/workflow/${WF_NAME}`, { waitUntil: 'networkidle0', timeout: 20000 });
await page.waitForSelector('[data-node-cell]', { timeout: 5000 });

// REQ-133: run chips + history table present
const runChipCount = await page.$$eval('[data-run-chip]', els => els.length);
const historyRows = await page.$$eval('[data-history-table] tbody tr', els => els.length).catch(() => -1);
const versionTagPresent = await page.$$eval('.tag', els => els.length > 0);

// REQ-134: .cell has 3 direct children; clip ratio for label/model on the first cell
const cellShape = await page.$eval('[data-node-cell]', (el) => {
  const cs = (sel) => el.querySelector(sel);
  const rectOf = (node) => node ? node.getBoundingClientRect() : null;
  const labelEl = cs('.cell-label');
  const modelEl = cs('.cell-model');
  function ratio(node) {
    if (!node) return null;
    const r = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    const fs = parseFloat(style.fontSize);
    const lh = parseFloat(style.lineHeight) || fs * 1.2;
    return +(r.height / lh).toFixed(3);
  }
  return {
    childCount: el.children.length,
    labelRatio: ratio(labelEl),
    modelRatio: ratio(modelEl),
  };
});

console.log('REQ-133 runChipCount (want >=1)', runChipCount);
console.log('REQ-133 historyRows (want >=1)', historyRows);
console.log('REQ-133 versionTagPresent (want true)', versionTagPresent);
console.log('REQ-134 cellShape (want childCount 3, ratios >=0.8)', cellShape);

await browser.close();
