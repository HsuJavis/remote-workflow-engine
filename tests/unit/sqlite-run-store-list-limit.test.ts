// UT (issue #160 BUG-2): `SqliteRunStore.list()` does `Math.min(filter.limit ?? 50, 500)` with no
// integer coercion and binds it straight into `LIMIT ?`. better-sqlite3 rejects a non-integer bound
// value against an INTEGER-affinity clause with a bare 'datatype mismatch' Error — no `.code`, so it
// escapes the call-tool error-wrapping machinery as a raw string instead of a coded envelope. A
// negative limit (`-1`) is worse: SQLite's `LIMIT -1` means "unbounded", and `Math.min(-1, 500)` is
// `-1` — the 500-row cap this function's own doc promises is silently bypassed, not merely
// mis-validated. Both must be refused/clamped before they reach the raw SQL bind.
//
// Mock policy (unit, DES-119, mirrors sqlite-run-store-workflow-name.test.ts): a real SqliteRunStore
// on real on-disk sqlite — the point of the test IS the query/bind behaviour.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FixedClock } from '../../src/clock.js';
import { SqliteRunStore } from '../../src/store/sqlite-run-store.js';

const CLOCK = new FixedClock(new Date('2026-09-03T10:00:00.000Z'));
let dir: string;
let store: SqliteRunStore;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'rwe-runstore-limit-')); store = new SqliteRunStore(join(dir, 'store'), CLOCK); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

async function seedRuns(n: number): Promise<void> {
  for (let i = 0; i < n; i++) await store.createRun({ origin: 'local', name: 'wf-list-limit', script: 'return 1;' });
}

describe('SqliteRunStore.list({limit}) never reaches the raw SQL bind with a non-integer or negative value (issue #160 BUG-2, UT)', () => {
  it('a float limit (1.5) never throws the raw driver "datatype mismatch" — it is coerced to an integer', async () => {
    await seedRuns(3);
    await expect(store.list({ limit: 1.5 })).resolves.toBeDefined();
    const rows = await store.list({ limit: 1.5 });
    expect(rows.length).toBeLessThanOrEqual(2); // truncated toward 1, never the raw float
  });

  it('a negative limit (-1) is clamped to a small positive bound, never passed through as SQLite\'s "unbounded" LIMIT -1', async () => {
    await seedRuns(10);
    // `Math.min(filter.limit ?? 50, 500)` leaves -1 AS -1 (min(-1,500) === -1) and SQLite's
    // `LIMIT -1` means "no limit" — so, unfixed, this returns all 10 seeded rows. A clamp to a
    // sane positive floor (e.g. 1) must return strictly fewer than every row.
    const rows = await store.list({ limit: -1 });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(10);
  });
});

// REPAIR (issue #160 BUG-2 follow-up, review D1-item1): commit 081bea5's own message documents
// "limit:0 回 []" (an explicit limit of 0 returns an empty array) as PRE-EXISTING, owner-acknowledged
// behavior — not a defect — and that commit's own text claims this was "left as-is". But the clamp
// it actually shipped, `Math.max(1, Math.min(Math.trunc(limit), 500))`, floors EVERY non-positive
// value (including an explicit 0) up to 1, so `list({limit: 0})` silently returns up to 1 row instead
// of the documented `[]`. This is a behavior change to a design choice the owner rules require be
// left untouched and merely flagged. The negative-limit clamp (the actual ceiling-bypass bug) must
// still clamp to a positive floor — only an explicit `0` is special-cased to mean "no rows".
describe('SqliteRunStore.list({limit: 0}) still returns [] — the pre-existing, owner-acknowledged "limit:0 means no rows" behavior must not be clamped away by the BUG-2 fix (issue #160 BUG-2 follow-up)', () => {
  it('limit:0 returns an empty array, not 1 row', async () => {
    await seedRuns(5);
    const rows = await store.list({ limit: 0 });
    expect(rows).toEqual([]);
  });

  it('limit:-1 (still a real bug: ceiling bypass) is clamped to a positive floor, NOT treated like 0', async () => {
    await seedRuns(5);
    const rows = await store.list({ limit: -1 });
    expect(rows.length).toBeGreaterThan(0);
  });
});
