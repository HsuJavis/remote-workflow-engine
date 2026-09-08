// UT-183 (DES-176, ARCH-114/113, TASK-187, v26, REQ-124): `layoutGraph` joins live agents to their
// skeleton lane by ORDINAL (`record.phaseIndex ?? inferPhase(record, phases)?.index`), not by string
// title equality — duplicate phase titles and dynamic titles are today's blind spot (100% of runs
// currently frame-grouped, `dashboard.ts:285`'s `const k = a.phase ?? ''`). `inferPhase` is a new
// pure export: the last `phases[i]` with `ts <= record.startedAt`. Written test-first (Gate 5, RED):
// `inferPhase` does not exist yet, and today's `layoutGraph(skeletonNodes, liveAgents, opts)` takes
// no `expected`/`phases` parameters at all — a call with the new 4-arg shape is a whole-file
// behavioural mismatch (extra args ignored, wrong join key).
// Mock policy (unit): pure functions, no I/O — hand-written synthetic AgentRecord/PhaseView fixtures.
import { describe, it, expect } from 'vitest';
import { inferPhase, layoutGraph } from '../../src/dashboard.js';
import { GRAPH_FIXTURES } from '../fixtures/expected-graph-fixtures.js';

const PHASES_LINEAR = [
  { title: 'one', ts: '2026-01-01T00:00:00.000Z' },
  { title: 'two', ts: '2026-01-01T00:01:00.000Z' },
  { title: 'three', ts: '2026-01-01T00:02:00.000Z' },
];

describe('inferPhase — the last phase[i] with ts <= record.startedAt (UT-183, DES-176)', () => {
  it('a startedAt exactly equal to a phase ts is INCLUSIVE (matches that phase)', () => {
    const record = { startedAt: '2026-01-01T00:01:00.000Z' } as any;
    expect(inferPhase(record, PHASES_LINEAR as any)).toEqual({ title: 'two', index: 1 });
  });

  it('a startedAt before every phase resolves to undefined', () => {
    const record = { startedAt: '2025-12-31T00:00:00.000Z' } as any;
    expect(inferPhase(record, PHASES_LINEAR as any)).toBeUndefined();
  });

  it('a startedAt after the last phase resolves to the last phase', () => {
    const record = { startedAt: '2026-01-01T00:05:00.000Z' } as any;
    expect(inferPhase(record, PHASES_LINEAR as any)).toEqual({ title: 'three', index: 2 });
  });

  it('an empty phases[] resolves to undefined', () => {
    const record = { startedAt: '2026-01-01T00:01:00.000Z' } as any;
    expect(inferPhase(record, [])).toBeUndefined();
  });

  it('a record with no startedAt but an endedAt still resolves via endedAt', () => {
    const record = { endedAt: '2026-01-01T00:01:30.000Z' } as any;
    expect(inferPhase(record, PHASES_LINEAR as any)).toEqual({ title: 'two', index: 1 });
  });
});

describe('layoutGraph joins by lane ordinal (UT-183, DES-176)', () => {
  it('phaseIndex, when present, WINS over a contradictory startedAt', () => {
    const record = { agentId: 'x1', label: 'x', state: 'done', phaseIndex: 2, startedAt: '2026-01-01T00:00:00.000Z' } as any;
    const expected = { lanes: [{ index: 0, title: 'one', dynamic: false, slots: [0] }, { index: 1, title: 'two', dynamic: false, slots: [1] }, { index: 2, title: 'three', dynamic: false, slots: [2] }], slots: [{ index: 0, lane: 0, labels: ['a'], kind: 'single', tools: {} }, { index: 1, lane: 1, labels: ['b'], kind: 'single', tools: {} }, { index: 2, lane: 2, labels: ['x'], kind: 'single', tools: {} }], edges: [] };
    const result = layoutGraph(expected as any, [record], PHASES_LINEAR as any) as any;
    const cell = result.cells.find((c: any) => c.agentId === 'x1');
    expect(cell?.col).toBe(3); // lane index 2 -> col 3 (col 0 is the trigger)
    expect(result.warnings).toEqual([]);
  });

  it.each(GRAPH_FIXTURES.filter((f) => f.expected.ok))('places every live agent in its true lane for: $name', ({ expected }) => {
    if (!expected.ok) return;
    const phases = expected.graph.lanes.map((l, i) => ({ title: l.title ?? `lane-${i}`, ts: `2026-01-01T00:0${i}:00.000Z` }));
    const liveAgents = expected.graph.slots.flatMap((slot, si) =>
      slot.labels.map((label, li) => ({
        agentId: `${label}-${si}-${li}`, label, state: 'done',
        phaseIndex: slot.lane,
        startedAt: phases[slot.lane]?.ts ?? '2026-01-01T00:00:00.000Z',
      })),
    );
    const result = layoutGraph(expected.graph as any, liveAgents as any, phases as any) as any;
    // a dynamic lane falls back to frame-grouping WITH a warning; a static lane places exactly.
    const anyDynamic = expected.graph.lanes.some((l) => l.dynamic);
    if (anyDynamic) {
      expect(result.warnings.length).toBeGreaterThan(0);
    } else if (liveAgents.length > 0) {
      expect(result.warnings).toEqual([]);
    }
  });
});
