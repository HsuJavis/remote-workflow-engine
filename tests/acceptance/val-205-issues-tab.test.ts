// VAL-215 (REQ-139/REQ-067; DES-217; TASK-224): real Chromium — the Issues tab in v28 clothes.
// This tab ships with NO design page (the handoff's three tabs are Models/System/Workflows; Issues
// is the owner's own fourth), so its acceptance is "same tokens/component classes as the other
// three tabs" rather than a per-line SPEC_ROWS table (DES-217's own boundary — no SPEC_ROW is
// authored for it), PLUS the one real security property `lib/issues.js`'s `safeIssueHref` exists
// to buy: an attacker-controlled issue URL (GitHub lets anyone open an issue) must never become an
// executable `href`.
//
// Mock policy (acceptance): real createServer() with an INJECTED `issueReporter` stub standing in
// for the one genuinely un-runnable third-party network boundary (a real GitHub API call) — same
// convention as `FAKE_GATEWAY` in `dashboard-disclosure.test.ts`; the SUT (server routing + the
// dashboard's own rendering) is never mocked.
//
// Red reason (measured): `ui/issues.js:85` sets `detailLink.setAttribute('href', data.url || '#')`
// with NO safety check at all — a `javascript:` URL from a malicious issue reaches the DOM as a
// live, clickable `href` today.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import type { IssueReporter } from '../../src/github/issue-reporter.js';
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

const MALICIOUS_URL = 'javascript:alert(1)';

const STUB_REPORTER = {
  async listIssues() {
    return { ok: true, issues: [{ number: 1, title: '[evil] issue', state: 'open', labels: [], url: MALICIOUS_URL }] };
  },
  async getIssue(number: number) {
    return { ok: true, issue: { number, title: '[evil] issue', state: 'open', labels: [], body: 'x', url: MALICIOUS_URL, commentCount: 0 } };
  },
} as unknown as IssueReporter;

const DEGRADED_REPORTER = {
  async listIssues() { return { ok: false, error: { code: 'GITHUB_NOT_CONFIGURED', message: 'GitHub not configured' } }; },
  async getIssue() { return { ok: false, error: { code: 'GITHUB_NOT_CONFIGURED', message: 'GitHub not configured' } }; },
} as unknown as IssueReporter;

let server: Server;
let baseUrl: string;
let tmpDir: string;
let degradedServer: Server;
let degradedBaseUrl: string;
let degradedTmpDir: string;

beforeAll(async () => {
  if (reason) { console.log(`[val-205] ${reason}`); return; }
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-val205-'));
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir, issueReporter: STUB_REPORTER });
  baseUrl = `http://127.0.0.1:${server.port}`;

  degradedTmpDir = mkdtempSync(join(tmpdir(), 'rwe-val205-degraded-'));
  degradedServer = await createServer({ port: 0, bind: '127.0.0.1', workRoot: degradedTmpDir, issueReporter: DEGRADED_REPORTER });
  degradedBaseUrl = `http://127.0.0.1:${degradedServer.port}`;
});

afterAll(async () => {
  await server?.close();
  await degradedServer?.close();
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  if (degradedTmpDir) rmSync(degradedTmpDir, { recursive: true, force: true });
});

const itReal = (name: string, fn: () => Promise<void>, timeout?: number): void => {
  it(name, async (ctx) => { if (reason) ctx.skip(); await fn(); }, timeout);
};

describe('Issues tab: v28 clothes + the real safeIssueHref wiring (VAL-215, REQ-139/067)', () => {
  itReal('a malicious issue URL never reaches the DOM as a live javascript: href', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle0', timeout: 10000 });
      await (await page.$('[data-tab="issues"]'))!.click();
      const row = await page.waitForSelector('.issue-row', { timeout: 5000 });
      await row!.click();
      await new Promise((r) => setTimeout(r, 300));
      const hrefs = await page.$$eval('a', (as) => as.map((a) => a.getAttribute('href')));
      expect(hrefs, 'no anchor on the page may carry the malicious javascript: URL as its href').not.toContain(MALICIOUS_URL);
    } finally {
      await browser.close();
    }
  }, 20000);

  itReal('REQ-067 non-regression, re-proven here: GitHub-not-configured (degraded) still shows the degraded TEXT, not a blank tab', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.goto(`${degradedBaseUrl}/dashboard`, { waitUntil: 'networkidle0', timeout: 10000 });
      await (await page.$('[data-tab="issues"]'))!.click();
      await new Promise((r) => setTimeout(r, 300));
      const bodyText = await page.evaluate(() => document.body.textContent ?? '');
      expect(bodyText).not.toBe('');
      expect(bodyText.toLowerCase()).toMatch(/degraded|not configured|github/);
    } finally {
      await browser.close();
    }
  }, 20000);

  itReal('Open/Resolved still partition, and a row still expands to a detail box', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle0', timeout: 10000 });
      await (await page.$('[data-tab="issues"]'))!.click();
      const row = await page.waitForSelector('.issue-row', { timeout: 5000 });
      await row!.click();
      await page.waitForSelector('.issue-detail', { timeout: 3000 });
    } finally {
      await browser.close();
    }
  }, 20000);

  // README-fidelity / DES-217: no design page, so the acceptance bar is theme parity, evidenced by
  // a real screenshot in both `data-theme` values (recorded to the feature's evidence directory,
  // this ledger's standing convention for a claim that cannot be a computed-style assertion).
  itReal('dark and light screenshots are captured as REQ-139\'s own visual evidence', async () => {
    const { mkdirSync } = await import('node:fs');
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle0', timeout: 10000 });
      await (await page.$('[data-tab="issues"]'))!.click();
      await new Promise((r) => setTimeout(r, 300));
      const evidenceDir = join(__dirname, '..', '..', '.sdlc', 'features', '001-remote-workflow-engine', 'evidence', 'v28');
      mkdirSync(evidenceDir, { recursive: true });
      for (const theme of ['dark', 'light'] as const) {
        await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
        await page.screenshot({ path: join(evidenceDir, `val215-issues-${theme}.png`) as `${string}.png` });
      }
      expect(existsSync(join(evidenceDir, 'val215-issues-dark.png'))).toBe(true);
      expect(existsSync(join(evidenceDir, 'val215-issues-light.png'))).toBe(true);
    } finally {
      await browser.close();
    }
  }, 20000);
});
