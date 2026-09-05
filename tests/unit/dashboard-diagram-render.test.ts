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
import { DASHBOARD_HTML } from '../../src/dashboard-page.js';

describe('dashboard workflow-detail view — diagram surface (UT-116, DES-133)', () => {
  it('fetches /api/workflows/:name/describe (NOT /skeleton) for the workflow-detail view', () => {
    expect(DASHBOARD_HTML).toContain("/api/workflows/'+encodeURIComponent(name)+'/describe");
    expect(DASHBOARD_HTML).not.toContain("/api/workflows/'+encodeURIComponent(name)+'/skeleton");
  });

  it('writes describe.mermaid into a <pre> via textContent — never innerHTML, for this specific field (v24, DES-156)', () => {
    // A `<pre>` element written via `.textContent = s.mermaid` (or an equivalent field read), never
    // `.innerHTML =` anywhere the mermaid source could reach — the codepoint gate is the upstream
    // layer, textContent is the renderer's own belt-and-suspenders (DES-133/DES-156).
    expect(DASHBOARD_HTML).toMatch(/\.textContent\s*=\s*s\.mermaid/);
  });

  it('renders mermaidNote when there is no mermaid string (v24, DES-156)', () => {
    expect(DASHBOARD_HTML).toContain('mermaidNote');
  });
});

describe('dashboard home-card mini-preview — honest absence, no fallback drawing (UT-116, DES-133, owner decision A1)', () => {
  // RE-POINTED at v23 Gate 6.5+7 round 4, per 02-architecture.md's A4 amendment (ARCH-084 dashboard
  // row) and the Gate-2-re-run handoff line "A4's two deleted lines + UT-116 re-point": "removed"
  // means `renderMiniPreviewAsync` and its call site are DELETED, not re-pointed at a different
  // endpoint. The old oracle asserted the function still existed and fetched /describe — which is
  // the very cost A4 removes (one request per card per 3s tick, response discarded). The oracle is
  // now ABSENCE, and it is two-sided: the home-card renderer must still exist, so a whole-file
  // truncation cannot pass this.
  it('has no home-card mini-preview at all — no renderMiniPreviewAsync, no per-card /describe fetch', () => {
    expect(DASHBOARD_HTML).not.toContain('renderMiniPreviewAsync');
    expect(DASHBOARD_HTML).toContain('function renderHomeGroup(');
    // The ONLY surviving /describe fetch is the workflow-detail view's (case 1 above), reached from a
    // card click, never from the card render itself.
    const fetches = DASHBOARD_HTML.split("/api/workflows/'+encodeURIComponent(name)+'/describe").length - 1;
    expect(fetches).toBe(1);
  });
});

// UT-158 (DES-156, v24 [T3]): the dashboard renders describe.mermaid into <pre> via textContent;
// the diagramStatus/diagramNote branches this file's earlier cases used to pin (now rewritten
// above, in the same task) and per-card describe fetches are gone; no client-side Mermaid library.
describe('v24: dashboard renders mermaid, not diagramStatus (UT-158, DES-156)', () => {
  it('the page source references describe.mermaid rendered via textContent', () => {
    expect(DASHBOARD_HTML).toMatch(/\.mermaid\b/);
  });

  it('the page source no longer branches on diagramStatus/diagramNote (retired v23 machinery)', () => {
    expect(DASHBOARD_HTML).not.toMatch(/diagramStatus/);
    expect(DASHBOARD_HTML).not.toMatch(/diagramNote/);
  });

  it('no client-side Mermaid rendering library is referenced (CDN script or import)', () => {
    expect(DASHBOARD_HTML.toLowerCase()).not.toMatch(/mermaid\.min\.js|cdn.*mermaid/);
  });
});
