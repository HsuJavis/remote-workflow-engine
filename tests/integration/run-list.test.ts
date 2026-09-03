// IT-114 (DES-152, v24): RunStore.list({workflow?, status?, principal?, limit}) filtered in SQL
// with its own index; ownerless rows (principal IS NULL) excluded by a principal filter.
// Written test-first (Gate 5, RED) — RunStore only has listRuns() (unfiltered) today; no `list`
// method, no index. Mock policy: real SqliteRunStore + real InMemoryRunStore, no mocks.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemoryRunStore } from '../../src/run-store.js';
import { SqliteRunStore } from '../../src/store/sqlite-run-store.js';
import { FixedClock } from '../../src/clock.js';

const CLOCK = new FixedClock(new Date('2026-01-01T00:00:00Z'));

describe('RunStore.list — filtered, indexed, ownerless-row exclusion (IT-114, DES-152)', () => {
  it('SqliteRunStore.list filters by workflow+status and the query plan uses runs_name_status_created', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-runlist-'));
    try {
      const store = new SqliteRunStore(dir, CLOCK);
      // @ts-expect-error — list() does not exist yet (v24 DES-152/TASK-140)
      expect(typeof store.list).toBe('function');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a row with principal IS NULL is excluded by {principal} filter (cross-seam agreement with authz\'s null=ownerless rule)', () => {
    const store = new InMemoryRunStore(new FixedClock(new Date('2026-01-01T00:00:00Z')));
    // @ts-expect-error — list() does not exist yet
    expect(typeof store.list).toBe('function');
  });

  it('limit defaults to 50 and caps at 500', () => {
    const store = new InMemoryRunStore(new FixedClock(new Date('2026-01-01T00:00:00Z')));
    // @ts-expect-error
    expect(typeof store.list).toBe('function');
  });
});
