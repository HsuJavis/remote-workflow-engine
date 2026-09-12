import puppeteer from 'puppeteer';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
function findChrome() {
  const root = join(homedir(), '.cache', 'puppeteer', 'chrome');
  for (const rev of readdirSync(root).sort().reverse()) {
    const p = join(root, rev, 'chrome-linux64', 'chrome');
    if (existsSync(p)) return p;
  }
}
const BASE = 'http://127.0.0.1:8935';
const browser = await puppeteer.launch({ headless: 'new', executablePath: findChrome(), args: ['--no-sandbox'] });
const page = await browser.newPage();
page.on('console', (m) => console.log('PAGE LOG:', m.text()));
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
await page.setViewport({ width: 1400, height: 1000 });
await page.goto(`${BASE}/dashboard/workflow/val27-swimlane`, { waitUntil: 'networkidle0', timeout: 15000 });
await page.waitForSelector('[data-node-cell][data-agent-id]', { timeout: 10000 });
const cellCount = await page.evaluate(() => document.querySelectorAll('[data-node-cell][data-agent-id]').length);
console.log('cellCount', cellCount);
const target = await page.$('[data-node-cell][data-agent-id]');
const box = await target.boundingBox();
console.log('box', box);
const elAtPoint = await page.evaluate((x, y) => {
  const el = document.elementFromPoint(x, y);
  return el ? { tag: el.tagName, cls: el.className, dataset: JSON.stringify(el.dataset) } : null;
}, box.x + box.width / 2, box.y + box.height / 2);
console.log('elementFromPoint at cell center:', JSON.stringify(elAtPoint));
try {
  await page.click('[data-node-cell][data-agent-id]');
  console.log('page.click succeeded');
} catch (e) {
  console.log('page.click FAILED:', e.message);
}
await new Promise((r) => setTimeout(r, 500));
console.log('panel exists after page.click:', await page.evaluate(() => !!document.querySelector('[data-agent-panel]')));
await browser.close();
