// UT-234 (DES-194, ARCH-127, TASK-199, REQ-141): `RunManager.listSummaries()` — one accessor, one
// precedence chain (live -> snapshot -> one-time backfilled fold -> absent), read by BOTH
// `/api/runs` and `/api/home`. Absence is keyed on `records.length === 0` decided BEFORE the fold
// (never on `costUSD === 0`, which `foldUsageFromRecords([])` would otherwise report as a
// fully-populated, confidently-wrong zero).
//
// Tier: unit — a fake RunStore (mock policy v27: "oracle external to the code under test"); no real
// network, no real SQLite (that half is UT-233/IT-166).
//
// v36 (REQ-217, DES-250) amendment: `listSummaries()` now reads `store.list()` (the already-
// paginated port method, limit 50/cap 500) instead of the unbounded `store.listRuns()` — the K5
// list-path cliff (ARCH-172/ADR-080). The fakes below were retargeted from `listRuns` to `list`;
// every case's OWN assertion (usage projection / backfill / absence) is unchanged, since that
// behaviour lives entirely downstream of whichever rows the store handed back.
//
// Red reason (measured, this amendment): every fake stubbed only `listRuns` — once `listSummaries()`
// called `store.list()`, all four hand-built-fake cases threw `TypeError: this._store.list is not
// a function` at `run-manager.ts:897` (confirmed by running the suite before this edit).
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { RunManager } from '../../src/run-manager.js';
import { InMemoryRunStore } from '../../src/run-store.js';
import { SqliteRunStore } from '../../src/store/sqlite-run-store.js';
import { FixedClock } from '../../src/clock.js';
import type { RunStore } from '../../src/run-store.js';
import type { RunSummary, RunUsage } from '../../src/types.js';

type ProjectedSummary = RunSummary & { costUSD?: number; unpricedCalls?: number; tokensTotal?: number; agentCount?: number };

function summariesManager(rows: ProjectedSummary[], backfillSpy?: (runId: string, usage: RunUsage) => void): RunManager {
  const store = {
    list: async () => rows,
    backfillUsage: async (runId: string, usage: RunUsage) => { backfillSpy?.(runId, usage); },
  } as unknown as RunStore;
  return new RunManager({ store, clock: new FixedClock(new Date('2026-09-11T00:00:00.000Z')) });
}

