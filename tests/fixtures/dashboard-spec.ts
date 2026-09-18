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
// `SPEC_ROWS.length >= 40` (64, after the v27c deletion, the v27 Gate 6 VAL-208 additions, the v27
// README-fidelity audit's own rows, the v27 README-fidelity build's 10 rows for the footer/nav-
// brand/running-dot/tabs build plus the re-added `.event-kind.is-tool`/`.is-message` pair, and this
// README-fidelity closure pass's 3 rows for the hue-slider gradient track and the two cell opacity
// fixes) is asserted at the acceptance tier.
//
// [v27 Gate 6 fix, VAL-208]: a new row kind, `notClipped` — the ONE failure class every row above
// is structurally blind to. A literal/token/animation row compares a stylesheet-authored VALUE
// against `getComputedStyle`; a flex-shrink clip has no such authored value to compare (no rule
// sets `height` on `.cell-label`/`.cell-model` — their box height is a LAYOUT OUTCOME of
// `font-size`/`line-height` inside a shrinkable flex column), so the defect VAL-208 found was
// invisible to this oracle until now. `notClipped` compares the anchor's rendered
// `getBoundingClientRect().height` against its OWN `font-size`×`line-height` (read via
// `getComputedStyle` on the SAME element) — see `tests/helpers/spec-rows.ts`.

// [v28 Gate 5, DES-219, TASK-221] `SpecReq`/`SpecView` widen for the two new tabs with a design
// page (Models/System). Issues gets NEITHER a `SpecReq` member NOR a `SpecView` member — DES-217:
// the handoff ships no design page for it, so its visual acceptance is "same tokens/classes as the
// other three tabs" (val-205), not a per-line 規格逐條核 table, and the 99% fidelity clause does not
// apply. These rows are authored from `.sdlc/design-handoff/README.md` §4 (Models) / §5 (System),
// RED, BEFORE `dashboard.css`'s v28 families exist (carry-forward lesson 3: a row copied from
// shipped CSS, or passing by sort-order coincidence, or encoding the very bug it should catch, are
// all worse than a missing row — this table is never read off the built CSS).
import type { EnrichedModelEntry } from '../../src/models/model-catalog.js';

