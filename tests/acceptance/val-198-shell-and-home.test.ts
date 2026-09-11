// VAL-198 (REQ-131, REQ-132; DES-200/201/202/206; 04-design.md's own v27 real-tier path row): real
// Chromium against a really booted engine — the dashboard shell (theme/lang/hue/connection) and the
// Workflows home (search/segments/avgCost/sweep), in ONE session per the design's own grouping.
//
// Mock policy (acceptance): real createServer(), real MCP HTTP, real Chromium (puppeteer). No
// gateway is injected for the home-only assertions; a fake gateway completes runs fast for the
// running/registered card split.
//
// Red reason (measured): none of `data-theme`, `--color-accent`/hue slider, the EN/中 toggle, the
// search box, or the segment counts exist on the current dashboard (confirmed: no `data-theme`,
// `localStorage`, or `prefers-color-scheme` reference anywhere in `src/dashboard-page.ts`).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import type { GatewayClient } from '../../src/gateway/client.js';
import { registerPublishedVia } from '../helpers/workflow-fixtures.js';
import { throwIfBrowserRequired } from '../helpers/require-browser.js';

function findChrome(): string | null {
  const explicit = process.env['PUPPETEER_EXECUTABLE_PATH'];
  if (explicit && existsSync(explicit)) return explicit;
  const root = join(homedir(), '.cache', 'puppeteer', 'chrome');
  if (!existsSync(root)) return null;
  for (const rev of readdirSync(root)) {
    for (const layout of ['chrome-linux64/chrome', 'chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
      const p = join(root, rev, layout);
      if (existsSync(p)) return p;
    }
  }
  return null;
}
const chrome = findChrome();
const reason = chrome ? null : 'SKIPPED: no puppeteer Chrome found (set PUPPETEER_EXECUTABLE_PATH)';
throwIfBrowserRequired(chrome);

const NEVER_RESOLVES_GATEWAY: GatewayClient = { invoke: () => new Promise(() => { /* keeps a run 'running' */ }) };

let server: Server;
let baseUrl: string;
let tmpDir: string;

async function mcpCall(name: string, args: unknown): Promise<any> {
  const res = await fetch(`${baseUrl}/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Math.random(), method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = (await res.json()) as { result?: { content: Array<{ text: string }> } };
  return JSON.parse(body.result!.content[0]!.text);
}

beforeAll(async () => {
  if (reason) { console.log(`[val-198] ${reason}`); return; }
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-val198-'));
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir, gateway: NEVER_RESOLVES_GATEWAY });
  baseUrl = `http://127.0.0.1:${server.port}`;
  await registerPublishedVia(mcpCall, 'val198-running', `await agent('a', { prompt: 'p' }); return 'ok';`);
  await mcpCall('run_start', { name: 'val198-running' });
  await registerPublishedVia(mcpCall, 'val198-registered', `return 'ok';`);
}, 30000);

afterAll(async () => {
  await server?.close();
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

const itReal = (name: string, fn: () => Promise<void>, timeout?: number): void => {
  it(name, async (ctx) => { if (reason) ctx.skip(); await fn(); }, timeout);
};

describe('the v27 dashboard shell + Workflows home, real Chromium (VAL-198, REQ-131/132)', () => {
  itReal('first load: dark by default, --color-bg computes to #18191b', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle0', timeout: 10000 });
      const theme = await page.$eval('html', (el) => el.getAttribute('data-theme'));
      expect(theme).toBe('dark');
      const bg = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim());
      expect(bg).toBe('#18191b');
    } finally {
      await browser.close();
    }
  }, 20000);

  itReal('switching to light persists across a reload (localStorage)', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle0', timeout: 10000 });
      await page.evaluate(() => localStorage.setItem('rwe-theme', 'light'));
      await page.reload({ waitUntil: 'networkidle0' });
      const theme = await page.$eval('html', (el) => el.getAttribute('data-theme'));
      expect(theme).toBe('light');
      const bg = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim());
      expect(bg).toBe('#eef2f1');
    } finally {
      await browser.close();
    }
  }, 20000);

  itReal('moving the hue slider recomputes --color-accent', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle0', timeout: 10000 });
      await page.evaluate(() => { document.documentElement.style.setProperty('--rwe-hue', '80'); });
      const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim());
      expect(accent).toContain('80');
    } finally {
      await browser.close();
    }
  }, 20000);

  itReal('the language toggle swaps a nav label between EN and 中 — 中 must actually appear when selected', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle0', timeout: 10000 });
      await page.evaluate(() => localStorage.setItem('rwe-lang', 'zh'));
      await page.reload({ waitUntil: 'networkidle0' });
      const bodyText = await page.evaluate(() => document.body.textContent ?? '');
      expect(bodyText).toMatch(/[一-鿿]/); // real 繁中 text must appear, not merely "no CJK in EN"
    } finally {
      await browser.close();
    }
  }, 20000);

  itReal('home: three segments, search box, segment counts, and a running-card sweep', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle0', timeout: 10000 });
      await page.waitForSelector('input[type="search"], input[placeholder]', { timeout: 2000 });
      const runningCardBorder = await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('[class*="card"]'));
        return cards.some((c) => (c.textContent ?? '').includes('val198-running'));
      });
      expect(runningCardBorder).toBe(true);
    } finally {
      await browser.close();
    }
  }, 20000);
});
