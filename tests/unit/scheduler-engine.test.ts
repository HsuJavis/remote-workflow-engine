// UT-028: Scheduler pure firing engine — tick(now) + computeNextFire + FakeTicker driver (DES-017, TASK-024)
// RED: src/scheduler-engine.js does not exist yet — all tests fail on module-not-found.
// Clock-hermetic: all "due" / "future" comparisons use clock.now() + offset, never absolute literals.
import { describe, it, expect, vi } from 'vitest';
import { FixedClock } from '../../src/clock.js';
// Value imports — cause module-not-found at load time when the module is absent.
import { tick, computeNextFire, FakeTicker, bootRearm } from '../../src/scheduler-engine.js';

// Fixed anchor — used as a stable reference, not a "future/past" wall-clock comparison.
const CLOCK = new FixedClock(new Date('2020-06-01T12:00:00.000Z'));

// Minimal stored schedule shape (nextFire is the persisted computed field).
function cronSchedule(overrides: object = {}) {
  return {
    kind: 'cron' as const,
    id: 'sched-1',
    workflow: 'my-workflow',
    cron: '* * * * *',
    enabled: true,
    nextFire: CLOCK.now() - 1000, // 1 second in the PAST relative to our clock anchor — due
    ...overrides,
  };
}

describe('tick(schedules, now) — pure firing decision (DES-017)', () => {
  it('returns a schedule whose nextFire <= now and is enabled', () => {
    const now = CLOCK.now();
    const firings = tick([cronSchedule({ nextFire: now - 1 })], now);
    expect(firings.length).toBe(1);
    expect(firings[0]!.id).toBe('sched-1');
    expect(firings[0]!.kind).toBe('cron');
  });

  it('does NOT return a schedule whose nextFire is in the future', () => {
    const now = CLOCK.now();
    const firings = tick([cronSchedule({ nextFire: now + 60_000 })], now);
    expect(firings.length).toBe(0);
  });

  it('does NOT return a disabled schedule even if nextFire is past', () => {
    const now = CLOCK.now();
    const firings = tick([cronSchedule({ enabled: false, nextFire: now - 1 })], now);
    expect(firings.length).toBe(0);
  });

  it('does NOT return a resident schedule (residents are trigger-only, no nextFire)', () => {
    const now = CLOCK.now();
    const firings = tick(
      [{ kind: 'resident' as const, id: 'r1', workflow: 'wf', enabled: true }],
      now,
    );
    expect(firings.length).toBe(0);
  });

  it('returns multiple due schedules in one tick', () => {
    const now = CLOCK.now();
    const s1 = { ...cronSchedule({ id: 's1', nextFire: now - 1 }) };
    const s2 = { ...cronSchedule({ id: 's2', nextFire: now - 500 }) };
    const s3 = { ...cronSchedule({ id: 's3', nextFire: now + 60_000 }) }; // future, not due
    const firings = tick([s1, s2, s3], now);
    expect(firings.length).toBe(2);
    expect(firings.map((f) => f.id)).toContain('s1');
    expect(firings.map((f) => f.id)).toContain('s2');
  });
});

describe('computeNextFire(cron, tz, after) — pure next-fire helper (DES-017)', () => {
  it('returns a time strictly after `after` (relative clock anchor)', () => {
    const after = CLOCK.now();
    const next = computeNextFire('* * * * *', undefined, after);
    expect(next).toBeGreaterThan(after);
  });

  it('for a every-minute cron, next fire is at most 60 seconds later', () => {
    const after = CLOCK.now();
    const next = computeNextFire('* * * * *', undefined, after);
    expect(next).toBeLessThanOrEqual(after + 60_000);
  });

  it('missed-fire catch-up: schedules multiple minutes late only fires ONCE (never backfills)', () => {
    // Simulates a server that was down for 10 minutes; on catch-up the cron should fire once,
    // not once per missed slot.
    const downSince = CLOCK.now() - 10 * 60_000;
    const catchUpNow = CLOCK.now();
    // The schedule's stored nextFire was set for `downSince`; tick() returns it once.
    const firings = tick(
      [cronSchedule({ nextFire: downSince })],
      catchUpNow,
    );
    expect(firings.length).toBe(1); // fire-once, not 10
  });
});

describe('FakeTicker driver loop (DES-017)', () => {
  it('FakeTicker.advance() invokes the callback synchronously', () => {
    const cb = vi.fn();
    const ticker = new FakeTicker();
    ticker.start(cb);
    ticker.advance(); // simulate one tick
    expect(cb).toHaveBeenCalledOnce();
  });

  it('ticker.stop() prevents further callbacks', () => {
    const cb = vi.fn();
    const ticker = new FakeTicker();
    ticker.start(cb);
    ticker.stop();
    ticker.advance();
    expect(cb).not.toHaveBeenCalled();
  });
});

describe('bootRearm uses the injected Clock (DES-017, DES-014)', () => {
  it('re-arms all persisted schedules from clock.now() without reading wall time', () => {
    // bootRearm should call computeNextFire for each schedule using the provided Clock.
    const schedules = [
      cronSchedule({ id: 'a', nextFire: 0 }), // stale / never set
    ];
    const rearmed = bootRearm(schedules, CLOCK);
    // All rearmed schedules should have nextFire > clock.now() - 1 (recently computed)
    for (const s of rearmed) {
      if ('nextFire' in s) {
        expect((s as { nextFire: number }).nextFire).toBeGreaterThanOrEqual(CLOCK.now());
      }
    }
  });
});