export type SpecReq = 'REQ-131' | 'REQ-132' | 'REQ-133' | 'REQ-134' | 'REQ-135' | 'REQ-137' | 'REQ-138';
export type SpecView = 'home' | 'workflow' | 'run' | 'panel' | 'models' | 'system';
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

  // [v27 README-fidelity build] README "Header / chrome": "Tabs are underlined links
  // (`aria-current="page"` → accent-700 text + accent underline)" — shipped before this pass was a
  // filled `button.active`; rebuilt as `<a>` elements with `aria-current` marking the current tab.
  { req: 'REQ-131', view: 'home', anchor: '[data-tab][aria-current="page"]', prop: 'color', expect: { token: 'accent-700' } },
  { req: 'REQ-131', view: 'home', anchor: '[data-tab][aria-current="page"]', prop: 'text-decoration-line', expect: { literal: 'underline' } },

  // [v27 README-fidelity build] README "Header / chrome": brand "工作流引擎 / Workflow Engine" next
  // to the source tag — did not exist at all before this pass. `notClipped` (not a literal/token
  // row): the thing this line is actually about is the bilingual label FITTING its box in the nav
  // row, not any one property's value.
  { req: 'REQ-131', view: 'home', anchor: 'data-nav-brand', prop: 'height', expect: { notClipped: true } },

  // [v27 README-fidelity build] README "Header / chrome": "Footer: API base left, `Updated
  // HH:MM:SS` right, 11.5 px 50 %" — no footer existed at all before this pass.
  { req: 'REQ-131', view: 'home', anchor: 'data-footer', prop: 'font-size', expect: { literal: '11.5px' } },
  { req: 'REQ-131', view: 'home', anchor: 'data-footer', prop: 'opacity', expect: { literal: '0.5' } },

  // [v27 README-fidelity closure] README "Header / chrome": "hue slider (150 px, gradient track of
  // oklch(0.68 0.07 h) stops, 16 px accent thumb with bg ring, current degrees)" — the track had NO
  // background at all before this pass (a bare native slider). The gradient's own stops are FIXED
  // degree literals (0/45/.../360), not the current --rwe-hue, so this is theme/hue-INVARIANT — a
  // `literal` row, same convention as the fixed failure-red rows elsewhere in this table. Measured
  // via a real Chromium `getComputedStyle` read (`oklch(... 360)` normalises to `oklch(... 0)`, a
  // browser fact, not a typo). The 16px thumb + bg ring is NOT a row: measured (this same pass) that
  // Chromium's `getComputedStyle(el, '::-webkit-slider-thumb')` silently returns the HOST element's
  // own computed style, not the thumb's — a row here could never fail even with zero thumb CSS, so
  // none is added (DES-209's "do not invent a row that cannot fail"); verified by screenshot only.
  { req: 'REQ-131', view: 'home', anchor: '.rwe-hue-slider', prop: 'background-image', expect: { literal: 'linear-gradient(90deg, oklch(0.68 0.07 0), oklch(0.68 0.07 45), oklch(0.68 0.07 90), oklch(0.68 0.07 135), oklch(0.68 0.07 180), oklch(0.68 0.07 225), oklch(0.68 0.07 270), oklch(0.68 0.07 315), oklch(0.68 0.07 0))' } },

  // [v27 README-fidelity closure, third audit sweep] README "Header / chrome": "source tag (`Live`
  // accent tint · `Offline` red outline · `Demo data` outline)" — `.is-live` shipped border-only
  // (no fill), the outline look the README reserves for `Offline`/`Demo data`. `[data-status="live"]`
  // narrows to the state the way `[data-node-cell].is-failed` does elsewhere in this table; a real
  // page mounts with an actual fetch, so by the time SPEC_ROWS run the connection has already
  // ticked past `checking` to `live` (measured, val-198's own `networkidle0` wait).
  { req: 'REQ-131', view: 'home', anchor: '[data-status="live"]', prop: 'background-color', expect: { token: 'accent-100' } },

  // -- REQ-132 home (view: home) --
  { req: 'REQ-132', view: 'home', anchor: '.card', prop: 'border-radius', expect: { literal: '3px' } },
  { req: 'REQ-132', view: 'home', anchor: '.card', prop: 'cursor', expect: { literal: 'pointer' } },
  { req: 'REQ-132', view: 'home', anchor: '.t', prop: 'font-weight', expect: { literal: '600' } },
  // [v29 REQ-146 — POISONED ROW REPLACED] This row asserted `word-break: break-all` on the card
  // title. That value is nowhere in `.sdlc/design-handoff/README.md`; it existed only because the
  // implementation had it — the exact class DES-209's v28 amendment names ("a poisoned row goes
  // green forever and looks like coverage"), and the fourth instance found in this ledger year.
  // README §1 gives the card title the HEADING face at 17px with `text-wrap: pretty`; the three
  // rows below are re-derived from that sentence, not from the stylesheet.
  // Chromium serializes a quoted family with DOUBLE quotes regardless of the source rule's quote
  // style — measured on the running page, same note as the `.mono` row below.
  { req: 'REQ-132', view: 'home', anchor: '.t', prop: 'font-family', expect: { literal: 'Archivo, -apple-system, "Segoe UI", sans-serif' } },
  { req: 'REQ-132', view: 'home', anchor: '.t', prop: 'font-size', expect: { literal: '17px' } },
  { req: 'REQ-132', view: 'home', anchor: '.t', prop: 'text-wrap', expect: { literal: 'pretty' } },
  { req: 'REQ-132', view: 'home', anchor: 'data-section', prop: 'display', expect: { literal: 'flex' } },
  { req: 'REQ-132', view: 'home', anchor: '[data-section] .cards', prop: 'gap', expect: { literal: '16px' } },
  // [v27 README-fidelity closure, third audit sweep] this row was hand-copied from what shipped
  // (a `--color-panel` fill) rather than from the design: the vendored `Workflow Dashboard.dc.html`
  // (lines 110, 129) sets NO background on `.card` at rest — only `.card.running:hover`/
  // `.card:hover` carry an accent TINT (dashboard.css). `background:transparent` normalises to
  // this literal under `getComputedStyle` (same convention as the `is-queued` hollow-dot row
  // below) — theme/hue-INVARIANT, since "no fill" does not vary with either.
  { req: 'REQ-132', view: 'home', anchor: '.card', prop: 'background-color', expect: { literal: 'rgba(0, 0, 0, 0)' } },
  // [v27c gate 5 fix] the sweep is DES-209's own table row: `.card.running::before` — `.card`
  // bare carries no animation at all (dashboard.css:173).
  { req: 'REQ-132', view: 'home', anchor: '.card.running::before', prop: 'animation-name', expect: { animation: ['rweSweep', '2.4s'] } },

  // [v27 README-fidelity build] README "1. Workflows home": "Running (h6 with pulsing 8 px accent
  // dot)" — `rwePulse` was declared in dashboard.css but nothing used it until this pass.
  { req: 'REQ-132', view: 'home', anchor: 'data-running-dot', prop: 'width', expect: { literal: '8px' } },
  { req: 'REQ-132', view: 'home', anchor: 'data-running-dot', prop: 'background-color', expect: { token: 'color-accent' } },
  { req: 'REQ-132', view: 'home', anchor: 'data-running-dot', prop: 'animation-name', expect: { animation: ['rwePulse', '1.6s'] } },

  // -- REQ-133 workflow detail (view: workflow) --
  { req: 'REQ-133', view: 'workflow', anchor: 'data-run-chip', prop: 'border-radius', expect: { literal: '100px' } },
  { req: 'REQ-133', view: 'workflow', anchor: 'data-run-chip', prop: 'font-size', expect: { literal: '12px' } },
  // [Gate 5 re-run, v27 3rd-sweep audit] narrowed from bare `data-run-chip` — the accent-100 fill is
  // `.run-chip.is-selected` only (`dashboard.css:225`); the bare anchor passed by COINCIDENCE
  // (`querySelector` returns the first DOM match, and `workflow.js` sorts chips newest-first with the
  // newest also the default selection, so the two happened to be the same element) — not because
  // every chip carries the fill. Reported at IMPL-266 (1a1746a), fixed here per that report.
  { req: 'REQ-133', view: 'workflow', anchor: '[data-run-chip].is-selected', prop: 'background-color', expect: { token: 'accent-100' } },
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
  // [pending item "the status dot is invisible" fix] `.cell-dot` had shape but no paint in any
  // state — these four rows are the real-tier proof the fix landed, one per README state rule
  // ("running: dot = accent" / "done: dot = text colour" / "failed: dot = the fixed failure red" /
  // "queued/pending: hollow dot"). `is-done`/`is-running` are `token` rows (hue-derived, compared
  // against a same-page probe, DES-209's rule); `is-failed` is `literal` (the fixed red is NOT
  // hue-derived, same convention as the existing `[data-node-cell].is-failed` border-color row
  // above); `is-queued`'s HOLLOW dot is proven via `border-color`, not `background-color` —
  // `getComputedStyle` normalises an authored `transparent` to `rgba(0, 0, 0, 0)`, a serialization
  // detail no `SPEC_ROW` kind should pin as if it were the spec fact (the spec fact is "no fill,
  // a muted ring", and the ring is what the border-color row actually checks).
  { req: 'REQ-134', view: 'run', anchor: '[data-node-cell].is-running .cell-dot', prop: 'background-color', expect: { token: 'color-accent' } },
  { req: 'REQ-134', view: 'run', anchor: '[data-node-cell].is-done .cell-dot', prop: 'background-color', expect: { token: 'color-ink' } },
  { req: 'REQ-134', view: 'run', anchor: '[data-node-cell].is-failed .cell-dot', prop: 'background-color', expect: { literal: 'oklch(0.55 0.16 25)' } },
  { req: 'REQ-134', view: 'run', anchor: '[data-node-cell].is-queued .cell-dot', prop: 'border-color', expect: { token: 'color-muted' } },
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
  // [v27 README-fidelity closure] README "2. Workflow detail", node cell row 2/row 3: "model short
  // name (11 px, 70 %)" / "`52k tok · $0.31 · 2m 10s` (10.5 px, 55 %)" — measured before this pass:
  // `.cell-model` shipped at opacity .8, `.cell-usage` at .72, both theme/hue-INVARIANT constants.
  { req: 'REQ-134', view: 'run', anchor: '[data-node-cell] .cell-model', prop: 'opacity', expect: { literal: '0.7' } },
  { req: 'REQ-134', view: 'run', anchor: '[data-node-cell] .cell-usage', prop: 'opacity', expect: { literal: '0.55' } },

  // -- REQ-135 agent panel (view: panel) --
  { req: 'REQ-135', view: 'panel', anchor: 'data-agent-panel', prop: 'width', expect: { literal: '760px' } },
  // [v27 Gate 7.5 round 2 fix] This literal was `'rweSlideIn'` (the RIGHT-slide default) — copied
  // from what shipped while `agent-panel.js`'s side computation was broken (a post-`await`
  // `window.event` read that was ALWAYS `undefined`, so the panel ALWAYS slid from the right,
  // regardless of the clicked node). Now that `panelSide` runs on real numbers (`ui/run.js`'s
  // `ensureCellLayer` measures the clicked cell synchronously), every val-201 fixture that reaches
  // this row clicks the SOLE node of a single-phase/single-lane run — and `SWIMLANE_BOX`'s own
  // constants put that one lane's cell center (x=236, `PAD 16 + TRIG_W 112 + LANE_W 216 / 2`) past
  // the midpoint of the whole graph's width (360/2=180, `PAD*2 + TRIG_W + LANE_W`), which is the
  // RIGHT half by `panelSide`'s own comparison — so it genuinely, deterministically slides from the
  // LEFT. Measured directly in real Chromium (val-201's own SPEC_ROWS case) before this edit.
  { req: 'REQ-135', view: 'panel', anchor: 'data-agent-panel', prop: 'animation-name', expect: { animation: ['rweSlideInL', '0.28s'] } },
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
  // [v27 README-fidelity audit] two rows below close gaps found walking README §3 "Agent panel"
  // against SPEC_ROWS: the backdrop's own fade/tint (was checked by nothing — `data-agent-panel-
  // backdrop` is newly registered above, an anchor that already existed on disk), and the failure
  // detail box's own border (README: "shown in a red-outlined box" — only its TEXT colour had a
  // row).
  { req: 'REQ-135', view: 'panel', anchor: 'data-agent-panel-backdrop', prop: 'background-color', expect: { literal: 'rgba(8, 12, 9, 0.5)' } },
  { req: 'REQ-135', view: 'panel', anchor: 'data-agent-panel-backdrop', prop: 'animation-name', expect: { animation: ['rweFadeIn', '0.2s'] } },
  { req: 'REQ-135', view: 'panel', anchor: '[data-agent-panel] .detail-block', prop: 'border-color', expect: { literal: 'oklch(0.55 0.16 25)' } },
  // [v27 README-fidelity build] `.event-kind.is-tool`/`.is-message` (README: "tool call = accent
  // tint, message = neutral") — the PREVIOUS pass added these, measured them red three times ("anchor
  // matched no element": no fixture in val-201 ever drove a `tool_call`/`tool_result`/`message`-kind
  // event into the panel), and correctly removed them rather than leave a permanently-red row. This
  // pass fixes the ROOT CAUSE instead of the row: val-201's own fixture now runs one agent call
  // through a real `ClaudeAgentSdkGatewayClient` session (mocked `@anthropic-ai/claude-agent-sdk`
  // `query()`, same technique as IT-027) that yields a real assistant-text turn and a real tool_use/
  // tool_result pair — both event kinds now genuinely reach the panel, so these rows are re-added
  // and checked against THAT run, never against `runId`'s plain ollama-stub run.
  { req: 'REQ-135', view: 'panel', anchor: '[data-agent-panel] .event-kind.is-tool', prop: 'background-color', expect: { token: 'accent-100' } },
  { req: 'REQ-135', view: 'panel', anchor: '[data-agent-panel] .event-kind.is-message', prop: 'background-color', expect: { token: 'color-panel2' } },

  // -- REQ-137 Models (view: models), authored from README §4 --
  // "`.table` min 960 px, horizontally scrollable" — a fixed viewport CANNOT prove "scrollable"
  // (that needs a real overflow probe, not getComputedStyle), so this row asserts only the
  // computed min-width floor, the provable half.
  { req: 'REQ-137', view: 'models', anchor: 'data-model-table', prop: 'min-width', expect: { literal: '960px' } },
  // "active header colored accent-700 with ▲/▼" — the ▲/▼ glyph is TEXT CONTENT (checked at the
  // acceptance layer directly, val-203), the COLOR is this row.
  { req: 'REQ-137', view: 'models', anchor: '[data-model-table] th.sort-active', prop: 'color', expect: { token: 'accent-700' } },
  // "Row click -> right slide-in panel (560 px)".
  { req: 'REQ-137', view: 'models', anchor: 'data-model-panel', prop: 'width', expect: { literal: '560px' } },
  // "Benchmarks with 2 px track / 4 px accent bar per score (grid `140px 1fr 48px`)" — PARKED, see
  // PARKED_SPEC_ROWS below (Won't-have D2 / ADR-060): no real `/api/models` reply can ever paint a
  // `.bench-row`, so these three stay out of the active SPEC_ROWS set this iteration.

  // -- REQ-138 System (view: system), authored from README §5 --
  // "Four stat cards ... 34 px / 500 figure, 2 px track with 4 px accent bar".
  { req: 'REQ-138', view: 'system', anchor: '[data-sys-stat-card] .stat-value', prop: 'font-size', expect: { literal: '34px' } },
  { req: 'REQ-138', view: 'system', anchor: '[data-sys-stat-card] .stat-value', prop: 'font-weight', expect: { literal: '500' } },
  { req: 'REQ-138', view: 'system', anchor: '[data-sys-stat-card] .stat-track', prop: 'height', expect: { literal: '2px' } },
  { req: 'REQ-138', view: 'system', anchor: '[data-sys-stat-card] .stat-bar', prop: 'height', expect: { literal: '4px' } },
  { req: 'REQ-138', view: 'system', anchor: '[data-sys-stat-card] .stat-bar', prop: 'background-color', expect: { token: 'color-accent' } },
  // "engine's own row marked ★ and accent bar" — the accent bar is the provable computed-style
  // half; the ★ glyph is text content, checked at val-204.
  { req: 'REQ-138', view: 'system', anchor: '[data-proc-table] .proc-self', prop: 'border-left-color', expect: { token: 'color-accent' } },
] as const;

