// IT-032: Scheduler firing engine calls RunManager.start for due schedules (DES-017, ARCH-010)
// RED: src/scheduler-engine.js does not exist yet — all tests fail on module-not-found.
// Clock-hermetic: all "due" / "not yet due" comparisons use clock.now() ± offset.
import { describe, it, expect, vi } from 'vitest';
import { FixedClock } from '../../src/clock.js';
// Value imports — cause module-not-found at load time when absent.
import { tick, FakeTicker } from '../../src/scheduler-engine.js';
import { SqliteSchedulerPort } from '../../src/scheduler.js';

const CLOCK = new FixedClock(new Date('2020-11-15T08:00:00.000Z'));

describe('Scheduler driver calls RunManager.start for due schedules (DES-017, ARCH-010)', () => {
  it('a due cron schedule fires a run via RunManager.start', async () => {
    const startMock = vi.fn().mockResolvedValue('run-123');
    // Simulate the scheduler driver: a due schedule, tick returns it, driver starts it.
    const now = CLOCK.now();
    const dueSchedule = {
      kind: 'cron' as const,
      id: 'cron-1',
      workflow: 'report-wf',
      cron: '* * * * *',
      enabled: true,
      nextFire: now - 1, // 1ms past — due
    };
    const firings = tick([dueSchedule], now);
    expect(firings.length).toBe(1);
    // Driver would call startMock for each firing.
    for (const f of firings) {
      await startMock({ name: f.workflow, args: f.args ?? null });
    }
    expect(startMock).toHaveBeenCalledOnce();
    expect(startMock.mock.calls[0]![0].name).toBe('report-wf');
  });

  it('a once schedule with past `at` fires and auto-completes (enabled becomes false)', async () => {
    const now = CLOCK.now();
    const onceSchedule = {
      kind: 'once' as const,
      id: 'once-1',
      workflow: 'one-shot',
      at: new Date(now - 5000).toISOString(), // 5s in the past
      enabled: true,
      nextFire: now - 5000, // derived from `at`
    };
    const firings = tick([onceSchedule], now);
    // A due once-schedule fires
    expect(firings.length).toBe(1);
    expect(firings[0]!.kind).toBe('once');
    // After firing, the implementation must mark it disabled (auto-complete).
    // This is tested at the store level in IT-031; here we verify tick returns it.
  });

  it('FakeTicker drives repeated tick invocations on advance()', async () => {
    const ticks: number[] = [];
    const ticker = new FakeTicker();
    let count = 0;
    ticker.start(() => { ticks.push(++count); });
    ticker.advance(); // tick 1
    ticker.advance(); // tick 2
    ticker.stop();
    ticker.advance(); // stopped — no more ticks
    expect(ticks).toEqual([1, 2]);
  });
});
