// v27c (DES-209, TASK-214, ADR-053): the "規格逐條核" table ADR-053 promised — one row per REQ-131..
// 135 constant, consumed by val-198..202 iterating this array under BOTH `data-theme` values and
// once more after a hue-slider move (DES-209's real-tier oracle). Seeded from REQ-131..135's own
// enumerated acceptance text (DES-209 boundary (4) — the delivery README is not in this repo, so
// those REQ constants are the only in-repo spec of record).
//
// `anchor` is always a TEST_ANCHORS entry (`tests/fixtures/dashboard-classes.ts`) or `:root` for a
// document-level custom property — NEVER a style hook (DES-209's "a test may never key on a style
// hook"); a few rows below reach a descendant via `[data-anchor] .style-hook` — the OUTER lookup is
// still anchor-frozen, the class only narrows within an already-identified element. Row kinds:
// `literal` — a theme/hue-INVARIANT constant (px, timing, keyword, or a fixed REQ colour like the
// failed-state red, which is not hue-derived); `token` — anything that recomputes with theme/hue,
// compared against a same-page probe rather than a hardcoded string (DES-209's rule: a literal
// `oklch(...)` string is only true for hue 236); `animation` — `[name, duration]` against
// `animationName`/`animationDuration`.
//
// [v27c, measured at this task's Gate 6]: three anchors below (`data-section`, `data-run-chip`,
// `data-history-table`) are declared by DES-209's signature but not yet emitted by the landed
// `home.js`/`workflow.js` (measured: `home.js` sets no `data-section`; `workflow.js` sets
// `data-run-chips` on the CONTAINER, not `data-run-chip` per chip; no `data-history-table` anywhere).
// The rows stay — the contract is declared before the emitter, same as `dashboard-classes.ts`'s
// swimlane hooks — reported to the orchestrator as a gap for TASK-208/209's owners, not silently
// worked around here (TASK-214 edits no `ui/*.js`).
//
// This fixture has no consumer yet (val-198..202 are not rewritten to read it in this invocation —
// DES-209's own note: "the tests half of this delta has no gate in the announced invocation").
// `SPEC_ROWS.length >= 40` is asserted at that future acceptance tier, not by this task's own dod.

export type SpecReq = 'REQ-131' | 'REQ-132' | 'REQ-133' | 'REQ-134' | 'REQ-135';
export type SpecView = 'home' | 'workflow' | 'run' | 'panel';
export type SpecExpect =
  | { literal: string }
  | { token: string }
  | { animation: [name: string, duration: string] };

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
  { req: 'REQ-131', view: 'home', anchor: ':root', prop: '--rwe-hue', expect: { literal: '236' } },
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
  { req: 'REQ-132', view: 'home', anchor: '.card', prop: 'animation-name', expect: { animation: ['rweSweep', '2.4s'] } },

  // -- REQ-133 workflow detail (view: workflow) --
  { req: 'REQ-133', view: 'workflow', anchor: 'data-run-chip', prop: 'border-radius', expect: { literal: '100px' } },
  { req: 'REQ-133', view: 'workflow', anchor: 'data-run-chip', prop: 'font-size', expect: { literal: '12px' } },
  { req: 'REQ-133', view: 'workflow', anchor: 'data-run-chip', prop: 'background-color', expect: { token: 'accent-100' } },
  { req: 'REQ-133', view: 'workflow', anchor: 'data-history-table', prop: 'border-collapse', expect: { literal: 'collapse' } },
  { req: 'REQ-133', view: 'workflow', anchor: 'data-history-table', prop: 'width', expect: { literal: '100%' } },
  { req: 'REQ-133', view: 'workflow', anchor: 'data-history-table', prop: 'font-size', expect: { literal: '12.5px' } },
  { req: 'REQ-133', view: 'workflow', anchor: '[data-history-table] tr.is-selected', prop: 'background-color', expect: { token: 'color-accent' } },
  { req: 'REQ-133', view: 'workflow', anchor: '.t', prop: 'font-family', expect: { literal: "'JetBrains Mono', ui-monospace, Consolas, monospace" } },

  // -- REQ-134 swimlane (view: run) --
  { req: 'REQ-134', view: 'run', anchor: 'data-node-cell', prop: 'width', expect: { literal: '216px' } },
  { req: 'REQ-134', view: 'run', anchor: 'data-node-cell', prop: 'height', expect: { literal: '74px' } },
  { req: 'REQ-134', view: 'run', anchor: 'data-node-cell', prop: 'border-radius', expect: { literal: '3px' } },
  { req: 'REQ-134', view: 'run', anchor: 'data-node-cell', prop: 'border-color', expect: { literal: 'oklch(0.55 0.16 25)' } },
  { req: 'REQ-134', view: 'run', anchor: 'data-node-cell', prop: 'opacity', expect: { literal: '0.65' } },
  { req: 'REQ-134', view: 'run', anchor: 'data-node-cell', prop: 'border-style', expect: { literal: 'dashed' } },
  { req: 'REQ-134', view: 'run', anchor: 'data-node-cell', prop: 'animation-name', expect: { animation: ['rweGlow', '1.8s'] } },
  { req: 'REQ-134', view: 'run', anchor: '[data-node-cell] .cell-dot', prop: 'animation-name', expect: { animation: ['rweRing', '1.3s'] } },
  { req: 'REQ-134', view: 'run', anchor: 'data-lane-header', prop: 'font-size', expect: { literal: '13px' } },
  { req: 'REQ-134', view: 'run', anchor: 'data-lane-header', prop: 'font-weight', expect: { literal: '600' } },
  { req: 'REQ-134', view: 'run', anchor: 'data-lane-header', prop: 'letter-spacing', expect: { literal: '0.04em' } },
  { req: 'REQ-134', view: 'run', anchor: 'data-lane-header', prop: 'text-transform', expect: { literal: 'uppercase' } },
  { req: 'REQ-134', view: 'run', anchor: 'data-legend', prop: 'font-size', expect: { literal: '11.5px' } },

  // -- REQ-135 agent panel (view: panel) --
  { req: 'REQ-135', view: 'panel', anchor: 'data-agent-panel', prop: 'width', expect: { literal: '760px' } },
  { req: 'REQ-135', view: 'panel', anchor: 'data-agent-panel', prop: 'animation-name', expect: { animation: ['rweSlideIn', '0.28s'] } },
  { req: 'REQ-135', view: 'panel', anchor: 'data-agent-panel', prop: 'box-shadow', expect: { token: 'shadow-lg' } },
  { req: 'REQ-135', view: 'panel', anchor: '[data-agent-panel] .stat-cards', prop: 'grid-template-columns', expect: { literal: 'repeat(auto-fit, minmax(150px, 1fr))' } },
  { req: 'REQ-135', view: 'panel', anchor: '[data-agent-panel] .prompt-pre', prop: 'white-space', expect: { literal: 'pre-wrap' } },
  { req: 'REQ-135', view: 'panel', anchor: '[data-agent-panel] .detail-block', prop: 'color', expect: { literal: 'oklch(0.45 0.16 25)' } },
  { req: 'REQ-135', view: 'panel', anchor: '[data-agent-panel] .event-kind.is-log', prop: 'border-color', expect: { literal: 'oklch(0.55 0.16 25)' } },
] as const;
