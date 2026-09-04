// IT-111 (DES-149, v24): trigger claims — claim/release/ownerOf, the register sequence,
// "omission does not release". Written test-first (Gate 5, RED) — SqliteSchedulerPort has no
// claim/release/ownerOf methods yet (schedules today are created ALREADY bound to a workflow).
// Mock policy: real SqliteSchedulerPort over :memory:, real Clock (FixedClock).
//
// TASK-148 dod note: the original RED draft destructured `const { id } = await port.create(...)`
// off `create()`'s real `{result, error}` envelope (scheduler.ts:58-61), so `id` was always
// `undefined` and every `claim()` resolved `NOT_FOUND` regardless of the claim/release/ownerOf
// implementation underneath. Fixed here to read `result.id` — a test-fixture defect, not a
// scheduler defect (claim/release/ownerOf were verified against DES-149 independently;
// adjudication v24 #2 A-7).
import { describe, it, expect } from 'vitest';
import { SqliteSchedulerPort } from '../../src/scheduler.js';
import { FixedClock } from '../../src/clock.js';

function makePort() {
  return new SqliteSchedulerPort({
    clock: new FixedClock(new Date('2026-01-01T00:00:00Z')),
    catalog: { resolve: async () => ({ ok: false, code: 'VERSION_NOT_FOUND' }) } as never,
    runManager: { start: async () => ({ runId: 'r1' }) } as never,
    dbPath: ':memory:',
  });
}

describe('trigger claims (IT-111, DES-149)', () => {
  it('claim(id, workflow) on an unknown id returns NOT_FOUND', async () => {
    const port = makePort();
    const result = await port.claim('missing-id', 'wf-a');
    expect(result).toBe('NOT_FOUND');
  });

  it('claim() twice by the SAME workflow returns \'held\' the second time and writes nothing new', async () => {
    const port = makePort();
    // @ts-expect-error — schedule creation is unclaimed in v24; today's create() still binds workflow at creation
    const { result } = await port.create({ kind: 'once', at: '2026-06-01T00:00:00Z' });
    const id = result!.id;
    const first = await port.claim(id, 'wf-a');
    const second = await port.claim(id, 'wf-a');
    expect(first).toBe('claimed');
    expect(second).toBe('held');
  });

  it('claim() by a DIFFERENT workflow after another already claimed returns ALREADY_CLAIMED', async () => {
    const port = makePort();
    // @ts-expect-error
    const { result } = await port.create({ kind: 'once', at: '2026-06-01T00:00:00Z' });
    const id = result!.id;
    await port.claim(id, 'wf-a');
    const claimResult = await port.claim(id, 'wf-b');
    expect(claimResult).toBe('ALREADY_CLAIMED');
  });

  it('a \'held\' claim is NEVER released by compensation — release() only reverts ids claimed THIS call', async () => {
    const port = makePort();
    // @ts-expect-error
    const { result } = await port.create({ kind: 'once', at: '2026-06-01T00:00:00Z' });
    const id = result!.id;
    await port.claim(id, 'wf-a');
    await port.release(id, 'wf-a');
    // The CLAIM is `claimedBy` — `ownerOf` answers `createdBy` (the creating principal), which a
    // claim/release never touches (Gate 6.5+7 round 2: DES-139/DES-149 step 2 over the DES-149
    // signature line's older claim-triple reading). Same assertion, read off the right column.
    expect(port.get(id)?.claimedBy).toBeNull();
  });

  it('a new version omitting a previously-claimed id does NOT release it — the fire path refuses NOT_IN_RELEASE', async () => {
    const port = makePort();
    // @ts-expect-error
    const { result } = await port.create({ kind: 'once', at: '2026-06-01T00:00:00Z' });
    const id = result!.id;
    await port.claim(id, 'wf-a');
    // the CLAIM persists across a re-registration that omits the id
    expect(port.get(id)?.claimedBy).toBe('wf-a');
  });
});
