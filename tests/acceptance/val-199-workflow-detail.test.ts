// VAL-199 (REQ-133; DES-197/204/206; 04-design.md's own v27 real-tier path): real Chromium — a
// workflow detail page: version/trigger tags, run chips, the nine-column history table with a LIVE
// row, a row click switching the figure, and a never-registered-run workflow rendering its
// predicted lanes.
//
// [v27b amendment, Round v27b owner ruling, ADR-051]: a THIRD case adds a SECOND, auth-ENABLED
// server and proves the predicted overlay is visible there too — the reversal's whole point. The
// Gate 7.5 instruction FLIPPED from "record what degrades under auth" to "PROVE the overlay IS
// visible" (ADR-051's own words); this case may not be judged before TASK-201's predicted-cell
// `label` has landed, or the Chromium oracle photographs grey boxes reading the literal word "agent"
// and that screenshot becomes the wrong baseline.
//
// Mock policy (acceptance): real createServer(), real MCP HTTP, real Chromium.
//
// Red reason (measured): today's dashboard has no "workflow detail" page at all — a card click goes
// straight to a run's DAG/diagram view (`showDescribe`/`renderDescribe` in `dashboard-page.ts`
// render only the diagram + harness table, no version tag, no run-chips row, no history table). The
// auth-ENABLED case is red for the SAME reason (no such view exists), not for an auth-specific one.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { TokenStore } from '../../src/auth/token-store.js';
import { registerPublishedVia, type ToolCaller } from '../helpers/workflow-fixtures.js';
import { throwIfBrowserRequired } from '../helpers/require-browser.js';
import { SPEC_ROWS } from '../fixtures/dashboard-spec.js';
import { specRowFailuresAcrossThemeAndHue } from '../helpers/spec-rows.js';

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

let server: Server;
let baseUrl: string;
let tmpDir: string;
let detailRunId: string;

// v27b (Round v27b owner ruling, ADR-051): a SECOND, auth-ENABLED server proving the predicted
// overlay is visible there too — the reversal's whole point. Same `mintBearer` pattern as
// dag-masking-auth.test.ts: authServer is loopback-bound (127.0.0.1), so D-BIND does not exempt it
// and registration genuinely needs the bearer; the dashboard PAGE itself needs none (no identity
// plumbing on that route at all — the same reachability the original H2 finding described).
let authServer: Server;
let authBaseUrl: string;
let authTmpDir: string;
const AUTH_OWNER = 'val199-owner@example.com';
const AUTH_AGENT_MARKER = 'val199-auth-marker-agent';

