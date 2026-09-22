// v26 Gate 7.5 round 6, defect D13 (orchestrator-scoped; see 06-impl-log IMPL-218). The twin of
// `webhook-migration.test.ts`: SQLite cannot drop a NOT NULL constraint via ALTER, so an on-disk
// `schedules.db` created before v24 keeps `workflow TEXT NOT NULL` and `schedule_create` — which
// since REQ-115 inserts an UNCLAIMED trigger with `workflow = NULL` — fails on every upgraded
// deployment while succeeding on a fresh one.
//
// That asymmetry is exactly what let D13 through two iterations of tests: every existing scheduler
// test builds a FRESH database, where the CREATE TABLE already has the right shape. So this file
// never uses a fresh db as the subject — it hand-writes the two pre-migration shapes that actually
// exist in the wild:
//   * `seedPreV22Db`  — the original 11-column table (no `lastError`, no v24 claim columns).
//   * `seedUpgradedDb` — TODAY'S PRODUCTION SHAPE, dumped read-only from this box's own
//     `~/.local/share/rwe-data/schedules.db`: the 11 original columns plus the six ALTER-added ones
//     (`lastError`, `claimedBy`, `createdBy`, `refusalCount`, `lastRefusedAt`, `lastRefusalReason`)
//     — i.e. a database that HAS already booted v24+ code and still carries `workflow TEXT NOT NULL`.
//
// The load-bearing assertion is `PRAGMA table_info` deep-equality against a fresh database:
// "upgraded == fresh" is the invariant D13 broke, and asserting it directly is what makes this test
// catch the next such drift instead of the next validation round.
import { describe, it, expect, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FixedClock } from '../../src/clock.js';
import { SqliteSchedulerPort } from '../../src/scheduler.js';

const CLOCK = new FixedClock(new Date('2020-03-01T10:00:00.000Z'));

function makeDeps(dbPath: string) {
  return {
    clock: CLOCK,
    catalog: { exists: vi.fn().mockResolvedValue(true) },
    runManager: { start: vi.fn().mockResolvedValue('run-abc') },
    dbPath,
  };
}

type ColumnInfo = { cid: number; name: string; type: string; notnull: number; dflt_value: string | null; pk: number };

function tableInfo(dbPath: string, table = 'schedules'): ColumnInfo[] {
  const db = new Database(dbPath, { readonly: true });
  try {
    return db.prepare(`PRAGMA table_info(${table})`).all() as ColumnInfo[];
  } finally {
    db.close();
  }
}

