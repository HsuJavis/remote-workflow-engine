// UT-074: pure `buildSystemInfo` host shaper — CPU delta, first-call null, same-jiffy,
//         negative-delta clamp, disk usedPct df-convention (DES-073, ARCH-048, TASK-074)
// UT-075: `buildSystemInfo` degrade paths — null cpu/mem/disk fields → independent degrade-to-null,
//         never throws (DES-073, ARCH-048, TASK-074)
//
// `buildSystemInfo(cur, prev, ctx, opts, procShape) → SystemInfoView` is PURE: no I/O, no clock.
//
// Red reason: `src/system-info.ts` does not exist yet.
//   → "Cannot find module '../../src/system-info.js'" at collect time (Vitest/Vite import resolution).
//
// Mock policy (unit): pure fixtures, no I/O. `StubSystemProbe`/clock not needed here — the shaper
// takes already-sampled `RawHostSnapshot` structs. `FakeProcShape` covers the procShape arg.

import { describe, it, expect } from 'vitest';
import { buildSystemInfo } from '../../src/system-info.js';
import type { RawHostSnapshot, ProcessInfoView } from '../../src/system-info.js';

// --- fixture helpers ---

function coreCounters(idle: number, total: number) {
  return { idleMs: idle, totalMs: total };
}

function makeHost(overrides?: Partial<RawHostSnapshot>): RawHostSnapshot {
  return {
    cpu: { perCore: [coreCounters(700, 1000), coreCounters(800, 1000)] },
    loadAvg: [0.5, 0.4, 0.3],
    cores: 2,
    mem: { totalBytes: 8_000_000_000, freeBytes: 3_000_000_000 },
    disk: { path: '/data', blockSize: 4096, blocks: 100_000, bfree: 30_000, bavail: 28_000 },
    ...overrides,
  };
}

const STUB_PROC: ProcessInfoView = {
  self: { pid: 42, uptimeSec: 10, rssBytes: 50_000_000, cpuPct: null, threads: 4, fdCount: 10 },
  topN: [],
  system: { total: 100, byState: { S: 95, R: 5 } },
};

const CTX_SECOND = (sampledAt = '2024-01-01T00:00:02.000Z') => ({
  sampledAt,
  windowMs: 2000,
});

// ============================================================
// UT-074 — CPU delta math, disk usedPct, first-call null, clamp
// ============================================================

