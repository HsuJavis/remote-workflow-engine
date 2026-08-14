// UT-076: `SystemInfoSampler` lazy-TTL cache + clock seam (DES-073, ARCH-048, TASK-074)
//
// Tests that:
//   1. First call always triggers a probe.sampleHost()
//   2. Within-TTL repeat reuses the cache (probe not called again)
//   3. After TTL expires (advancing clock), a new probe.sampleHost() is triggered
//   4. windowMs = currentTime - prevSampleTime (derived from injected clock, not wall clock)
//   5. sampledAt = clock.isoNow() at the time of sampling (not wall time)
//   6. TTL freshness check uses the injected clock (time-travel safe)
//
// Red reason: `src/system-info.ts` does not exist yet.
//   → "Cannot find module '../../src/system-info.js'" at collect time.
//
// Mock policy (unit): StubSystemProbe (per-field fault injection) + AdvancingClock (local helper)
//   cover all TTL and clock-seam paths without real I/O or wall-clock reads.
//
// Note on hermeticity: the AdvancingClock local helper derives ALL time from a fixed anchor
//   (new Date('2024-01-01T00:00:00.000Z')) and an explicit offset — no wall-clock comparisons.

import { describe, it, expect, vi } from 'vitest';
import { SystemInfoSampler } from '../../src/system-info.js';
import type { SystemProbe, RawHostSnapshot, RawProcSnapshot } from '../../src/system-info.js';
import type { Clock } from '../../src/clock.js';

// ---- local helpers ----

const ANCHOR_MS = new Date('2024-01-01T00:00:00.000Z').getTime();

/** Mutable clock for TTL tests. Advance with .tick(ms). Derives from a fixed anchor — no wall clock. */
class AdvancingClock implements Clock {
  private _ms: number;
  constructor(offsetMs = 0) { this._ms = ANCHOR_MS + offsetMs; }
  now() { return this._ms; }
  isoNow() { return new Date(this._ms).toISOString(); }
  tick(ms: number) { this._ms += ms; }
}

function makeSnapshot(variant = 0): RawHostSnapshot {
  return {
    cpu: { perCore: [{ idleMs: 700 + variant * 10, totalMs: 1000 + variant * 10 }] },
    loadAvg: [0.5 + variant * 0.1, 0.4, 0.3],
    cores: 4,
    mem: { totalBytes: 8_000_000_000, freeBytes: 3_000_000_000 },
    disk: { path: '/data', blockSize: 4096, blocks: 100_000, bfree: 30_000, bavail: 28_000 },
  };
}

const EMPTY_PROCS: RawProcSnapshot = { self: { threads: null, fdCount: null }, procs: [], procsDegraded: undefined };

function makeProbe(snapshots: RawHostSnapshot[]): SystemProbe & { hostCallCount: number } {
  let idx = 0;
  return {
    get hostCallCount() { return idx; },
    async sampleHost(): Promise<RawHostSnapshot> {
      return snapshots[Math.min(idx++, snapshots.length - 1)];
    },
    async sampleProcesses(_deadlineMs: number): Promise<RawProcSnapshot> {
      return EMPTY_PROCS;
    },
  };
}

// ---- tests ----

describe('SystemInfoSampler — TTL cache + clock seam (UT-076, DES-073)', () => {
  it('first call always triggers probe.sampleHost()', async () => {
    const clock = new AdvancingClock();
    const probe = makeProbe([makeSnapshot(0)]);
    const sampler = new SystemInfoSampler(probe, clock, 1500);

    await sampler.get({ topN: 5 });
    expect(probe.hostCallCount).toBe(1);
  });

  it('within-TTL repeat reuses the cache (probe not called again)', async () => {
    const clock = new AdvancingClock();
    const probe = makeProbe([makeSnapshot(0), makeSnapshot(1)]);
    const sampler = new SystemInfoSampler(probe, clock, 1500);

    await sampler.get({ topN: 5 });
    // advance less than TTL
    clock.tick(500);
    await sampler.get({ topN: 5 });
    expect(probe.hostCallCount).toBe(1); // still 1 — cached
  });

  it('after TTL expires a new sampleHost() is triggered', async () => {
    const clock = new AdvancingClock();
    const probe = makeProbe([makeSnapshot(0), makeSnapshot(1)]);
    const sampler = new SystemInfoSampler(probe, clock, 1500);

    await sampler.get({ topN: 5 });
    clock.tick(2000); // past TTL
    await sampler.get({ topN: 5 });
    expect(probe.hostCallCount).toBe(2);
  });

  it('sampledAt reflects clock.isoNow() at the time of sampling (not wall clock)', async () => {
    const clock = new AdvancingClock(5000); // start at ANCHOR + 5s
    const probe = makeProbe([makeSnapshot(0)]);
    const sampler = new SystemInfoSampler(probe, clock, 1500);

    const view = await sampler.get({ topN: 5 });
    expect(view.sampledAt).toBe(new Date(ANCHOR_MS + 5000).toISOString());
  });

  it('windowMs is derived from injected clock timestamps (not wall time)', async () => {
    const clock = new AdvancingClock();
    const probe = makeProbe([makeSnapshot(0), makeSnapshot(1)]);
    const sampler = new SystemInfoSampler(probe, clock, 1500);

    await sampler.get({ topN: 5 }); // first call — windowMs should be null (no prev)
    clock.tick(2000); // advance beyond TTL
    const view2 = await sampler.get({ topN: 5 }); // second call — windowMs = clock delta

    // First call must produce windowMs null (no prior snapshot)
    // Second call should produce windowMs = 2000 (the clock delta between samples)
    expect(view2.windowMs).toBe(2000);
  });

  it('first call returns windowMs null + utilizationPct null (awaiting-second-sample)', async () => {
    const clock = new AdvancingClock();
    const probe = makeProbe([makeSnapshot(0)]);
    const sampler = new SystemInfoSampler(probe, clock, 1500);

    const view = await sampler.get({ topN: 5 });
    expect(view.windowMs).toBeNull();
    expect(view.cpu.utilizationPct).toBeNull();
    expect(view.cpu.utilizationDegraded).toMatchObject({ reason: 'awaiting-second-sample' });
  });

  it('within-TTL second call still returns the cached windowMs (no re-sample)', async () => {
    const clock = new AdvancingClock();
    const probe = makeProbe([makeSnapshot(0), makeSnapshot(1)]);
    const sampler = new SystemInfoSampler(probe, clock, 1500);

    await sampler.get({ topN: 5 }); // first — null window
    clock.tick(2000); // expire TTL
    await sampler.get({ topN: 5 }); // second — compute window
    clock.tick(500); // within TTL
    const view3 = await sampler.get({ topN: 5 }); // third — cached
    expect(probe.hostCallCount).toBe(2); // no third probe call
    // view3 should be the cached result from the second call
    expect(view3.windowMs).toBe(2000);
  });
});
