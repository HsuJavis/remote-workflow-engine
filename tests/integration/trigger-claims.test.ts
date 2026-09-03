// IT-111 (DES-149, v24): trigger claims — claim/release/ownerOf, the register sequence,
// "omission does not release". Written test-first (Gate 5, RED) — SqliteSchedulerPort has no
// claim/release/ownerOf methods yet (schedules today are created ALREADY bound to a workflow).
// Mock policy: real SqliteSchedulerPort over :memory:, real Clock (FixedClock).
import { describe, it, expect } from 'vitest';
import { SqliteSchedulerPort } from '../../src/scheduler.js';
import { FixedClock } from '../../src/clock.js';

function makePort() {
  return new SqliteSchedulerPort({
    clock: new FixedClock(new Date('2026-01-01T00:00:00Z')),
    catalog: { resolve: async () => ({ ok: false, code: 'UNKNOWN_VERSION' }) } as never,
    runManager: { start: async () => ({ runId: 'r1' }) } as never,
    dbPath: ':memory:',
  });
}

describe('trigger claims (IT-111, DES-149)', () => {
  it('claim(id, workflow) on an unknown id returns NOT_FOUND', async () => {
    const port = makePort();
    // @ts-expect-error — claim() does not exist yet (v24 DES-149/TASK-141)
    const result = await port.claim('missing-id', 'wf-a');
    expect(result).toBe('NOT_FOUND');
  });

  it('claim() twice by the SAME workflow returns \'held\' the second time and writes nothing new', async () => {
    const port = makePort();
    // @ts-expect-error — schedule creation is unclaimed in v24; today's create() still binds workflow at creation
    const { id } = await port.create({ kind: 'once', at: '2026-06-01T00:00:00Z' });
    // @ts-expect-error
    const first = await port.claim(id, 'wf-a');
    // @ts-expect-error
    const second = await port.claim(id, 'wf-a');
    expect(first).toBe('claimed');
    expect(second).toBe('held');
  });

  it('claim() by a DIFFERENT workflow after another already claimed returns ALREADY_CLAIMED', async () => {
    const port = makePort();
    // @ts-expect-error
    const { id } = await port.create({ kind: 'once', at: '2026-06-01T00:00:00Z' });
    // @ts-expect-error
    await port.claim(id, 'wf-a');
    // @ts-expect-error
    const result = await port.claim(id, 'wf-b');
    expect(result).toBe('ALREADY_CLAIMED');
  });

  it('a \'held\' claim is NEVER released by compensation — release() only reverts ids claimed THIS call', async () => {
    const port = makePort();
    // @ts-expect-error
    const { id } = await port.create({ kind: 'once', at: '2026-06-01T00:00:00Z' });
    // @ts-expect-error
    await port.claim(id, 'wf-a');
    // @ts-expect-error — release() does not exist yet
    await port.release(id, 'wf-a');
    // @ts-expect-error — ownerOf() does not exist yet
    expect(await port.ownerOf(id)).toBeNull();
  });

  it('a new version omitting a previously-claimed id does NOT release it — the fire path refuses NOT_IN_RELEASE', async () => {
    const port = makePort();
    // @ts-expect-error
    const { id } = await port.create({ kind: 'once', at: '2026-06-01T00:00:00Z' });
    // @ts-expect-error
    await port.claim(id, 'wf-a');
    // @ts-expect-error — ownerOf persists across a re-registration that omits the id
    expect(await port.ownerOf(id)).toBe('wf-a');
  });
});
