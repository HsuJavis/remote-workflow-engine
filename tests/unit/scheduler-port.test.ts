// UT-027: SchedulerPort CRUD + workflow_trigger (DES-016, TASK-019)
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

  it('create with unknown workflow name returns an ErrEnvelope', async () => {
    const port = new SqliteSchedulerPort({
      clock: CLOCK,
      catalog: makeFakeCatalog(['my-workflow']),
      runManager: makeFakeRunManager(),
      dbPath: ':memory:',
    });
    const result = await port.create({
      kind: 'cron', workflow: 'does-not-exist', cron: '* * * * *', enabled: true,
    });
    expect(result.error).toBeDefined();
    expect(result.error?.code).toMatch(/NOT_FOUND|UNKNOWN/i);
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
    await port.create({ kind: 'resident', workflow: 'my-workflow', enabled: true });
    const result = await port.trigger('my-workflow', { x: 1 });
    expect(result.error).toBeUndefined();
    expect(result.result?.runId).toBe('run-abc');
    expect(mgr.start).toHaveBeenCalledOnce();
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
