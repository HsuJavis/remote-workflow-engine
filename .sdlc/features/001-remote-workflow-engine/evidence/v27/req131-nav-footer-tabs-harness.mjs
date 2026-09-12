// v27 README-fidelity build evidence: footer/brand/tabs, both themes. Reuses the exact
// findChrome()/screenshot technique from evidence/v27/req131-135-browser-harness.mjs (BASE points
// at the same real booted instance the harness targets — port 8935 — but this pass's minimal
// fixture, unlike setup-instance-b-harness.mjs, registers no external-provider run, so only the
// req131-shaped shell assertions below are meaningful; that is all this evidence is for).
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
const EVDIR = '/home/user/Documents/remote-workflow/.sdlc/features/001-remote-workflow-engine/evidence/v27';
const chrome = findChrome();

const browser = await puppeteer.launch({ headless: 'new', executablePath: chrome, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle0', timeout: 15000 });

  const footerText = await page.evaluate(() => document.querySelector('[data-footer]')?.textContent ?? null);
  const brandText = await page.evaluate(() => document.querySelector('[data-nav-brand]')?.textContent ?? null);
  const currentTab = await page.evaluate(() => document.querySelector('[data-tab][aria-current="page"]')?.textContent ?? null);
  const runningDot = await page.evaluate(() => document.querySelector('[data-running-dot]') !== null);
  console.log(JSON.stringify({ footerText, brandText, currentTab, runningDot }, null, 2));

  await page.screenshot({ path: `${EVDIR}/req131-nav-footer-tabs-dark.png`, fullPage: true });

  await page.evaluate(() => localStorage.setItem('rwe-theme', 'light'));
  await page.reload({ waitUntil: 'networkidle0' });
  await page.screenshot({ path: `${EVDIR}/req131-nav-footer-tabs-light.png`, fullPage: true });
} finally {
  await browser.close();
}
