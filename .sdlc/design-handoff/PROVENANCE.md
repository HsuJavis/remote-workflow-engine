# Design handoff — provenance

**Why this directory exists.** Gate 7.5 failed REQ-134 on a defect that every test missed, and the
validator named the reason: the fidelity oracle was a hand-transcribed subset (`SPEC_ROWS`, 44 rows), so
any spec line nobody copied across could never be checked. DES-209's owner_decision put the choice to
the owner on 2026-09-12; the owner chose **vendor the handoff into the repo as the full oracle**.

## Source

| | |
|---|---|
| Claude Design project | `38fc8181-5b00-45aa-a354-bf07994e19ab` — "Workflow Dashboard Design" (type `PROJECT_TYPE_PROJECT`, owner HUNGJUNG HSU) |
| Path in that project | `design_handoff_workflow_dashboard/` |
| Fetched | 2026-09-12, via the `DesignSync` `get_file` read API |
| Bound design system | Classical `f8a17458-220b-47fd-bca7-474d25bff7a7` — **component classes only** (`.card .tag .btn .table .seg .input .nav .hr`); every token is overridden per theme, so Classical's own gold-on-white look is NOT this design |

## Files here

- `README.md` — the handoff spec, verbatim. This is the **fidelity oracle** for REQ-131..139.
- `Workflow Dashboard.dc.html` — the design itself, byte-identical to the project copy (extracted from
  the raw API response, never retyped). `theme` defaults to `dark`. Its `<style>` block (lines 15-50)
  carries the authoritative `[data-theme]` token sets, the hue-slider styling and all seven `@keyframes`;
  lines 51-508 are the template markup the class names come from.

## Two traps recorded from this iteration

1. **The `.dc.html`'s static hex is a snapshot, not the truth.** It is baked at one hue (teal,
   `--color-accent:#5fb3a1` dark / `#2f8f7d` light) while `README.md` specifies a hue-driven OKLCH
   formula with default h=236. **The formula wins**; the hex is what one slider position happened to
   produce.
2. **This copy can drift.** The upstream lives in Claude Design and can be edited there with nothing
   here noticing. Anyone relying on this as an oracle should re-fetch and diff before trusting it for a
   new iteration. That risk was stated to the owner when the decision was taken and accepted.

Not vendored: `rwe-data.js` (i18n + formatters + REST client + the demo dataset) and `support.js`, the
`.dc` runtime. They are reference implementation, not spec; the engine's own client tree supersedes them.
