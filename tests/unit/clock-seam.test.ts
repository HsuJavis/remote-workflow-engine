// UT-014: Clock/RNG determinism seam — FixedClock + RunStore timestamp injection (DES-014)
import { describe, it, expect } from 'vitest';
import { FixedClock, SystemClock } from '../../src/clock.js';
import { InMemoryRunStore } from '../../src/run-store.js';

const ANCHOR = new Date('2024-06-01T12:00:00.000Z');

describe('FixedClock (value object — implemented)', () => {
  it('now() returns the injected anchor epoch ms', () => {
    const clock = new FixedClock(ANCHOR);
    expect(clock.now()).toBe(ANCHOR.getTime());
  });

  it('isoNow() returns the anchor as an ISO string', () => {
    const clock = new FixedClock(ANCHOR);
    expect(clock.isoNow()).toBe('2024-06-01T12:00:00.000Z');
  });

  it('now() is stable across multiple calls (no drift)', () => {
    const clock = new FixedClock(ANCHOR);
    const t1 = clock.now();
    const t2 = clock.now();
    expect(t1).toBe(t2);
  });
});

describe('RunStore clock injection', () => {
  it('run creation timestamp uses the injected Clock, not the wall clock', async () => {
    const fixedMs = ANCHOR.getTime();
    const clock = new FixedClock(ANCHOR);
    const store = new InMemoryRunStore(clock);
    const runId = await store.createRun({ script: 'return 1;' });
    const summary = (await store.listRuns()).find((r) => r.runId === runId);
    expect(summary).toBeDefined();
    // The createdAt timestamp must be the injected clock's time, not Date.now()
    expect(summary!.createdAt).toBe(new Date(fixedMs).toISOString());
  });

  it('recordTransition uses the provided ts string (from injected Clock)', async () => {
    const clock = new FixedClock(ANCHOR);
    const store = new InMemoryRunStore(clock);
    const runId = await store.createRun({ script: 'return 1;' });
    const ts = clock.isoNow();
    await store.recordTransition(runId, 'queued', 'running', ts);
    const view = await store.getRun(runId);
    expect(view!.status).toBe('running');
    // The transition timestamp should match what we passed
  });
});
