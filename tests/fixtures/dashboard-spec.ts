// v27c (DES-209, TASK-214, ADR-053): the "規格逐條核" table ADR-053 promised — one row per REQ-131..
// 135 constant, consumed by val-198/199/200/201 (one `SpecView` per file: home/workflow/run/panel —
// val-202 is REQ-067/076/077/078 ported tabs, no `SpecView` maps to it; the design text's "five
// rows" is imprecise, the type is the four-view contract of record) iterating this array under
// BOTH `data-theme` values and once more after a hue-slider move (`tests/helpers/spec-rows.ts`).
// Seeded from REQ-131..135's own enumerated acceptance text (DES-209 boundary (4) — the delivery
// README is not in this repo, so those REQ constants are the only in-repo spec of record).
//
// `anchor` is always a TEST_ANCHORS entry (`tests/fixtures/dashboard-classes.ts`), `:root` for a
// document-level custom property, or a `[anchor] .hook`/`.hook::pseudo` narrowing of one — NEVER a
// bare style hook (DES-209's "a test may never key on a style hook"); state (`is-running`,
// `is-failed`, …) is encoded ONLY as an `is-*` hook, so a state-specific row has no way to exist
// without narrowing on one — the narrowing stays WITHIN an already-anchored element, the outer
// lookup is still anchor-frozen. Row kinds: `literal` — a theme/hue-INVARIANT constant (px, timing,
// keyword, or a fixed REQ colour like the failed-state red, which is not hue-derived) — never a
// property `getComputedStyle` cannot echo back verbatim (a `repeat()`/`minmax()` formula resolves
// to concrete px tracks; an `em` unit resolves to px); `token` — anything that recomputes with
// theme/hue, compared against a same-page probe rather than a hardcoded string (DES-209's rule: a
// literal `oklch(...)` string is only true for hue 236) — a self-referential `:root` row (`prop`
// already IS `--<token>`) has nothing else to probe against and is checked for non-emptiness only;
// `animation` — `[name, duration]` against `animation-name`/`animation-duration`.
//
// [v27c, measured at TASK-214's Gate 6]: three anchors below (`data-section`, `data-run-chip`,
// `data-history-table`) are declared by DES-209's signature but not yet emitted by the landed
// `home.js`/`workflow.js` (measured: `home.js` sets no `data-section`; `workflow.js` sets
// `data-run-chips` on the CONTAINER, not `data-run-chip` per chip; no `data-history-table` anywhere).
// The rows stay — the contract is declared before the emitter, same as `dashboard-classes.ts`'s
// swimlane hooks — a gap for TASK-208/209's owners, not silently worked around here (TASK-214 edits
// no `ui/*.js`).
//
// [v27c gate 5]: wired into val-198/199/200/201 (`specRowFailuresAcrossThemeAndHue`, confirmed RED
// for the right reason — unlanded anchors above, plus the run-scenario gaps `val-200`/`val-201`'s
// own headers note); six rows rewritten or deleted in this same pass where the ORACLE, not the
// implementation, was wrong (a permanently-unsatisfiable literal, or an anchor DES-209's own table
// does not actually assign the checked rule to) — each carries its own `[v27c gate 5 fix]` comment.
// `SPEC_ROWS.length >= 40` (45, after the v27c deletion and the v27 Gate 6 VAL-208 additions) is
// asserted at the acceptance tier.
//
// [v27 Gate 6 fix, VAL-208]: a new row kind, `notClipped` — the ONE failure class every row above
// is structurally blind to. A literal/token/animation row compares a stylesheet-authored VALUE
// against `getComputedStyle`; a flex-shrink clip has no such authored value to compare (no rule
// sets `height` on `.cell-label`/`.cell-model` — their box height is a LAYOUT OUTCOME of
// `font-size`/`line-height` inside a shrinkable flex column), so the defect VAL-208 found was
// invisible to this oracle until now. `notClipped` compares the anchor's rendered
// `getBoundingClientRect().height` against its OWN `font-size`×`line-height` (read via
// `getComputedStyle` on the SAME element) — see `tests/helpers/spec-rows.ts`.

export type SpecReq = 'REQ-131' | 'REQ-132' | 'REQ-133' | 'REQ-134' | 'REQ-135';
export type SpecView = 'home' | 'workflow' | 'run' | 'panel';
export type SpecExpect =
  | { literal: string }
  | { token: string }
  | { animation: [name: string, duration: string] }
  | { notClipped: true };

export interface SpecRow {
  req: SpecReq;
  view: SpecView;
  anchor: string;
  prop: string;
  expect: SpecExpect;
}

