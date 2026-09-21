// UT-072: pure `buildHomeView` 3-way grouping (DES-070, ARCH-046, TASK-072)
//
// `buildHomeView(catalog, runs, metrics) → HomeView` is PURE: no clock, no store, no DOM.
//   - RUNNING   = catalog workflow with ≥1 run in a non-terminal status (running|queued|suspended|interrupted)
//   - REGISTERED = catalog workflow with no active (non-terminal) run
//   - OTHER     = run name absent from catalog (inline-script or deregistered), keyed by name or '(inline)'
//
// Grouping rules:
//   - RUNNING wins over REGISTERED (a workflow with both an active and a completed run → running)
//   - Catalog membership decides REGISTERED vs OTHER (never throws on missing data)
//   - A workflow appears in exactly ONE group
//   - Empty catalog + no runs → three empty groups (never throws)
//   - activeRunId set for the workflow's active run; latestRunId set for any run
//
// Mock policy (unit): pure fixture — no I/O; inject RunSummary + catalog arrays directly.
// Red reason: `buildHomeView` is not exported from `src/dashboard.ts`
//   → TypeError: buildHomeView is not a function at test runtime (Vitest/Vite transforms make the
//     missing export undefined rather than a hard SyntaxError at collect time).
import { describe, it, expect } from 'vitest';
import { buildHomeView } from '../../src/dashboard.js';
import type { WorkflowMetrics } from '../../src/dashboard.js';
import type { RunSummary } from '../../src/types.js';

// Fixture helpers
const ZERO_METRICS: WorkflowMetrics = { successRate: null, avgDurationMs: null, terminalCount: 0, avgCostUSD: null, unpricedRuns: 0 };
const metricsMap = (entries: [string, WorkflowMetrics][] = []) =>
  new Map(entries);

function run(overrides: Partial<RunSummary> & { runId: string }): RunSummary {
  return {
    status: 'completed',
    scriptVersion: 'v1',
    createdAt: new Date().toISOString(),
    ...overrides,
  } as RunSummary;
}

