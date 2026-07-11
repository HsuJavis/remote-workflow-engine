// UT-045: Outer timeout race + kill-on-timeout + slot-free-exactly-once + FailureEnvelope
// (DES-027, TASK-033, TASK-035, TASK-037). UT time-travels the CLI's own multi-minute retry/backoff
// via vi.useFakeTimers() — zero real wall-clock waiting, per DES-027's own testability note.
// RED: src/timeout-race.js does not exist yet — all tests fail on module-not-found.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FixedClock } from '../../src/clock.js';
// Value imports — cause module-not-found at load time when the modules are absent.
import { raceWithTimeout } from '../../src/timeout-race.js';
import { createSemaphore } from '../../src/agent-semaphore.js';

const CLOCK = new FixedClock(new Date('2020-06-01T00:00:00.000Z'));

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('raceWithTimeout — timeout branch (DES-027, REQ-020)', () => {
  it('a hung call (never resolves) times out at timeoutMs: killImpl called exactly once, resolves ok:false with a timeout FailureEnvelope', async () => {
    const kill = vi.fn();
    const sem = createSemaphore(1);
    const hungCall = () => new Promise<string>(() => { /* simulates a ~4-minute CLI hang: never settles */ });

    const resultPromise = raceWithTimeout(hungCall, { clock: CLOCK, timeoutMs: 5000, kill, semaphore: sem });
    await vi.advanceTimersByTimeAsync(5000);
    const result = await resultPromise;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.envelope.kind).toBe('timeout');
      expect(result.envelope.elapsedMs).toBeGreaterThanOrEqual(5000);
    }
    expect(kill).toHaveBeenCalledTimes(1);
  });

  it('never smuggles a timeout as fake success — resolves ok:false, never ok:true', async () => {
    const sem = createSemaphore(1);
    const hungCall = () => new Promise<string>(() => {});
    const resultPromise = raceWithTimeout(hungCall, { clock: CLOCK, timeoutMs: 1000, kill: vi.fn(), semaphore: sem });
    await vi.advanceTimersByTimeAsync(1000);
    const result = await resultPromise;
    expect(result.ok).toBe(false);
  });
});

describe('raceWithTimeout — success branch never kills, slot still frees (DES-027)', () => {
  it('a call that resolves before timeoutMs never invokes killImpl and the slot returns to 0', async () => {
    const kill = vi.fn();
    const sem = createSemaphore(1);
    const fastCall = () => Promise.resolve('done');
    const result = await raceWithTimeout(fastCall, { clock: CLOCK, timeoutMs: 5000, kill, semaphore: sem });
    expect(result).toEqual({ ok: true, value: 'done' });
    expect(kill).not.toHaveBeenCalled();
    expect(sem.gauge()).toEqual({ total: 1, inUse: 0, queued: 0 });
  });
});

describe('raceWithTimeout — slot-free-exactly-once across every branch (D-V3a #1 HIGH risk, DES-027)', () => {
  it('success: gauge().inUse returns to 0 exactly once', async () => {
    const sem = createSemaphore(1);
    await raceWithTimeout(() => Promise.resolve('ok'), { clock: CLOCK, timeoutMs: 5000, kill: vi.fn(), semaphore: sem });
    expect(sem.gauge().inUse).toBe(0);
  });

  it('provider-error (rejected call): gauge().inUse returns to 0, never a double-free or never-free', async () => {
    const sem = createSemaphore(1);
    const failingCall = () => Promise.reject(new Error('provider unreachable'));
    const result = await raceWithTimeout(failingCall, { clock: CLOCK, timeoutMs: 5000, kill: vi.fn(), semaphore: sem });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.envelope.kind).toBe('provider_error');
    expect(sem.gauge()).toEqual({ total: 1, inUse: 0, queued: 0 });
  });

  it('timeout-kill: gauge().inUse returns to 0 after the kill branch resolves', async () => {
    const sem = createSemaphore(1);
    const hungCall = () => new Promise<string>(() => {});
    const resultPromise = raceWithTimeout(hungCall, { clock: CLOCK, timeoutMs: 2000, kill: vi.fn(), semaphore: sem });
    await vi.advanceTimersByTimeAsync(2000);
    await resultPromise;
    expect(sem.gauge()).toEqual({ total: 1, inUse: 0, queued: 0 });
  });

  it('a second call can acquire the slot immediately after the first (timeout) branch frees it — never starved', async () => {
    const sem = createSemaphore(1);
    const hungCall = () => new Promise<string>(() => {});
    const firstPromise = raceWithTimeout(hungCall, { clock: CLOCK, timeoutMs: 1000, kill: vi.fn(), semaphore: sem });
    await vi.advanceTimersByTimeAsync(1000);
    await firstPromise;
    const second = await raceWithTimeout(() => Promise.resolve('second-ok'), { clock: CLOCK, timeoutMs: 1000, kill: vi.fn(), semaphore: sem });
    expect(second).toEqual({ ok: true, value: 'second-ok' });
  });
});
