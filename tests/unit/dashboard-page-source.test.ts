// v27 disposition (DES-208, TASK-213): UT-191/UT-222(part)/UT-227 RETIRE — the DAG cell's
// sumTokens/costUSD/unpriced rendering and the harness table's alias index are no longer inline JS
// text inside DASHBOARD_HTML at all (ARCH-122 empties the shell of executable JS); a grep for their
// old literals against the now-scriptless shell would pass VACUOUSLY (the "dangerous green" DES-208
// warns about) rather than proving anything. Real coverage: `sumTokens`/`fmtCost` are unit-tested
// directly in tests/unit/dashboard-lib-runlist.test.js (DES-204); the DAG cell's visual cost/token/
// unpriced rendering and the harness table's alias resolution are re-proven at the real-Chromium
// tier by val-200 (swimlane) and val-199 (workflow detail). UT-222's `.fit-btn` pin (a markup/CSS
// fact, not behaviour) STAYS below.
//
// UT-224's "mousedown preventDefault" RETIRES the same way — the zoom/pan handler moves into
// `ui/run.js` (DES-206) and is re-proven by the real-mouse Chromium test val-193 (val-197 was
// its author-diagram sibling and retired with that surface in v29 c4 / REQ-151) (per
// DES-208's own explicit disposition for this exact literal). Its two markup/CSS pins STAY.
//
// Mock policy (unit): page-source text assertion over the exported DASHBOARD_HTML, except the two
// CSS-rule pins below which [v27c] take `clientFile('dashboard.css')` as their subject (DES-200's
// v27c clause: `dashboard-page.ts` deletes its inlined `<style>${DASHBOARD_CSS}</style>` copy, so
// `DASHBOARD_HTML` is no longer a valid subject for a CSS-rule assertion — the `<link>` is the one
// delivery path and the bytes live only in the served file now).
import { describe, it, expect } from 'vitest';
import { DASHBOARD_HTML } from '../../src/dashboard-page.js';
import { clientFile } from '../helpers/client-corpus.js';

