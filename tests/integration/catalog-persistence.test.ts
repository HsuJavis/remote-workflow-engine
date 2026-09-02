// IT-012: WorkflowCatalog registrations persist to the on-disk SQLite DB and survive a fresh
// instance pointed at the same workRoot (ARCH-007, REQ-014, D-V2 — user-confirmed).
// Mirrors run-store-persistence.test.ts (IT-006)'s "new instance simulates restart" pattern.
//
// Red reason (2026-07-03, before Gate 6 rework): WorkflowCatalog (src/workflow-catalog.ts) keeps
// registrations in a private in-memory `Map` only — a new instance pointed at the same workRoot
// starts with an empty catalog, so `cat2.get('persist-flow')` throws CatalogNotFoundError.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { WorkflowCatalog } from '../../src/workflow-catalog.js';
import { FixedClock } from '../../src/clock.js';

const CLOCK = new FixedClock(new Date('2024-01-01T00:00:00Z'));

describe('WorkflowCatalog SQLite persistence (IT-012, D-V2)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rwe-catalog-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('a registration survives a new WorkflowCatalog instance on the same workRoot', async () => {
    const cat1 = new WorkflowCatalog(dir, CLOCK);
    const { version } = await cat1.register('persist-flow', `return 1;`);

    // New instance simulates a server restart against the same on-disk workRoot.
    // v22 (DES-111): get() is deleted — resolve() with an explicit {version} selector always
    // resolves regardless of publish/channel state (registration ≠ publication, REQ-097).
    const cat2 = new WorkflowCatalog(dir, CLOCK);
    const entry = await cat2.resolve('persist-flow', { version });
    expect(entry.script).toBe('return 1;');
    expect(entry.version).toBe(version);
  });

  it('list() on a fresh instance still shows a workflow registered by a prior instance', async () => {
    const cat1 = new WorkflowCatalog(dir, CLOCK);
    await cat1.register('persist-list', `return 2;`);

    const cat2 = new WorkflowCatalog(dir, CLOCK);
    const names = (await cat2.list()).map((e) => e.name);
    expect(names).toContain('persist-list');
  });

  // v21 (ARCH-067, DES-103, TASK-096): get() widened to return {script, version, defaults, params}
  // — today get() only SELECTs script+version (see workflow-catalog.ts:136-142), so `defaults` is
  // undefined even for a row registered WITH defaults (only getFull() sees it). This is the
  // trivially-green-trap-avoiding assertion: NOT "params is undefined on a fresh row" (vacuously
  // true today) but "defaults survives get(), not just getFull()".
  it('resolve() (not just resolveDetail()) returns the registered `defaults`, matching ARCH-066\'s "one row-read, no second query"', async () => {
    const cat = new WorkflowCatalog(dir, CLOCK);
    const { version } = await cat.register('it012-defaults', 'return 1;', { model: 'sonnet' });
    const entry = await cat.resolve('it012-defaults', { version });
    expect((entry as { defaults?: unknown }).defaults).toEqual({ model: 'sonnet' });
  });

  it('a pre-v21 row (registered with no meta.params) reads back resolve().params as the canonical contract shape, not a raw undefined key omission', async () => {
    const cat = new WorkflowCatalog(dir, CLOCK);
    const { version } = await cat.register('it012-no-params', 'return 1;');
    const entry = await cat.resolve('it012-no-params', { version });
    // `resolve()`'s return type has no `params` key at all when the row carries none; once
    // TASK-096/099 land this must be an explicit key (even if its value is `undefined`) so
    // resolveDetail()'s delegation stays 1 row-shape.
    expect('params' in entry).toBe(true);
  });

  // v21 Gate 5 addendum (B-5, TASK-096, REQ-090): the case above registers through already-v21
  // code, so it only ever exercises parseParamContract writing a canonical contract — it never
  // touches the ALTER-TABLE migration path itself. This fixture writes a row the way the pre-v21
  // schema genuinely did (no `params` column at all) directly against catalog.db, THEN constructs
  // a WorkflowCatalog on top of it so the idempotent migration is the thing under test.
  it('a genuine pre-v21 catalog.db (no params column) migrates cleanly: resolve() returns params:undefined', async () => {
    const raw = new Database(join(dir, 'catalog.db'));
    raw.exec(`
      CREATE TABLE workflows (
        name TEXT PRIMARY KEY,
        script TEXT NOT NULL,
        version TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        owner TEXT,
        defaults TEXT
      );
    `);
    raw.prepare(
      'INSERT INTO workflows (name, script, version, createdAt, owner, defaults) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('it012-pre-v21', 'return 1;', 'v1', '2024-01-01T00:00:00Z', null, null);
    raw.close();

    // WorkflowCatalog's constructor runs the idempotent `ALTER TABLE ... ADD COLUMN params` — this
    // row never went through parseParamContract at all, exercising the migration path IT-012's
    // other pre-v21 case (registered via v21 code) cannot reach.
    const cat = new WorkflowCatalog(dir, CLOCK);
    // ADR-011: a migrated row is published to release, so a no-selector resolve() works unaided.
    const entry = await cat.resolve('it012-pre-v21', {});
    expect(entry.params).toBeUndefined();
  });
});
