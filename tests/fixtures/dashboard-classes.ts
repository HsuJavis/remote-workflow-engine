// v27c (DES-209, TASK-214): the class contract, declared BEFORE it appears in code. A STYLE_HOOKS
// entry is a class this row's owner (dashboard.css) defines and the view layer (ui/*.js or
// DASHBOARD_HTML) may set or rename freely as long as the CSS edit travels in the same commit. A
// TEST_ANCHORS entry is a `data-*` attribute or a C2 id — it belongs to the TESTS and is FROZEN; a
// rule may never key on one and a test may never key on a style hook (DES-209's contract).
//
// Every entry is a FLAT atomic class name (no leading combinator, no compound chain) — a compound
// selector in the stylesheet such as `.cell.is-failed` or `.card .t` decomposes into two atoms
// (`cell`, `is-failed` / `card`, `t`), each declared once here regardless of how many compound
// selectors it participates in. `.card` and `.t` appear in BOTH arrays on purpose: the stylesheet
// defines `.card .t` (so `.t` must be a style hook the class-lock's reverse half can find), and
// DES-209's own signature freezes the same two names as C2 test anchors — the two lists are not
// disjoint by construction, only by DEFAULT.
//
// [v27c note, measured against the tree at this task's Gate 6 (2026-09-12)]: `.seg` and several
// REQ-134 swimlane hooks are declared here but NOT YET set by any landed `ui/*.js` — the swimlane
// substrate migration (DES-209 boundary (1)) is TASK-210's own deferred item (see
// `src/dashboard/ui/run.js`'s file-banner comment), and `.seg` has no emitter yet either. Declaring
// the contract ahead of the emitter is DES-209's stated order of operations, not a defect — the
// emitter half of the class lock (`dashboard-no-design-values.test.ts`) is the SLICE's own final
// green, re-run once every view task lands.

/** Every class `dashboard.css` defines, atomised. Length is asserted `>= 60` by DES-209. */
export const STYLE_HOOKS: readonly string[] = [
  // -- components (the Classical borrow + ported utilities) --
  'card', 't', 's', 'mono', 'tag', 'tag-outline', 'tag-accent', 'tag-neutral', 'btn', 'btn-icon',
  'table', 'seg', 'input', 'nav', 'hr', 'sys-table', 'models-table', 'issue-row', 'issue-detail',
  'degraded', 'empty', 'back', 'fit-btn', 'zoomable',

  // -- REQ-131 shell --
  'rwe-nav', 'rwe-tabs', 'rwe-tab-panels', 'rwe-connection', 'is-live', 'is-degraded', 'is-offline',
  'rwe-theme-group', 'rwe-lang-group', 'rwe-hue-slider', 'rwe-version', 'rwe-update-panel',
  'rwe-update-outcome', 'rwe-update-cta', 'rwe-config-check', 'active',
  // [v27 README-fidelity build] `nav-brand` (README "Header / chrome": brand text next to the
  // source tag) and `rwe-footer` (README: "Footer: API base left, Updated HH:MM:SS right, 11.5px
  // 50%") — neither existed before this pass; both are new `app.js`-built chrome, not swimlane/panel.
  'nav-brand', 'rwe-footer',

  // -- REQ-132 home --
  'card-section', 'other', 'card-grid', 'cards', 'running', 'kicker', 'meta', 'home-toolbar',
  'home-search', 'segment-tabs',
  // [v27 README-fidelity build] `running-dot` — README "1. Workflows home": the Running section's
  // h6 carries a pulsing 8px accent dot (`rwePulse`, already declared as a keyframe, unused until
  // now). `home.js` builds it inside the Running group's own heading only.
  'running-dot',

  // -- REQ-133 workflow detail --
  'workflow-view', 'run-view', 'wf-desc', 'run-chip', 'is-selected', 'status-dot',
  'usage-cols', 'usage-lowerbound', 'usage-row',

  // -- REQ-134 swimlane (DES-209 boundary (1) substrate — declared ahead of TASK-210's re-run) --
  // [v27 Gate 6 fix, VAL-208] `cell-head` (row 1: dot+label) and `cell-meta` (row 2: model+effort)
  // are the row-grouping wrappers that close VAL-208's flex-shrink defect (5 flat column siblings
  // -> 3 grouped rows, per REQ-134's own spec).
  'cell-layer', 'lane-head', 'is-current', 'lane-hairline', 'edge', 'is-active', 'is-walked',
  'is-pending', 'cell', 'is-running', 'is-done', 'is-failed', 'is-queued', 'is-predicted',
  'cell-head', 'cell-dot', 'cell-label', 'cell-meta', 'cell-model', 'cell-effort', 'cell-usage',
  'cell-trigger', 'legend', 'run-summary',
  // -- graph container (DES-209 boundary (2): run.js's/workflow.js's own graphContainer/zoom
  // sizing, moved off `.style.*` — no handoff spec exists for these px values (measured: the
  // handoff's own graph wrapper is `overflow:auto` with dynamic width/height, no fixed height, no
  // pan/zoom at all — it predates REQ-129), so the pre-existing per-view heights are kept verbatim
  // and only relocated. --
  'graph-frame',

  // -- REQ-135 agent panel --
  'agent-backdrop', 'agent-panel', 'from-left', 'stat-cards', 'stat-label',
  'stat-value', 'prompt-pre', 'tag-columns', 'event-list', 'event-row', 'event-kind', 'is-tool',
  'is-message', 'is-log', 'detail-block',
] as const;

/** `data-*` attributes and C2 ids — FROZEN, belongs to the tests, never renamed by a CSS edit. */
export const TEST_ANCHORS: readonly string[] = [
  'data-lane-header', 'data-node-cell', 'data-legend', 'data-agent-panel', 'data-tab',
  'data-section', 'data-run-chip', 'data-history-table',
  // [v27 README-fidelity audit] `data-agent-panel-backdrop` was already emitted by
  // `agent-panel.js` (the DES-209-style comment right next to its own `setAttribute` call even
  // names it a TEST_ANCHORS candidate) but never actually added here or used by any SPEC_ROW —
  // the backdrop's fade/dim (README "Backdrop rgba(8,12,9,.5) fades in .2s") was checked by
  // nothing. Registering the anchor that already exists on disk, not inventing a new one.
  'data-agent-panel-backdrop',
  // [v27 README-fidelity build] the three new chrome anchors this pass's SPEC_ROWS key on: the nav
  // brand text, the footer, and the Running section's pulsing dot (see the STYLE_HOOKS comments
  // above for which README lines each closes).
  'data-nav-brand', 'data-footer', 'data-running-dot',
  '#dag-fit', '#dag-graph', '#dag-zoom', '#run-usage', '#diagram-img', '#diagram-zoom',
  '.card', '.t',
] as const;
