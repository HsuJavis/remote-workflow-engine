// Issue #117 (owner decision, 2026-10-10): val-203-models-tab.test.ts's `.bench-row` SPEC_ROWS were
// PARKED (tests/fixtures/dashboard-spec.ts's `PARKED_SPEC_ROWS`, Won't-have D2 / ADR-060 and the
// follow-up comment there) because val-203 runs a real, un-mocked `createServer()` with NO injected
// catalog transport — its OpenRouter fetch is the real `https://openrouter.ai/api/v1/models`, so
// whether a clicked row carries benchmarks (and therefore paints `.bench-row` at all) depends on
// live network and on which rows that live listing happens to return that day. This file is the
// "offline data" half of the fix: it boots its OWN real `createServer()` (same mock policy as
// val-203 — a real server, real Chromium, real `enrichModelEntry` pipeline) but injects the
// OpenRouter TRANSPORT only (`modelCatalogFetchers.openrouterFetch`), serving the same captured
// fixture several other suites already replay (`tests/fixtures/models/openrouter-models-sample.json`
// — model-catalog-selection.test.ts, models-list-tool.test.ts, models-query.test.ts). That is not
// "mocking the catalog" in the sense IMPL-292's investigation ruled out (a hand-built fake
// `ModelEntry[]` bypassing real enrichment): the real `buildCatalog`/`enrichModelEntry` pipeline
// still runs, against a captured real OpenRouter reply instead of a live one — exactly the
// technique those other suites already use for the SAME file. `openai/gpt-6.1-sol` in that fixture
// carries a non-null `artificial_analysis.intelligence_index` (51.8), so clicking it deterministically
// paints a `.bench-row`, offline, every run — never racing live network or a live listing's
// day-to-day contents.
//
// Deliberately NOT touching val-203-models-tab.test.ts or moving PARKED_SPEC_ROWS back into
// SPEC_ROWS: doing either would still leave val-203 itself red offline (its own fetch is still
// live), which is exactly the trap the parking note warns against. `PARKED_SPEC_ROWS` stays parked
// as the record of what to restore THERE once val-203 itself gets an offline transport (a separate,
// larger change outside this issue's scope) — this file instead gives the three rows a real,
// passing, offline exercise of their own, which is what "restore" needs ahead of that.
//
// Mock policy (acceptance): real createServer() (an injected TRANSPORT only, not a mock catalog —
// see above), real Chromium (same `findChrome()`/skip-if-absent convention as val-203).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, readdirSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { throwIfBrowserRequired } from '../helpers/require-browser.js';
import { PARKED_SPEC_ROWS } from '../fixtures/dashboard-spec.js';
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

// Same captured fixture + fake-transport technique as model-catalog-selection.test.ts /
// models-list-tool.test.ts — NOT a mock of the catalog layer, a replayed real OpenRouter reply.
const FIX = join(__dirname, '..', 'fixtures', 'models');
const OPENROUTER_SAMPLE = JSON.parse(readFileSync(join(FIX, 'openrouter-models-sample.json'), 'utf8')) as { data: unknown[] };
const BENCHMARKED_MODEL_SEARCH = 'gpt-6.1-sol'; // `openai/gpt-6.1-sol` — intelligence_index: 51.8, the one non-null AA score this fixture row carries

// Of PARKED_SPEC_ROWS's three rows, only these two are actually restorable by this file: a real
// browser's `getComputedStyle(...).gridTemplateColumns` ALWAYS resolves an authored `1fr` track to
// its computed PIXEL width (e.g. "140px 307px 48px"), never echoes the literal "1fr" back — so
// `{ anchor: '.bench-row', prop: 'grid-template-columns', expect: { literal: '140px 1fr 48px' } }`
// cannot pass in ANY real browser, offline or live, regardless of data. That is a defect in the
// ROW ITSELF (the `literal` SpecRow kind has no "mixed px/fr with tolerance" comparison — `token`
// and `notClipped` don't fit a grid-template value either), independent of the data-availability
// reason (Won't-have D2 / ADR-060) the row was originally parked for. Fixing it needs either a new
// SpecRow expect kind or a rewritten row (e.g. asserting the two FIXED tracks only) — an authoring
// decision for dashboard-spec.ts's own owner, out of this file's scope. Left OUT here rather than
// silently skipped, so it keeps failing visibly (confirmed below) instead of being forgotten.
const restorableParked = PARKED_SPEC_ROWS.filter((r) => r.prop !== 'grid-template-columns');

