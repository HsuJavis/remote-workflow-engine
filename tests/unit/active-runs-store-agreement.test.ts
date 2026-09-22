// UT-308 (REQ-217 follow-up, DES-251, TASK-249): `RunStore.activeRuns()` — the "currently
// non-terminal" (queued/running/suspended/interrupted) query `buildHomeView`'s RUNNING group and
// `activeRunId` now resolve from, instead of the paginated `list()` page. Both implementations of
// the port must agree — same precedent as UT-307 (workflowMetrics) and UT-303 (lastRunAtByName):
// v36 already shipped one store-only field once (`failedAgentCount` on `SqliteRunStore` alone,
// `InMemoryRunStore` silently answering `undefined`, suite green throughout) — this is the guard
// that would have caught it for THIS field.
//
// Red reason (measured against a `git archive HEAD` copy, never a working-tree checkout —
// CLAUDE.md): neither `SqliteRunStore` nor `InMemoryRunStore` had an `activeRuns` method at HEAD
// (`50cc26a`) — `TypeError: store.activeRuns is not a function` / `sqlite.activeRuns is not a
// function` at every case below.
//
// Mock policy (unit): both REAL implementations of the port (InMemoryRunStore is real, not a
// mock) — same convention as UT-307/UT-303.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { SqliteRunStore } from '../../src/store/sqlite-run-store.js';
import { InMemoryRunStore } from '../../src/run-store.js';
import type { RunStore } from '../../src/run-store.js';
import type { Clock } from '../../src/clock.js';

/** Distinct, monotonically increasing `createdAt` per `createRun()` call — needed so "older than
 *  the page" is a real, deterministic fixture property rather than an unspecified tie-break (a
 *  `FixedClock` gives every row the SAME `createdAt`; `ORDER BY createdAt DESC LIMIT n`'s tie-break
 *  is unspecified in SQLite and insertion-order under the in-memory store's stable sort — same
 *  precedent as `tests/integration/run-list.test.ts`'s `SteppingClock`). */
class SteppingClock implements Clock {
  private _ms: number;
  constructor(anchorMs: number) { this._ms = anchorMs; }
  now(): number { return this._ms; }
  isoNow(): string { const iso = new Date(this._ms).toISOString(); this._ms += 1000; return iso; }
}

const ANCHOR_MS = new Date('2026-09-22T00:00:00.000Z').getTime();
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function newSqlite(): RunStore {
  const dir = mkdtempSync(join(tmpdir(), 'rwe-ut308-'));
  dirs.push(dir);
  return new SqliteRunStore(dir, new SteppingClock(ANCHOR_MS));
}

/** Same as `newSqlite()` but also hands back the on-disk db path — needed only by the
 *  EXPLAIN-QUERY-PLAN case below, which opens a second, read-only-in-spirit raw `Database`
 *  connection onto the SAME file (IT-114/`tests/integration/run-list.test.ts:87-100`'s own
 *  precedent) rather than reach into `SqliteRunStore`'s private `_db`. */
function newSqliteWithDbPath(): { store: RunStore; dbPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'rwe-ut308-plan-'));
  dirs.push(dir);
  return { store: new SqliteRunStore(dir, new SteppingClock(ANCHOR_MS)), dbPath: join(dir, 'index.db') };
}

/** Seeds ALL SEVEN `RunStatus` values through the port only (`createRun`/`recordTransition`, never
 *  a direct SQL write): one run each of the four ACTIVE statuses (one left 'queued' — createRun's
 *  own initial status — and three transitioned to running/suspended/interrupted), one run each of
 *  the three TERMINAL statuses, plus one UNNAMED run left 'running' (name grouping is irrelevant to
 *  this query — it returns a flat list, not a map — but an unnamed row must not be dropped). */
