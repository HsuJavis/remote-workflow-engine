// UT-247b (Gate 6.5+7, verifier): `ui/clock.js` — the browser composition-root clock seam
// (`clockNow()`) IMPL-247 introduced so `ui/agent-panel.js`/`ui/workflow.js` name the wall-clock
// read on one line instead of reading `new Date()` ad hoc (determinism_check.py's seam-line rule).
// [v27c AC-7 Gate 8 repair]: moved from `lib/clock.js` to `ui/clock.js` — a wall-clock read is I/O,
// which ARCH-124's `api:` forbids inside `lib/` (TASK-207's own DoD grep); `ui/` is the layer
// ARCH-125 allows it in. The function is trivial by design, but it never executes under Node from
// its two real call sites (both `ui/*.js`, browser-only) — this test exercises it directly rather
// than leaning on the "≤5-line function may miss 1 line" coverage-gate allowance to excuse a
// genuinely 0%-covered line.
//
// Tier: unit, `.js` — imports the exact bytes the browser is served (ADR-049).
import { describe, it, expect } from 'vitest';
import { clockNow } from '../../src/dashboard/ui/clock.js';

describe('ui/clock.js: clockNow() (Gate 6.5+7, IMPL-247)', () => {
  it('returns a parseable ISO timestamp string', () => {
    const now = clockNow();
    expect(typeof now).toBe('string');
    expect(Number.isNaN(Date.parse(now))).toBe(false);
  });
});