export const SPEC_ROWS: ReadonlyArray<SpecRow> = [
  // -- REQ-131 shell (view: home) --
  { req: 'REQ-131', view: 'home', anchor: ':root', prop: '--color-bg', expect: { token: 'color-bg' } },
  { req: 'REQ-131', view: 'home', anchor: ':root', prop: '--color-accent', expect: { token: 'color-accent' } },
  { req: 'REQ-131', view: 'home', anchor: ':root', prop: '--radius-md', expect: { literal: '3px' } },
  { req: 'REQ-131', view: 'home', anchor: ':root', prop: '--accent-100', expect: { token: 'accent-100' } },
  { req: 'REQ-131', view: 'home', anchor: ':root', prop: '--accent-900', expect: { token: 'accent-900' } },
  // [v27c gate 5 fix] a literal --rwe-hue:236 row can never survive this same file's own
  // "once more after a hue-slider move" pass (DES-209) — that pass SETS --rwe-hue to 80. 236 is
  // the stylesheet's default, a UT-tier fact (dashboard-class-contract.test.ts), not an
  // acceptance-tier one; deleted rather than left permanently red for a category error.
  { req: 'REQ-131', view: 'home', anchor: 'data-tab', prop: 'cursor', expect: { literal: 'pointer' } },
  { req: 'REQ-131', view: 'home', anchor: ':root', prop: '--shadow-md', expect: { token: 'shadow-md' } },

  // -- REQ-132 home (view: home) --
  { req: 'REQ-132', view: 'home', anchor: '.card', prop: 'border-radius', expect: { literal: '3px' } },
  { req: 'REQ-132', view: 'home', anchor: '.card', prop: 'cursor', expect: { literal: 'pointer' } },
  { req: 'REQ-132', view: 'home', anchor: '.t', prop: 'font-weight', expect: { literal: '600' } },
  { req: 'REQ-132', view: 'home', anchor: '.t', prop: 'word-break', expect: { literal: 'break-all' } },
  { req: 'REQ-132', view: 'home', anchor: 'data-section', prop: 'display', expect: { literal: 'flex' } },
  { req: 'REQ-132', view: 'home', anchor: '[data-section] .cards', prop: 'gap', expect: { literal: '16px' } },
  { req: 'REQ-132', view: 'home', anchor: '.card', prop: 'background-color', expect: { token: 'color-panel' } },
  // [v27c gate 5 fix] the sweep is DES-209's own table row: `.card.running::before` — `.card`
  // bare carries no animation at all (dashboard.css:173).
  { req: 'REQ-132', view: 'home', anchor: '.card.running::before', prop: 'animation-name', expect: { animation: ['rweSweep', '2.4s'] } },

  // -- REQ-133 workflow detail (view: workflow) --
  { req: 'REQ-133', view: 'workflow', anchor: 'data-run-chip', prop: 'border-radius', expect: { literal: '100px' } },
  { req: 'REQ-133', view: 'workflow', anchor: 'data-run-chip', prop: 'font-size', expect: { literal: '12px' } },
  { req: 'REQ-133', view: 'workflow', anchor: 'data-run-chip', prop: 'background-color', expect: { token: 'accent-100' } },
  { req: 'REQ-133', view: 'workflow', anchor: 'data-history-table', prop: 'border-collapse', expect: { literal: 'collapse' } },
  // [TASK-214 oracle fix] `width` is a resolved-value property — `getComputedStyle` returns the
  // used pixel width, never the specified `100%`, on any browser (this row could never pass at
  // any implementation). REQ-133 names no numeric table width, so it is not a DES-209 enumerated
  // anchor either; deleted rather than rewritten to a viewport-sized px literal, which would pin
  // Puppeteer's default 800x600 viewport as if it were a requirement.
  { req: 'REQ-133', view: 'workflow', anchor: 'data-history-table', prop: 'font-size', expect: { literal: '12.5px' } },
  // [Gate 5 oracle fix, 2026-09-12] REQ-133 itself (01-requirements.md:1765,
  // 「選中列為 7% accent 底」) specifies a 7% TINT, not a flat `--color-accent` fill — the CSS
  // (`dashboard.css`, `.table tr.is-selected`) already had this right; this row mis-encoded the
  // requirement by probing the wrong token. Fixed via the token-set route (dashboard.css hoists the
  // 7% color-mix() into its own `--row-selected-bg` custom property) rather than extending
  // `tokenProbeValue` with an expression-capable row kind: one row needed it, the existing `token`
  // row kind already expresses "themed value with its own name" exactly, and REQ-133's 7% figure
  // now has a named, greppable home instead of being buried as an inline literal.
  { req: 'REQ-133', view: 'workflow', anchor: '[data-history-table] tr.is-selected', prop: 'background-color', expect: { token: 'row-selected-bg' } },
  // [v27c gate 5 fix] `.t`'s rule is `.card .t` (dashboard.css:99, card-scoped); DES-209's own
  // REQ-133 style-hook row lists `.mono` (dashboard.css:101, standalone), the class the workflow
  // view's monospace figures actually carry.
  // [TASK-214 oracle fix] Chromium's `getComputedStyle` always serializes a quoted font-family
  // with DOUBLE quotes regardless of the source rule's quote style (`dashboard.css:101` writes
  // single quotes) — measured, not a style preference.
  { req: 'REQ-133', view: 'workflow', anchor: '.mono', prop: 'font-family', expect: { literal: '"JetBrains Mono", ui-monospace, Consolas, monospace' } },

  // -- REQ-134 swimlane (view: run) --
  { req: 'REQ-134', view: 'run', anchor: 'data-node-cell', prop: 'width', expect: { literal: '216px' } },
  { req: 'REQ-134', view: 'run', anchor: 'data-node-cell', prop: 'height', expect: { literal: '74px' } },
  { req: 'REQ-134', view: 'run', anchor: 'data-node-cell', prop: 'border-radius', expect: { literal: '3px' } },
  // [v27c gate 5 fix] state is only ever encoded as an `is-*` hook on `[data-node-cell]`
  // (dashboard.css:211-217); the bare anchor always reads whichever cell is first in the DOM
  // (typically `is-done`, which carries none of these four rules) and can never pass. Narrowed to
  // the specific state each rule actually targets — a `[anchor] .hook` narrowing WITHIN an
  // already-frozen anchor, same convention as `[data-history-table] tr.is-selected` below.
  { req: 'REQ-134', view: 'run', anchor: '[data-node-cell].is-failed', prop: 'border-color', expect: { literal: 'oklch(0.55 0.16 25)' } },
  { req: 'REQ-134', view: 'run', anchor: '[data-node-cell].is-queued', prop: 'opacity', expect: { literal: '0.65' } },
  { req: 'REQ-134', view: 'run', anchor: '[data-node-cell].is-queued', prop: 'border-style', expect: { literal: 'dashed' } },
  { req: 'REQ-134', view: 'run', anchor: '[data-node-cell].is-running', prop: 'animation-name', expect: { animation: ['rweGlow', '1.8s'] } },
  { req: 'REQ-134', view: 'run', anchor: '[data-node-cell].is-running .cell-dot', prop: 'animation-name', expect: { animation: ['rweRing', '1.3s'] } },
  { req: 'REQ-134', view: 'run', anchor: 'data-lane-header', prop: 'font-size', expect: { literal: '13px' } },
  { req: 'REQ-134', view: 'run', anchor: 'data-lane-header', prop: 'font-weight', expect: { literal: '600' } },
  // [v27c gate 5 fix] getComputedStyle always resolves letter-spacing to px, never `em` — 0.52px
  // is REQ-134's own 0.04em resolved at the row above's 13px font-size (0.04 * 13 = 0.52),
  // measured against the landed rule, not a relaxed assertion.
  { req: 'REQ-134', view: 'run', anchor: 'data-lane-header', prop: 'letter-spacing', expect: { literal: '0.52px' } },
  { req: 'REQ-134', view: 'run', anchor: 'data-lane-header', prop: 'text-transform', expect: { literal: 'uppercase' } },
  { req: 'REQ-134', view: 'run', anchor: 'data-legend', prop: 'font-size', expect: { literal: '11.5px' } },
  // [v27 Gate 6 fix, VAL-208] the flex-shrink clip itself: `.cell-label`/`.cell-model` measured
  // rendered at ~30% of their own font-size×line-height before the `.cell-head`/`.cell-meta`
  // row-grouping fix (dashboard.css) — this is the "new SPEC_ROWS kind" VAL-208 recommended so the
  // same defect class cannot ship invisibly again.
  { req: 'REQ-134', view: 'run', anchor: '[data-node-cell] .cell-label', prop: 'height', expect: { notClipped: true } },
  { req: 'REQ-134', view: 'run', anchor: '[data-node-cell] .cell-model', prop: 'height', expect: { notClipped: true } },

  // -- REQ-135 agent panel (view: panel) --
  { req: 'REQ-135', view: 'panel', anchor: 'data-agent-panel', prop: 'width', expect: { literal: '760px' } },
  { req: 'REQ-135', view: 'panel', anchor: 'data-agent-panel', prop: 'animation-name', expect: { animation: ['rweSlideIn', '0.28s'] } },
  { req: 'REQ-135', view: 'panel', anchor: 'data-agent-panel', prop: 'box-shadow', expect: { token: 'shadow-lg' } },
  // [v27c gate 5 fix] getComputedStyle never echoes back a `repeat()`/`minmax()` formula — it
  // always resolves to the concrete px track list, so this literal could never pass under any
  // implementation. `display:grid` is the part `getComputedStyle` CAN observe; the minmax(150px)
  // formula itself has no anchor at either tier today (gate_check gap, TASK-214's DoD did not
  // anchor it either — grep confirms 0 hits).
  { req: 'REQ-135', view: 'panel', anchor: '[data-agent-panel] .stat-cards', prop: 'display', expect: { literal: 'grid' } },
  { req: 'REQ-135', view: 'panel', anchor: '[data-agent-panel] .prompt-pre', prop: 'white-space', expect: { literal: 'pre-wrap' } },
  { req: 'REQ-135', view: 'panel', anchor: '[data-agent-panel] .detail-block', prop: 'color', expect: { literal: 'oklch(0.45 0.16 25)' } },
  { req: 'REQ-135', view: 'panel', anchor: '[data-agent-panel] .event-kind.is-log', prop: 'border-color', expect: { literal: 'oklch(0.55 0.16 25)' } },
] as const;
