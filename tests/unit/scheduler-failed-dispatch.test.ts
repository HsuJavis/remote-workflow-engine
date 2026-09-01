// UT-105 (DES-118, ARCH-072, TASK-112): `Scheduler.markFailed` — the driver's `.catch()`
// (server.ts:1294-1309) gets a writer. Today it writes nothing while `markFired` is the sole writer
// that advances a schedule after a firing — so a failed dispatch (e.g. the catalog entry was
// deregistered after the schedule was created) re-fires at the 500ms driver-tick cadence forever,
// and `schedule_list` shows silence rather than failure, under a comment claiming the opposite.
//
// Mock policy (unit, DES-119): the injected clock + a fake ticker — this test drives the SAME
// tick()/start()/.catch() shape the real driver loop uses (server.ts), but manually, without
// booting an HTTP server or a real 500ms timer.
//
// Red reason: `SqliteSchedulerPort.markFailed` does not exist today (only `markFired` does) →
// `port.markFailed is not a function`, TypeError. A SINGLE-TICK test would pass today and prove
// nothing (the defect is only visible on tick 2 — DES-118's own words) — hence three ticks.
import { describe, it, expect, vi } from 'vitest';
import { SqliteSchedulerPort } from '../../src/scheduler.js';
import { tick } from '../../src/scheduler-engine.js';
import type { Clock } from '../../src/clock.js';

/** A mutable fake clock (this repo's FixedClock is immutable) — needed to drive multiple ticks. */
class MutableClock implements Clock {
  private _ms: number;
  constructor(startMs: number) { this._ms = startMs; }
  now(): number { return this._ms; }
  isoNow(): string { return new Date(this._ms).toISOString(); }
  advance(ms: number): void { this._ms += ms; }
}

function failingRunManager(code: string) {
  return { start: vi.fn().mockRejectedValue(Object.assign(new Error('dispatch failed'), { code })) };
}

// v22 (DES-111): CatalogPort shrank to the existence-only shape scheduler.ts actually needs.
const OK_CATALOG = { exists: vi.fn().mockResolvedValue(true) };

/** Mirrors the real driver loop's body (server.ts:1294-1309) exactly, so this test drives the same
 *  shape the fix must land in production, not a re-invented one. */
async function driveOneTick(port: SqliteSchedulerPort, runManager: { start: (spec: unknown) => Promise<string> }, now: number): Promise<void> {
  const due = tick(port.all(), now);
  for (const firing of due) {
    await runManager.start({ name: firing.workflow, args: firing.args, startedBy: { type: 'schedule', id: firing.workflow } })
      .then((runId: string) => port.markFired(firing, runId))
      .catch((err: unknown) => port.markFailed(firing, (err as { code?: string }).code ?? 'DISPATCH_FAILED'));
  }
}

describe('Scheduler.markFailed — once schedule (DES-118, UT-105)', () => {
  it('a failing once-schedule attempts start() exactly once across 3 ticks, is auto-disabled, and records lastError', async () => {
    const start = Date.parse('2026-01-01T00:00:00.000Z');
    const clock = new MutableClock(start);
    const runManager = failingRunManager('WORKFLOW_NOT_FOUND');
    const port = new SqliteSchedulerPort({ clock, catalog: OK_CATALOG, runManager, dbPath: ':memory:' });

    const created = await port.create({ kind: 'once', workflow: 'gone-workflow', at: new Date(start - 1000).toISOString(), enabled: true });
    expect(created.error).toBeUndefined();

    // Tick 1: the schedule is due; dispatch fails; markFailed must be called from the .catch().
    await driveOneTick(port, runManager, clock.now());
    // Tick 2 and 3: at the SAME 500ms driver cadence (no cron-interval time has genuinely elapsed) —
    // today's bug is that the schedule stays "due" forever because nothing advances/disables it.
    clock.advance(500);
    await driveOneTick(port, runManager, clock.now());
    clock.advance(500);
    await driveOneTick(port, runManager, clock.now());

    expect(runManager.start).toHaveBeenCalledTimes(1); // not re-fired at 2Hz forever
    const list = await port.list();
    expect(list).toHaveLength(1);
    expect(list[0]!.enabled).toBe(false); // 'once' auto-disabled, same as a successful markFired
    expect((list[0] as unknown as { lastError?: { code: string; at: string } }).lastError).toMatchObject({ code: 'WORKFLOW_NOT_FOUND' });
  });
});

describe('Scheduler.markFailed — cron schedule (DES-118, UT-105)', () => {
  it('a failing cron schedule attempts start() exactly once across 3 ticks and its nextFire is advanced past `now`', async () => {
    const start = Date.parse('2026-01-01T00:00:30.000Z'); // 30s past the minute boundary
    const clock = new MutableClock(start);
    const runManager = failingRunManager('WORKFLOW_NOT_FOUND');
    const port = new SqliteSchedulerPort({ clock, catalog: OK_CATALOG, runManager, dbPath: ':memory:' });

    const created = await port.create({ kind: 'cron', workflow: 'gone-workflow', cron: '* * * * *', enabled: true });
    expect(created.error).toBeUndefined();
    const beforeList = await port.list();
    const nextFireBefore = beforeList[0]!.nextFire;

    // Advance the clock to (past) the computed nextFire — creation itself never makes a schedule
    // immediately due (computeNextFire always returns a boundary strictly after `now`).
    clock.advance(Date.parse(nextFireBefore!) - clock.now());
    await driveOneTick(port, runManager, clock.now());
    clock.advance(500);
    await driveOneTick(port, runManager, clock.now());
    clock.advance(500);
    await driveOneTick(port, runManager, clock.now());

    expect(runManager.start).toHaveBeenCalledTimes(1); // driver tick 2/3 must not re-attempt at the same due instant
    const afterList = await port.list();
    expect(afterList[0]!.enabled).toBe(true); // cron stays enabled, unlike 'once'
    expect(afterList[0]!.nextFire).not.toBe(nextFireBefore); // a fresh future nextFire, never the stale due one
    expect((afterList[0] as unknown as { lastError?: { code: string; at: string } }).lastError).toMatchObject({ code: 'WORKFLOW_NOT_FOUND' });
  });
});