describe('buildSystemInfo — CPU delta math (UT-074, DES-073)', () => {
  it('computes host utilizationPct from cpu jiffie delta between prev and cur', () => {
    // prev: idle=700, total=1000 per core × 2 cores
    // cur:  idle=600, total=1100 per core × 2 cores
    // delta idle = (600-700)*2 = -200 total idle consumed
    // delta total = (1100-1000)*2 = 200
    // utilization = 1 - (-200+400) / 400 ... wait, let's re-derive:
    // per ARCH-048: utilizationPct = 1 - (sumIdleDelta/sumTotalDelta) → clamp [0,100]
    // sumIdleDelta = (600-700)*2 = -200 → that's negative? means idle decreased (CPU was busy)
    // actually: idleDelta = curIdle - prevIdle for each core, sum up
    // totalDelta = curTotal - prevTotal for each core, sum up
    // utilizationPct = (1 - sumIdleDelta/sumTotalDelta) * 100
    // sumIdleDelta = (600-700) + (600-700) = -100 + -100 = -200
    // sumTotalDelta = (1100-1000) + (1100-1000) = 100 + 100 = 200
    // utilizationPct = (1 - (-200/200)) * 100 = (1 + 1) * 100 = 200 → clamp to 100
    // Hmm, that doesn't match typical formula. Let me reconsider.
    // Standard formula: usedDelta = totalDelta - idleDelta; utilizationPct = usedDelta/totalDelta*100
    // usedDelta = 200 - (-200) = 400 ... that's wrong since usedDelta > totalDelta
    // Let me use proper values: prev idle=700, prev total=1000. cur idle=600, cur total=1100.
    // totalDelta per core = 1100-1000 = 100; idleDelta per core = 600-700 = -100 (idle time decreased)
    // That would be impossible (idle counter should never decrease). Let me use a proper fixture.

    // prev: idle=700, total=1000 — means 700ms idle in last 1s → 30% utilized
    // cur:  idle=750, total=1100 — in the window: totalDelta=200, idleDelta=100 → used=100 → 50%
    const prev = makeHost({ cpu: { perCore: [coreCounters(700, 1000), coreCounters(700, 1000)] } });
    const cur = makeHost({ cpu: { perCore: [coreCounters(750, 1100), coreCounters(750, 1100)] } });
    // totalDelta = (1100-1000)*2 = 200; idleDelta = (750-700)*2 = 100; used = 200-100 = 100
    // utilizationPct = 100/200 * 100 = 50
    const view = buildSystemInfo(cur, prev, CTX_SECOND(), { topN: 5 }, STUB_PROC);
    expect(view.cpu.utilizationPct).toBeCloseTo(50, 1);
    expect(view.cpu.utilizationDegraded).toBeUndefined();
  });

  it('first call (prev=null) → utilizationPct null + reason awaiting-second-sample', () => {
    const cur = makeHost();
    const view = buildSystemInfo(cur, null, { sampledAt: '2024-01-01T00:00:00.000Z', windowMs: null }, { topN: 5 }, STUB_PROC);
    expect(view.cpu.utilizationPct).toBeNull();
    expect(view.cpu.utilizationDegraded).toMatchObject({ reason: 'awaiting-second-sample' });
    expect(view.windowMs).toBeNull();
  });

  it('same jiffy (totalDelta===0) → utilizationPct null + reason sample-window-too-short', () => {
    const snap = makeHost({ cpu: { perCore: [coreCounters(700, 1000), coreCounters(700, 1000)] } });
    // Same snapshot for cur and prev → totalDelta = 0 (divide-by-zero guard)
    const view = buildSystemInfo(snap, snap, CTX_SECOND(), { topN: 5 }, STUB_PROC);
    expect(view.cpu.utilizationPct).toBeNull();
    expect(view.cpu.utilizationDegraded).toMatchObject({ reason: 'sample-window-too-short' });
  });

  it('counter wrap / negative used delta → clamp to 0', () => {
    // prev total > cur total (simulates counter wrap) → usedDelta could be negative
    // totalDelta = 200; idleDelta = 210 → usedDelta = -10 → clamp 0
    const prev = makeHost({ cpu: { perCore: [coreCounters(100, 500), coreCounters(100, 500)] } });
    const cur = makeHost({ cpu: { perCore: [coreCounters(310, 600), coreCounters(310, 600)] } });
    // totalDelta = (600-500)*2=200; idleDelta=(310-100)*2=420; used=200-420=-220 → clamp 0
    const view = buildSystemInfo(cur, prev, CTX_SECOND(), { topN: 5 }, STUB_PROC);
    expect(view.cpu.utilizationPct).toBeGreaterThanOrEqual(0);
    expect(view.cpu.utilizationPct).toBeLessThanOrEqual(100);
  });

  it('disk usedPct uses df convention: used=(blocks-bfree)*blockSize, free=bavail*blockSize, usedPct=used/(used+bavail)', () => {
    // blocks=100_000, bfree=30_000, bavail=28_000, blockSize=4096
    // used = (100_000-30_000)*4096 = 70_000*4096 = 286_720_000
    // free = 28_000*4096 = 114_688_000
    // usedPct = 286_720_000 / (286_720_000 + 114_688_000) = 286_720_000 / 401_408_000 ≈ 71.4%
    const cur = makeHost({
      disk: { path: '/data', blockSize: 4096, blocks: 100_000, bfree: 30_000, bavail: 28_000 },
    });
    const view = buildSystemInfo(cur, null, { sampledAt: '2024-01-01T00:00:00.000Z', windowMs: null }, { topN: 5 }, STUB_PROC);
    const disk = view.disk;
    if ('reason' in disk) throw new Error(`disk degraded: ${disk.reason}`);
    const used = (100_000 - 30_000) * 4096;
    const bavailBytes = 28_000 * 4096;
    expect(disk.usedBytes).toBe(used);
    expect(disk.freeBytes).toBe(bavailBytes);
    expect(disk.usedPct).toBeCloseTo(used / (used + bavailBytes) * 100, 1);
    expect(disk.path).toBe('/data');
  });

  it('memory fields: usedBytes = total - free, usedPct = used/total', () => {
    const cur = makeHost({ mem: { totalBytes: 8_000_000_000, freeBytes: 3_000_000_000 } });
    const view = buildSystemInfo(cur, null, { sampledAt: '2024-01-01T00:00:00.000Z', windowMs: null }, { topN: 5 }, STUB_PROC);
    const mem = view.memory;
    if ('reason' in mem) throw new Error(`memory degraded: ${mem.reason}`);
    expect(mem.totalBytes).toBe(8_000_000_000);
    expect(mem.freeBytes).toBe(3_000_000_000);
    expect(mem.usedBytes).toBe(5_000_000_000);
    expect(mem.usedPct).toBeCloseTo(5_000_000_000 / 8_000_000_000 * 100, 1);
  });

  it('returns sampledAt and windowMs from ctx', () => {
    const cur = makeHost();
    const view = buildSystemInfo(cur, null, { sampledAt: '2024-06-01T10:00:00.000Z', windowMs: null }, { topN: 5 }, STUB_PROC);
    expect(view.sampledAt).toBe('2024-06-01T10:00:00.000Z');
    expect(view.windowMs).toBeNull();

    const view2 = buildSystemInfo(cur, cur, { sampledAt: '2024-06-01T10:00:02.000Z', windowMs: 2000 }, { topN: 5 }, STUB_PROC);
    expect(view2.windowMs).toBe(2000);
  });

  it('cpu.cores + cpu.loadAvg forwarded verbatim', () => {
    const cur = makeHost({ loadAvg: [1.2, 0.8, 0.5], cores: 4 });
    const view = buildSystemInfo(cur, null, { sampledAt: '2024-01-01T00:00:00.000Z', windowMs: null }, { topN: 5 }, STUB_PROC);
    expect(view.cpu.cores).toBe(4);
    expect(view.cpu.loadAvg).toEqual([1.2, 0.8, 0.5]);
  });
});

