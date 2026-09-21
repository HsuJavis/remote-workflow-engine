// UT-301 (DES-245, ARCH-160, TASK-243, REQ-213/212): `principal` is written by `SqliteRunStore`
// (`:115-116`) and read by the status view (`:305`) but `getSpec()`'s SELECT omits the column —
// the ADR-067 SQL/TS-twin class: a resumed-run identity test written against `InMemoryRunStore`
// passes while production (SQLite) emits `null`. This file pins a BOTH-STORES agreement test so
// that class of bug cannot hide again.
//
// Red reason: `SqliteRunStore.getSpec()`'s SELECT is
// `'SELECT name, script, args, budget, started_by FROM runs WHERE runId = ?'` (measured, no
// `principal`) — the SQLite-backed run's `spec.principal` comes back `undefined` while the
// in-memory twin (which returns `run.spec` whole) correctly returns it, so the two disagree.
//
// Mock policy (unit): both are REAL implementations of the `RunStore` port (InMemoryRunStore is a
// real implementation, not a mock of one, per this slice's stated mock policy) — no fakes.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteRunStore } from '../../src/store/sqlite-run-store.js';
import { InMemoryRunStore } from '../../src/run-store.js';
import { FixedClock } from '../../src/clock.js';

const clock = new FixedClock(new Date('2026-09-21T00:00:00.000Z'));
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe('UT-301: getSpec() returns `principal` on BOTH stores (ADR-067 SQL/TS-twin guard)', () => {
  it('a run started with a principal round-trips through SqliteRunStore.getSpec() with spec.principal set', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-ut301-sqlite-'));
    dirs.push(dir);
    const store = new SqliteRunStore(dir, clock);
    const runId = await store.createRun({ name: 'ut301', script: "return 1;", principal: 'alice' } as any);
    const spec = await store.getSpec(runId);
    expect(spec?.principal).toBe('alice');
  });

  it('BOTH-STORES AGREEMENT: the same spec round-tripped through InMemoryRunStore and SqliteRunStore returns the SAME spec.principal', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-ut301-agree-'));
    dirs.push(dir);
    const sqlite = new SqliteRunStore(dir, clock);
    const mem = new InMemoryRunStore(clock);
    const spec = { name: 'ut301-agree', script: 'return 1;', principal: 'alice' } as any;
    const sqliteRunId = await sqlite.createRun(spec);
    const memRunId = await mem.createRun(spec);
    const fromSqlite = await sqlite.getSpec(sqliteRunId);
    const fromMem = await mem.getSpec(memRunId);
    expect(fromSqlite?.principal).toBe(fromMem?.principal);
    expect(fromSqlite?.principal).toBe('alice');
  });
});
