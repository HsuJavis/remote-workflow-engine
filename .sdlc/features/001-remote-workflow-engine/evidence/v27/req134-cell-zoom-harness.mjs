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
const browser = await puppeteer.launch({ headless: 'new', executablePath: findChrome(), args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 1000 });
await page.goto(`http://127.0.0.1:8935/dashboard/41e2791d-6495-4a46-a7ce-c383aa485219`, { waitUntil: 'networkidle0', timeout: 15000 });
await page.waitForSelector('#dag-graph', { timeout: 5000 });
const node = await page.$('#dag-zoom [data-node-cell]');
const box = await node.boundingBox();
await page.screenshot({ path: process.argv[2], clip: { x: box.x - 20, y: box.y - 20, width: box.width + 40, height: box.height + 40 } });
const html = await page.evaluate((el) => el.outerHTML, node);
console.log(html);
await browser.close();
