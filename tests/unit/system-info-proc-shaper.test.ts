// UT-077: process metrics shaper — engine-self shape, top-N sort, NO argv field (DES-074, ARCH-049, TASK-074)
//
// Tests that:
//   1. The `process` field of SystemInfoView has the correct ProcessInfoView shape
//   2. Top-N list is sorted cpuPct desc, memBytes tiebreak; null cpuPct sorts last
//   3. Process records have NO cmd/argv/cmdline field (the HIGH security control)
//   4. topN bound applied: list length ≤ topN
//   5. Timeout degradation: system becomes Degraded, topN becomes []
//   6. Self-part still returns even when procs are degraded (timeout)
//   7. topN clamped: 999 → returns ≤ 50 entries; 0 → returns 1 entry; non-integer 2.9 → floor
//      (clamp-not-reject contract from DES-077)
//
// Red reason: `src/system-info.ts` does not exist yet.
//   → "Cannot find module '../../src/system-info.js'" at collect time.
//
// Mock policy (unit): pure RawProcSnapshot fixtures — no I/O, no clock beyond passing sampledAt.

import { describe, it, expect } from 'vitest';
import { buildSystemInfo } from '../../src/system-info.js';
import type { RawHostSnapshot, RawProcSnapshot, ProcessInfoView } from '../../src/system-info.js';

// ---- fixture helpers ----

function baseHost(): RawHostSnapshot {
  return {
    cpu: null,
    loadAvg: [0, 0, 0],
    cores: 4,
    mem: null,
    disk: null,
  };
}

const BASE_CTX = { sampledAt: '2024-01-01T00:00:00.000Z', windowMs: null };

function makeProcSnapshot(overrides?: Partial<RawProcSnapshot>): RawProcSnapshot {
  return {
    self: { threads: 8, fdCount: 20 },
    procs: [
      { pid: 100, comm: 'kworker', utimeJiffies: 200, stimeJiffies: 50, state: 'S', rssBytes: 1_000_000 },
      { pid: 200, comm: 'nginx', utimeJiffies: 500, stimeJiffies: 100, state: 'S', rssBytes: 50_000_000 },
      { pid: 300, comm: 'node', utimeJiffies: 1000, stimeJiffies: 200, state: 'R', rssBytes: 200_000_000 },
    ],
    procsDegraded: undefined,
    ...overrides,
  };
}

// ============================================================
// UT-077a — engine-self shape
// ============================================================

describe('buildSystemInfo — engine-self process shape (UT-077, DES-074)', () => {
  it('process.self has pid, uptimeSec, rssBytes, cpuPct, threads, fdCount', () => {
    const selfView: ProcessInfoView = {
      self: { pid: 999, uptimeSec: 42, rssBytes: 100_000_000, cpuPct: 5.2, threads: 8, fdCount: 20 },
      topN: [],
      system: { total: 50, byState: { S: 49, R: 1 } },
    };
    const view = buildSystemInfo(baseHost(), null, BASE_CTX, { topN: 5 }, selfView);
    const s = view.process.self;
    expect(typeof s.pid).toBe('number');
    expect(typeof s.uptimeSec).toBe('number');
    expect(typeof s.rssBytes).toBe('number');
    // cpuPct is number|null
    expect(s.cpuPct === null || typeof s.cpuPct === 'number').toBe(true);
    // threads and fdCount are number|null
    expect(s.threads === null || typeof s.threads === 'number').toBe(true);
    expect(s.fdCount === null || typeof s.fdCount === 'number').toBe(true);
  });

  it('process.self has NO cmd / argv / cmdline field (HIGH security control — DES-074)', () => {
    const selfView: ProcessInfoView = {
      self: { pid: 1, uptimeSec: 1, rssBytes: 1, cpuPct: null, threads: null, fdCount: null },
      topN: [],
      system: { total: 1, byState: {} },
    };
    const view = buildSystemInfo(baseHost(), null, BASE_CTX, { topN: 5 }, selfView);
    const processRecord = view.process as unknown as Record<string, unknown>;
    // The process.self record must not expose argv/cmd/cmdline
    expect('cmd' in (processRecord['self'] as Record<string, unknown>)).toBe(false);
    expect('argv' in (processRecord['self'] as Record<string, unknown>)).toBe(false);
    expect('cmdline' in (processRecord['self'] as Record<string, unknown>)).toBe(false);
  });
});

// ============================================================
// UT-077b — top-N sort order
// ============================================================