describe('buildHomeView — pure 3-way grouping (UT-072, DES-070)', () => {
  it('catalog workflow with an active run → RUNNING group', () => {
    const catalog = [{ name: 'wf', description: 'desc' }];
    const runs = [run({ runId: 'r1', name: 'wf', status: 'running' })];
    const view = buildHomeView(catalog, runs, metricsMap());
    expect(view.running.map((c) => c.name)).toContain('wf');
    expect(view.registered.map((c) => c.name)).not.toContain('wf');
    expect(view.other.map((c) => c.name)).not.toContain('wf');
  });

  it('catalog workflow with no active run → REGISTERED group', () => {
    const catalog = [{ name: 'idle', description: 'idle wf' }];
    const runs = [run({ runId: 'r2', name: 'idle', status: 'completed' })];
    const view = buildHomeView(catalog, runs, metricsMap());
    expect(view.registered.map((c) => c.name)).toContain('idle');
    expect(view.running.map((c) => c.name)).not.toContain('idle');
  });

  it('catalog workflow with NO runs at all → REGISTERED group', () => {
    const catalog = [{ name: 'never-run', description: 'not run yet' }];
    const view = buildHomeView(catalog, [], metricsMap());
    expect(view.registered.map((c) => c.name)).toContain('never-run');
    expect(view.running).toHaveLength(0);
    expect(view.other).toHaveLength(0);
  });

  it('run whose name is absent from catalog → OTHER group', () => {
    const catalog = [{ name: 'wf', description: 'desc' }];
    const runs = [run({ runId: 'r3', name: 'unknown-wf', status: 'completed' })];
    const view = buildHomeView(catalog, runs, metricsMap());
    const otherNames = view.other.map((c) => c.name);
    expect(otherNames).toContain('unknown-wf');
    expect(view.running).toHaveLength(0);
    expect(view.registered.map((c) => c.name)).toContain('wf');
  });

  it('inline-script run (no name / undefined) → OTHER group keyed "(inline)"', () => {
    const catalog: { name: string; description: string }[] = [];
    const runs = [run({ runId: 'r4', name: undefined, status: 'completed' })];
    const view = buildHomeView(catalog, runs, metricsMap());
    const inlineCard = view.other.find((c) => c.name === '(inline)');
    expect(inlineCard).toBeDefined();
  });

  it('RUNNING wins over REGISTERED — workflow with both active and terminal runs → RUNNING only', () => {
    const catalog = [{ name: 'busy', description: 'both' }];
    const runs = [
      run({ runId: 'r5a', name: 'busy', status: 'completed' }),
      run({ runId: 'r5b', name: 'busy', status: 'running' }),
    ];
    const view = buildHomeView(catalog, runs, metricsMap());
    const inRunning = view.running.some((c) => c.name === 'busy');
    const inRegistered = view.registered.some((c) => c.name === 'busy');
    expect(inRunning).toBe(true);
    expect(inRegistered).toBe(false);
  });

  it('empty catalog + no runs → three empty groups; never throws', () => {
    expect(() => buildHomeView([], [], metricsMap())).not.toThrow();
    const view = buildHomeView([], [], metricsMap());
    expect(view.running).toHaveLength(0);
    expect(view.registered).toHaveLength(0);
    expect(view.other).toHaveLength(0);
  });

  it('activeRunId set on RUNNING card; latestRunId set when any run exists', () => {
    const catalog = [{ name: 'wf', description: '' }];
    const runs = [
      run({ runId: 'r6old', name: 'wf', status: 'completed' }),
      run({ runId: 'r6active', name: 'wf', status: 'running' }),
    ];
    const view = buildHomeView(catalog, runs, metricsMap());
    const card = view.running.find((c) => c.name === 'wf');
    expect(card?.activeRunId).toBe('r6active');
    expect(card?.latestRunId).toBeDefined();
  });

  // v36 (REQ-217): `listSummaries()` now builds on `list()` (`ORDER BY createdAt DESC`), so
  // `buildHomeView` must pick the true latest/active run by comparing `createdAt` — never by
  // trusting "list order" (the pre-REQ-217 contract, when the input was `listRuns()`'s effectively
  // insertion-ordered sweep). Feed the runs OLDEST-first here and NEWEST-first in the next case;
  // both must resolve to the SAME winner.
  it('activeRunId/latestRunId pick the run with the LATEST createdAt regardless of input array order (oldest-first)', () => {
    const catalog = [{ name: 'wf', description: '' }];
    const runs = [
      run({ runId: 'r-old', name: 'wf', status: 'running', createdAt: '2026-09-22T00:00:00.000Z' }),
      run({ runId: 'r-mid', name: 'wf', status: 'running', createdAt: '2026-09-22T00:01:00.000Z' }),
      run({ runId: 'r-new', name: 'wf', status: 'running', createdAt: '2026-09-22T00:02:00.000Z' }),
    ];
    const view = buildHomeView(catalog, runs, metricsMap());
    const card = view.running.find((c) => c.name === 'wf');
    expect(card?.activeRunId).toBe('r-new');
    expect(card?.latestRunId).toBe('r-new');
  });

  it('activeRunId/latestRunId pick the run with the LATEST createdAt regardless of input array order (newest-first, DESC — the real `list()` order post-REQ-217)', () => {
    const catalog = [{ name: 'wf', description: '' }];
    const runs = [
      run({ runId: 'r-new', name: 'wf', status: 'running', createdAt: '2026-09-22T00:02:00.000Z' }),
      run({ runId: 'r-mid', name: 'wf', status: 'running', createdAt: '2026-09-22T00:01:00.000Z' }),
      run({ runId: 'r-old', name: 'wf', status: 'running', createdAt: '2026-09-22T00:00:00.000Z' }),
    ];
    const view = buildHomeView(catalog, runs, metricsMap());
    const card = view.running.find((c) => c.name === 'wf');
    expect(card?.activeRunId).toBe('r-new');
    expect(card?.latestRunId).toBe('r-new');
  });

  it('card carries description from catalog', () => {
    const catalog = [{ name: 'cs', description: '2-parallel → verify' }];
    const view = buildHomeView(catalog, [], metricsMap());
    const card = view.registered.find((c) => c.name === 'cs');
    expect(card?.description).toBe('2-parallel → verify');
  });

  it('metrics from map are passed through to card; unknown workflow gets zero-metrics', () => {
    const catalog = [{ name: 'wf', description: '' }];
    const known: WorkflowMetrics = { successRate: 0.8, avgDurationMs: 1000, terminalCount: 5, avgCostUSD: null, unpricedRuns: 0 };
    const m = metricsMap([['wf', known]]);
    const view = buildHomeView(catalog, [], m);
    const card = view.registered.find((c) => c.name === 'wf');
    expect(card?.metrics.successRate).toBe(0.8);
    expect(card?.metrics.terminalCount).toBe(5);
  });
});
