// UT-046: D-DOS global AgentSemaphore — injectable single instance + gauge + release invariant (TASK-035, DES-027)
// RED: src/agent-semaphore.js does not exist yet — all tests fail on module-not-found.
import { describe, it, expect } from 'vitest';
// Value import — causes module-not-found at load time when the module is absent.
import { createSemaphore } from '../../src/agent-semaphore.js';

describe('AgentSemaphore — gauge + FIFO queueing (D-DOS, DES-027/TASK-035)', () => {
  it('gauge() starts at {total, inUse:0, queued:0}', () => {
    const sem = createSemaphore(2);
    expect(sem.gauge()).toEqual({ total: 2, inUse: 0, queued: 0 });
  });

  it('withSlot increments inUse while the callback is in flight and decrements after it resolves', async () => {
    const sem = createSemaphore(1);
    let duringGauge: { inUse: number } | undefined;
    await sem.withSlot(async () => {
      duringGauge = sem.gauge();
    });
    expect(duringGauge?.inUse).toBe(1);
    expect(sem.gauge().inUse).toBe(0);
  });

  it('a second call queues (queued:1) while max=1 is occupied, then runs after release', async () => {
    const sem = createSemaphore(1);
    let secondRan = false;
    let release!: () => void;
    const first = sem.withSlot(() => new Promise<void>((resolve) => { release = resolve; }));
    // Give the first call's microtask a tick to actually acquire the slot.
    await new Promise((r) => setTimeout(r, 10));
    expect(sem.gauge().inUse).toBe(1);
    const second = sem.withSlot(async () => { secondRan = true; });
    await new Promise((r) => setTimeout(r, 10));
    expect(sem.gauge().queued).toBe(1);
    expect(secondRan).toBe(false);
    release();
    await first;
    await second;
    expect(secondRan).toBe(true);
    expect(sem.gauge()).toEqual({ total: 1, inUse: 0, queued: 0 });
  });

  it('the slot is released exactly once even when the callback throws (never a starved permanent hold)', async () => {
    const sem = createSemaphore(1);
    await expect(sem.withSlot(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(sem.gauge()).toEqual({ total: 1, inUse: 0, queued: 0 });
  });

  it('is a genuinely injectable/resettable instance, not a module-level static (two instances are independent)', () => {
    const a = createSemaphore(1);
    const b = createSemaphore(3);
    expect(a.gauge().total).toBe(1);
    expect(b.gauge().total).toBe(3);
  });
});