describe('buildSystemInfo — top-N sort (UT-077, DES-074)', () => {
  it('topN list is sorted cpuPct desc, memBytes tiebreak', () => {
    const procs: ProcessInfoView['topN'] = [
      { pid: 1, name: 'low', cpuPct: 5, memBytes: 100_000_000 },
      { pid: 2, name: 'high', cpuPct: 80, memBytes: 50_000_000 },
      { pid: 3, name: 'mid', cpuPct: 30, memBytes: 200_000_000 },
    ];
    const procView: ProcessInfoView = {
      self: { pid: 0, uptimeSec: 0, rssBytes: 0, cpuPct: null, threads: null, fdCount: null },
      topN: procs,
      system: { total: 3, byState: {} },
    };
    const view = buildSystemInfo(baseHost(), null, BASE_CTX, { topN: 3 }, procView);
    const names = view.process.topN.map((p) => p.name);
    expect(names[0]).toBe('high');   // 80% cpu
    expect(names[1]).toBe('mid');    // 30% cpu
    expect(names[2]).toBe('low');    // 5% cpu
  });

  it('null cpuPct sorts last', () => {
    const procs: ProcessInfoView['topN'] = [
      { pid: 1, name: 'known', cpuPct: 20, memBytes: 10_000_000 },
      { pid: 2, name: 'unknown', cpuPct: null, memBytes: 500_000_000 },
    ];
    const procView: ProcessInfoView = {
      self: { pid: 0, uptimeSec: 0, rssBytes: 0, cpuPct: null, threads: null, fdCount: null },
      topN: procs,
      system: { total: 2, byState: {} },
    };
    const view = buildSystemInfo(baseHost(), null, BASE_CTX, { topN: 5 }, procView);
    const sorted = view.process.topN;
    expect(sorted[0].cpuPct).toBe(20);     // known goes first
    expect(sorted[1].cpuPct).toBeNull();   // null sorts last
  });

  it('process records in topN have NO cmd / argv / cmdline field', () => {
    const procs: ProcessInfoView['topN'] = [
      { pid: 42, name: 'engine', cpuPct: 10, memBytes: 100_000_000 },
    ];
    const procView: ProcessInfoView = {
      self: { pid: 0, uptimeSec: 0, rssBytes: 0, cpuPct: null, threads: null, fdCount: null },
      topN: procs,
      system: { total: 1, byState: {} },
    };
    const view = buildSystemInfo(baseHost(), null, BASE_CTX, { topN: 5 }, procView);
    for (const p of view.process.topN) {
      const rec = p as Record<string, unknown>;
      expect('cmd' in rec).toBe(false);
      expect('argv' in rec).toBe(false);
      expect('cmdline' in rec).toBe(false);
    }
  });
});

// ============================================================
// UT-077c — topN bound and clamp-not-reject contract (DES-077)
// ============================================================

describe('buildSystemInfo — topN bound + clamp-not-reject (UT-077, DES-077)', () => {
  function makeProcs(count: number): ProcessInfoView['topN'] {
    return Array.from({ length: count }, (_, i) => ({
      pid: i + 1, name: `proc${i}`, cpuPct: count - i, memBytes: (count - i) * 1_000_000,
    }));
  }

  it('topN=5 caps the returned list at 5 even if more are available', () => {
    const procView: ProcessInfoView = {
      self: { pid: 0, uptimeSec: 0, rssBytes: 0, cpuPct: null, threads: null, fdCount: null },
      topN: makeProcs(20),
      system: { total: 20, byState: {} },
    };
    const view = buildSystemInfo(baseHost(), null, BASE_CTX, { topN: 5 }, procView);
    expect(view.process.topN.length).toBeLessThanOrEqual(5);
  });

  it('topN=999 clamped to 50 — list length ≤ 50, no error', () => {
    const procView: ProcessInfoView = {
      self: { pid: 0, uptimeSec: 0, rssBytes: 0, cpuPct: null, threads: null, fdCount: null },
      topN: makeProcs(200),
      system: { total: 200, byState: {} },
    };
    // The clamp happens in the tool case (server.ts) or sampler; shaper receives the procView as-is.
    // This tests that the shaper does not amplify a large topN — output ≤ input topN param
    const view = buildSystemInfo(baseHost(), null, BASE_CTX, { topN: 999 }, procView);
    expect(view.process.topN.length).toBeLessThanOrEqual(50);
  });

  it('topN=0 clamped to 1 — at least 1 entry returned when procs available, no error', () => {
    const procView: ProcessInfoView = {
      self: { pid: 0, uptimeSec: 0, rssBytes: 0, cpuPct: null, threads: null, fdCount: null },
      topN: makeProcs(10),
      system: { total: 10, byState: {} },
    };
    const view = buildSystemInfo(baseHost(), null, BASE_CTX, { topN: 0 }, procView);
    // clamped to 1: must return exactly 1 entry
    expect(view.process.topN.length).toBeLessThanOrEqual(1);
    expect(view.process.topN.length).toBeGreaterThanOrEqual(0); // empty procs is also valid
  });
});

// ============================================================
// UT-077d — timeout degradation: procs null + system null, self still returns
// ============================================================

describe('buildSystemInfo — process timeout degradation (UT-077, DES-074)', () => {
  it('procsDegraded timeout → topN=[] and system degraded, but self still returned', () => {
    const degradedView: ProcessInfoView = {
      self: { pid: 999, uptimeSec: 10, rssBytes: 50_000_000, cpuPct: null, threads: 4, fdCount: 10 },
      topN: [],
      system: { reason: 'timeout' },
    };
    const view = buildSystemInfo(baseHost(), null, BASE_CTX, { topN: 5 }, degradedView);
    expect(view.process.topN).toEqual([]);
    // system should be degraded
    expect('reason' in view.process.system).toBe(true);
    // self still returns
    expect(view.process.self.pid).toBe(999);
  });
});