async function seedAllStatuses(store: RunStore): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};

  ids.queued = await store.createRun({ origin: 'local', name: 'act-wf', args: {} }); // never transitioned

  ids.running = await store.createRun({ origin: 'local', name: 'act-wf', args: {} });
  await store.recordTransition(ids.running, 'queued', 'running', '2026-09-22T00:01:00.000Z');

  ids.suspended = await store.createRun({ origin: 'local', name: 'act-wf', args: {} });
  await store.recordTransition(ids.suspended, 'queued', 'running', '2026-09-22T00:02:00.000Z');
  await store.recordTransition(ids.suspended, 'running', 'suspended', '2026-09-22T00:02:01.000Z');

  ids.interrupted = await store.createRun({ origin: 'local', name: 'act-wf', args: {} });
  await store.recordTransition(ids.interrupted, 'queued', 'running', '2026-09-22T00:03:00.000Z');
  await store.recordTransition(ids.interrupted, 'running', 'interrupted', '2026-09-22T00:03:01.000Z');

  ids.completed = await store.createRun({ origin: 'local', name: 'act-wf', args: {} });
  await store.recordTransition(ids.completed, 'queued', 'running', '2026-09-22T00:04:00.000Z');
  await store.recordTransition(ids.completed, 'running', 'completed', '2026-09-22T00:04:01.000Z');

  ids.failed = await store.createRun({ origin: 'local', name: 'act-wf', args: {} });
  await store.recordTransition(ids.failed, 'queued', 'running', '2026-09-22T00:05:00.000Z');
  await store.recordTransition(ids.failed, 'running', 'failed', '2026-09-22T00:05:01.000Z');

  ids.stopped = await store.createRun({ origin: 'local', name: 'act-wf', args: {} });
  await store.recordTransition(ids.stopped, 'queued', 'running', '2026-09-22T00:06:00.000Z');
  await store.recordTransition(ids.stopped, 'running', 'stopped', '2026-09-22T00:06:01.000Z');

  ids.unnamedRunning = await store.createRun({ origin: 'local', args: {} });
  await store.recordTransition(ids.unnamedRunning, 'queued', 'running', '2026-09-22T00:07:00.000Z');

  return ids;
}

const ACTIVE_KEYS = ['queued', 'running', 'suspended', 'interrupted', 'unnamedRunning'] as const;
const TERMINAL_KEYS = ['completed', 'failed', 'stopped'] as const;

