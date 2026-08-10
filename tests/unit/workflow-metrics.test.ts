// UT-073: pure `computeWorkflowMetrics` fold + boundary conditions (DES-071, ARCH-047, TASK-073)
//
// `computeWorkflowMetrics(runs: RunSummary[]) → Map<string, WorkflowMetrics>` is PURE: no clock read.
//   - groups by run.name; for each group:
//     terminalCount  = runs with status ∈ {completed, failed, stopped}
//     successRate    = completedCount / terminalCount  (null if terminalCount === 0)
//     avgDurationMs  = mean of (Date.parse(terminalAt) − Date.parse(createdAt)) over terminal runs
//                      with a parseable terminalAt (null if none are parseable)
//
// Boundary conditions (DES-071):
//   - zero terminal runs → {successRate:null, avgDurationMs:null, terminalCount:0}, NEVER NaN
//   - interrupted/suspended/running/queued excluded from BOTH metrics
//   - legacy terminal run missing/unparseable terminalAt → counted in successRate, SKIPPED from mean
//   - ALL terminal runs missing terminalAt → avgDurationMs:null, successRate still computes
//   - empty run list → empty map
//   - never throws, never emits NaN
//
// Hermetic time note: fixture ISO strings are fixed anchors (relative anchor = computed, never
//   compared to real Date.now()). The only time-arithmetic is terminalAt−createdAt over provided
//   literals — safe under any real-clock shift.
//
// Mock policy (unit): pure fixture — no I/O; inject RunSummary arrays directly.
// Red reason: `computeWorkflowMetrics` is not exported from `src/dashboard.ts`
//   → TypeError: computeWorkflowMetrics is not a function at test runtime (Vitest/Vite transforms
//     make the missing export undefined rather than a hard SyntaxError at collect time).
import { describe, it, expect } from 'vitest';
import { computeWorkflowMetrics } from '../../src/dashboard.js';
import type { RunSummary } from '../../src/types.js';

// Fixed ISO anchors — deterministic, never compared to real clock
const T0 = '2025-01-01T00:00:00.000Z';
const T1 = '2025-01-01T00:00:01.000Z';   // +1s  = 1000 ms
const T2 = '2025-01-01T00:00:02.000Z';   // +2s  = 2000 ms
const T3 = '2025-01-01T00:00:03.000Z';   // +3s  = 3000 ms
const T4 = '2025-01-01T00:00:04.000Z';   // +4s  = 4000 ms
const T5 = '2025-01-01T00:00:05.000Z';   // +5s  = 5000 ms
// mean of {1000,2000,3000,4000,5000} = 3000 ms

function mkRun(overrides: {
  runId: string;
  name?: string;
  status: string;
  createdAt?: string;
  terminalAt?: string;
}): RunSummary {
  // Cast needed: terminalAt is added to RunSummary by this DES (not yet in the type)
  return {
    runId: overrides.runId,
    name: overrides.name,
    status: overrides.status as RunSummary['status'],
    scriptVersion: 'v1',
    createdAt: overrides.createdAt ?? T0,
    ...(overrides.terminalAt !== undefined ? { terminalAt: overrides.terminalAt } : {}),
  } as RunSummary;
}

