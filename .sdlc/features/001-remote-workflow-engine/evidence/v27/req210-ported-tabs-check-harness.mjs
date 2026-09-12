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
await page.goto('http://127.0.0.1:8935/dashboard', { waitUntil: 'networkidle0', timeout: 15000 });
const tabs = await page.$$eval('[data-tab]', (els) => els.map((e) => e.getAttribute('data-tab')));
console.log('tabs found:', JSON.stringify(tabs));
for (const t of ['models', 'system', 'issues']) {
  const tabEl = await page.$(`[data-tab="${t}"]`);
  if (tabEl) {
    await tabEl.click();
    await new Promise((r) => setTimeout(r, 300));
    const visible = await page.evaluate((tt) => !!document.querySelector(`[data-tab="${tt}"]`), t);
    console.log(t, 'clickable:', visible);
  }
}
await browser.close();
