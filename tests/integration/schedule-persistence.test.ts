// IT-031: Schedule SQLite persistence survives across SqliteSchedulerPort instances (DES-016, ARCH-010)
// RED: src/scheduler.js does not exist yet — all tests fail on module-not-found.
// Mirrors IT-012's (catalog-persistence.test.ts) "new instance same on-disk dir" pattern.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FixedClock } from '../../src/clock.js';
// Value import — causes module-not-found at load time when module is absent.
import { SqliteSchedulerPort } from '../../src/scheduler.js';

let tmpDir: string;

beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), 'rwe-sched-')); });
afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

const CLOCK = new FixedClock(new Date('2020-09-01T00:00:00.000Z'));

// v22 (DES-111): CatalogPort shrank to the existence-only shape scheduler.ts actually needs.
// v22 send-back (H4, 07-review.md §4.2): `create()` now also calls `resolve()` (the release-channel
// check) — this fake always resolves so these persistence-only cases are unaffected.
function makeFakeCatalog() {
  return { exists: async (_n: string) => true, resolve: async (_n: string) => ({ script: '', version: 'v1' }) };
}
function makeFakeRunManager() {
  return { start: async () => 'run-1' };
}

describe('SqliteSchedulerPort persistence (DES-016, ARCH-010)', () => {
  it('a schedule created by one instance is visible from a second instance on the same dbPath', async () => {
    const dbPath = join(tmpDir, 'schedules.db');
    const port1 = new SqliteSchedulerPort({ clock: CLOCK, catalog: makeFakeCatalog(), runManager: makeFakeRunManager(), dbPath });
    await port1.create({ kind: 'resident', workflow: 'wf-a', enabled: true });

    // Simulate a restart: fresh instance, same dbPath.
    const port2 = new SqliteSchedulerPort({ clock: CLOCK, catalog: makeFakeCatalog(), runManager: makeFakeRunManager(), dbPath });
    const list = await port2.list();
    expect(list.some((s) => s.workflow === 'wf-a')).toBe(true);
  });

  it('schedule enabled-state changes persist across instances', async () => {
    const dbPath = join(tmpDir, 'schedules.db');
    const port1 = new SqliteSchedulerPort({ clock: CLOCK, catalog: makeFakeCatalog(), runManager: makeFakeRunManager(), dbPath });
    const r = await port1.create({ kind: 'resident', workflow: 'wf-b', enabled: true });
    const id = r.result!.id;
    await port1.setEnabled(id, false);

    const port2 = new SqliteSchedulerPort({ clock: CLOCK, catalog: makeFakeCatalog(), runManager: makeFakeRunManager(), dbPath });
    const list = await port2.list();
    expect(list.find((s) => s.id === id)?.enabled).toBe(false);
  });

  it('a deleted schedule is not visible from a second instance', async () => {
    const dbPath = join(tmpDir, 'schedules.db');
    const port1 = new SqliteSchedulerPort({ clock: CLOCK, catalog: makeFakeCatalog(), runManager: makeFakeRunManager(), dbPath });
    const r = await port1.create({ kind: 'cron', workflow: 'wf-c', cron: '0 * * * *', enabled: true });
    const id = r.result!.id;
    await port1.delete(id);

    const port2 = new SqliteSchedulerPort({ clock: CLOCK, catalog: makeFakeCatalog(), runManager: makeFakeRunManager(), dbPath });
    const list = await port2.list();
    expect(list.find((s) => s.id === id)).toBeUndefined();
  });
});
