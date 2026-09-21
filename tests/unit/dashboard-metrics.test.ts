// UT-239 (DES-196, ARCH-126, ADR-055, TASK-201, REQ-132/133): `predictedLanes(script)` — the ONE
// derivation (`parseWorkflowSkeleton` + `scanAgentCalls` + `deriveExpectedGraph`, INV-V26-3's third
// consumer) returning per-lane agent labels in slot order; and `computeWorkflowMetrics` gains
// `avgCostUSD` (mean over terminal summaries CARRYING costUSD, `null` when none does — never `0`)
// and `unpricedRuns`.
//
// Tier: unit, pure.
//
// Red reason (measured): `src/dashboard.ts` exports no `predictedLanes`
// (`TypeError: predictedLanes is not a function`); `computeWorkflowMetrics`'s existing
// `WorkflowMetrics` carries no `avgCostUSD`/`unpricedRuns` field at all (reads `undefined`, never
// `null`, on every input).
import { describe, it, expect } from 'vitest';
import { predictedLanes, computeWorkflowMetrics } from '../../src/dashboard.js';
import { deriveExpectedGraph } from '../../src/skeleton-graph.js';
import { parseWorkflowSkeleton, scanAgentCalls } from '../../src/workflow-meta.js';
import type { RunSummary } from '../../src/types.js';

// A 5-lane / 9-agent fixture — the shape val-200/DES-196's own tests line names.
const SCRIPT = `
  phase('one'); await agent('a1', {}); await agent('a2', {});
  phase('two'); await agent('b1', {});
  phase('three'); await agent('c1', {}); await agent('c2', {}); await agent('c3', {});
  phase('four'); await agent('d1', {});
  phase('five'); await agent('e1', {}); await agent('e2', {});
`;

describe('predictedLanes (UT-239, DES-196, ADR-055)', () => {
  it('a 5-lane/9-agent script: agent labels appear in slot order, one entry per lane', () => {
    const lanes = predictedLanes(SCRIPT);
    expect(lanes.length).toBe(5);
    expect(lanes[0]?.agents).toEqual(['a1', 'a2']);
    expect(lanes[2]?.agents).toEqual(['c1', 'c2', 'c3']);
  });

  it('matches the SAME deriveExpectedGraph derivation directly — no fourth implementation (INV-V26-3)', () => {
    const nodes = parseWorkflowSkeleton(SCRIPT);
    const scan = scanAgentCalls(SCRIPT);
    const derived = deriveExpectedGraph(nodes, scan);
    expect(derived.ok).toBe(true);
    if (!derived.ok) throw new Error('fixture must derive ok');
    const bySlotLane = new Map<number, string[]>();
    for (const slot of derived.graph.slots) {
      bySlotLane.set(slot.lane, [...(bySlotLane.get(slot.lane) ?? []), ...slot.labels]);
    }
    const lanes = predictedLanes(SCRIPT);
    for (const lane of derived.graph.lanes) {
      expect(lanes.find((l) => l.index === lane.index)?.agents).toEqual(bySlotLane.get(lane.index) ?? []);
    }
  });
});

// v35 (item 5 of the Gate 8 return, DES-234-adjacent): `predictedLanes` must surface
// `scan.unscannable` as an additive, backward-compatible property on the returned array — never a
// silently empty/garbled result indistinguishable from "no lanes to predict". `.unscannable` is
// set directly on the array object so existing `.map`/`.find` consumers (mcp-facade.ts) are
// unaffected.
//
// Red reason (measured): `predictedLanes` returns a bare array today with no `unscannable`
// property at all — `lanes.unscannable` reads `undefined` even on an oracle parse failure.
describe('predictedLanes surfaces scan.unscannable additively (item 5, Gate 8 return)', () => {
  it('an oracle parse failure marks the returned array `.unscannable === true`', () => {
    const src = "export const meta = {};\nphase('main'); agent('a', {});\nconst x = ((((;";
    const lanes = predictedLanes(src) as ReturnType<typeof predictedLanes> & { unscannable?: true };
    expect(lanes.unscannable).toBe(true);
  });

  it('a normal, cleanly-derivable script never sets `.unscannable` (backward-compatible: no new property)', () => {
    const lanes = predictedLanes(SCRIPT) as ReturnType<typeof predictedLanes> & { unscannable?: true };
    expect(lanes.unscannable).toBeUndefined();
    expect(lanes.length).toBe(5); // still a plain array to every existing consumer
  });

  // v35 GATE 6.5+7 (verifier, coverage-gate closure): the sibling early-return branch — an
  // unscannable script whose regex-detected nodes ALSO fail `deriveExpectedGraph` on its own
  // grounds (here: an `agent()` node found before any `phase()` node, since the failed oracle
  // filters nothing — `inNonCode` is always `false` once `oracle.ok` is `false`) hits the
  // `!derived.ok` early return, not the populated-lanes return above. `dashboard.ts:304-309` (the
  // `unscannable?: true` set on the EMPTY array) had zero coverage before this case.
  it('an oracle parse failure with no phase() at all hits the empty-array branch and still marks `.unscannable`', () => {
    const src = "export const meta = {};\nagent('a', {});\nconst x = ((((;";
    const lanes = predictedLanes(src) as ReturnType<typeof predictedLanes> & { unscannable?: true };
    expect(lanes.length).toBe(0);
    expect(lanes.unscannable).toBe(true);
  });
});

describe('computeWorkflowMetrics gains avgCostUSD/unpricedRuns (UT-239, DES-196)', () => {
  const baseRun = (over: Partial<RunSummary & { costUSD?: number }>): RunSummary => ({
    runId: over.runId ?? 'r', status: 'completed', scriptVersion: 'v1', createdAt: '2026-09-11T00:00:00.000Z', terminalAt: '2026-09-11T00:01:00.000Z', name: 'wf', ...over,
  });

  it('zero terminal runs carrying costUSD -> avgCostUSD is null (never 0), unpricedRuns counts the rest', () => {
    const runs = [baseRun({ runId: 'a' }), baseRun({ runId: 'b' })] as Array<RunSummary & { costUSD?: number }>;
    const metrics = computeWorkflowMetrics(runs).get('wf') as { avgCostUSD?: number | null; unpricedRuns?: number } | undefined;
    expect(metrics?.avgCostUSD).toBeNull();
    expect(metrics?.unpricedRuns).toBe(2);
  });

  it('the mean is over runs that CARRY costUSD only', () => {
    const runs = [
      baseRun({ runId: 'a', costUSD: 0.2 }),
      baseRun({ runId: 'b', costUSD: 0.6 }),
      baseRun({ runId: 'c' }), // no costUSD at all — excluded from the mean, counted in unpricedRuns
    ] as Array<RunSummary & { costUSD?: number }>;
    const metrics = computeWorkflowMetrics(runs).get('wf') as { avgCostUSD?: number | null; unpricedRuns?: number } | undefined;
    expect(metrics?.avgCostUSD).toBeCloseTo(0.4, 10);
    expect(metrics?.unpricedRuns).toBe(1);
  });
});
