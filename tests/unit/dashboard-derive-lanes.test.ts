// UT-238 (DES-196, ARCH-126, ADR-051, TASK-201, REQ-140/132/133/134): `deriveLanes(phases,
// expected, opts) -> {lanes, current}` — pure, no I/O. Lanes come from `view.phases` (present
// regardless of auth), extended by the expected overlay only when `opts.masked` is false; `current`
// must be defined for all SEVEN `RunStatus` members, not just `running` (DES-196's own refinement
// of ARCH-126's simpler "only running" line).
//
// Note (test-first observation, not a product decision): ARCH-126/DES-196's own `api:` line types
// `opts` as `{ masked: boolean }` only, yet the boundary text requires branching on `status` too
// ("current = last observed phase index for running|suspended|interrupted... null for queued and
// the three terminal states") — `status` cannot be derived from `phases`/`expected` alone (a
// terminal run still has non-empty `phases`, per "Lanes come from view.phases, present regardless
// of auth"). This test calls the signature the boundary text actually requires: `opts: { masked,
// status }`. Left for Gate 6 to reconcile literally; not an owner_decision (no product ambiguity).
//
// Tier: unit, pure — literal-fixture oracle (mock policy v27).
//
// Red reason (measured): `src/dashboard.ts` exports no `deriveLanes` at all
// (`TypeError: deriveLanes is not a function`).
import { describe, it, expect } from 'vitest';
import { deriveLanes } from '../../src/dashboard.js';
import type { PhaseView, RunStatus } from '../../src/types.js';
import type { ExpectedGraph } from '../../src/skeleton-graph.js';

const PHASES: PhaseView[] = [{ title: 'one', ts: 't1' }, { title: 'two', ts: 't2' }];
const EXPECTED: ExpectedGraph = {
  lanes: [{ index: 0, title: 'one', dynamic: false, slots: [] }, { index: 1, title: 'two', dynamic: false, slots: [] }, { index: 2, title: 'three', dynamic: false, slots: [] }],
  slots: [], edges: [],
};

const ALL_STATUSES: RunStatus[] = ['queued', 'running', 'suspended', 'stopped', 'completed', 'failed', 'interrupted'];
const LIVE_STATUSES = new Set<RunStatus>(['running', 'suspended', 'interrupted']);

function call(phases: PhaseView[], status: RunStatus, masked: boolean) {
  return deriveLanes(phases, EXPECTED, { masked, status } as { masked: boolean; status: RunStatus });
}

describe('deriveLanes: current over the 7 (status) x 2 (phases) x 2 (masked) table (UT-238, DES-196)', () => {
  for (const status of ALL_STATUSES) {
    for (const phasesLabel of ['empty', 'non-empty'] as const) {
      const phases = phasesLabel === 'empty' ? [] : PHASES;
      for (const masked of [true, false]) {
        it(`status=${status} phases=${phasesLabel} masked=${masked}`, () => {
          const { current } = call(phases, status, masked);
          const expected = phases.length > 0 && LIVE_STATUSES.has(status) ? phases.length - 1 : null;
          expect(current).toBe(expected);
        });
      }
    }
  }
});

describe('deriveLanes: lane join (UT-238, DES-196)', () => {
  it('masked:true -> lanes are OBSERVED-ONLY (never the predicted overlay), joined by ordinal', () => {
    const { lanes } = call(PHASES, 'running', true);
    expect(lanes).toEqual([{ index: 0, title: 'one' }, { index: 1, title: 'two' }]);
  });

  it('masked:false -> lanes extend with the UNREACHED expected lanes (index 2 "three")', () => {
    const { lanes } = call(PHASES, 'running', false);
    expect(lanes.length).toBe(3);
    expect(lanes[2]).toEqual({ index: 2, title: 'three' });
  });

  it('expected undefined (auth-masked server never populates it) never throws, degrades to observed-only', () => {
    expect(() => deriveLanes(PHASES, undefined, { masked: false, status: 'running' } as { masked: boolean; status: RunStatus })).not.toThrow();
  });
});
