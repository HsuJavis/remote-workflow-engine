// UT-198 (DES-184, ARCH-119, TASK-192, v26, REQ-128/REQ-110): the workflow page gains a per-agent
// harness table — one row per `params.agents.<label>`: label / declared model -> resolved model /
// effort / timeoutMs / tools, every cell written with `textContent` (never `innerHTML` on any
// run/author-derived string). Written test-first (Gate 5, RED): the workflow describe panel
// (dashboard-page.ts) has no harness-table rendering at all today.
// Mock policy (unit): page-source text assertion; see the RETIRES note below for what is left.
import { describe, it, expect } from 'vitest';

// UT-198's own describe RETIRES entirely (2026-09-17, v27j, TASK-215, DES-208's disposition): its
// one case pinned the `#harness-table-section`/`#harness-table` static containers on the fossil
// body (`dashboard-page.ts:92-152`, deleted by this task) — the "port the existing skeleton" plan
// it cited never landed, and no client module (`ui/workflow.js`, `ui/agent-panel.js`) references
// either id or a `harness[-_]?table`/`harnessTable` literal at all (measured: 0 hits). The
// "harness table" surface's actual role is REQ-135's agent panel, a projection of the RECORD
// (DES-205) rather than a table keyed by workflow params — real-tier proven by val-201. No
// replacement pin: there is nothing left on this surface's own terms to pin.
//
// RETIRES (DES-208): the 'effort'/'timeoutMs' cell text was inline JS, gone with ARCH-122's empty
// shell. Real coverage: dashboard-lib-agent.test.js's `panelModel` (DES-205) unit-tests both
// fields directly, and the UT-254 disposition anchor below proves the client corpus still names
// them once `lib/agent.js` (already landed) is consumed by a rendering module.

// v27 (UT-254, DES-208, TASK-213, REQ-135): the alias-index / token-column greps this file pins
// MOVE into real `lib/` unit tests (UT-247's `panelModel`) — this positive anchor proves the
// client corpus still names `effort`/`timeoutMs` once built, rather than the corpus going quietly
// empty (adjudication (v23) #4's vacuous-survivor class).
//
// Red reason (measured): `clientCorpus()` throws today — `src/dashboard/**/*.js` does not exist.
describe('v27 disposition anchor: effort/timeoutMs rendering re-points to lib/agent.js (UT-254, DES-208)', () => {
  it('the client corpus (once built) still names effort/timeoutMs and is not vacuously tiny', async () => {
    const { clientCorpus } = await import('../helpers/client-corpus.js');
    const corpus = clientCorpus();
    expect(corpus).toMatch(/effort/);
    expect(corpus).toMatch(/timeoutMs/);
    expect(corpus.length).toBeGreaterThan(5000);
  });
});
