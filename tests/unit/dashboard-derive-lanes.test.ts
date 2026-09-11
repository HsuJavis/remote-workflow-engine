// UT-238 (DES-196, ARCH-126, ADR-051, TASK-201, REQ-140/132/133/134): `deriveLanes(phases,
// expected, opts) -> {lanes, current}` — pure, no I/O. Lanes come from `view.phases` (present
// regardless of auth), extended UNCONDITIONALLY by the expected overlay's unreached tail (Round
// v27b owner ruling, ADR-051 (b): the `!authEnabled` mask over the PREDICTED overlay is REVERSED,
// both surfaces or neither). `current` must be defined for all SEVEN `RunStatus` members, not just
// `running` (DES-196's own refinement of ARCH-126's simpler "only running" line).
//
// [v27b amendment, Round v27b owner ruling, ADR-051, TASK-201]: the `masked` axis DOES NOT EXIST —
// `expected` is NON-optional (`server.ts:519` already declares a literal `ExpectedGraph` before any
// branch; `undefined` is a state the route cannot produce) and `opts` is `{ status }` alone. The
// `as { masked: boolean; status: RunStatus }` cast this file used to carry at line 34 is GONE — its
// disappearance IS the evidence the signature was reconciled literally rather than re-cast (a
// shrink is the shape of an accidental weakening, not a growth the reviewer must diff for intent).
// 28 status/phases/masked cases become 14 status/phases cases; four join rows replace the old
// masked-vs-unmasked pair.
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
// The PRODUCTION derivation-failure input (`server.ts:538`/`:540`'s FALSE/catch arms) — this, not
// `undefined`, is what a route with no resolvable overlay actually passes.
const EMPTY_EXPECTED: ExpectedGraph = { lanes: [], slots: [], edges: [] };

const ALL_STATUSES: RunStatus[] = ['queued', 'running', 'suspended', 'stopped', 'completed', 'failed', 'interrupted'];
const LIVE_STATUSES = new Set<RunStatus>(['running', 'suspended', 'interrupted']);

function call(phases: PhaseView[], expected: ExpectedGraph, status: RunStatus) {
  return deriveLanes(phases, expected, { status });
}

describe('deriveLanes: current over the 7 (status) x 2 (phases) table, 14 cases (UT-238, DES-196)', () => {
  for (const status of ALL_STATUSES) {
    for (const phasesLabel of ['empty', 'non-empty'] as const) {
      const phases = phasesLabel === 'empty' ? [] : PHASES;
      it(`status=${status} phases=${phasesLabel}`, () => {
        const { current } = call(phases, EXPECTED, status);
        const expected = phases.length > 0 && LIVE_STATUSES.has(status) ? phases.length - 1 : null;
        expect(current).toBe(expected);
      });
    }
  }
});

describe('deriveLanes: lane join, UNCONDITIONAL (UT-238, DES-196, Round v27b/ADR-051)', () => {
  it('lanes extend with the UNREACHED expected lanes (index 2 "three") on every deployment, auth on or off', () => {
    const { lanes } = call(PHASES, EXPECTED, 'running');
    expect(lanes.length).toBe(3);
    expect(lanes[0]).toEqual({ index: 0, title: 'one' });
    expect(lanes[1]).toEqual({ index: 1, title: 'two' });
    expect(lanes[2]).toEqual({ index: 2, title: 'three' });
  });

  it('the PRODUCTION derivation-failure input ({lanes:[],slots:[],edges:[]}) returns the observed lanes only, never throws', () => {
    expect(() => call(PHASES, EMPTY_EXPECTED, 'running')).not.toThrow();
    const { lanes, current } = call(PHASES, EMPTY_EXPECTED, 'running');
    expect(lanes).toEqual([{ index: 0, title: 'one' }, { index: 1, title: 'two' }]);
    expect(current).toBe(1);
  });

  it('observed longer than expected (a loop-body phase()) — current is NOT clamped to expected.lanes.length - 1', () => {
    const shortExpected: ExpectedGraph = {
      lanes: [{ index: 0, title: 'one', dynamic: false, slots: [] }],
      slots: [], edges: [],
    };
    const threePhases: PhaseView[] = [{ title: 'one', ts: 't1' }, { title: 'two', ts: 't2' }, { title: 'three', ts: 't3' }];
    const { lanes, current } = call(threePhases, shortExpected, 'running');
    // `lanes` IS the observed list beyond the predicted lane count — no conflict output, no
    // detector (the rejected title-conflict detector stays dead; QD's measurement, Decision
    // rationale v27b): a loop-body phase() legitimately produces more observed phases than
    // predicted lanes.
    expect(lanes).toEqual([{ index: 0, title: 'one' }, { index: 1, title: 'two' }, { index: 2, title: 'three' }]);
    expect(current).toBe(2);
  });

  it('DENSITY: a non-contiguous expected.lanes ([0,1,3]) re-indexes so lanes[k].index === k, titles in order', () => {
    const nonContiguous: ExpectedGraph = {
      lanes: [
        { index: 0, title: 'one', dynamic: false, slots: [] },
        { index: 1, title: 'two', dynamic: false, slots: [] },
        { index: 3, title: 'four', dynamic: false, slots: [] },
      ],
      slots: [], edges: [],
    };
    const { lanes } = call(PHASES, nonContiguous, 'running');
    lanes.forEach((lane: { index: number; title: string | null }, k: number) => expect(lane.index).toBe(k));
    expect(lanes.map((l: { index: number; title: string | null }) => l.title)).toEqual(['one', 'two', 'four']);
  });

  // ROBUSTNESS row (DES-196's own tests bullet): `expected` is typed NON-optional now, so passing
  // `undefined` is a compile-time error — asserted with `@ts-expect-error` (house precedent:
  // tests/unit/error-catalog.test.ts:48) rather than silently kept passing through a cast. It may
  // not throw at runtime either, since the body stays garbage-tolerant (`Array.isArray(expected?.lanes)`,
  // matching `layoutGraph` at dashboard.ts:346) — tolerance is a BODY property, not a TYPE property.
  it('a robustness case: an out-of-contract undefined `expected` still does not throw at runtime', () => {
    // @ts-expect-error — `expected` is non-optional (ADR-051); this call is deliberately ill-typed
    // to prove the BODY tolerates it even though the TYPE no longer advertises the state.
    expect(() => deriveLanes(PHASES, undefined, { status: 'running' })).not.toThrow();
  });
});