function schemaSql(dbPath: string, table = 'schedules'): string {
  const db = new Database(dbPath, { readonly: true });
  try {
    return (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name = ?").get(table) as { sql: string }).sql;
  } finally {
    db.close();
  }
}

/** The 11-column original: what a workRoot created before v22 holds on disk. */
function seedPreV22Db(dbPath: string): void {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE schedules (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      workflow TEXT NOT NULL,
      argsJson TEXT,
      cron TEXT,
      tz TEXT,
      at TEXT,
      enabled INTEGER NOT NULL,
      nextFire INTEGER,
      lastFire TEXT,
      lastRunId TEXT
    );
    CREATE TABLE run_origins (
      runId TEXT PRIMARY KEY,
      scheduleId TEXT NOT NULL,
      kind TEXT NOT NULL
    );
  `);
  db.prepare('INSERT INTO schedules (id, kind, workflow, argsJson, cron, tz, at, enabled, nextFire, lastFire, lastRunId) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run('pre-v22-sched', 'cron', 'legacy-nightly', '{"a":1}', '0 3 * * *', 'Asia/Taipei', null, 1, 1735700000000, '2024-12-31T19:00:00.000Z', 'run-legacy');
  db.prepare('INSERT INTO run_origins (runId, scheduleId, kind) VALUES (?,?,?)').run('run-legacy', 'pre-v22-sched', 'cron');
  db.close();
}

/** THE PRODUCTION SHAPE (dumped read-only from this box, 2026-09-09): the 11 original columns plus
 *  the six columns the v22/v24 `ALTER … ADD COLUMN` migrations already added — and still
 *  `workflow TEXT NOT NULL`. Every v24 column on the seeded row carries a NON-DEFAULT value so
 *  that "the rebuild preserved the row" is a real assertion and not a check that NULLs stayed NULL. */
function seedUpgradedDb(dbPath: string): void {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE schedules (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      workflow TEXT NOT NULL,
      argsJson TEXT,
      cron TEXT,
      tz TEXT,
      at TEXT,
      enabled INTEGER NOT NULL,
      nextFire INTEGER,
      lastFire TEXT,
      lastRunId TEXT
    , lastError TEXT, claimedBy TEXT, createdBy TEXT, refusalCount INTEGER NOT NULL DEFAULT 0, lastRefusedAt TEXT, lastRefusalReason TEXT);
    CREATE TABLE run_origins (
      runId TEXT PRIMARY KEY,
      scheduleId TEXT NOT NULL,
      kind TEXT NOT NULL
    );
  `);
  db.prepare(`
    INSERT INTO schedules (id, kind, workflow, argsJson, cron, tz, at, enabled, nextFire, lastFire, lastRunId,
                           lastError, claimedBy, createdBy, refusalCount, lastRefusedAt, lastRefusalReason)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    'upgraded-sched', 'cron', 'legacy-nightly', '{"a":1}', '0 3 * * *', 'Asia/Taipei', null, 1, 1735700000000,
    '2024-12-31T19:00:00.000Z', 'run-legacy',
    '{"code":"DISPATCH_FAILED","at":"2025-01-01T00:00:00.000Z"}', 'legacy-nightly', 'principal-42', 3,
    '2025-01-02T00:00:00.000Z', 'UNCLAIMED',
  );
  db.prepare('INSERT INTO run_origins (runId, scheduleId, kind) VALUES (?,?,?)').run('run-legacy', 'upgraded-sched', 'cron');
  db.close();
}

describe('D13 — SqliteSchedulerPort rebuilds a stale `schedules.workflow NOT NULL` on an UPGRADED db', () => {
  let dir: string;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('the production shape accepts an unclaimed schedule_create (this is the D13 red)', async () => {
    dir = mkdtempSync(join(tmpdir(), 'rwe-sched-mig-'));
    const dbPath = join(dir, 'schedules.db');
    seedUpgradedDb(dbPath);

    const port = new SqliteSchedulerPort(makeDeps(dbPath));
    const created = await port.create({ kind: 'once', at: '2030-01-01T00:00:00.000Z', enabled: true });

    expect(created.error).toBeUndefined();
    expect(created.result?.workflow).toBeUndefined();
    expect(created.result?.claimedBy).toBeNull();
  });

  it.each([
    ['pre-v22 (11 columns)', seedPreV22Db],
    ['upgraded/production (17 columns, still NOT NULL)', seedUpgradedDb],
  ])('%s ends up with a table byte-shaped like a FRESH one (upgraded == fresh)', (_label, seed) => {
    dir = mkdtempSync(join(tmpdir(), 'rwe-sched-mig-'));
    const oldPath = join(dir, 'old.db');
    const freshPath = join(dir, 'fresh.db');
    seed(oldPath);

    new SqliteSchedulerPort(makeDeps(oldPath));
    new SqliteSchedulerPort(makeDeps(freshPath));

    // Column-for-column: name, declared type, nullability, DEFAULT and pk, in order. `refusalCount`
    // DEFAULT 0 is load-bearing — `create()`'s INSERT does not name that column (scheduler.ts:230).
    expect(tableInfo(oldPath)).toEqual(tableInfo(freshPath));
    expect(tableInfo(oldPath).find((c) => c.name === 'workflow')!.notnull).toBe(0);
  });

  it('every pre-existing row survives the rebuild with every column intact, run_origins included', () => {
    dir = mkdtempSync(join(tmpdir(), 'rwe-sched-mig-'));
    const dbPath = join(dir, 'schedules.db');
    seedUpgradedDb(dbPath);

    new SqliteSchedulerPort(makeDeps(dbPath));

    const db = new Database(dbPath, { readonly: true });
    const row = db.prepare('SELECT * FROM schedules WHERE id = ?').get('upgraded-sched');
    const origin = db.prepare('SELECT * FROM run_origins WHERE runId = ?').get('run-legacy');
    db.close();

    expect(row).toEqual({
      id: 'upgraded-sched', kind: 'cron', workflow: 'legacy-nightly', argsJson: '{"a":1}',
      cron: '0 3 * * *', tz: 'Asia/Taipei', at: null, enabled: 1, nextFire: 1735700000000,
      lastFire: '2024-12-31T19:00:00.000Z', lastRunId: 'run-legacy',
      lastError: '{"code":"DISPATCH_FAILED","at":"2025-01-01T00:00:00.000Z"}',
      claimedBy: 'legacy-nightly', createdBy: 'principal-42', refusalCount: 3,
      lastRefusedAt: '2025-01-02T00:00:00.000Z', lastRefusalReason: 'UNCLAIMED',
      // v37 (ARCH-182, DES-263, TASK-258): new idempotent ADD COLUMN — an upgraded row reads back
      // the DEFAULT (0/local), same idiom as every other additive column this test already covers.
      createdRemote: 0,
    });
    expect(origin).toEqual({ runId: 'run-legacy', scheduleId: 'upgraded-sched', kind: 'cron' });
  });

  it('is idempotent: opening the migrated db a second time neither throws nor duplicates a row', async () => {
    dir = mkdtempSync(join(tmpdir(), 'rwe-sched-mig-'));
    const dbPath = join(dir, 'schedules.db');
    seedUpgradedDb(dbPath);

    new SqliteSchedulerPort(makeDeps(dbPath));
    const afterFirst = schemaSql(dbPath);

    let second!: SqliteSchedulerPort;
    expect(() => { second = new SqliteSchedulerPort(makeDeps(dbPath)); }).not.toThrow();

    // A second rebuild would rewrite `sqlite_master.sql`; byte-identity proves the guard held.
    expect(schemaSql(dbPath)).toBe(afterFirst);
    expect((await second.list()).length).toBe(1);
    expect((await second.create({ kind: 'once', at: '2030-01-01T00:00:00.000Z', enabled: true })).error).toBeUndefined();
  });

  it('does not run at all on a database that is already correct', () => {
    dir = mkdtempSync(join(tmpdir(), 'rwe-sched-mig-'));
    const dbPath = join(dir, 'fresh.db');

    new SqliteSchedulerPort(makeDeps(dbPath));
    const fresh = schemaSql(dbPath);

    new SqliteSchedulerPort(makeDeps(dbPath));

    // SQLite stores the CREATE without `IF NOT EXISTS`, and a table produced by RENAME comes back
    // with its name QUOTED — so the unquoted form is itself the proof that no rebuild ever ran.
    expect(schemaSql(dbPath)).toBe(fresh);
    expect(fresh).toContain('CREATE TABLE schedules (');
  });
});
