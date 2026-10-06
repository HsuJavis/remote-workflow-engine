// UT (issue #160 BUG-3): `computeNextFire`'s single catch in `SqliteSchedulerPort.create()`
// (scheduler.ts) was written for its own two documented failure modes (a semantically impossible
// calendar combination, or the 4-year search horizon exhausted) and unconditionally labels
// EVERY throw from it `{code:'INVALID_CRON', field:'cron'}`. But `computeNextFire` can also throw
// for a completely orthogonal reason — an invalid IANA `tz` — via `dtfFor`/`Intl.DateTimeFormat`
// inside `fieldsAt` (scheduler-engine.ts), which raises a RangeError whose message gets stitched
// into the "This cron never fires: <msg>" string. A bogus tz is then mislabeled as a cron problem,
// pointing the caller at the wrong field.
//
// Mock policy (unit, mirrors scheduler-refusal.test.ts): a real SqliteSchedulerPort over
// `:memory:`, FixedClock.
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

describe('schedule_create with an invalid tz (issue #160 BUG-3, UT)', () => {
  it('is refused with field:"tz" (never field:"cron") for a bogus IANA zone', async () => {
    const clock = new FixedClock(new Date('2026-01-01T00:00:00Z'));
    const port = makePort(clock);
    const created = await port.create({ kind: 'cron', workflow: 'wf-a', cron: '0 9 * * *', tz: 'Mars/Olympus_Mons', enabled: true });
    const result = created as { error?: { code: string; field?: string; message: string } };
    expect(result.error).toBeDefined();
    expect(result.error?.field).toBe('tz');
    expect(result.error?.code).not.toBe('INVALID_CRON');
  });

  it('a genuinely impossible cron combination (day 31 in February) still answers field:"cron"', async () => {
    const clock = new FixedClock(new Date('2026-01-01T00:00:00Z'));
    const port = makePort(clock);
    const created = await port.create({ kind: 'cron', workflow: 'wf-a', cron: '0 0 31 2 *', enabled: true });
    const result = created as { error?: { code: string; field?: string } };
    expect(result.error?.code).toBe('INVALID_CRON');
    expect(result.error?.field).toBe('cron');
  });
});