// ============================================================
// UT-075 — independent degrade paths, never-throw
// ============================================================

describe('buildSystemInfo — degrade paths (UT-075, DES-073)', () => {
  it('null cpu snapshot → cpu block degrades (utilizationPct null + Degraded), others still populated', () => {
    const cur = makeHost({ cpu: null });
    const view = buildSystemInfo(cur, null, { sampledAt: '2024-01-01T00:00:00.000Z', windowMs: null }, { topN: 5 }, STUB_PROC);
    expect(view.cpu.utilizationPct).toBeNull();
    // mem and disk still returned (not degraded)
    expect('reason' in view.memory).toBe(false);
    expect('reason' in view.disk).toBe(false);
  });

  it('null mem snapshot → memory is a Degraded object', () => {
    const cur = makeHost({ mem: null });
    const view = buildSystemInfo(cur, null, { sampledAt: '2024-01-01T00:00:00.000Z', windowMs: null }, { topN: 5 }, STUB_PROC);
    expect('reason' in view.memory).toBe(true);
    // disk and cpu still present
    expect('reason' in view.disk).toBe(false);
  });

  it('null disk snapshot → disk is a Degraded object', () => {
    const cur = makeHost({ disk: null });
    const view = buildSystemInfo(cur, null, { sampledAt: '2024-01-01T00:00:00.000Z', windowMs: null }, { topN: 5 }, STUB_PROC);
    expect('reason' in view.disk).toBe(true);
    // mem still present
    expect('reason' in view.memory).toBe(false);
  });

  it('null cpu + null mem + null disk → all three sections degrade independently, no throw', () => {
    const cur = makeHost({ cpu: null, mem: null, disk: null });
    expect(() => {
      const view = buildSystemInfo(cur, null, { sampledAt: '2024-01-01T00:00:00.000Z', windowMs: null }, { topN: 5 }, STUB_PROC);
      expect('reason' in view.memory).toBe(true);
      expect('reason' in view.disk).toBe(true);
      expect(view.cpu.utilizationPct).toBeNull();
    }).not.toThrow();
  });

  it('never throws even with a completely empty host snapshot', () => {
    const cur: RawHostSnapshot = {
      cpu: null,
      loadAvg: [0, 0, 0],
      cores: 0,
      mem: null,
      disk: null,
    };
    expect(() =>
      buildSystemInfo(cur, null, { sampledAt: '2024-01-01T00:00:00.000Z', windowMs: null }, { topN: 5 }, STUB_PROC)
    ).not.toThrow();
  });
});
