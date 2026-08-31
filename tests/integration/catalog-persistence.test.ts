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
    const cat2 = new WorkflowCatalog(dir, CLOCK);
    const entry = await cat2.get('persist-flow');
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
  it('get() (not just getFull()) returns the registered `defaults`, matching ARCH-066\'s "one row-read, no second query"', async () => {
    const cat = new WorkflowCatalog(dir, CLOCK);
    await cat.register('it012-defaults', 'return 1;', { model: 'sonnet' });
    const entry = await cat.get('it012-defaults');
    expect((entry as { defaults?: unknown }).defaults).toEqual({ model: 'sonnet' });
  });

  it('a pre-v21 row (registered with no meta.params) reads back get().params as the canonical contract shape, not a raw undefined key omission', async () => {
    const cat = new WorkflowCatalog(dir, CLOCK);
    await cat.register('it012-no-params', 'return 1;');
    const entry = await cat.get('it012-no-params');
    // Today `get()`'s return type has no `params` key at all; once TASK-096/099 land this must be
    // an explicit key (even if its value is `undefined`) so getFull()'s delegation stays 1 row-shape.
    expect('params' in entry).toBe(true);
  });
});
