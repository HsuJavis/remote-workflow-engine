// UT-151 (DES-150, v24): markRefused shares markFailed's advance; markFired resets refusalCount.
// Written test-first (Gate 5, RED) — SqliteSchedulerPort has no markRefused method and markFired's
// UPDATE does not touch any refusalCount column (the column doesn't exist yet).
// Mock policy: real SqliteSchedulerPort over :memory:, FixedClock (hermetic, no wall-clock reads).
//
// Gate 6 (implementer, TASK-141): every `.create()` call below now passes `enabled: true`
// explicitly, matching every other call site of `SqliteSchedulerPort.create()` in the suite
// (scheduler-port.test.ts, scheduler-failed-dispatch.test.ts, etc.) — the shipped version of this
// file omitted it and relied on an `as never` cast to bypass `NewSchedule`'s required `enabled`
// field, which silently created rows already `enabled=0`. Also filled out to the dod's own ≥10
// floor (adjudication v24 #2 A-6, applied by analogy — the same "test count is this iteration's
// defence" rationale that ruled TASK-140's run-list.test.ts/run-store-audit.test.ts shortfall):
// one case per RefusalReason, and a `cron` tight-loop-trap case (the ONLY kind for which
// `nextFire` advancing past `now` is even a meaningful assertion — DES-150 pins `once`'s advance
// as `enabled=0` alone, mirroring `markFailed`'s existing `once` branch verbatim, so `once` never
// touches `nextFire` on a refusal).
import { describe, it, expect } from 'vitest';
import { SqliteSchedulerPort, onceConsumedNote } from '../../src/scheduler.js';
import { tick } from '../../src/scheduler-engine.js';
import { FixedClock } from '../../src/clock.js';
import { ERROR_CATALOG } from '../../src/errors.js';
import type { RefusalReason } from '../../src/types.js';

function makePort(clock: FixedClock) {
  return new SqliteSchedulerPort({
    clock,
    catalog: { resolve: async () => ({ ok: true, value: { script: '', version: 'v1' } }) } as never,
    runManager: { start: async () => ({ runId: 'r1' }) } as never,
    dbPath: ':memory:',
  });
}

