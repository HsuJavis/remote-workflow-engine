// UT-027: SchedulerPort CRUD + the port-level trigger() (DES-016, TASK-019). v24 (TASK-152,
// ARCH-087): the MCP tool that used to expose this as a manual "fire now" call is retired with no
// replacement (ch.16.1) — `SqliteSchedulerPort.trigger()` itself is unchanged internal plumbing
// (`scheduler.ts:280`), still exercised directly at this unit tier.
// RED: src/scheduler.js does not exist yet — all tests fail on module-not-found.
import { describe, it, expect, vi } from 'vitest';
import { FixedClock } from '../../src/clock.js';
// Value import — causes module-not-found at load time when module is absent.
import { SqliteSchedulerPort } from '../../src/scheduler.js';
import { CatalogNotFoundError } from '../../src/errors.js';

const CLOCK = new FixedClock(new Date('2020-03-01T10:00:00.000Z'));

// Minimal fake RunManager: only RunManager.start needs to be callable.
function makeFakeRunManager() {
  return { start: vi.fn().mockResolvedValue('run-abc') };
}

// Minimal fake WorkflowCatalog: exists(name) resolves true/false (v22, DES-111 — CatalogPort shrank
// to the existence-only shape scheduler.ts actually needs).
// v22 send-back (H4, 07-review.md §4.2): `create()` now also calls `resolve()` (the release-channel
// check) — mirrors `exists`'s membership check so these CRUD-shape cases are unaffected.
function makeFakeCatalog(names: string[] = ['my-workflow']) {
  return {
    exists: vi.fn().mockImplementation(async (n: string) => names.includes(n)),
    resolve: vi.fn().mockImplementation(async (n: string) => {
      if (!names.includes(n)) throw new CatalogNotFoundError(n);
      return { script: '', version: 'v1' };
    }),
  };
}

