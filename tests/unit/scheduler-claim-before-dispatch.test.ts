// UT-270 (v29, REQ-152, R29-A1): a due firing is CLAIMED synchronously, before any dispatch, so a
// second tick at the next 500 ms boundary cannot see it again.
//
// The defect this is written against (mechanism read from the code, then reproduced here):
//   server.ts:945  ticker.start(() => {
//                    const due = tick(scheduler.all(), clock.now());   // synchronous
//                    for (const firing of due) {
//                      void resolveScheduleTarget(firing).then((target) => {   // async
//                        runManager.start(...).then((runId) => scheduler.markFired(firing, runId))
// `markFired` is the ONLY writer that sets `enabled = 0` for a `once` schedule, and it lands only
// after `runManager.start()` resolves. Until then the row is still `enabled = 1` with an unchanged
// `nextFire`, so the next tick (RealTicker(500)) returns the SAME firing and dispatches a SECOND
// run. Observed twice in v29's full regressions, always exactly 2 runs, never 3 — by the third
// tick the first `markFired` has landed.
//
// `markRefused` already carries a comment naming this race ("two ticks racing the same instant")
// and guards the refusal path against double-COUNTING. The success path has no such guard, and its
// race produces a double RUN, not a double count.
//
// Mock policy: real SqliteSchedulerPort over :memory:, FixedClock — hermetic, no wall-clock read.
import { describe, it, expect } from 'vitest';
import { SqliteSchedulerPort } from '../../src/scheduler.js';
import { FixedClock } from '../../src/clock.js';
import { tick } from '../../src/scheduler-engine.js';

function makePort(clock: FixedClock) {
  return new SqliteSchedulerPort({
    clock,
    catalog: { resolve: async () => ({ ok: true, value: { script: '', version: 'v1' } }) } as never,
    runManager: { start: async () => ({ runId: 'r1' }) } as never,
    dbPath: ':memory:',
  });
}

describe('a due firing is claimed before dispatch (UT-270, REQ-152)', () => {
  it('once: the second tick does NOT see a firing the first tick already took', async () => {
    const clock = new FixedClock(new Date('2026-01-01T00:00:00Z'));
    const port = makePort(clock);
    const created = await port.create({ kind: 'once', workflow: 'wf-a', at: '2026-01-01T00:00:00Z', enabled: true });
    const id = (created as { result: { id: string } }).result.id;

    const firstTick = tick(port.all(), clock.now());
    expect(firstTick).toHaveLength(1);
    expect(port.claimFiring(firstTick[0]!)).toBe(true);

    // Dispatch has NOT completed — `markFired` has not been called. This is the window.
    const secondTick = tick(port.all(), clock.now());
    expect(secondTick, 'the same once firing was still due on the next tick').toHaveLength(0);
  });

  it('the OLD driver shape, stated as an executable fact: without a claim the next tick re-fires it', async () => {
    // This case does NOT test the fix. It pins the defect's mechanism so the reason for the claim
    // cannot be lost to a comment: with `markFired` as the only writer that disables a `once` row,
    // and that call sitting after an awaited dispatch, the window is exactly this.
    const clock = new FixedClock(new Date('2026-01-01T00:00:00Z'));
    const port = makePort(clock);
    await port.create({ kind: 'once', workflow: 'wf-a', at: '2026-01-01T00:00:00Z', enabled: true });

    const first = tick(port.all(), clock.now());
    const second = tick(port.all(), clock.now()); // 500 ms later in production; dispatch still in flight
    expect(first).toHaveLength(1);
    expect(second, 'two ticks see the same due firing while nothing has claimed it').toHaveLength(1);
    expect(second[0]!.id).toBe(first[0]!.id);
    // ...which is two dispatches of the same schedule. Always exactly two, because by the third
    // tick the first `markFired` has landed — matching what the regressions observed.
  });

  it('once: a racing second claim of the same firing is refused, so only one dispatch happens', async () => {
    const clock = new FixedClock(new Date('2026-01-01T00:00:00Z'));
    const port = makePort(clock);
    const created = await port.create({ kind: 'once', workflow: 'wf-a', at: '2026-01-01T00:00:00Z', enabled: true });
    const firing = { kind: 'once' as const, id: (created as { result: { id: string } }).result.id, workflow: 'wf-a' };
    expect(port.claimFiring(firing)).toBe(true);
    expect(port.claimFiring(firing)).toBe(false);
  });

  it('cron: claiming advances nextFire, and a later markFired does NOT advance it a second time', async () => {
    // The regression a naive fix would introduce: if both the claim and `markFired` recompute
    // `nextFire` from `now`, the schedule skips one whole occurrence per fire.
    const clock = new FixedClock(new Date('2026-01-01T00:00:00Z'));
    const port = makePort(clock);
    const created = await port.create({ kind: 'cron', workflow: 'wf-b', cron: '* * * * *', enabled: true });
    const id = (created as { result: { id: string } }).result.id;
    const firing = { kind: 'cron' as const, id, workflow: 'wf-b' };

    // `StoredSchedule` is a union and the `resident` variant carries no `nextFire` — narrow on
    // `kind` rather than asserting the field exists (tsc catches the un-narrowed form).
    const nextFireOf = (): number | undefined => {
      const row = port.all().find((s) => s.id === id);
      return row && row.kind !== 'resident' ? row.nextFire : undefined;
    };
    expect(port.claimFiring(firing)).toBe(true);
    const afterClaim = nextFireOf()!;
    expect(afterClaim).toBeGreaterThan(clock.now());

    port.markFired(firing, 'run-1');
    const afterFired = nextFireOf()!;
    expect(afterFired, 'markFired advanced nextFire a second time — one occurrence was skipped').toBe(afterClaim);

    const status = (await port.list()).find((s: { id: string }) => s.id === id);
    expect(status?.lastRunId, 'the fire record itself must still be written').toBe('run-1');
  });

  it('cron: a racing second claim at the same instant is refused', async () => {
    const clock = new FixedClock(new Date('2026-01-01T00:00:00Z'));
    const port = makePort(clock);
    const created = await port.create({ kind: 'cron', workflow: 'wf-b', cron: '* * * * *', enabled: true });
    const firing = { kind: 'cron' as const, id: (created as { result: { id: string } }).result.id, workflow: 'wf-b' };
    expect(port.claimFiring(firing)).toBe(true);
    expect(port.claimFiring(firing)).toBe(false);
  });
});