describe('RunManager.listSummaries() (UT-234, DES-194)', () => {
  it('a run whose store row already carries usage passes it through untouched (no live entry, no backfill needed)', async () => {
    const manager = summariesManager([
      { runId: 'r1', status: 'completed', scriptVersion: 'v1', createdAt: '2026-09-11T00:00:00.000Z', costUSD: 0.5, unpricedCalls: 0, tokensTotal: 18, agentCount: 2 },
    ]);
    const rows = await (manager as unknown as { listSummaries(): Promise<ProjectedSummary[]> }).listSummaries();
    expect(rows[0]?.costUSD).toBe(0.5);
  });

  it('a run that completed with zero agent() calls (store row carries no usage at all) reports all four ABSENT, never 0', async () => {
    const manager = summariesManager([
      { runId: 'r2', status: 'completed', scriptVersion: 'v1', createdAt: '2026-09-11T00:00:00.000Z' },
    ]);
    const rows = await (manager as unknown as { listSummaries(): Promise<ProjectedSummary[]> }).listSummaries();
    expect(rows[0]?.costUSD).toBeUndefined();
    expect(rows[0]?.unpricedCalls).toBeUndefined();
    expect(rows[0]?.tokensTotal).toBeUndefined();
    expect(rows[0]?.agentCount).toBeUndefined();
  });

  it('a terminal legacy row WITH a real usage event backfills successfully: writes the store, heals in place, and never re-writes on the next call (Gate 6.5+7 coverage)', async () => {
    const backfillCalls: Array<{ runId: string; usage: RunUsage }> = [];
    const usage: RunUsage = { tokens: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0 }, costUSD: 0.75, unpricedCalls: 0, unmappedMessages: {} };
    const store = {
      list: async (): Promise<ProjectedSummary[]> => [{ runId: 'r-legacy', status: 'completed', scriptVersion: 'v1', createdAt: '2026-09-11T00:00:00.000Z' }],
      getRun: async () => ({ agents: [{ agentId: 'a1', label: 'x', state: 'done' }], usage }),
      backfillUsage: async (runId: string, u: RunUsage) => { backfillCalls.push({ runId, usage: u }); },
    } as unknown as RunStore;
    const manager = new RunManager({ store, clock: new FixedClock(new Date('2026-09-11T00:00:00.000Z')) });
    const rows = await (manager as unknown as { listSummaries(): Promise<ProjectedSummary[]> }).listSummaries();
    expect(backfillCalls).toEqual([{ runId: 'r-legacy', usage }]);
    expect(rows[0]).toMatchObject({ costUSD: 0.75, unpricedCalls: 0, tokensTotal: 30 });

    // Second call: the row is now memoized as checked — no redundant getRun/backfillUsage.
    backfillCalls.length = 0;
    await (manager as unknown as { listSummaries(): Promise<ProjectedSummary[]> }).listSummaries();
    expect(backfillCalls).toEqual([]);
  });

  it('a store whose backfillUsage rejects still resolves listSummaries() (a write-path failure never fails the read)', async () => {
    const store = {
      list: async (): Promise<ProjectedSummary[]> => [{ runId: 'r3', status: 'completed', scriptVersion: 'v1', createdAt: '2026-09-11T00:00:00.000Z' }],
      backfillUsage: async () => { throw new Error('write raced'); },
    } as unknown as RunStore;
    const manager = new RunManager({ store, clock: new FixedClock(new Date('2026-09-11T00:00:00.000Z')) });
    await expect((manager as unknown as { listSummaries(): Promise<ProjectedSummary[]> }).listSummaries()).resolves.toBeDefined();
  });

  it('with a real InMemoryRunStore and no live entries, listSummaries() delegates straight through to store.list()', async () => {
    const store = new InMemoryRunStore(new FixedClock(new Date('2026-09-11T00:00:00.000Z')));
    const runId = await store.createRun({ origin: 'local', name: 'x', args: {} });
    await store.recordTransition(runId, 'running', 'completed', '2026-09-11T00:01:00.000Z');
    const manager = new RunManager({ store, clock: new FixedClock(new Date('2026-09-11T00:00:00.000Z')) });
    const rows = await (manager as unknown as { listSummaries(): Promise<ProjectedSummary[]> }).listSummaries();
    expect(rows.some((r) => r.runId === runId)).toBe(true);
  });

  // v36 (REQ-217): listSummaries() is now paginated — a page larger than the default limit (50)
  // must never leave the store's own cap. Same InMemoryRunStore.list() default as SqliteRunStore's.
  it('listSummaries() never returns more than store.list()\'s default limit (50), even with 60 rows present', async () => {
    const store = new InMemoryRunStore(new FixedClock(new Date('2026-09-11T00:00:00.000Z')));
    for (let i = 0; i < 60; i++) {
      const runId = await store.createRun({ origin: 'local', name: `n${i}`, args: {} });
      await store.recordTransition(runId, 'running', 'completed', `2026-09-11T00:${String(i % 60).padStart(2, '0')}:00.000Z`);
    }
    const manager = new RunManager({ store, clock: new FixedClock(new Date('2026-09-11T00:00:00.000Z')) });
    const rows = await (manager as unknown as { listSummaries(): Promise<ProjectedSummary[]> }).listSummaries();
    expect(rows.length).toBe(50);
  });

  it('a counting prepare() proxy: list() issues exactly ONE statement; listSummaries() heals the legacy cohort at most BACKFILL_PER_TICK=25 on the first call, then 1 on the second', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-ut234-count-'));
    try {
      const store = new SqliteRunStore(dir, new FixedClock(new Date('2026-09-11T00:00:00.000Z')));
      const db = (store as unknown as { _db: Database.Database })._db;
      // Ten terminal runs, no snapshot at all (the legacy cohort DES-194's backfill heals).
      for (let i = 0; i < 10; i++) {
        const runId = await store.createRun({ origin: 'local', name: `n${i}`, args: {} });
        db.prepare("UPDATE runs SET status = 'completed' WHERE runId = ?").run(runId);
      }
      let prepareCalls = 0;
      const originalPrepare = db.prepare.bind(db);
      (db as unknown as { prepare: typeof db.prepare }).prepare = ((sql: string) => { prepareCalls++; return originalPrepare(sql); }) as typeof db.prepare;

      prepareCalls = 0;
      await store.list();
      expect(prepareCalls).toBe(1);

      const manager = new RunManager({ store, clock: new FixedClock(new Date('2026-09-11T00:00:00.000Z')) });
      prepareCalls = 0;
      await (manager as unknown as { listSummaries(): Promise<ProjectedSummary[]> }).listSummaries();
      expect(prepareCalls).toBeLessThanOrEqual(1 + 10 * 25);

      prepareCalls = 0;
      await (manager as unknown as { listSummaries(): Promise<ProjectedSummary[]> }).listSummaries();
      expect(prepareCalls).toBe(1); // every row already healed — no more backfill writes
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