describe('SchedulerPort CRUD (DES-016)', () => {
  it('create a cron schedule returns a ResultEnvelope with the new Schedule', async () => {
    const port = new SqliteSchedulerPort({
      clock: CLOCK,
      catalog: makeFakeCatalog(),
      runManager: makeFakeRunManager(),
      dbPath: ':memory:',
    });
    const result = await port.create({
      kind: 'cron', workflow: 'my-workflow', cron: '0 3 * * *', enabled: true,
    });
    expect(result.error).toBeUndefined();
    expect(result.result?.id).toBeTruthy();
    expect(result.result?.kind).toBe('cron');
  });

  it('create with an invalid cron expression returns an ErrEnvelope with field', async () => {
    const port = new SqliteSchedulerPort({
      clock: CLOCK,
      catalog: makeFakeCatalog(),
      runManager: makeFakeRunManager(),
      dbPath: ':memory:',
    });
    const result = await port.create({
      kind: 'cron', workflow: 'my-workflow', cron: 'NOT_A_CRON', enabled: true,
    });
    expect(result.error).toBeDefined();
    expect(result.error?.code).toMatch(/INVALID|PARSE/i);
    expect(result.error?.field).toBe('cron');
  });

  // issue #92 item 1: create()'s OWN reproduction strings. Pre-fix, both escaped as a raw JSON-RPC
  // -32000 / a raw thrown Error rather than a tool-result ErrEnvelope — this asserts `create()`
  // returns a normal `{ error }` result (never throws) with the catalogued code.
  it('create with an out-of-range field (99 99 * * *, issue #92\'s own repro) returns INVALID_CRON, not a raw throw', async () => {
    const port = new SqliteSchedulerPort({
      clock: CLOCK, catalog: makeFakeCatalog(), runManager: makeFakeRunManager(), dbPath: ':memory:',
    });
    const result = await port.create({ kind: 'cron', cron: '99 99 * * *', enabled: true });
    expect(result.error?.code).toBe('INVALID_CRON');
    expect(result.error?.field).toBe('cron');
    expect(result.result).toBeUndefined();
  });

  it('create with a cron that can never fire (0 0 31 2 * — Feb 31) returns INVALID_CRON, not a raw throw', async () => {
    const port = new SqliteSchedulerPort({
      clock: CLOCK, catalog: makeFakeCatalog(), runManager: makeFakeRunManager(), dbPath: ':memory:',
    });
    const result = await port.create({ kind: 'cron', cron: '0 0 31 2 *', enabled: true });
    expect(result.error?.code).toBe('INVALID_CRON');
    expect(result.error?.field).toBe('cron');
    // Genuinely impossible on ANY calendar date (no Feb 31 ever exists) — "never fires" is accurate here.
    expect(result.error?.message).toMatch(/never fires/i);
  });

  // issue: send-back item 5 (verify-b, 2026-09-26) — a cron that is NOT analytically impossible
  // (the date exists) but just doesn't recur within `computeNextFire`'s bounded 4-year search
  // horizon gets a message naming that actual limitation, never "never fires" (which overclaims).
  //
  // issue #99: `0 0 29 2 1` (this test's ORIGINAL repro, Feb 29 ANDed with Monday) is no longer such
  // a case — day-of-month (`29`) and day-of-week (`1`) are both "restricted" (neither starts with
  // `*`), so standard Vixie/POSIX semantics now OR them, and it resolves fine (next Monday in
  // February). The horizon-exceeded case now needs a day-of-week field that still starts with `*`
  // — counted "unrestricted" by the Vixie rule even though a step narrows it to one weekday — to
  // stay ANDed with a rare day-of-month: `0 0 29 2 */7` (day-of-week "star step 7" is the single
  // value Sunday, syntactically starred so it stays AND-mode with day-of-month 29 in February).
  it('create with a cron outside the bounded search horizon but not analytically impossible (0 0 29 2 */7 — Feb 29 AND the one weekday a star-prefixed step selects) does not overclaim "never fires"', async () => {
    const port = new SqliteSchedulerPort({
      clock: CLOCK, catalog: makeFakeCatalog(), runManager: makeFakeRunManager(), dbPath: ':memory:',
    });
    const result = await port.create({ kind: 'cron', cron: '0 0 29 2 */7', enabled: true });
    expect(result.error?.code).toBe('INVALID_CRON');
    expect(result.error?.field).toBe('cron');
    expect(result.error?.message).toMatch(/does not fire within the next 4 years \(search horizon\)/i);
    expect(result.error?.message).not.toMatch(/never fires/i);
  });

  // issue #99: the flip side of the above — `0 0 29 2 1` used to be this file's horizon-exceeded
  // repro; now that day-of-month and day-of-week OR (both restricted), it creates successfully.
  it('create with 0 0 29 2 1 (Feb 29 OR Monday, issue #99) now succeeds — no longer horizon-exceeded', async () => {
    const port = new SqliteSchedulerPort({
      clock: CLOCK, catalog: makeFakeCatalog(), runManager: makeFakeRunManager(), dbPath: ':memory:',
    });
    const result = await port.create({ kind: 'cron', cron: '0 0 29 2 1', enabled: true });
    expect(result.error).toBeUndefined();
    expect(result.result?.kind).toBe('cron');
  });

  it('create with a step of 0 (*/0 * * * *) returns INVALID_CRON fast — the freeze this closes', async () => {
    const port = new SqliteSchedulerPort({
      clock: CLOCK, catalog: makeFakeCatalog(), runManager: makeFakeRunManager(), dbPath: ':memory:',
    });
    const start = Date.now();
    const result = await port.create({ kind: 'cron', cron: '*/0 * * * *', enabled: true });
    expect(Date.now() - start).toBeLessThan(500);
    expect(result.error?.code).toBe('INVALID_CRON');
  });

  // v24 Gate 7.5 (D-1, REQ-115's last clause): `create()` no longer resolves the catalog. A
  // trigger is created FIRST and claimed by a workflow at registration, so a name that does not
  // exist yet is the NORMAL case here; the verdict moved to the FIRE path, which refuses
  // CLAIMED_WORKFLOW_MISSING and records it (IT-093, VAL-016). The ARGUMENT validation this file
  // is really about — cron/at shape — is unchanged and still refuses before any row is written.
  it('create with an unknown workflow name is ACCEPTED — the catalog check moved to the fire path', async () => {
    const port = new SqliteSchedulerPort({
      clock: CLOCK,
      catalog: makeFakeCatalog(['my-workflow']),
      runManager: makeFakeRunManager(),
      dbPath: ':memory:',
    });
    const result = await port.create({
      kind: 'cron', workflow: 'does-not-exist', cron: '* * * * *', enabled: true,
    });
    expect(result.error).toBeUndefined();
    expect(result.result?.id).toBeTruthy();
  });

  it('create with NO workflow at all is accepted and the row is unclaimed (REQ-115 clause 1)', async () => {
    const port = new SqliteSchedulerPort({
      clock: CLOCK,
      catalog: makeFakeCatalog(),
      runManager: makeFakeRunManager(),
      dbPath: ':memory:',
    });
    const result = await port.create({ kind: 'cron', cron: '* * * * *', enabled: true });
    expect(result.error).toBeUndefined();
    expect(result.result?.claimedBy ?? null).toBeNull();
  });

  it('list returns all created schedules', async () => {
    const port = new SqliteSchedulerPort({
      clock: CLOCK,
      catalog: makeFakeCatalog(),
      runManager: makeFakeRunManager(),
      dbPath: ':memory:',
    });
    await port.create({ kind: 'cron', workflow: 'my-workflow', cron: '* * * * *', enabled: true });
    await port.create({ kind: 'resident', workflow: 'my-workflow', enabled: true });
    const list = await port.list();
    expect(list.length).toBe(2);
  });

  it('delete removes the schedule from list', async () => {
    const port = new SqliteSchedulerPort({
      clock: CLOCK,
      catalog: makeFakeCatalog(),
      runManager: makeFakeRunManager(),
      dbPath: ':memory:',
    });
    const r = await port.create({ kind: 'resident', workflow: 'my-workflow', enabled: true });
    const id = r.result!.id;
    await port.delete(id);
    const list = await port.list();
    expect(list.find((s) => s.id === id)).toBeUndefined();
  });

  it('trigger on an enabled resident calls RunManager.start and returns runId', async () => {
    const mgr = makeFakeRunManager();
    const port = new SqliteSchedulerPort({
      clock: CLOCK,
      catalog: makeFakeCatalog(),
      runManager: mgr,
      dbPath: ':memory:',
    });
    const created = await port.create({ kind: 'resident', workflow: 'my-workflow', enabled: true });
    const result = await port.trigger('my-workflow', { x: 1 });
    expect(result.error).toBeUndefined();
    expect(result.result?.runId).toBe('run-abc');
    expect(mgr.start).toHaveBeenCalledOnce();
    // issue #103(d): startedBy.id must be the SCHEDULE id (like a webhook run carries the webhook
    // id), never the workflow name — the workflow name already travels as `name`/`run_origins`.
    expect(mgr.start).toHaveBeenCalledWith(expect.objectContaining({ startedBy: { type: 'schedule', id: created.result!.id } }));
  });

  it('trigger on a disabled resident returns SCHEDULE_DISABLED without starting a run', async () => {
    const mgr = makeFakeRunManager();
    const port = new SqliteSchedulerPort({
      clock: CLOCK,
      catalog: makeFakeCatalog(),
      runManager: mgr,
      dbPath: ':memory:',
    });
    await port.create({ kind: 'resident', workflow: 'my-workflow', enabled: false });
    const result = await port.trigger('my-workflow');
    expect(result.error?.code).toBe('SCHEDULE_DISABLED');
    expect(mgr.start).not.toHaveBeenCalled();
  });

  it('setEnabled flips the enabled flag', async () => {
    const port = new SqliteSchedulerPort({
      clock: CLOCK,
      catalog: makeFakeCatalog(),
      runManager: makeFakeRunManager(),
      dbPath: ':memory:',
    });
    const r = await port.create({ kind: 'resident', workflow: 'my-workflow', enabled: true });
    const id = r.result!.id;
    await port.setEnabled(id, false);
    const list = await port.list();
    expect(list.find((s) => s.id === id)?.enabled).toBe(false);
  });
});