describe('computeWorkflowMetrics — pure fold (UT-073, DES-071)', () => {
  it('4 completed + 1 failed → successRate 0.8, terminalCount 5, finite avgDurationMs', () => {
    const runs = [
      mkRun({ runId: 'r1', name: 'wf', status: 'completed', createdAt: T0, terminalAt: T1 }), // 1000ms
      mkRun({ runId: 'r2', name: 'wf', status: 'completed', createdAt: T0, terminalAt: T2 }), // 2000ms
      mkRun({ runId: 'r3', name: 'wf', status: 'completed', createdAt: T0, terminalAt: T3 }), // 3000ms
      mkRun({ runId: 'r4', name: 'wf', status: 'completed', createdAt: T0, terminalAt: T4 }), // 4000ms
      mkRun({ runId: 'r5', name: 'wf', status: 'failed',    createdAt: T0, terminalAt: T5 }), // 5000ms
    ];
    const map = computeWorkflowMetrics(runs);
    const m = map.get('wf');
    expect(m).toBeDefined();
    expect(m!.terminalCount).toBe(5);
    expect(m!.successRate).toBeCloseTo(0.8);
    expect(m!.avgDurationMs).toBeCloseTo(3000);
    // Must not be NaN
    expect(Number.isNaN(m!.successRate)).toBe(false);
    expect(Number.isNaN(m!.avgDurationMs)).toBe(false);
  });

  it('zero terminal runs → {successRate:null, avgDurationMs:null, terminalCount:0} — never NaN', () => {
    const runs = [
      mkRun({ runId: 'r1', name: 'wf', status: 'running' }),
      mkRun({ runId: 'r2', name: 'wf', status: 'queued' }),
    ];
    const map = computeWorkflowMetrics(runs);
    const m = map.get('wf');
    expect(m).toBeDefined();
    expect(m!.terminalCount).toBe(0);
    expect(m!.successRate).toBeNull();
    expect(m!.avgDurationMs).toBeNull();
  });

  it('interrupted/suspended/running/queued excluded from both successRate and avgDurationMs', () => {
    const runs = [
      mkRun({ runId: 'r1', name: 'wf', status: 'interrupted', createdAt: T0, terminalAt: T1 }),
      mkRun({ runId: 'r2', name: 'wf', status: 'suspended',   createdAt: T0, terminalAt: T2 }),
      mkRun({ runId: 'r3', name: 'wf', status: 'running',     createdAt: T0, terminalAt: T3 }),
      mkRun({ runId: 'r4', name: 'wf', status: 'queued',      createdAt: T0, terminalAt: T4 }),
    ];
    const map = computeWorkflowMetrics(runs);
    const m = map.get('wf');
    expect(m!.terminalCount).toBe(0);
    expect(m!.successRate).toBeNull();
    expect(m!.avgDurationMs).toBeNull();
  });

  it('terminal run with missing terminalAt → counted in successRate, skipped from duration mean', () => {
    const runs = [
      mkRun({ runId: 'r1', name: 'wf', status: 'completed', createdAt: T0, terminalAt: T2 }), // 2000ms
      mkRun({ runId: 'r2', name: 'wf', status: 'completed', createdAt: T0 }),                  // no terminalAt
    ];
    const map = computeWorkflowMetrics(runs);
    const m = map.get('wf');
    expect(m!.terminalCount).toBe(2);
    expect(m!.successRate).toBeCloseTo(1.0);   // 2/2
    // Only r1 contributes to mean (r2 has no terminalAt)
    expect(m!.avgDurationMs).toBeCloseTo(2000);
  });

  it('ALL terminal runs missing terminalAt → avgDurationMs:null, successRate still computes', () => {
    const runs = [
      mkRun({ runId: 'r1', name: 'wf', status: 'completed', createdAt: T0 }),
      mkRun({ runId: 'r2', name: 'wf', status: 'failed',    createdAt: T0 }),
    ];
    const map = computeWorkflowMetrics(runs);
    const m = map.get('wf');
    expect(m!.terminalCount).toBe(2);
    expect(m!.successRate).toBeCloseTo(0.5);   // 1/2
    expect(m!.avgDurationMs).toBeNull();
  });

  it('empty run list → empty map', () => {
    const map = computeWorkflowMetrics([]);
    expect(map.size).toBe(0);
  });

  it('multiple workflows — keyed separately, no cross-contamination', () => {
    const runs = [
      mkRun({ runId: 'a1', name: 'alpha', status: 'completed', createdAt: T0, terminalAt: T1 }),
      mkRun({ runId: 'b1', name: 'beta',  status: 'failed',    createdAt: T0, terminalAt: T2 }),
    ];
    const map = computeWorkflowMetrics(runs);
    expect(map.get('alpha')!.successRate).toBeCloseTo(1.0);
    expect(map.get('beta')!.successRate).toBeCloseTo(0.0);
  });

  it('never throws on any valid RunSummary array', () => {
    const weird = [
      mkRun({ runId: 'w1', name: undefined, status: 'completed', createdAt: T0, terminalAt: 'not-a-date' }),
      mkRun({ runId: 'w2', name: '',         status: 'stopped',   createdAt: 'bad', terminalAt: T1 }),
    ];
    expect(() => computeWorkflowMetrics(weird)).not.toThrow();
    const m = computeWorkflowMetrics(weird);
    for (const v of m.values()) {
      expect(Number.isNaN(v.successRate)).toBe(false);
      expect(Number.isNaN(v.avgDurationMs)).toBe(false);
    }
  });
});
