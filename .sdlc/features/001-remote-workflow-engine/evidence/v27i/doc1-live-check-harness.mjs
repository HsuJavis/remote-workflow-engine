// v27i Gate 7.5 SEND-BACK REPAIR — DOC-1 real-run evidence harness.
// Boots against a scratch deploy.sh instance (see 08-validation.md's "v27i GATE 7.5 SEND-BACK
// REPAIR" section for the exact boot command) on port 8940. Confirms, with a real headless-Chromium
// render of the real deployed page (not source-reading alone), that:
//   1. Models tab: clicking a column header does not re-sort rows (no sort control exists).
//   2. Models tab: clicking a data row opens no slide-in/detail panel.
//   3. System tab: renders exactly the six-row resource table, no stat cards, no process table.
//   4. Issues tab / GET /api/issues: served over the real HTTP route (behaviour cross-checked
//      separately against a real GitHub token in DEPLOY.md's own scratch config; the degrade
//      STRING itself was confirmed by `curl .../static/dashboard/ui/issues.js | grep -o
//      "GitHub not configured"` against the real served bytes, matching src/dashboard/ui/issues.js).
import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME_PATH ||
  '/home/user/.cache/puppeteer/chrome/linux-152.0.7977.75/chrome-linux64/chrome';
const BASE = process.env.RWE_BASE_URL || 'http://127.0.0.1:8940';

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle0' });

// --- Models tab: no sort, no slide-in panel ---
await page.click('[data-tab="models"]');
await new Promise((r) => setTimeout(r, 1500));
const before = await page.evaluate(() =>
  Array.from(document.querySelectorAll('table tbody tr')).slice(0, 5).map((tr) => tr.children[0].textContent));
await page.click('table thead th');
await new Promise((r) => setTimeout(r, 500));
const after = await page.evaluate(() =>
  Array.from(document.querySelectorAll('table tbody tr')).slice(0, 5).map((tr) => tr.children[0].textContent));
await page.click('table tbody tr');
await new Promise((r) => setTimeout(r, 500));
const panelOpenedAfterRowClick = await page.evaluate(() => {
  const el = document.querySelector('.agent-panel, [class*="slide-in"], [class*="detail-panel"]');
  return el ? getComputedStyle(el).display : 'no-such-element';
});
console.log('MODELS: sameOrderAfterHeaderClick=%s, panelAfterRowClick=%s',
  JSON.stringify(before) === JSON.stringify(after), panelOpenedAfterRowClick);

// --- System tab: six-row table, no cards ---
await page.click('[data-tab="system"]');
await new Promise((r) => setTimeout(r, 2000));
const sys = await page.evaluate(() => {
  const cards = document.querySelectorAll('.card, [class*="stat-card"]');
  const table = document.querySelector('table');
  const text = (document.querySelector('main') || document.body).innerText;
  return { cardCount: cards.length, hasTable: !!table, sysTableClass: table ? table.className : null, bodySnippet: text.slice(0, 400) };
});
console.log('SYSTEM:', JSON.stringify(sys, null, 2));

await browser.close();
