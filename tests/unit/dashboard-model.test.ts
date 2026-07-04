// UT-029: Dashboard pure buildDashboardModel (DES-018, TASK-020)
// RED: src/dashboard.js does not exist yet — all tests fail on module-not-found.
import { describe, it, expect } from 'vitest';
import type { RunSummary, RunStatusView, TranscriptEvent } from '../../src/types.js';
// Value import — causes module-not-found at load time when absent.
import { buildDashboardModel } from '../../src/dashboard.js';

const RUN_SUMMARY: RunSummary = {
  runId: 'r1',
  status: 'completed',
  scriptVersion: 'v1',
  createdAt: '2020-01-01T00:00:00.000Z',
};

const STATUS_VIEW: RunStatusView = {
  runId: 'r1',
  status: 'completed',
  phases: [{ title: 'fetch' }],
  agents: [],
  scriptVersion: 'v1',
};

const TRANSCRIPT: TranscriptEvent[] = [
  { ts: '2020-01-01T00:00:01.000Z', kind: 'usage', data: { tokens: { input: 10, output: 5 } } },
];

describe('buildDashboardModel (pure, DES-018)', () => {
  it('empty runs list produces a DashboardVM with an empty runs array', () => {
    const vm = buildDashboardModel([]);
    expect(vm.runs).toEqual([]);
    expect(vm.selected).toBeUndefined();
    expect(vm.transcript).toBeUndefined();
  });

  it('a non-empty runs list is reflected in vm.runs', () => {
    const vm = buildDashboardModel([RUN_SUMMARY]);
    expect(vm.runs.length).toBe(1);
    expect(vm.runs[0]!.runId).toBe('r1');
  });

  it('a selected RunStatusView is reflected in vm.selected', () => {
    const vm = buildDashboardModel([RUN_SUMMARY], STATUS_VIEW);
    expect(vm.selected?.runId).toBe('r1');
    expect(vm.selected?.phases).toHaveLength(1);
  });

  it('a provided transcript is reflected in vm.transcript', () => {
    const vm = buildDashboardModel([RUN_SUMMARY], STATUS_VIEW, TRANSCRIPT);
    expect(vm.transcript?.length).toBe(1);
    expect(vm.transcript![0]!.kind).toBe('usage');
  });

  it('a store read error is reflected in vm.degraded, never throws', () => {
    // Pass a special sentinel string as the degraded signal (implementation-agnostic).
    const vm = buildDashboardModel([RUN_SUMMARY], undefined, undefined, 'store-read-error');
    expect(vm.degraded).toBeDefined();
    expect(typeof vm.degraded).toBe('string');
  });

  it('is a pure function — no mutation of input arrays', () => {
    const runs = [RUN_SUMMARY];
    buildDashboardModel(runs);
    expect(runs).toHaveLength(1); // original not mutated
  });
});
