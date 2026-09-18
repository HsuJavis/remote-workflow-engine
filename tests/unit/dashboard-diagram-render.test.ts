// UT-116/UT-158 (TASK-121/TASK-149, DES-133/DES-156, ARCH-084/105-106): the dashboard's
// workflow-detail view fetches `/api/workflows/:name/describe` (replacing `/skeleton`) from
// inside the existing 3s-ticked `render()`, writes `mermaid` (v24, DES-156 — the author-supplied
// diagram string, replacing the retired analyzer-drawn `diagram`/`diagramStatus`/`diagramNote`
// family) into a `<pre>` via `textContent` (never `innerHTML`), renders `mermaidNote` when there
// is no mermaid string, and the home-card mini-preview renders NOTHING when no diagram exists.
//
// Mock policy (unit, DES-119): this repo has no jsdom/browser-DOM test harness (`environment: 'node'`
// in vitest.config, confirmed — no jsdom devDependency), and `dashboard-page.ts`'s browser logic
// lives inside an embedded `<script>` STRING (`DASHBOARD_HTML`/`buildDashboardHtml()`), not a
// Node-importable function — so a full behavioral DOM proof is out of reach at unit tier without
// adding new test infrastructure (a real decision, not this gate's to make silently). This file pins
// the MECHANICAL, source-level properties DES-133/DES-156 name — same convention this exact ledger
// already uses for the no-skeleton-surface guard (TASK-120) and the schema drift-lock series: a
// static assertion over the served page's own source text. The full DOM behavior is additionally
// proven at real-tier by VAL-113/VAL-116's Playwright-driven acceptance path.
import { describe, it, expect } from 'vitest';
// [v27j, TASK-215] DASHBOARD_HTML is no longer imported: the one remaining assertion that used to
// grep it re-points to clientFile()/clientCorpus() (dynamically imported below, same convention
// this file already uses) once the fossil body is deleted (see the disposition comment below).

// v27 disposition (DES-208, TASK-213): every assertion in this describe block was a grep over the
// OLD inline JS SOURCE TEXT embedded in DASHBOARD_HTML — the describe/mermaid fetch, the
// `.textContent = s.mermaid` write, and the `mermaidNote` reference. ARCH-122 empties the shell of
// that text entirely; the workflow-detail view (fetch, textContent write, and the
// `predictedLayoutUnavailable` note that supersedes the old `mermaidNote` concept) now lives in
// `ui/workflow.js` (TASK-209, DES-206), re-proven at the real-Chromium tier by val-199. The
// `/describe` fetch-literal (RETIRED here as a direct grep) MOVES into the disposition anchor below
// as a corpus-wide count, since a bare grep over DASHBOARD_HTML would now find nothing to count.

// (the "not /skeleton" negative retires too — a grep with nothing left to scan is vacuous, and
// TASK-196's no-skeleton-surface guard already walks the real client corpus for this broadly.)

// v27 disposition (DES-208): RETIRES — `renderMiniPreviewAsync`'s absence and `renderHomeGroup`'s
// presence were both greps over inline JS source text that no longer exists in the shell at all;
// checking for either is vacuous once ARCH-122 empties DASHBOARD_HTML. The real invariant (no
// per-card mini-preview fetch, one card-click-through fetch only) is owned by `ui/home.js`
// (TASK-208) and re-proven by val-198's real Chromium home view.

// UT-158 (DES-156, v24 [T3]) disposition (DES-208): the `.mermaid` reference RETIRES with the same
// reasoning as the block above (real coverage: val-199). The two negative guards (no
// diagramStatus/diagramNote, no CDN Mermaid) are exactly DES-208's "dangerous green" class — a
// negative grep with nothing left to scan passes trivially — so they MOVE to the corpus-wide check
// in the disposition anchor below rather than being deleted outright.