async function mcpCall(name: string, args: unknown): Promise<any> {
  const res = await fetch(`${baseUrl}/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Math.random(), method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = (await res.json()) as { result?: { content: Array<{ text: string }> } };
  return JSON.parse(body.result!.content[0]!.text);
}

async function mintBearer(workRoot: string, email: string): Promise<string> {
  const db = new Database(join(workRoot, 'auth-tokens.db'));
  const now = Date.now();
  const store = new TokenStore(db, { clock: () => now, csprng: (n: number) => randomBytes(n) });
  const { token } = store.issue(email, 7 * 24 * 3600_000);
  db.close();
  return token;
}

function authMcpCallFor(bearer: string): ToolCaller {
  return async (name, args) => {
    const res = await fetch(`${authBaseUrl}/mcp`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: Math.random(), method: 'tools/call', params: { name, arguments: args } }),
    });
    const body = (await res.json()) as { result?: { content: Array<{ text: string }> } };
    return JSON.parse(body.result!.content[0]!.text);
  };
}

beforeAll(async () => {
  if (reason) { console.log(`[val-199] ${reason}`); return; }
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-val199-'));
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir });
  baseUrl = `http://127.0.0.1:${server.port}`;
  await registerPublishedVia(mcpCall, 'val199-detail', `phase('one'); await agent('a', { prompt: 'p' }); return 'ok';`);
  const run = await mcpCall('run_start', { name: 'val199-detail' });
  detailRunId = run.runId;
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const s = await mcpCall('run_status', { runId: run.runId });
    if (['completed', 'failed'].includes(s.status)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  // `meta.phases` is declared explicitly — `describe.phases` is the author's own static contract
  // (mcp-facade.ts:491-503/workflow-meta.ts's `parseMeta`, val-111's own precedent), never derived
  // from scanning a `phase()` CALL at runtime, so a script that only calls `phase('a')` describes
  // as `phases: []` and the predicted-lane join (`predictedLanes`) never has a row to attach agents
  // to. Without this, both never-run cases below can only exercise the `predictedLayoutUnavailable`
  // fallback, never the agent-NAME branch the design and the auth-enabled case require.
  await registerPublishedVia(mcpCall, 'val199-never-run', `export const meta = { params: { agents: { x: { model: { type: 'string', default: 'default' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } } } }, phases: [{title:'a'}] };\nphase('a'); await agent('x', {}); return 1;`);

  authTmpDir = mkdtempSync(join(tmpdir(), 'rwe-val199-auth-'));
  authServer = await createServer({
    port: 0, bind: '127.0.0.1', workRoot: authTmpDir,
    auth: {
      enabled: true, issuer: 'http://127.0.0.1:0',
      googleClientId: 'val199-client-id', googleClientSecret: 'val199-client-secret',
      googleBase: 'http://127.0.0.1:0', jwksFetch: async () => [],
    },
    principals: { [AUTH_OWNER]: { role: 'author' } },
  } as never);
  authBaseUrl = `http://127.0.0.1:${authServer.port}`;
  const ownerToken = await mintBearer(authTmpDir, AUTH_OWNER);
  // Same `meta.phases` declaration as the plain-server fixture above — required for the predicted
  // agent NAME (not just the fallback wording) to reach `describe.phases[].agents` at all.
  await registerPublishedVia(authMcpCallFor(ownerToken), 'val199-auth-never-run', `export const meta = { params: { agents: { '${AUTH_AGENT_MARKER}': { model: { type: 'string', default: 'default' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } } } }, phases: [{title:'a'}] };\nphase('a'); await agent('${AUTH_AGENT_MARKER}', {}); return 1;`);
}, 30000);

afterAll(async () => {
  await server?.close();
  await authServer?.close();
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  if (authTmpDir) rmSync(authTmpDir, { recursive: true, force: true });
});

const itReal = (name: string, fn: () => Promise<void>, timeout?: number): void => {
  it(name, async (ctx) => { if (reason) ctx.skip(); await fn(); }, timeout);
};

describe('workflow detail page, real Chromium (VAL-199, REQ-133)', () => {
  itReal('a workflow detail view exists with a version tag and a run-history table with 9 columns', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/dashboard/workflow/val199-detail`, { waitUntil: 'networkidle0', timeout: 10000 });
      await page.waitForSelector('table', { timeout: 2000 });
      const headerCount = await page.$$eval('table th', (ths) => ths.length);
      expect(headerCount).toBeGreaterThanOrEqual(9);
    } finally {
      await browser.close();
    }
  }, 20000);

  itReal('a never-run workflow renders its predicted lanes, with "predicted layout" wording (never the forbidden word)', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/dashboard/workflow/val199-never-run`, { waitUntil: 'networkidle0', timeout: 10000 });
      // Strip <script>/<style> content — a code COMMENT mentioning "predicted" (or the C3 word)
      // must not make this pass/fail vacuously; only VISIBLE rendered text counts.
      const bodyText = await page.evaluate(() => {
        const clone = document.body.cloneNode(true) as HTMLElement;
        clone.querySelectorAll('script, style').forEach((el) => el.remove());
        return clone.textContent ?? '';
      });
      expect(bodyText.toLowerCase()).not.toContain('skeleton');
      expect(bodyText).toMatch(/predicted|預測/i);
    } finally {
      await browser.close();
    }
  }, 20000);

  // v27b (Round v27b owner ruling, ADR-051; VAL-199/VAL-204's own "may not be judged before
  // TASK-201's label has landed" note): the Gate 7.5 instruction FLIPPED from "record what degrades
  // under auth" to "PROVE the overlay IS visible". A structural DOM check (a lane element exists)
  // would pass on grey boxes reading the literal word "agent" — the actual proof is the AGENT NAME
  // itself, rendered from `describe.phases[].agents`, visible in an ANONYMOUS page load against an
  // auth-ENABLED engine (registration needed the bearer; the page GET needs none).
  itReal('auth-ENABLED engine: a never-run workflow renders the predicted agent NAME, anonymously, with no auth-scoped degradation', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      // No Authorization header at all — the dashboard page and its /api/* GETs carry no bearer on
      // this route (the same reachability the original H2 finding described); only registration
      // above needed the mintBearer trap.
      await page.goto(`${authBaseUrl}/dashboard/workflow/val199-auth-never-run`, { waitUntil: 'networkidle0', timeout: 10000 });
      const bodyText = await page.evaluate(() => {
        const clone = document.body.cloneNode(true) as HTMLElement;
        clone.querySelectorAll('script, style').forEach((el) => el.remove());
        return clone.textContent ?? '';
      });
      expect(bodyText.toLowerCase()).not.toContain('skeleton');
      expect(bodyText).toContain(AUTH_AGENT_MARKER);
    } finally {
      await browser.close();
    }
  }, 20000);

  // [v27c] DES-209's own promised oracle (ADR-053 「規格逐條核」): every SPEC_ROWS row for the
  // 'workflow' view, checked under BOTH data-theme values and once more after a hue-slider move. A
  // row whose anchor matches no element FAILS (never skips) — see spec-rows.ts.
  itReal('SPEC_ROWS (workflow view, REQ-133) hold under both themes and a hue move', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/dashboard/workflow/val199-detail`, { waitUntil: 'networkidle0', timeout: 10000 });
      const rows = SPEC_ROWS.filter((r) => r.view === 'workflow');
      const failures = await specRowFailuresAcrossThemeAndHue(page, rows);
      expect(failures).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 20000);

  // [v27c AC-4 Gate 8 repair] the falsifying test the review named: "describe ok + runs degraded ->
  // tag degraded, no throw". `ui/workflow.js` has no unit tier (ADR-049/ARCH-124: no DOM outside a
  // real browser), so this is the only tier that can witness it. ONE network response is faked at
  // the browser's edge (`/api/runs`, the SAME single-boundary-fake convention as `FAKE_GATEWAY` in
  // the integration tests) — everything else (server, page, describe route, scripts/CSS) is real.
  // Before the repair this reproduced as a `pageerror` (`allRuns.filter is not a function`,
  // `ui/workflow.js`'s `nameFilteredRuns`) and the tag stuck at `checking` — `nextConnection` never
  // even ran because the throw happened before it, in the SAME `onTick` call (`app.js:352`, before
  // `app.js:356`).
  itReal('a degraded /api/runs beside a healthy describe: the connection tag reads degraded, no page error (AC-4)', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      const pageErrors: string[] = [];
      page.on('pageerror', (err) => pageErrors.push(String(err)));
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        if (new URL(req.url()).pathname === '/api/runs') {
          req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ runs: [], degraded: 'val199 injected degrade' }) });
          return;
        }
        req.continue();
      });
      await page.goto(`${baseUrl}/dashboard/workflow/val199-detail`, { waitUntil: 'networkidle0', timeout: 10000 });
      await page.waitForFunction(
        () => document.querySelector('.rwe-connection')?.getAttribute('data-status') !== 'checking',
        { timeout: 10000 },
      );
      const status = await page.$eval('.rwe-connection', (el) => el.getAttribute('data-status'));
      expect(status).toBe('degraded');
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 20000);

  // [BF-6 Gate 8 repair] the falsifying test the review named: a degraded whole-route response on
  // `/api/runs/:id` (and its sibling `/api/runs/:id/dag` — the SAME `{runs:[], degraded:'...'}`
  // catch-all shape server.ts's try/catch returns for either, `paintSelected`'s `Promise.all` fetches
  // both together) was passed unguarded into `ui/workflow.js`'s `paintSelected`: `dagRes.body ||
  // {defaults}` (`:319`, pre-fix) never fires on a truthy degraded body, and `renderLegend(shell.legend,
  // payload, viewRes.body, lang)` (`:322`, pre-fix) is identical in shape to the bug just fixed at
  // `run.js:506` (BF-5) — `view.status` renders as the literal string "undefined" in the
  // `.run-summary` line, with no page error to flag it. `paintSwimlane`'s own internal
  // `Array.isArray` guards already neutralize `:319`'s malformed `payload` for the swimlane itself
  // (an empty repaint either way), so the one assertion that actually falsifies is `:322`'s
  // `.run-summary` text — the same "no page error, no empty element" trap BF-5's own comment names.
  itReal('a degraded /api/runs/:id (+ its /dag sibling) drops the run-summary line rather than rendering "undefined" (BF-6)', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      const pageErrors: string[] = [];
      page.on('pageerror', (err) => pageErrors.push(String(err)));
      await page.goto(`${baseUrl}/dashboard/workflow/val199-detail`, { waitUntil: 'networkidle0', timeout: 10000 });
      await page.waitForSelector('.run-summary', { timeout: 3000 });
      const before = await page.$eval('.run-summary', (el) => el.textContent);
      expect(before).not.toContain('undefined');
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        const p = new URL(req.url()).pathname;
        if (p === `/api/runs/${detailRunId}` || p === `/api/runs/${detailRunId}/dag`) {
          req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ runs: [], degraded: 'val199 injected degrade' }) });
          return;
        }
        req.continue();
      });
      // One poll tick is ~3s (app.js); wait past two to be sure a degraded tick actually landed.
      await new Promise((r) => setTimeout(r, 7000));
      const after = await page.$('.run-summary');
      expect(after).toBeNull();
      const legendText = await page.$eval('[data-legend]', (el) => el.textContent);
      expect(legendText).not.toContain('undefined');
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 20000);
});
