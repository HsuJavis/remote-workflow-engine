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

  // [v29c, REQ-153/154/155] The structural half of the side-by-side audit's first group. These are
  // DOM/text facts, not `getComputedStyle` facts, so SPEC_ROWS cannot carry them (DES-209's
  // SpecExpect is style-shaped only) — asserted directly here, the same convention as val-198's
  // right-cluster ordering case.
  //
  // Measured against the restored reference (design project 38fc8181 served locally with its
  // `/api/*` proxied to a real engine): it has all four strings, the numbered lane headers, the
  // five-key legend and a bordered graph box. This build had none of them.
  itReal('the detail page carries its breadcrumb, triggers column, three section headings and legend (REQ-153/155)', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/dashboard/workflow/val199-detail`, { waitUntil: 'networkidle0', timeout: 10000 });
      await new Promise((r) => setTimeout(r, 1200));
      const txt = await page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' '));
      for (const word of ['總覽', '觸發器', '工作流圖', '檢視執行', '執行歷史']) {
        expect(txt, `missing section/structure string: ${word}`).toContain(word);
      }
      // REQ-155: the legend's five status keys, not just the right-aligned run summary
      for (const key of ['執行中', '完成', '失敗', '排隊', '待執行']) {
        expect(txt, `missing legend key: ${key}`).toContain(key);
      }
    } finally {
      await browser.close();
    }
  }, 20000);

  itReal('lane headers are numbered, and a traversed lane is not painted the same as an unreached one (REQ-154)', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/dashboard/workflow/val199-detail`, { waitUntil: 'networkidle0', timeout: 10000 });
      await new Promise((r) => setTimeout(r, 1200));
      const heads = await page.evaluate(() =>
        [...document.querySelectorAll('[data-lane-header]')].map((e) => ({
          txt: (e as HTMLElement).innerText.replace(/\s+/g, ' ').trim(),
          color: getComputedStyle(e).color,
          index: (e.querySelector('[data-lane-index]') as HTMLElement | null)?.innerText.trim() ?? null,
        })));
      expect(heads.length, 'no lane headers rendered at all').toBeGreaterThan(0);
      // every lane carries its own two-digit index as its OWN element (the reference's shape),
      // never a number folded into the title string
      expect(heads.map((h) => h.index)).toEqual(heads.map((_, i) => String(i + 1).padStart(2, '0')));
      // the graph box is inset, so the trigger cell at x = PAD is not flush against the viewport
      const boxX = await page.evaluate(() => {
        const el = document.querySelector('[data-graph-box]');
        return el ? Math.round(el.getBoundingClientRect().x) : -1;
      });
      expect(boxX, 'the swimlane box is missing or flush to the viewport edge').toBeGreaterThan(0);
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
  //
  // [BF-7 Gate 8 repair, A-2] This case's own assertion changed with the guard it now sits beside,
  // and the change is part of BF-7's commit by necessity, not by choice. It degrades BOTH routes
  // AFTER a healthy paint with the selection unchanged — which is exactly DES-206's (K) arm, so
  // `paintSelected` now bails before any DOM write and the last-known `.run-summary` correctly
  // STAYS. The old `expect(after).toBeNull()` asserted the erase, so it goes red against the right
  // behaviour; restated as the invariant across the fault (exactly one element, text unchanged),
  // which holds under both arms. BF-5/BF-6's actual pins — the two `not.toContain('undefined')`
  // assertions — are untouched, and both findings stay closed: their subject was the literal text
  // "undefined", never the element's absence.
  itReal('a degraded /api/runs/:id (+ its /dag sibling) keeps the last-known run-summary line rather than rendering "undefined" (BF-6, BF-7)', async () => {
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
      // `$$eval` (not `$`): `page.$()` returns an ElementHandle, which has no `textContent`
      // property at all, so `after?.textContent` would be `undefined` on every path and the
      // assertion would be red whether the guard is right or wrong.
      const after = await page.$$eval('.run-summary', (els) => els.map((e) => e.textContent));
      expect(after).toEqual([before]);
      const legendText = await page.$eval('[data-legend]', (el) => el.textContent);
      expect(legendText).not.toContain('undefined');
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 20000);

  // [BF-7 Gate 8 repair] The falsifying case the guard is worthless without, and the reason it is a
  // SEPARATE case rather than an extra assertion on the BF-6 one above: BF-6's case degrades BOTH
  // `/api/runs/:id` and `/api/runs/:id/dag` together, which nulls `view`, so `renderLegend`'s own
  // `if (!view) return` (`run.js:360`) drops the summary element and an absence assertion passes
  // over a BLANKED graph — that file's own comment at the BF-6 case concedes it. The fault here is
  // ASYMMETRIC: `/dag` alone degrades while `/api/runs/:id` stays healthy, which is the shape that
  // made `paintSelected` synthesize `{cells:[],edges:[],warnings:[],lanes:[],current:null}`, hand
  // it to `paintSwimlane` (which `replaceChildren()`s the svg and the cell layer before appending,
  // erasing the live figure) and then to `renderLegend`, which — `view` being truthy — computed
  // `nodeCount` off the invented `cells` and printed 「0 個節點」 beside two true figures.
  //
  // The assertions are invariants ACROSS the fault, never presence/absence: an unchanged cell count
  // (a bare "non-zero" would pass on a repaint of the wrong run) and the summary still reporting
  // the TRUE node count (asserting the element is absent cannot catch this — on this tick it is
  // present and wrong). Two ticks, because the defect repeats every 3 s, not once.
  itReal('a degraded /api/runs/:id/dag ALONE: the live figure and the true node count survive, never an empty graph and「0 個節點」(BF-7)', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      const pageErrors: string[] = [];
      page.on('pageerror', (err) => pageErrors.push(String(err)));
      await page.goto(`${baseUrl}/dashboard/workflow/val199-detail`, { waitUntil: 'networkidle0', timeout: 10000 });
      await page.waitForSelector('[data-node-cell]', { timeout: 5000 });
      await page.waitForSelector('.run-summary', { timeout: 3000 });
      const beforeCells = await page.$$eval('[data-node-cell]', (els) => els.length);
      // Without this the "unchanged" assertion below would pass vacuously on 0 === 0.
      expect(beforeCells).toBeGreaterThan(0);
      const beforeSummary = await page.$eval('.run-summary', (el) => el.textContent);
      expect(beforeSummary).not.toContain('undefined');

      await page.setRequestInterception(true);
      page.on('request', (req) => {
        // ONE route only — the sibling `/api/runs/:id` stays healthy, which is the whole point.
        if (new URL(req.url()).pathname === `/api/runs/${detailRunId}/dag`) {
          req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ runs: [], degraded: 'val199 injected dag-only degrade' }) });
          return;
        }
        req.continue();
      });
      // One poll tick is ~3s (app.js); wait past two so a repeat of the defect would be caught.
      await new Promise((r) => setTimeout(r, 7000));

      const afterCells = await page.$$eval('[data-node-cell]', (els) => els.length);
      expect(afterCells).toBe(beforeCells);
      const afterSummary = await page.$$eval('.run-summary', (els) => els.map((e) => e.textContent));
      expect(afterSummary).toEqual([beforeSummary]);
      expect(afterSummary[0]).not.toMatch(/(^|[^\d])0 (個節點|nodes)/);
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 30000);

  // [BF-7 Gate 8 repair] The SECOND of the two mandatory branches. The case above pins the KEEP arm
  // (a degrade AFTER a healthy paint, selection unchanged); nothing pins the UNAVAILABLE arm, and a
  // mandatory branch that has never executed in a browser is exactly the shape this finding is about
  // — `paintFigureUnavailable` and the `t(lang,'unavailable')` key would otherwise ship unrun (`.js`,
  // so `tsc` sees none of it). The interception is installed BEFORE `goto`, so the view never has a
  // successful paint of this run and `state.paintedRunId` stays null: DES-206's (U) arm.
  //
  // The pre-fix code passes the SYNTHESIZED empty payload to `paintSwimlane` here too, which renders
  // an empty graph with no marker at all — indistinguishable from "still loading" for an operator —
  // so the `.empty` assertion is what falsifies this arm, and the string comes from the table
  // (`t('zh','unavailable')`), never a per-file literal.
  itReal('a degraded /api/runs/:id/dag from LOAD: the figure region paints the ONE Unavailable component, not an empty graph (BF-7)', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      const pageErrors: string[] = [];
      page.on('pageerror', (err) => pageErrors.push(String(err)));
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        if (new URL(req.url()).pathname === `/api/runs/${detailRunId}/dag`) {
          req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ runs: [], degraded: 'val199 injected first-paint degrade' }) });
          return;
        }
        req.continue();
      });
      await page.goto(`${baseUrl}/dashboard/workflow/val199-detail`, { waitUntil: 'networkidle0', timeout: 10000 });
      await page.waitForSelector('[data-legend] .empty', { timeout: 8000 });
      // The marker's text is the string table's zh value (the page's default lang), not a literal
      // copied into `ui/workflow.js` — `ui/system.js:29`'s zh-only const is the debt this must not
      // duplicate. A missing key would render the literal string "undefined" here (`t()` has no
      // fallback), which is why the text is asserted rather than just the element's presence.
      const markerText = await page.$eval('[data-legend] .empty', (el) => el.textContent);
      expect(markerText).toBe('無法取樣');
      // Cleared, not painted-over: no cells, no svg children, and no run-summary fabricated beside
      // a graph that was never drawn.
      expect(await page.$$eval('[data-node-cell]', (els) => els.length)).toBe(0);
      expect(await page.$$eval('.workflow-view svg', (els) => els.map((e) => e.children.length))).toEqual([0]);
      expect(await page.$$eval('.run-summary', (els) => els.length)).toBe(0);
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 30000);
});