// UT-169 (v25, REQ-119, DES-166, TASK-166): the dashboard shows a RENDERED PICTURE, and the way it
// loads that picture is itself the security property.
//
// REQ-119 overrules ADR-033's display decision but keeps BOTH of its reasons: the rendering happens
// server-side, so (1) author-controlled label text never reaches an HTML renderer in a viewer's
// browser and (2) no Mermaid library ships to the client — UT-161's grep guard above is untouched
// and stays green. The `<img>` requirement is not stylistic: `<object>` and `<embed>` load an SVG as
// a DOCUMENT, where script inside it executes; `<img>` does not.
//
// Same mock policy as the cases above (DES-119): `dashboard-page.ts`'s browser logic lives inside an
// embedded `<script>` STRING with no jsdom harness in this repo, so these are source-level
// assertions over the served page. The behavioural proof is VAL-169 (a real engine, a real render).
// v27 disposition (DES-208): the fetch-literal and "no Mermaid library" negatives MOVE below (the
// same class as UT-158's).
//
// [v27j, TASK-215] `<img>`/never-`<object>`/never-`<embed>` MOVES too: this was a grep over the
// fossil body (`dashboard-page.ts:92-152`, deleted by this task), which `app.js:455` discarded
// before first paint — a pin whose subject the browser never renders (ARCH-122's own pin rule). The
// element is actually built by `ui/workflow.js:152-153` (`document.createElement('img')` /
// `img.id = 'diagram-img'`); the never-`<object>`/never-`<embed>` guarantee is a "never CREATE
// this element" fact, so its JS-idiomatic form over `clientCorpus()` is a `createElement` grep, not
// a markup-string grep with nothing left to scan (DES-208's vacuous-green class).
// [v29 c4, REQ-151] UT-169 is SPLIT rather than retired whole. Its first assertion pinned the
// author-diagram `<img>`, whose surface the owner removed (V29-Q2) — that half goes. Its second is
// a live security invariant with nothing to do with the diagram: `<object>`/`<embed>` execute
// script inside an SVG, and the client must never create either, whatever it is rendering. Letting
// that guard die because the element that motivated it was deleted would be throwing away a
// security check as collateral damage of a cosmetic change.
describe('the client never creates <object>/<embed> (UT-169, REQ-119, DES-166)', () => {
  it('no client module can create an element that executes script inside an SVG', async () => {
    const { clientCorpus } = await import('../helpers/client-corpus.js');
    const corpus = clientCorpus();
    expect(corpus).not.toMatch(/createElement\(['"](object|embed)['"]\)/);
    // not vacuous: the corpus really is loaded and really does create elements
    expect(corpus).toContain('createElement(');
  });
});

// v27 disposition (DES-208): RETIRES — "never writes through innerHTML" (the function-body-slice
// technique), "fetches once per (name,version)" (the `diagramKey` memo) and "falls back to the
// source <pre> with a reason" were all greps over inline JS that no longer exists as text anywhere
// in DASHBOARD_HTML. `createObjectURL`/`revokeObjectURL` already re-point under UT-252 below (DES-
// 208 names this pair + "the diagram memo" explicitly); the broader "no innerHTML anywhere in the
// client corpus" invariant (DES-206's D5) MOVES into the same anchor. The once-per-key fetch and
// the unavailable-render fallback are re-proven behaviourally by `ui/workflow.js` (TASK-209) —
// val-199's own dod does not name a Chromium case for the render-failure fallback path specifically,
// which is flagged to the orchestrator as a possible coverage gap (see needs_clarification).

// v27 disposition (DES-208): RETIRES — `loadDag`/`hideDiagram`'s text-slice checks are moot once
// there is no inline JS to slice. Architecturally the bug class (a stale diagram surviving into the
// run view) cannot recur under DES-206: `app.js` fully tears down and rebuilds the view container on
// every route change, so there is no "previous view's leftover DOM" for a run view to inherit — a
// stronger guarantee than the old per-call `hideDiagram()` cleanup it replaces.

// v27 (UT-252, DES-208, TASK-213, REQ-129/119): the disposition anchor for this file — one positive
// beside the negatives DES-208 requires moved here (adjudication (v23) #4's vacuous-survivor class):
// `createObjectURL`/`revokeObjectURL` + "the diagram memo" (TASK-209/`ui/workflow.js`), the
// `/diagram.svg?version=` fetch and the `/describe` fetch-once-per-corpus count (TASK-209), and the
// three corpus-wide negatives DES-206/DES-208 mandate (no `innerHTML`, no CDN/imported Mermaid, no
// `diagramStatus`/`diagramNote`).
//
// Red reason (measured): `src/dashboard/ui/workflow.js` does not exist yet (TASK-209) — the
// createObjectURL/revokeObjectURL/diagram.svg/describe-count positives stay RED until it lands;
// that is the expected split this ledger names elsewhere (TASK-204/213's own preamble rule), not a
// defect. `clientCorpus()` itself does not throw: `src/dashboard/lib/*.js` already exists (a
// sibling task's completed work), so the corpus is non-empty today, and the three negatives are
// already green against it.
// [v29 c4, REQ-151 — RETIRED with its surface] UT-252's disposition anchor asserted that the
// client corpus still carried `createObjectURL`/`revokeObjectURL`, the versioned `/diagram.svg`
// fetch, and two call sites for it. Owner ruling V29-Q2 removed the surface that did all four, so
// the anchor now asserts the presence of code that was deliberately deleted — a test that would
// force the very thing the requirement removes.
//
// The blob-URL pair is gone from `src/dashboard/**` entirely (measured), which is the point: the
// client no longer fetches the diagram at all. The ROUTE is untouched and still covered by
// `tests/integration/diagram-svg-route.test.ts` (IT-134); the removal itself is locked by UT-269.