// [v28, IMPL-292/IMPL-293] PARKED, not deleted, not left permanently red: the three REQ-137
// `.bench-row` rows that used to live in SPEC_ROWS above (grid-template-columns, `.stat-track`
// height, `.stat-bar` height — README §4's "Benchmarks with 2px track / 4px accent bar per score").
// `EnrichedModelEntry` (`src/models/model-catalog.ts:341`) carries no `benchmarks` field this
// iteration and `enrichModelEntry` (`:419`) never emits one — this is `01-requirements.md`'s
// Won't-have **D2** ("models 的 latency 量測管線與 benchmark 資料源...本輪不做"), and
// `02-architecture.md`'s **ADR-060** independently confirms the Models tab ships wire-neutral, with
// "typed-but-absent `latency`/`benchmarks`" never emitted on the wire. So no real `/api/models`
// reply can ever paint a `.bench-row` — a case asserting one would either stay red forever (which
// teaches everyone to ignore red) or only pass by faking the catalog, which `val-203-models-tab.
// test.ts:4`'s own "no mock catalog" mock-policy banner already forbids (considered and rejected in
// IMPL-292's investigation). Restore these three rows to SPEC_ROWS's `view: 'models'` set the day D2
// is lifted (`benchmarks` lands on `EnrichedModelEntry` and `enrichModelEntry` emits it for a real
// row) — do NOT rewrite them to assert the absence instead (that would encode Won't-have D2 as a
// permanent pass and go green forever even after D2 lifts; ADR-060's own housekeeping note (iv)
// names this exact trap for the honesty-column tests and it applies here too).
export const PARKED_SPEC_ROWS: ReadonlyArray<SpecRow> = [
  { req: 'REQ-137', view: 'models', anchor: '.bench-row', prop: 'grid-template-columns', expect: { literal: '140px 1fr 48px' } },
  { req: 'REQ-137', view: 'models', anchor: '.bench-row .stat-track', prop: 'height', expect: { literal: '2px' } },
  { req: 'REQ-137', view: 'models', anchor: '.bench-row .stat-bar', prop: 'height', expect: { literal: '4px' } },
] as const;

// Anti-rot tripwire, not a test: `npx tsc --noEmit` already runs on every gate, so wire the parking
// decision straight to the type it depends on rather than trusting a future reader to re-find this
// comment. While `EnrichedModelEntry` has no `benchmarks` key, `_D2StillHolds` is `true` and the
// assignment below compiles. The day someone adds `benchmarks` to that interface (D2 lifted),
// `_D2StillHolds` becomes `never`, `_d2Guard`'s assignment stops compiling, and the resulting
// `tsc --noEmit` error points straight at this file and PARKED_SPEC_ROWS above.
type _D2StillHolds = 'benchmarks' extends keyof EnrichedModelEntry ? never : true;
const _d2Guard: _D2StillHolds = true;
void _d2Guard;
