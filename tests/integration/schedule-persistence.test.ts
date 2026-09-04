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

// Gate 6.5+7 round 2 (verifier): `rearmAtBoot` was 7/17 lines — every test that constructed a
// SqliteSchedulerPort took the `rows.length === 0` early return, so the re-derive-and-persist body
// (the whole point of the method, and what `server.ts:634` calls at every boot) ran nowhere.
describe('SqliteSchedulerPort.rearmAtBoot (DES-017, D-V2I-2)', () => {
  it('re-derives nextFire for persisted cron and once schedules from the injected clock and persists it', async () => {
    const dbPath = join(tmpDir, 'rearm.db');
    const bootClock = new FixedClock(new Date('2020-09-01T00:00:00.000Z'));
    const port1 = new SqliteSchedulerPort({ clock: bootClock, catalog: makeFakeCatalog(), runManager: makeFakeRunManager(), dbPath });
    await port1.create({ kind: 'cron', workflow: 'wf-cron', cron: '0 3 * * *', enabled: true, args: { a: 1 } });
    await port1.create({ kind: 'once', workflow: 'wf-once', at: '2020-09-02T00:00:00.000Z', enabled: true });
    await port1.create({ kind: 'resident', workflow: 'wf-res', enabled: true });

    // "Restart" a YEAR later: a fresh instance whose clock has moved on re-arms from ITS clock.
    const laterClock = new FixedClock(new Date('2021-09-01T00:00:00.000Z'));
    const port2 = new SqliteSchedulerPort({ clock: laterClock, catalog: makeFakeCatalog(), runManager: makeFakeRunManager(), dbPath });
    port2.rearmAtBoot();

    const byWorkflow = Object.fromEntries((await port2.list()).map((s) => [s.workflow, s]));
    // cron: a fresh future nextFire derived from the LATER clock, not the stored 2020 one.
    expect(Date.parse(byWorkflow['wf-cron']!.nextFire!)).toBeGreaterThan(laterClock.now());
    // once: still due at its own `at` — a restart must not lose a one-shot whose moment has passed.
    expect(byWorkflow['wf-once']!.nextFire).toBe('2020-09-02T00:00:00.000Z');
    // resident: never on a clock, so `rearmAtBoot` writes nothing for it.
    expect(byWorkflow['wf-res']!.nextFire).toBeUndefined();
  });

  it('is a no-op on an empty store (the early return) and on a store holding only UNCLAIMED triggers', async () => {
    const dbPath = join(tmpDir, 'rearm-empty.db');
    const port = new SqliteSchedulerPort({ clock: CLOCK, catalog: makeFakeCatalog(), runManager: makeFakeRunManager(), dbPath });
    expect(() => port.rearmAtBoot()).not.toThrow();
    await port.create({ kind: 'cron', cron: '0 3 * * *', enabled: true }); // no workflow ⇒ unclaimed
    expect(() => port.rearmAtBoot()).not.toThrow();
  });
});

