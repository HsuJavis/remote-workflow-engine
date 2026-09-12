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
// `ui/run.js` (DES-206) and is re-proven by the real-mouse Chromium tests val-193/val-197 (per
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
// `ui/workflow.js` too — `app.js:427`'s `replaceChildren` deletes DASHBOARD_HTML's pre-v27 body
// before first paint (ARCH-122), so the `<img id="diagram-img" ... draggable="false">` this pin
// asserted on DASHBOARD_HTML was guarding dead bytes no browser renders; the element is actually
// built by `workflow.js`'s `img.id = 'diagram-img'` / `img.draggable = false` (real-tier coverage
// unchanged: val-197-diagram-drag-pan.test.ts:119-123).
describe("the author's diagram can be drag-panned: no native image drag (UT-224, D10/REQ-129)", () => {
  it('the diagram <img> is explicitly non-draggable', () => {
    expect(clientFile('ui/workflow.js')).toMatch(/img\.id = 'diagram-img';[\s\S]*?img\.draggable = false;/);
  });

  it('#diagram-img also disables the webkit image drag and text selection', () => {
    expect(clientFile('dashboard.css')).toMatch(/#diagram-img\{[^}]*-webkit-user-drag:none;user-select:none\}/);
  });
});

// v27 (UT-240, DES-200/201, ARCH-122, TASK-205, REQ-131): the served page becomes a SHELL — markup
// + tokens CSS + a JSON data island + one module script; ZERO inline executable JS. `DASHBOARD_HTML`
// keeps its export name (it stays the subject of page-source tests) but now holds markup/CSS only.
//
// Red reason (measured): today's `DASHBOARD_HTML` has NO `data-theme` attribute, links no
// `/static/dashboard/*` asset, and its one `<script>` is the executable inline panel script (no
// `type="application/json"` data island at all) — every assertion below fails against the current
// template literal.
describe('the v27 shell: markup + tokens CSS + a JSON data island, zero inline executable JS (UT-240, DES-200)', () => {
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
    expect(css).toMatch(/\[data-theme="dark"\][^}]*--color-bg:\s*#18191b/);
    expect(css).toMatch(/\[data-theme="light"\][^}]*--color-bg:\s*#eef2f1/);
    expect(css).toMatch(/oklch\([^)]*var\(--rwe-hue\)\)/);
  });

  it('the C1 page-source pins (CSS/markup, not behaviour) survive the rebuild', () => {
    // [v27c] the CSS-rule pin re-points to `dashboard.css` bytes; the markup pin stays on DASHBOARD_HTML.
    expect(clientFile('dashboard.css')).toMatch(/\.fit-btn\{position:relative;z-index:1;/);
    expect(DASHBOARD_HTML).toMatch(/draggable="false"/);
  });
});
