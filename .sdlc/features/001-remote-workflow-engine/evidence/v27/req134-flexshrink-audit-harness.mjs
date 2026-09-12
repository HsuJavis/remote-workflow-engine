// v27 Gate 7.5 finding: the swimlane node cell's `.cell-label`/`.cell-model` render clipped to a
// few px tall (flex-column shrink + overflow:hidden resets the flex-item automatic min-size to 0).
// This harness (a) confirms the bug on the swimlane cell, (b) sweeps sibling text-bearing surfaces
// for the SAME failure class (rendered rect height << font-size*line-height, invisible to a plain
// getComputedStyle check), and (c) runs a bounded diagnostic override (flex:none on the two
// squeezed children) to show the container has room once shrink stops -- diagnostic only, no src
// touched.
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
}
const BASE = process.env.RWE_BASE || 'http://127.0.0.1:8935';
const RUN_ID = process.env.RWE_RUN_ID;
const browser = await puppeteer.launch({ headless: 'new', executablePath: findChrome(), args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 1000, deviceScaleFactor: 3 });

async function auditSelector(containerSel) {
  return page.evaluate((sel) => {
    const container = document.querySelector(sel);
    if (!container) return { sel, found: false };
    const out = [];
    const walk = (el) => {
      for (const child of el.children) {
        const cs = getComputedStyle(child);
        const r = child.getBoundingClientRect();
        const hasOwnText = Array.from(child.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim());
        if (hasOwnText) {
          const fs = parseFloat(cs.fontSize);
          const lh = cs.lineHeight === 'normal' ? fs * 1.2 : parseFloat(cs.lineHeight);
          out.push({ cls: child.className, text: child.textContent.slice(0, 30), rectH: r.height, expectMinH: lh, ratio: r.height / lh });
        }
        walk(child);
      }
    };
    walk(container);
    return { sel, found: true, out };
  }, containerSel);
}

// 1) swimlane node cell
await page.goto(`${BASE}/dashboard/${RUN_ID}`, { waitUntil: 'networkidle0', timeout: 15000 });
await page.waitForSelector('#dag-graph', { timeout: 5000 });
const cellAudit = await auditSelector('[data-node-cell]');

// bounded diagnostic override: does the container have room once shrink stops?
const overrideResult = await page.evaluate(() => {
  const style = document.createElement('style');
  style.textContent = '.cell-label,.cell-model{flex:none !important}';
  document.head.appendChild(style);
  const cell = document.querySelector('[data-node-cell]');
  const label = cell.querySelector('.cell-label');
  const model = cell.querySelector('.cell-model');
  const cellR = cell.getBoundingClientRect();
  return {
    labelH: label.getBoundingClientRect().height,
    modelH: model.getBoundingClientRect().height,
    cellH: cellR.height,
    cellOverflowsNow: cell.scrollHeight > cell.clientHeight,
  };
});

// open the agent panel and audit stat cards
const node = await page.$('#dag-zoom [data-node-cell]');
await node.click();
await page.waitForSelector('[data-agent-panel]', { timeout: 5000 });
const panelAudit = await auditSelector('[data-agent-panel]');

// 2) lane headers, legend
const laneAudit = await auditSelector('[data-lane-header]');
const legendAudit = await auditSelector('[data-legend]');

// 3) home card meta line
await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle0', timeout: 15000 });
await page.waitForSelector('[class*="card"]', { timeout: 5000 });
const cardAudit = await page.evaluate(() => {
  const cards = Array.from(document.querySelectorAll('[class*="card"]'));
  const card = cards.find((c) => (c.textContent ?? '').includes('val27-swimlane'));
  if (!card) return { found: false };
  const out = [];
  const walk = (el) => {
    for (const child of el.children) {
      const cs = getComputedStyle(child);
      const r = child.getBoundingClientRect();
      const hasOwnText = Array.from(child.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim());
      if (hasOwnText) {
        const fs = parseFloat(cs.fontSize);
        const lh = cs.lineHeight === 'normal' ? fs * 1.2 : parseFloat(cs.lineHeight);
        out.push({ cls: child.className, text: child.textContent.slice(0, 40), rectH: r.height, expectMinH: lh, ratio: r.height / lh });
      }
      walk(child);
    }
  };
  walk(card);
  return { found: true, out };
});

// 4) workflow detail run chips
await page.goto(`${BASE}/dashboard/workflow/val27-swimlane`, { waitUntil: 'networkidle0', timeout: 15000 });
await page.waitForSelector('table', { timeout: 5000 });
const chipAudit = await auditSelector('[data-run-chip]');

function flagBad(audit, label) {
  if (!audit.found) { console.log(`[${label}] selector not found`); return; }
  const bad = audit.out.filter((r) => r.ratio < 0.8);
  console.log(`[${label}] ${audit.out.length} text nodes checked, ${bad.length} squeezed (<80% of expected line-height):`);
  for (const b of bad) console.log(`   `, JSON.stringify(b));
  if (bad.length === 0) console.log('    none — clean');
}

console.log('=== swimlane node cell ===');
flagBad(cellAudit, 'node-cell');
console.log('=== bounded diagnostic (flex:none on label/model) ===', JSON.stringify(overrideResult));
console.log('=== agent panel ===');
flagBad(panelAudit, 'agent-panel');
console.log('=== lane header ===');
flagBad(laneAudit, 'lane-header');
console.log('=== legend ===');
flagBad(legendAudit, 'legend');
console.log('=== home card meta ===');
flagBad(cardAudit, 'home-card');
console.log('=== run chip ===');
flagBad(chipAudit, 'run-chip');

await browser.close();
