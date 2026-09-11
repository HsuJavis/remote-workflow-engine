// v27 (DES-200/201, ARCH-122, TASK-205, REQ-131/REQ-070): the dashboard becomes a SHELL — markup +
// tokens CSS + a JSON data island + one classic script + one module script. ZERO inline executable
// JS (ARCH-122's boundary; makes ARCH-130's `script-src 'self'` CSP achievable). All browser
// BEHAVIOUR (fetching, DOM rendering, zoom/pan, theme/lang) now lives in `src/dashboard/{lib,ui}/*.js`
// (TASK-206..212), served byte-for-byte with no build step (ADR-049) — this file's ONLY job is to
// assemble the static bytes; it decides nothing.
import { readFileSync } from 'node:fs';
import type { UpdateOutcome } from './update-types.js';
import { resolveEngineVersion } from './github/issue-reporter.js';

// ─── DES-065 (TASK-068): pure logical→pixel mapper + Morandi palette ─────────────────────────────
// v27 (04-design.md "Decision rationale — v27"): this Morandi SVG renderer loses its last CLIENT
// consumer this iteration (the swimlane painter, DES-203/206, replaces it) — it is a
// flagged-not-deleted orphan, same as `DAG_BOX_DEFAULTS`/`dagBox` in dashboard.ts: still exported,
// still unit-tested (tests/unit/morandi-renderer.test.ts), removed only when ITS OWN change orphans
// it (ADR-056's discipline: remove only what your change orphans).

/** Logical grid cell from the layout engine. */
export interface LayoutCell { col: number; row: number; laneSpan: number }
/** Box dimensions shared between server and browser (one constant controls the visual rhythm). */
export interface BoxSize { cellW: number; cellH: number; gap: number }
/** Screen-space rectangle returned by cellToPixel. */
export interface Rect { x: number; y: number; width: number; height: number }

/** Morandi muted palette — one hue per frame; lives as a CSS-custom-property set so a single
 *  file swap reskins the graph without touching model/topology code. */
const MORANDI_PALETTE = [
  '#b5c4b1', '#c4b5b5', '#b5b9c4', '#c4c0b5', '#b5c4c0',
  '#c8b8b8', '#b8c8c4', '#c4c8b8', '#b8bec8', '#c8c4b8',
];

function stableHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) >>> 0;
  }
  return h;
}

/** Pure logical→pixel mapper. The only place logical grid coordinates become screen geometry;
 *  a box-size restyle (cellW/cellH/gap) touches zero model or topology tests. */
export function cellToPixel(cell: LayoutCell, box: BoxSize): Rect {
  return {
    x: cell.col * (box.cellW + box.gap),
    y: cell.row * (box.cellH + box.gap),
    width: box.cellW,
    height: cell.laneSpan * box.cellH + (cell.laneSpan - 1) * box.gap,
  };
}

/** Pure per-frame hue selector — same frame string always returns the same palette entry (no
 *  flicker across the 3s poll). Two different frames may hash to the same hue by design. */
