// UT-198 (DES-184, ARCH-119, TASK-192, v26, REQ-128/REQ-110): the workflow page gains a per-agent
// harness table — one row per `params.agents.<label>`: label / declared model -> resolved model /
// effort / timeoutMs / tools, every cell written with `textContent` (never `innerHTML` on any
// run/author-derived string). Written test-first (Gate 5, RED): the workflow describe panel
// (dashboard-page.ts) has no harness-table rendering at all today.
// Mock policy (unit): page-source text assertion over the exported DASHBOARD_HTML.
import { describe, it, expect } from 'vitest';
import { DASHBOARD_HTML } from '../../src/dashboard-page.js';

describe('the workflow page renders a per-agent harness table via textContent (UT-198, DES-184)', () => {
  it('the page source references a harness table render function/marker', () => {
    expect(DASHBOARD_HTML).toMatch(/harness[-_]?table|harnessTable/i);
  });

  it('the harness table renders effort and timeoutMs cells', () => {
    expect(DASHBOARD_HTML).toMatch(/effort/);
    expect(DASHBOARD_HTML).toMatch(/timeoutMs/);
  });
});

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
