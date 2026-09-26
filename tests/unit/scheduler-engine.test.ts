// UT-028: Scheduler pure firing engine — tick(now) + computeNextFire + FakeTicker driver (DES-017, TASK-024)
// RED: src/scheduler-engine.js does not exist yet — all tests fail on module-not-found.
// Clock-hermetic: all "due" / "future" comparisons use clock.now() + offset, never absolute literals.
import { describe, it, expect, vi } from 'vitest';
import { FixedClock } from '../../src/clock.js';
// Value imports — cause module-not-found at load time when the module is absent.
import { tick, computeNextFire, FakeTicker, bootRearm, parseCron } from '../../src/scheduler-engine.js';

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

// issue #92 item 1: `parseCron`/`parseCronField` semantic validation — the SAME grammar both
// `scheduler.ts`'s create-time `validateCron` and every runtime reader (`computeNextFire`,
// `claimFiring`, boot re-arm) parse through, so a stored row that predates this validation is
// caught here too (defence in depth), not just at the create-time door.
describe('parseCron semantic validation (issue #92 item 1)', () => {
  it('a step of 0 is refused immediately — never loops (the freeze this closes)', () => {
    // Before the fix, `parseCronField` looped `for (v = lo; v <= hi; v += step)` with step 0,
    // which never terminates. This assertion only proves something once the fix makes it FAST; the
    // RED-phase evidence that it used to hang is a bounded `timeout 20 npx vitest run ... -t
    // 'step of 0'` shell run against the pre-fix source (exit 124), not a test that itself waits.
    expect(() => parseCron('*/0 * * * *')).toThrow();
    let code: unknown;
    try { parseCron('*/0 * * * *'); } catch (e) { code = (e as { code?: unknown }).code; }
    expect(code).toBe('INVALID_CRON');
  });

  it('a negative or fractional step is refused, not silently coerced', () => {
    expect(() => parseCron('*/-1 * * * *')).toThrow();
    expect(() => parseCron('1-10/2.5 * * * *')).toThrow();
  });

  it('an out-of-range field value is refused naming the field (99 99 * * * — issue #92\'s own repro)', () => {
    let err: unknown;
    try { parseCron('99 99 * * *'); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(Error);
    expect((err as { code?: unknown }).code).toBe('INVALID_CRON');
    expect((err as Error).message).toMatch(/minute/);
  });

  it('a range with a > b is refused', () => {
    expect(() => parseCron('10-5 * * * *')).toThrow(/INVALID_CRON|range/i);
  });

  it('a non-numeric field value is refused, not silently treated as an empty/zero set', () => {
    expect(() => parseCron('abc * * * *')).toThrow();
  });

  it('a wrong field count is refused with a typed error, not a raw TypeError', () => {
    let err: unknown;
    try { parseCron('* * *'); } catch (e) { err = e; }
    expect((err as { code?: unknown } | undefined)?.code).toBe('INVALID_CRON');
  });

  it('day-of-week 7 is refused as out of range — no Sunday alias in this dialect (keep behaviour: pre-fix it silently never matched anything, since fieldsAt only ever yields 0-6)', () => {
    let err: unknown;
    try { parseCron('0 0 * * 7'); } catch (e) { err = e; }
    expect((err as { code?: unknown } | undefined)?.code).toBe('INVALID_CRON');
    expect((err as Error | undefined)?.message).toMatch(/day-of-week/);
  });

  it('valid expressions (including comma lists, ranges, steps, and dow 0-6) still parse', () => {
    expect(() => parseCron('*/15 0-6 1,15 * 1-5')).not.toThrow();
    expect(() => parseCron('0 0 * * 0')).not.toThrow(); // dow 0 = Sunday, unaffected by the dow-7 refusal
  });
});

describe('computeNextFire never-fires detection (issue #92 item 1c)', () => {
  it('a day-of-month/month combination that can never occur (Feb 31) throws fast — not a ~2.1M-iteration scan', () => {
    const start = Date.now();
    expect(() => computeNextFire('0 0 31 2 *', undefined, CLOCK.now())).toThrow();
    // The analytical short-circuit (`hasPossibleDate`) must reject this before the minute-by-minute
    // horizon scan ever begins — a generous bound (real: sub-millisecond) that would still catch a
    // regression back to the full scan (which measured seconds, even with a cached tz formatter).
    expect(Date.now() - start).toBeLessThan(500);
  });

  it('the same never-fires cron throws fast with a tz set too (the tz path is where the un-cached formatter cost lived)', () => {
    const start = Date.now();
    expect(() => computeNextFire('0 0 31 2 *', 'Asia/Taipei', CLOCK.now())).toThrow();
    expect(Date.now() - start).toBeLessThan(500);
  });

  it('a valid every-Feb-29 cron (leap years only) still finds a real next fire, not a false "never fires"', () => {
    const next = computeNextFire('0 0 29 2 *', undefined, CLOCK.now());
    expect(Number.isFinite(next)).toBe(true);
  });
});
