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
});