export function morandiFrameHue(frame: string): string {
  return MORANDI_PALETTE[stableHash(frame) % MORANDI_PALETTE.length]!;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────

// The engine's own version, resolved once at module load (same helper + same value server.ts's
// GET /api/version already serves, DES-061/TASK-064) — the data island's ONE always-present field.
const ENGINE_VERSION = resolveEngineVersion();

// DES-201: the tokens CSS (dark/light bg, the OKLCH accent ramp over --rwe-hue, the ported
// component rules) has ONE source — this file on disk, served externally at
// /static/dashboard/dashboard.css (DES-199) AND read once here to inline into the shell's <style>
// so first paint is themed correctly before the external stylesheet round-trips (both carry the
// SAME bytes; ARCH-130's `style-src 'self' 'unsafe-inline'` CSP permits the inline copy).
const DASHBOARD_CSS = readFileSync(new URL('./dashboard/dashboard.css', import.meta.url), 'utf8');

interface ShellInit {
  version: string;
  lastUpdate?: UpdateOutcome | null;
  interruptedRuns?: number;
}

/** Assemble the shell's bytes. The data island is DATA, not script — `type="application/json"` is
 *  never prepared for execution, so it needs no nonce and is not subject to `script-src` (DES-200).
 *  `<` is escaped exactly as the pre-v27 panelScript did (KP-12 XSS mandate). */
function shell(init: ShellInit): string {
  const islandJson = JSON.stringify(init).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html data-theme="dark" lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Remote Workflow Engine — Dashboard</title>
<link rel="stylesheet" href="/static/dashboard/dashboard.css">
<style>${DASHBOARD_CSS}</style>
<script src="/static/dashboard/ui/theme-init.js"></script>
</head>
<body>
<header>
  <h1>Remote Workflow Engine — Live Dashboard</h1>
  <a href="/dashboard">Runs</a>
  <a href="/dashboard/issues">Issues</a>
</header>
<main>
  <section id="home">
    <h2>Running</h2>
    <div id="home-running" class="cards"></div>
    <h2>Registered</h2>
    <div id="home-registered" class="cards"></div>
    <h2>Other</h2>
    <div id="home-other" class="cards"></div>
    <h2>System</h2>
    <div id="system-panel"></div>
    <h2>Models</h2>
    <div id="models-panel"></div>
  </section>
  <section id="detail" style="display:none">
    <p><a class="back" href="/dashboard">&larr; all runs</a></p>
    <h2>Run <span id="detail-runid"></span> <span id="detail-status" class="pill"></span></h2>
    <div id="phases"></div>
    <div id="run-usage"></div>
    <div id="graph-container" style="overflow:hidden;height:420px;margin:10px 0">
      <button type="button" id="dag-fit" class="fit-btn">Fit</button>
      <div id="dag-zoom" class="zoomable">
        <svg id="dag-graph" xmlns="http://www.w3.org/2000/svg" style="display:block"></svg>
      </div>
    </div>
    <div id="tree"></div>
    <!-- The diagram figure has no separate clipping ancestor (unlike #graph-container above): a
         zoomed-in author SVG may spill past this pane's edge — accepted, Gate 7.5 tracks it. -->
    <div id="diagram-zoom" class="zoomable" style="display:none">
      <!-- v26 Gate 7.5 round 3 (defect D10, REQ-129): draggable="false" is REQUIRED for the pan —
           a default-draggable <img> hands a real press-and-move to the browser's own image drag
           instead of the .zoomable pan handler (VAL-189). -->
      <img id="diagram-img" alt="workflow diagram" draggable="false">
    </div>
    <button type="button" id="diagram-fit" class="fit-btn" style="display:none">Fit</button>
    <pre id="diagram" style="display:none"></pre>
    <p id="mermaidNote" style="display:none"></p>
    <div id="harness-table-section" style="display:none">
      <h2>Agents</h2>
      <div id="harness-table"></div>
    </div>
    <h2>Transcript <span id="tr-agent" class="mdl"></span></h2>
    <pre id="transcript">Select an agent node above.</pre>
  </section>
  <section id="issues" style="display:none">
    <p><a class="back" href="/dashboard">&larr; runs</a></p>
    <h2>Open</h2>
    <div id="issues-open"></div>
    <h2>Resolved</h2>
    <div id="issues-resolved"></div>
    <div id="issue-detail" style="display:none" class="issue-detail">
      <p id="issue-detail-meta"></p>
      <p><a id="issue-detail-link" href="#" target="_blank" rel="noopener noreferrer">Open on GitHub ↗</a></p>
      <pre id="issue-detail-body"></pre>
    </div>
  </section>
</main>
<script type="application/json" id="rwe-init">${islandJson}</script>
<script type="module" src="/static/dashboard/ui/app.js"></script>
</body>
</html>
`;
}

/**
 * Build the dashboard HTML, optionally injecting a server-side update outcome. Keeps its pre-v27
 * signature and its one caller (server.ts). The island always carries `version` (DES-200); `lastUpdate`
 * / `interruptedRuns` are included only when supplied (`JSON.stringify` drops `undefined` keys, so a
 * bare call never emits the literal word "undefined").
 */
export function buildDashboardHtml(init?: { lastUpdate?: UpdateOutcome | null; interruptedRuns?: number }): string {
  return shell({ version: ENGINE_VERSION, lastUpdate: init?.lastUpdate, interruptedRuns: init?.interruptedRuns });
}

// Static browser dashboard shell (DES-018/REQ-008, rebuilt v27 per DES-200/ARCH-122): the SAME
// single page served at GET /dashboard for every /dashboard/<sub-path> (server.ts's SPA catch-all);
// client-side routing reads location.pathname. All behaviour lives in the external ui/*.js + lib/*.js
// modules (TASK-206..212) that query these containers by id — this export holds markup and CSS only.
export const DASHBOARD_HTML = buildDashboardHtml();