// UT-222 (v26 Gate 7.5 round 1, defect D8/REQ-129's fit clause) — STAYS: the shell keeps this
// exact CSS rule (DES-200's boundary names it as a C1 pin that survives the rebuild verbatim).
// [v27c] re-pointed to `dashboard.css` bytes (DES-200/DES-208).
describe('the run page keeps Fit clickable (UT-222, D8/REQ-129)', () => {
  it('.fit-btn is positioned with a z-index (a transformed .zoomable paints above in-flow content)', () => {
    expect(clientFile('dashboard.css')).toMatch(/\.fit-btn\{position:relative;z-index:1;/);
  });
});

// UT-224 (v26 Gate 7.5 round 3, defect D10) — the two markup/CSS facts STAY; the "mousedown
// preventDefault" JS behaviour pin RETIRES (see the file banner above). [v27c] the CSS-rule half
// re-points to `dashboard.css` bytes. [v27c AC-3b Gate 8 repair]: the markup half re-points to
// [v29 c4, REQ-151 — RETIRED with its surface] UT-224 pinned two facts about the author-diagram
// `<img>`: that it set `draggable = false`, and that the stylesheet disabled the webkit image drag
// and text selection on it. Owner ruling V29-Q2 removed that element, so both pins now describe
// something that does not exist. REQ-105 / ADR-048: deleting a surface deletes its tests, it does
// not grandfather them into a permanent green over nothing.
//
// What still covers REQ-102 (the engine side, NOT retired): the route's own integration suite
// `tests/integration/diagram-svg-route.test.ts` (IT-134) and `src/diagram-render.ts`'s unit
// coverage. What the surface's removal is locked by: UT-269
// (`dashboard-diagram-surface-retired.test.ts`), which also keeps `.fit-btn` alive — that class
// belongs to the swimlane's zoom control, not to the deleted one.

// v27 (UT-241, DES-200/201, ARCH-122, TASK-205, REQ-131): the served page becomes a SHELL — markup
// + tokens CSS + a JSON data island + one module script; ZERO inline executable JS. `DASHBOARD_HTML`
// keeps its export name (it stays the subject of page-source tests) but now holds markup/CSS only.
// [UT-240 is a different item — `static-assets.test.ts`, 05-tests.md:12086 — this file's comment
// named the wrong id; fixed under TASK-215 so `sh .sdlc/trace` (which cannot see this class of typo,
// since both ids resolve) is not the only place it is caught.]
//
// Red reason (measured): today's `DASHBOARD_HTML` has NO `data-theme` attribute, links no
// `/static/dashboard/*` asset, and its one `<script>` is the executable inline panel script (no
// `type="application/json"` data island at all) — every assertion below fails against the current
// template literal.
describe('the v27 shell: markup + tokens CSS + a JSON data island, zero inline executable JS (UT-241, DES-200)', () => {
  it('the root element carries the dark default theme and zh-Hant language', () => {
    expect(DASHBOARD_HTML).toMatch(/<html[^>]*data-theme="dark"[^>]*lang="zh-Hant"/);
  });

  it('the page links the vendored stylesheet and the two served scripts from /static/dashboard/*', () => {
    expect(DASHBOARD_HTML).toContain('/static/dashboard/dashboard.css');
    expect(DASHBOARD_HTML).toContain('/static/dashboard/ui/theme-init.js');
    expect(DASHBOARD_HTML).toContain('/static/dashboard/ui/app.js');
  });

  it('exactly ONE inline <script>, and it is the non-executable JSON data island', () => {
    const scriptTags = DASHBOARD_HTML.match(/<script(?![^>]*\bsrc=)[^>]*>/g) ?? [];
    expect(scriptTags.length).toBe(1);
    expect(scriptTags[0]).toMatch(/type="application\/json"\s+id="rwe-init"/);
  });

  it('the island round-trips {version} through JSON.parse with "<" escaped', () => {
    const match = /<script type="application\/json" id="rwe-init">([\s\S]*?)<\/script>/.exec(DASHBOARD_HTML);
    expect(match).not.toBeNull();
    const parsed = JSON.parse((match![1] ?? '').replace(/\\u003c/g, '<')) as { version?: string };
    expect(typeof parsed.version).toBe('string');
  });

  it('the CSS declares the dark/light --color-bg tokens and an oklch()-based accent ramp over --rwe-hue', () => {
    // [v27c] re-pointed to `dashboard.css` bytes: the shell no longer inlines a <style> copy
    // (DES-200), so these token facts are only assertable against the served file directly.
    const css = clientFile('dashboard.css');
    // [v29 REQ-145 — ORACLE RE-DERIVED, third site] This pinned `#18191b` / `#eef2f1`. Measured,
    // those are L .213/C .004 and L .958/C .004 — the README's own `oklch(.21 .006 h)` and
    // `oklch(.955 .008 h)` frozen at ONE hue, i.e. the `.dc.html` static-block snapshot DES-201
    // says is "never copied anywhere". Two sibling sites were re-derived in a85bad1; this one was
    // missed because that sweep searched `tests/acceptance/` only. Asserting the FORMULA is also
    // strictly stronger: a hex can only ever be right at one hue.
    expect(css).toMatch(/\[data-theme="dark"\][^}]*--color-bg:\s*oklch\([^)]*var\(--rwe-hue\)\)/);
    expect(css).toMatch(/\[data-theme="light"\][^}]*--color-bg:\s*oklch\([^)]*var\(--rwe-hue\)\)/);
    expect(css).toMatch(/oklch\([^)]*var\(--rwe-hue\)\)/);
  });

  it('the C1 CSS pin survives the rebuild', () => {
    // [v27c] re-points to `dashboard.css` bytes. [v27j/TASK-215] the sibling markup pin
    // (`draggable="false"` on DASHBOARD_HTML) RETIRES here: UT-224's v27g re-pointed case
    // (`:43` above, `clientFile('ui/workflow.js')`) already guards the real element, and this
    // pin's own subject (the fossil body) is deleted by this task — see DES-208's disposition.
    expect(clientFile('dashboard.css')).toMatch(/\.fit-btn\{position:relative;z-index:1;/);
  });

  // v27j (UT-241's new positive, DES-200/ARCH-122, TASK-215): the F-pattern proof that the fossil
  // body is actually gone — this is the ONE assertion that goes red if `dashboard-page.ts:92-152`
  // ever comes back. RED reason at HEAD (measured): the pre-v27 body still stands between `<body>`
  // and the island, so it contains `<header`/`<section` and no `<main class="empty">`.
  it('the <body> holds ONE mount element — no <section>/<header> fossil, the island, and the module script', () => {
    const bodyMatch = /<body>([\s\S]*)<\/body>/.exec(DASHBOARD_HTML);
    expect(bodyMatch).not.toBeNull();
    const body = bodyMatch![1] ?? '';
    expect(body).toMatch(/<main class="empty">/);
    expect(body).not.toMatch(/<section/);
    expect(body).not.toMatch(/<header/);
    expect(body).toContain('id="rwe-init"');
    const moduleSrcMatch = /<script type="module" src="([^"]+)">/.exec(body);
    expect(moduleSrcMatch).not.toBeNull();
    const assetPath = moduleSrcMatch![1] ?? '';
    // the pre-boot literal names the SAME asset path the module script emits — two copies of one
    // path, one of them unguarded, is how the diagnostic starts lying (DES-200's own reasoning).
    const mainMatch = /<main class="empty">([\s\S]*?)<\/main>/.exec(body);
    expect(mainMatch).not.toBeNull();
    expect(mainMatch![1] ?? '').toContain(assetPath);
  });
});
