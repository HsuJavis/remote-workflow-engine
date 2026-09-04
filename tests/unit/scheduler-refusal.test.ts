// UT-151 (DES-150, v24): markRefused shares markFailed's advance; markFired resets refusalCount.
// Written test-first (Gate 5, RED) — SqliteSchedulerPort has no markRefused method and markFired's
// UPDATE does not touch any refusalCount column (the column doesn't exist yet).
// Mock policy: real SqliteSchedulerPort over :memory:, FixedClock (hermetic, no wall-clock reads).
import { describe, it, expect } from 'vitest';
import { SqliteSchedulerPort } from '../../src/scheduler.js';
import { FixedClock } from '../../src/clock.js';

function makePort(clock: FixedClock) {
  return new SqliteSchedulerPort({
    clock,
    catalog: { resolve: async () => ({ ok: true, value: { script: '', version: 'v1' } }) } as never,
    runManager: { start: async () => ({ runId: 'r1' }) } as never,
    dbPath: ':memory:',
  });
}

describe('scheduler refusal accounting (UT-151, DES-150)', () => {
  it('TWO ticks at the same instant refuse ⇒ refusalCount === 1 AND nextFire advances past now [the tight-loop trap]', async () => {
    const clock = new FixedClock(new Date('2026-01-01T00:00:00Z'));
    const port = makePort(clock);
    const created = await port.create({ kind: 'once', workflow: 'wf-a', at: '2026-01-01T00:00:00Z' } as never);
    const firing = { kind: 'once' as const, id: (created as { result: { id: string } }).result.id };
    port.markRefused(firing, 'UNCLAIMED');
    port.markRefused(firing, 'UNCLAIMED');
    const status = (await port.list()).find((s: { id: string }) => s.id === firing.id);
    expect(status?.refusalCount).toBe(1);
    expect(new Date(status!.nextFire!).getTime()).toBeGreaterThan(clock.now());
  });

  it('refuse x3 then markFired ⇒ refusalCount resets to 0', async () => {
    const clock = new FixedClock(new Date('2026-01-01T00:00:00Z'));
    const port = makePort(clock);
    const created = await port.create({ kind: 'cron', workflow: 'wf-a', cron: '0 0 * * *' } as never);
    const firing = { kind: 'cron' as const, id: (created as { result: { id: string } }).result.id };
    port.markRefused(firing, 'UNCLAIMED');
    port.markRefused(firing, 'UNCLAIMED');
    port.markRefused(firing, 'UNCLAIMED');
    port.markFired(firing, 'run-x');
    const status = (await port.list()).find((s: { id: string }) => s.id === firing.id);
    expect(status?.refusalCount).toBe(0);
  });

  it('a refused `once` is consumed — claiming it later does not resurrect it', async () => {
    const clock = new FixedClock(new Date('2026-01-01T00:00:00Z'));
    const port = makePort(clock);
    const created = await port.create({ kind: 'once', workflow: 'wf-a', at: '2026-01-01T00:00:00Z' } as never);
    const firing = { kind: 'once' as const, id: (created as { result: { id: string } }).result.id };
    port.markRefused(firing, 'UNCLAIMED');
    const status = (await port.list()).find((s: { id: string }) => s.id === firing.id);
    expect(status?.enabled).toBe(false);
  });

  it('lastError stays untouched by a refusal — lastError=dispatch failure, lastRefusalReason=policy refusal, never both', async () => {
    const clock = new FixedClock(new Date('2026-01-01T00:00:00Z'));
    const port = makePort(clock);
    const created = await port.create({ kind: 'once', workflow: 'wf-a', at: '2026-01-01T00:00:00Z' } as never);
    const firing = { kind: 'once' as const, id: (created as { result: { id: string } }).result.id };
    port.markRefused(firing, 'CHANNEL_UNPUBLISHED');
    const status = (await port.list()).find((s: { id: string }) => s.id === firing.id);
    expect(status?.lastError).toBeUndefined();
    expect(status?.lastRefusalReason).toBe('CHANNEL_UNPUBLISHED');
  });
});