describe('scheduler refusal accounting (UT-151, DES-150)', () => {
  it('TWO ticks at the same instant refuse (once) ⇒ refusalCount === 1 [the tight-loop trap]', async () => {
    const clock = new FixedClock(new Date('2026-01-01T00:00:00Z'));
    const port = makePort(clock);
    const created = await port.create({ kind: 'once', workflow: 'wf-a', at: '2026-01-01T00:00:00Z', enabled: true });
    const id = (created as { result: { id: string } }).result.id;
    // [v29, REQ-152] The INVARIANT is unchanged — two ticks at one due instant must produce ONE
    // refusal. What changed is where it is enforced, so this test now drives the real two-tick
    // path instead of calling the writer twice directly. The old form bypassed `tick()` on purpose
    // to exercise an in-writer guard (`AND enabled = 1`); that guard has been removed because it
    // asked "am I the one who consumed this firing?" — false once `claimFiring()` consumes it
    // before dispatch, which made the writer silently stop recording the refusal at all.
    // Driving both ticks is strictly the stronger test: it exercises the path production takes.
    for (let t = 0; t < 2; t += 1) {
      for (const f of tick(port.all(), clock.now())) {
        if (!port.claimFiring(f)) continue;
        port.markRefused(f, 'UNCLAIMED');
      }
    }
    const status = (await port.list()).find((s: { id: string }) => s.id === id);
    expect(status?.refusalCount).toBe(1);
    expect(status?.enabled).toBe(false);
  });

  it('TWO ticks at the same instant refuse (cron) ⇒ refusalCount === 1 AND nextFire advances past now [the tight-loop trap]', async () => {
    const clock = new FixedClock(new Date('2026-01-01T00:00:00Z'));
    const port = makePort(clock);
    const created = await port.create({ kind: 'cron', workflow: 'wf-a', cron: '0 0 * * *', enabled: true });
    const id = (created as { result: { id: string } }).result.id;
    for (let t = 0; t < 2; t += 1) {
      for (const f of tick(port.all(), clock.now())) {
        if (!port.claimFiring(f)) continue;
        port.markRefused(f, 'UNCLAIMED');
      }
    }
    const status = (await port.list()).find((s: { id: string }) => s.id === id);
    expect(status?.refusalCount).toBe(1);
    // the advance is the CLAIM's now, not the refusal's — the observable fact is unchanged
    expect(new Date(status!.nextFire!).getTime()).toBeGreaterThan(clock.now());
  });

  it('refuse x3 then markFired ⇒ refusalCount resets to 0', async () => {
    const clock = new FixedClock(new Date('2026-01-01T00:00:00Z'));
    const port = makePort(clock);
    const created = await port.create({ kind: 'cron', workflow: 'wf-a', cron: '0 0 * * *', enabled: true });
    const firing = { kind: 'cron' as const, id: (created as { result: { id: string } }).result.id };
    port.markRefused(firing, 'UNCLAIMED');
    port.markRefused(firing, 'UNCLAIMED');
    port.markRefused(firing, 'UNCLAIMED');
    port.markFired(firing, 'run-x');
    const status = (await port.list()).find((s: { id: string }) => s.id === firing.id);
    expect(status?.refusalCount).toBe(0);
  });

  // LOW-4 (owner decision 2026-10-02, verify-k): a stale `lastRefusalReason`/`lastRefusedAt` must
  // not survive a LATER successful fire — before this fix only `refusalCount` reset to 0, so
  // `schedule_list` kept showing e.g. CHANNEL_UNPUBLISHED (and its derived `lastRefusalMessage`)
  // from the earlier refused instant even once the schedule had since fired for real.
  it('markFired clears a prior refusal (lastRefusedAt/lastRefusalReason/lastRefusalMessage), not just refusalCount', async () => {
    const clock = new FixedClock(new Date('2026-01-01T00:00:00Z'));
    const port = makePort(clock);
    const created = await port.create({ kind: 'cron', workflow: 'wf-a', cron: '0 0 * * *', enabled: true });
    const firing = { kind: 'cron' as const, id: (created as { result: { id: string } }).result.id };
    port.markRefused(firing, 'CHANNEL_UNPUBLISHED');
    port.markFired(firing, 'run-x');
    const status = (await port.list()).find((s: { id: string }) => s.id === firing.id);
    expect(status?.lastRefusedAt).toBeUndefined();
    expect(status?.lastRefusalReason).toBeUndefined();
    expect(status?.lastRefusalMessage).toBeUndefined();
    expect(status?.lastRunId).toBe('run-x');
  });

  // LOW-4: same clearing for a prior DISPATCH failure's `lastError` — the exact scenario verify-k
  // found (a cron's DISK_LOW `lastError` from an earlier low-disk window stayed visible, reading
  // "retry later" from a timestamp before the floor lifted, even after it had since re-fired).
  it('markFired clears a prior dispatch failure (lastError), not just refusalCount', async () => {
    const clock = new FixedClock(new Date('2026-01-01T00:00:00Z'));
    const port = makePort(clock);
    const created = await port.create({ kind: 'cron', workflow: 'wf-a', cron: '0 0 * * *', enabled: true });
    const firing = { kind: 'cron' as const, id: (created as { result: { id: string } }).result.id };
    port.markFailed(firing, 'DISK_LOW');
    port.markFired(firing, 'run-y');
    const status = (await port.list()).find((s: { id: string }) => s.id === firing.id);
    expect(status?.lastError).toBeUndefined();
    expect(status?.lastRunId).toBe('run-y');
  });

  it('a refused `once` is consumed — claiming it later does not resurrect it', async () => {
    const clock = new FixedClock(new Date('2026-01-01T00:00:00Z'));
    const port = makePort(clock);
    const created = await port.create({ kind: 'once', workflow: 'wf-a', at: '2026-01-01T00:00:00Z', enabled: true });
    const firing = { kind: 'once' as const, id: (created as { result: { id: string } }).result.id };
    port.markRefused(firing, 'UNCLAIMED');
    const status = (await port.list()).find((s: { id: string }) => s.id === firing.id);
    expect(status?.enabled).toBe(false);
  });

  it('lastError stays untouched by a refusal — lastError=dispatch failure, lastRefusalReason=policy refusal, never both', async () => {
    const clock = new FixedClock(new Date('2026-01-01T00:00:00Z'));
    const port = makePort(clock);
    const created = await port.create({ kind: 'once', workflow: 'wf-a', at: '2026-01-01T00:00:00Z', enabled: true });
    const firing = { kind: 'once' as const, id: (created as { result: { id: string } }).result.id };
    port.markRefused(firing, 'CHANNEL_UNPUBLISHED');
    const status = (await port.list()).find((s: { id: string }) => s.id === firing.id);
    expect(status?.lastError).toBeUndefined();
    expect(status?.lastRefusalReason).toBe('CHANNEL_UNPUBLISHED');
  });

  const reasons: RefusalReason[] = ['UNCLAIMED', 'CLAIMED_WORKFLOW_MISSING', 'NOT_IN_RELEASE', 'CHANNEL_UNPUBLISHED'];
  it.each(reasons)('records reason %s verbatim on lastRefusalReason', async (reason) => {
    const clock = new FixedClock(new Date('2026-01-01T00:00:00Z'));
    const port = makePort(clock);
    const created = await port.create({ kind: 'once', workflow: 'wf-a', at: '2026-01-01T00:00:00Z', enabled: true });
    const firing = { kind: 'once' as const, id: (created as { result: { id: string } }).result.id };
    port.markRefused(firing, reason);
    const status = (await port.list()).find((s: { id: string }) => s.id === firing.id);
    expect(status?.lastRefusalReason).toBe(reason);
    expect(status?.refusalCount).toBe(1);
  });

  // Owner decision (schedule/webhook refusal message visibility): a consumed-by-refusal `once`
  // trigger must be readable from `schedule_list` alone — `enabled:false` plus `lastRefusalReason`
  // WITH a human-readable `lastRefusalMessage` (the same static `ERROR_CATALOG` hint, never a raw
  // internal string), not just the bare machine code.
  // MEDIUM-1 (owner decision 2026-10-02, verify-k): a `once` row's lastRefusalMessage is the
  // catalogued hint PLUS the once-consumed note — the row is disabled by this SAME call
  // (`markRefused`'s `once` branch), so it will never get a chance to act on the bare hint alone.
  it.each(reasons)('lastRefusalMessage carries the catalogued hint PLUS the once-consumed note for reason %s', async (reason) => {
    const clock = new FixedClock(new Date('2026-01-01T00:00:00Z'));
    const port = makePort(clock);
    const created = await port.create({ kind: 'once', workflow: 'wf-a', at: '2026-01-01T00:00:00Z', enabled: true });
    const firing = { kind: 'once' as const, id: (created as { result: { id: string } }).result.id };
    port.markRefused(firing, reason);
    const status = (await port.list()).find((s: { id: string }) => s.id === firing.id);
    expect(status?.lastRefusalMessage).toBe(`${ERROR_CATALOG[reason].hint} — ${onceConsumedNote('refused')}`);
  });

  it('a consumed-by-refusal once trigger is unambiguous from schedule_list alone: enabled:false + reason + message', async () => {
    const clock = new FixedClock(new Date('2026-01-01T00:00:00Z'));
    const port = makePort(clock);
    const created = await port.create({ kind: 'once', workflow: 'wf-a', at: '2026-01-01T00:00:00Z', enabled: true });
    const firing = { kind: 'once' as const, id: (created as { result: { id: string } }).result.id };
    port.markRefused(firing, 'CHANNEL_UNPUBLISHED');
    const status = (await port.list()).find((s: { id: string }) => s.id === firing.id);
    expect(status?.enabled).toBe(false);
    expect(status?.lastRefusalReason).toBe('CHANNEL_UNPUBLISHED');
    expect(status?.lastRefusalMessage).toBe(`${ERROR_CATALOG.CHANNEL_UNPUBLISHED.hint} — ${onceConsumedNote('refused')}`);
  });

  // MEDIUM-1: a cron row's lastRefusalMessage stays the BARE catalog hint — a cron keeps firing
  // (markRefused's cron branch never disables it), so "retry later"-shaped hints stay literally true.
  it('lastRefusalMessage stays the bare catalogued hint for a cron row (never the once-consumed note)', async () => {
    const clock = new FixedClock(new Date('2026-01-01T00:00:00Z'));
    const port = makePort(clock);
    const created = await port.create({ kind: 'cron', workflow: 'wf-a', cron: '0 0 * * *', enabled: true });
    const firing = { kind: 'cron' as const, id: (created as { result: { id: string } }).result.id };
    port.markRefused(firing, 'CHANNEL_UNPUBLISHED');
    const status = (await port.list()).find((s: { id: string }) => s.id === firing.id);
    expect(status?.lastRefusalMessage).toBe(ERROR_CATALOG.CHANNEL_UNPUBLISHED.hint);
  });

  it('lastRefusedAt is stamped from the injected Clock, not the wall clock', async () => {
    const clock = new FixedClock(new Date('2026-01-01T00:00:00Z'));
    const port = makePort(clock);
    const created = await port.create({ kind: 'once', workflow: 'wf-a', at: '2026-01-01T00:00:00Z', enabled: true });
    const firing = { kind: 'once' as const, id: (created as { result: { id: string } }).result.id };
    port.markRefused(firing, 'UNCLAIMED');
    const status = (await port.list()).find((s: { id: string }) => s.id === firing.id);
    expect(status?.lastRefusedAt).toBe(clock.isoNow());
  });

  it('markFired after zero refusals leaves refusalCount at 0 (no spurious decrement)', async () => {
    const clock = new FixedClock(new Date('2026-01-01T00:00:00Z'));
    const port = makePort(clock);
    const created = await port.create({ kind: 'once', workflow: 'wf-a', at: '2026-01-01T00:00:00Z', enabled: true });
    const firing = { kind: 'once' as const, id: (created as { result: { id: string } }).result.id };
    port.markFired(firing, 'run-y');
    const status = (await port.list()).find((s: { id: string }) => s.id === firing.id);
    expect(status?.refusalCount).toBe(0);
  });
});
