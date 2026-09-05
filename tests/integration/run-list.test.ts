// IT-114 (DES-152, v24): RunStore.list({workflow?, status?, principal?, limit}) filtered in SQL
// with its own index; ownerless rows (principal IS NULL) excluded by a principal filter.
// Written test-first (Gate 5, RED) — RunStore only has listRuns() (unfiltered) today; no `list`
// method, no index. Mock policy: real SqliteRunStore + real InMemoryRunStore, no mocks.
// Filled per adjudication v24 #2 A-6: the originally-shipped file was three `typeof x === 'function'`
// stubs (dod requires ≥10 real cases: singly + combined filters, the query plan, the ownerless-row
// rule on both sides, and InMemoryRunStore parity against a hand-written array).
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { InMemoryRunStore } from '../../src/run-store.js';
import { SqliteRunStore } from '../../src/store/sqlite-run-store.js';
import type { Clock } from '../../src/clock.js';

/** A Clock whose isoNow() advances by one second per call — lets a single store instance produce
 *  runs with distinct, orderable createdAt values (FixedClock is deliberately frozen). */
class SteppingClock implements Clock {
  private _ms: number;
  constructor(anchorMs: number) { this._ms = anchorMs; }
  now(): number { return this._ms; }
  isoNow(): string { const iso = new Date(this._ms).toISOString(); this._ms += 1000; return iso; }
}

const ANCHOR_MS = new Date('2026-01-01T00:00:00Z').getTime();

describe('RunStore.list — filtered, indexed, ownerless-row exclusion (IT-114, DES-152)', () => {
  describe('SqliteRunStore', () => {
    function mk() {
      const dir = mkdtempSync(join(tmpdir(), 'rwe-runlist-'));
      const store = new SqliteRunStore(dir, new SteppingClock(ANCHOR_MS));
      return { dir, store };
    }
    async function seed(store: SqliteRunStore) {
      const a = await store.createRun({ name: 'deploy', principal: 'alice' });
      await store.recordTransition(a, null, 'running', new Date().toISOString());
      const b = await store.createRun({ name: 'deploy', principal: 'bob' });
      await store.recordTransition(b, null, 'completed', new Date().toISOString());
      const c = await store.createRun({ name: 'build', principal: 'alice' });
      const d = await store.createRun({ name: 'build', principal: null });
      return { a, b, c, d };
    }

    it('filters by workflow alone', async () => {
      const { dir, store } = mk();
      try {
        await seed(store);
        const rows = await store.list({ workflow: 'deploy' });
        expect(rows.map((r) => r.name).sort()).toEqual(['deploy', 'deploy']);
      } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    it('filters by status alone', async () => {
      const { dir, store } = mk();
      try {
        await seed(store);
        const rows = await store.list({ status: 'completed' });
        expect(rows.length).toBe(1);
        expect(rows[0]!.status).toBe('completed');
      } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    it('combines workflow+status filters (AND, not OR)', async () => {
      const { dir, store } = mk();
      try {
        await seed(store);
        const rows = await store.list({ workflow: 'deploy', status: 'running' });
        expect(rows.length).toBe(1);
        expect(rows[0]!.name).toBe('deploy');
        expect(rows[0]!.status).toBe('running');
      } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    it('a row with principal IS NULL is excluded by a {principal} filter (cross-seam agreement with authz\'s null=ownerless rule)', async () => {
      const { dir, store } = mk();
      try {
        const { a } = await seed(store);
        const rows = await store.list({ workflow: 'build', principal: 'alice' });
        // 'c' (build/alice) matches; 'd' (build/null) must not, even though it shares the workflow.
        expect(rows.length).toBe(1);
        expect(rows[0]!.name).toBe('build');
        void a;
      } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    it('EXPLAIN QUERY PLAN for the filtered query names runs_name_status_created', async () => {
      const { dir, store } = mk();
      try {
        await seed(store);
        await store.list({ workflow: 'deploy', status: 'running' }); // ensures the table/index exist
        const raw = new Database(join(dir, 'index.db'));
        try {
          const plan = raw.prepare(
            'EXPLAIN QUERY PLAN SELECT * FROM runs WHERE name = ? AND status = ? ORDER BY createdAt DESC LIMIT ?',
          ).all('deploy', 'running', 50) as Array<{ detail: string }>;
          expect(plan.some((p) => p.detail.includes('runs_name_status_created'))).toBe(true);
        } finally { raw.close(); }
      } finally { rmSync(dir, { recursive: true, force: true }); }
    });
  });

  describe('InMemoryRunStore', () => {
    function mk() {
      return new InMemoryRunStore(new SteppingClock(ANCHOR_MS));
    }
    async function seed(store: InMemoryRunStore) {
      const a = await store.createRun({ name: 'deploy', principal: 'alice' });
      await store.recordTransition(a, null, 'running', new Date().toISOString());
      const b = await store.createRun({ name: 'deploy', principal: 'bob' });
      await store.recordTransition(b, null, 'completed', new Date().toISOString());
      const c = await store.createRun({ name: 'build', principal: 'alice' });
      const d = await store.createRun({ name: 'build', principal: null });
      return { a, b, c, d };
    }

    it('filters by workflow alone (parity with SqliteRunStore)', async () => {
      const store = mk();
      await seed(store);
      const rows = await store.list({ workflow: 'build' });
      expect(rows.map((r) => r.name)).toEqual(['build', 'build']);
    });

    it('a row with principal IS NULL is excluded by a {principal} filter', async () => {
      const store = mk();
      await seed(store);
      const rows = await store.list({ workflow: 'build', principal: 'alice' });
      expect(rows.length).toBe(1);
      expect(rows[0]!.name).toBe('build');
    });

    it('limit defaults to 50 and caps at 500 even when more rows exist', async () => {
      const store = new InMemoryRunStore(new SteppingClock(ANCHOR_MS));
      for (let i = 0; i < 60; i++) await store.createRun({ name: 'flood' });
      const defaulted = await store.list({ workflow: 'flood' });
      expect(defaulted.length).toBe(50);
      for (let i = 0; i < 450; i++) await store.createRun({ name: 'flood' }); // 510 total
      const capped = await store.list({ workflow: 'flood', limit: 10_000 });
      expect(capped.length).toBe(500);
    });

    it('list() parity against a HAND-WRITTEN expected array (order + combined filters)', async () => {
      const store = mk();
      const { a, b, c } = await seed(store);
      void b;
      const rows = await store.list({ principal: 'alice' });
      // Hand-written: two 'alice' runs, most-recently-created first ('c' created after 'a').
      expect(rows.map((r) => r.runId)).toEqual([c, a]);
      expect(rows.every((r) => r.startedBy)).toBe(true);
    });

    it('unfiltered list() returns every run, newest first', async () => {
      const store = mk();
      const { a, b, c, d } = await seed(store);
      const rows = await store.list();
      expect(rows.map((r) => r.runId)).toEqual([d, c, b, a]);
    });
  });
});