describe('UT-308: RunStore.activeRuns() — both stores agree, unbounded, status-filtered', () => {
  it('SqliteRunStore: returns exactly the 5 non-terminal runs, excludes all 3 terminal', async () => {
    const store = newSqlite();
    const ids = await seedAllStatuses(store);
    const active = await store.activeRuns();
    const activeIds = active.map((r) => r.runId).sort();
    expect(activeIds).toEqual(ACTIVE_KEYS.map((k) => ids[k]).sort());
    for (const k of TERMINAL_KEYS) expect(activeIds).not.toContain(ids[k]);
  });

  it('InMemoryRunStore: returns exactly the 5 non-terminal runs, excludes all 3 terminal', async () => {
    const store = new InMemoryRunStore(new SteppingClock(ANCHOR_MS));
    const ids = await seedAllStatuses(store);
    const active = await store.activeRuns();
    const activeIds = active.map((r) => r.runId).sort();
    expect(activeIds).toEqual(ACTIVE_KEYS.map((k) => ids[k]).sort());
    for (const k of TERMINAL_KEYS) expect(activeIds).not.toContain(ids[k]);
  });

  it('a genuinely empty store -> an empty array (both stores)', async () => {
    const sqlite = newSqlite();
    const mem = new InMemoryRunStore(new SteppingClock(ANCHOR_MS));
    expect(await sqlite.activeRuns()).toEqual([]);
    expect(await mem.activeRuns()).toEqual([]);
  });

  it('BOTH-STORES AGREEMENT: SqliteRunStore and InMemoryRunStore answer the SAME (runId, name, status) set over the SAME fixture', async () => {
    const sqlite = newSqlite();
    const mem = new InMemoryRunStore(new SteppingClock(ANCHOR_MS));
    await seedAllStatuses(sqlite);
    await seedAllStatuses(mem);
    // Compared WITHOUT runId — each store mints its own random UUIDs (InMemoryRunStore and
    // SqliteRunStore never share an id generator), so the agreement property is "same
    // (name, status) MULTISET", not "same runId set". Sorted on a key that is unique per row in
    // THIS fixture (`status` alone collides: the unnamed row and `ids.running` are both 'running').
    const shape = (rows: Array<{ name?: string; status: string }>) =>
      rows.map((r) => ({ name: r.name, status: r.status })).sort((a, b) => `${a.status}|${a.name ?? ''}`.localeCompare(`${b.status}|${b.name ?? ''}`));
    expect(shape(await sqlite.activeRuns())).toEqual(shape(await mem.activeRuns()));
  });

  // The load-bearing, discriminating case (mirrors REQ-217's own `list()` pagination test,
  // IT-300): a single active run OLDER than every other row in the store must still be returned by
  // `activeRuns()` even though `list()` (limit 50, DES-152) drops it off the page entirely.
  // ARCH-174/ADR-081 (Gate 8 send-back repair): this does NOT prove the result set is "bounded by
  // concurrency, not by history" — it proves the opposite. `staleId` here is exactly the kind of
  // row that never gets swept (nothing transitions a suspended/interrupted run out except an
  // operator's workflow_resume/workflow_stop); the true bound is "active ∪ never-resumed — grows
  // with restarts × concurrency, not with total history". What IS bounded, separately, is scan
  // cost, by the `runs_status` index (see the EXPLAIN QUERY PLAN case below).
  for (const [label, mk] of [
    ['SqliteRunStore', () => newSqlite()],
    ['InMemoryRunStore', () => new InMemoryRunStore(new SteppingClock(ANCHOR_MS))],
  ] as const) {
    it(`${label}: a suspended run older than list()'s 50-row page is dropped by list() but still returned by activeRuns()`, async () => {
      const store = mk();
      const staleId = await store.createRun({ origin: 'local', name: 'act-wf', args: {} }); // oldest createdAt — created first
      await store.recordTransition(staleId, 'queued', 'suspended', '2026-09-22T00:00:00.500Z');
      for (let i = 0; i < 55; i++) {
        const id = await store.createRun({ origin: 'local', name: 'flood', args: {} });
        await store.recordTransition(id, 'queued', 'completed', '2026-09-22T00:10:00.000Z');
      }
      const page = await store.list();
      expect(page.length).toBe(50);
      expect(page.map((r) => r.runId)).not.toContain(staleId);

      const active = await store.activeRuns();
      expect(active.map((r) => r.runId)).toEqual([staleId]);
    });
  }

  // ARCH-174/ADR-081 (Gate 8 send-back repair): the `runs` table's OWN plan line for
  // `activeRuns()`'s real statement must be a SEARCH on the new `runs_status` index, never a SCAN.
  // A bare `/SEARCH/` match is already green BEFORE the index exists — the LEFT JOIN on
  // `run_snapshots` contributes its own `SEARCH s ...` line regardless — so this asserts the `r`
  // line specifically. Projection columns (the `_USAGE_PROJECTION` json_extract list, private to
  // SqliteRunStore) do not change the access path chosen for `r`/`s`, so this statement keeps the
  // real FROM/LEFT JOIN/correlated-subquery/WHERE shape and trims the unrelated SELECT list.
  it("EXPLAIN QUERY PLAN for activeRuns()'s statement names runs_status on the `runs` table, not a SCAN", async () => {
    const { store, dbPath } = newSqliteWithDbPath();
    await store.activeRuns(); // ensures the schema (including the new index) exists on disk
    const raw = new Database(dbPath);
    try {
      const plan = raw.prepare(`
        EXPLAIN QUERY PLAN
        SELECT r.runId,
               (SELECT MIN(t.ts) FROM transitions t
                WHERE t.runId = r.runId
                  AND t.to_status IN ('completed', 'failed', 'stopped')) AS terminalAt
        FROM runs r
        LEFT JOIN run_snapshots s ON s.runId = r.runId
        WHERE r.status IN (?, ?, ?, ?)
      `).all('queued', 'running', 'suspended', 'interrupted') as Array<{ detail: string }>;
      expect(plan.some((p) => p.detail.startsWith('SEARCH r USING INDEX runs_status'))).toBe(true);
      expect(plan.some((p) => p.detail.startsWith('SCAN r'))).toBe(false);
    } finally { raw.close(); }
  });
});