function jsonFetch(body: unknown): typeof fetch {
  return (async () => ({ ok: true, status: 200, json: async () => body })) as unknown as typeof fetch;
}

let server: Server;
let baseUrl: string;
let tmpDir: string;

beforeAll(async () => {
  if (reason) { console.log(`[val-203b] ${reason}`); return; }
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-val203b-'));
  server = await createServer({
    port: 0, bind: '127.0.0.1', workRoot: tmpDir,
    modelCatalogFetchers: { openrouterFetch: jsonFetch(OPENROUTER_SAMPLE) },
  });
  baseUrl = `http://127.0.0.1:${server.port}`;
});

afterAll(async () => {
  await server?.close();
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

const itReal = (name: string, fn: () => Promise<void>, timeout?: number): void => {
  it(name, async (ctx) => { if (reason) ctx.skip(); await fn(); }, timeout);
};

describe('Models tab .bench-row, offline (issue #117: the "restore with offline data" half of the D2/ADR-060 parking)', () => {
  itReal('a search narrowed to a model the fixture carries a real benchmark score for paints .bench-row, and PARKED_SPEC_ROWS holds under both themes and a hue move', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle0', timeout: 10000 });
      await (await page.$('[data-tab="models"]'))!.click();
      await page.waitForSelector('[data-model-table] tbody tr', { timeout: 5000 });
      const search = await page.$('[data-tab-panel="models"] input[type="search"]');
      expect(search, 'a search input must exist on the Models tab').not.toBeNull();
      await search!.type(BENCHMARKED_MODEL_SEARCH);
      await page.waitForSelector('[data-model-table] tbody tr', { timeout: 5000 });
      const rowCount = await page.$$eval('[data-model-table] tbody tr', (rs) => rs.length);
      expect(rowCount, `the search "${BENCHMARKED_MODEL_SEARCH}" must narrow to exactly the one fixture row`).toBe(1);
      const row = await page.$('[data-model-table] tbody tr');
      await row!.click();
      await page.waitForSelector('[data-model-panel]', { timeout: 3000 });
      const benchRow = await page.$('.bench-row');
      expect(benchRow, 'the clicked row carries a non-null artificial_analysis score — .bench-row must paint').not.toBeNull();

      expect(PARKED_SPEC_ROWS.length).toBeGreaterThan(0);
      // The `.stat-track`/`.stat-bar` HEIGHT rows are genuinely data-blocked (exactly what the
      // parking note says) and now pass, offline, with a real benchmark row to click. The THIRD
      // parked row (`.bench-row` `grid-template-columns`) is a SEPARATE, orthogonal defect this
      // file's own investigation surfaced — see `restorableParked`'s own comment just below — and
      // stays excluded here rather than silently skipped: it is reported, not swallowed.
      const failures = await specRowFailuresAcrossThemeAndHue(page, restorableParked);
      expect(failures).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 20000);

  // Tracked, not silently dropped (see `restorableParked`'s comment above): confirms the
  // grid-template-columns row's failure is the computed-style resolution issue, not a regression of
  // this file's own offline wiring — if this ever starts PASSING, the comment above is stale and the
  // row belongs back in `restorableParked`.
  itReal('the grid-template-columns row is confirmed still blocked by computed-style fr-resolution, not by missing data', async () => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' as never, executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle0', timeout: 10000 });
      await (await page.$('[data-tab="models"]'))!.click();
      await page.waitForSelector('[data-model-table] tbody tr', { timeout: 5000 });
      const search = await page.$('[data-tab-panel="models"] input[type="search"]');
      await search!.type(BENCHMARKED_MODEL_SEARCH);
      await page.waitForSelector('[data-model-table] tbody tr', { timeout: 5000 });
      await (await page.$('[data-model-table] tbody tr'))!.click();
      await page.waitForSelector('[data-model-panel]', { timeout: 3000 });
      const gridRow = PARKED_SPEC_ROWS.find((r) => r.prop === 'grid-template-columns')!;
      const failures = await specRowFailuresAcrossThemeAndHue(page, [gridRow]);
      expect(failures.length, 'this row must fail (computed-style fr-resolution), confirming the row itself — not this file\'s data — is the remaining blocker').toBeGreaterThan(0);
      for (const f of failures) expect(f).toMatch(/expected literal "140px 1fr 48px", got "140px \d+px 48px"/);
    } finally {
      await browser.close();
    }
  }, 20000);
});
