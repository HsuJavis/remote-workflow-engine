// UT-303 (DES-247, ARCH-162, TASK-245, REQ-213/REQ-216/K5): `lastRunAtByName(): Promise<Map<string,
// string>>` on the `RunStore` port, DERIVED (not denormalized) — a grouped `MAX(createdAt)` query,
// never a per-name column. A never-run name is ABSENT from the map (never a `null` VALUE), so the
// caller's `?? null` is what produces `null` and can never be confused with "a run exists with a
// null timestamp". Both implementations conform (both-stores agreement).
//
// Red reason: neither `SqliteRunStore` nor `InMemoryRunStore` implements `lastRunAtByName` —
// `TypeError: ...lastRunAtByName is not a function`.
//
// Mock policy (unit): both REAL implementations of the port (InMemoryRunStore is real, not a mock).
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

describe('UT-303: lastRunAtByName() — grouped MAX(createdAt), both stores agree, absent means never-run', () => {
  it('two runs on one name → the LATER createdAt (SqliteRunStore)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-ut303-sqlite-'));
    dirs.push(dir);
    const earlyClock = new FixedClock(new Date('2026-09-21T00:00:00.000Z'));
    const lateClock = new FixedClock(new Date('2026-09-21T01:00:00.000Z'));
    const earlyStore = new SqliteRunStore(dir, earlyClock);
    await earlyStore.createRun({ name: 'ut303-a', script: 'return 1;' } as any);
    const lateStore = new SqliteRunStore(dir, lateClock);
    await lateStore.createRun({ name: 'ut303-a', script: 'return 1;' } as any);
    const map = await (lateStore as any).lastRunAtByName();
    expect(map.get('ut303-a')).toBe(lateClock.isoNow());
  });

  it('a never-run name is ABSENT from the map, not present with a null value', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-ut303-absent-'));
    dirs.push(dir);
    const store = new SqliteRunStore(dir, clock);
    await store.createRun({ name: 'ut303-ran', script: 'return 1;' } as any);
    const map = await (store as any).lastRunAtByName();
    expect(map.has('ut303-never-ran')).toBe(false);
  });

  it('BOTH-STORES AGREEMENT: SqliteRunStore and InMemoryRunStore answer the same shape over one fixture', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-ut303-agree-'));
    dirs.push(dir);
    const sqlite = new SqliteRunStore(dir, clock);
    const mem = new InMemoryRunStore(clock);
    await sqlite.createRun({ name: 'ut303-agree', script: 'return 1;' } as any);
    await mem.createRun({ name: 'ut303-agree', script: 'return 1;' } as any);
    const fromSqlite = await (sqlite as any).lastRunAtByName();
    const fromMem = await (mem as any).lastRunAtByName();
    expect(fromSqlite.has('ut303-agree')).toBe(fromMem.has('ut303-agree'));
    expect(fromSqlite.has('ut303-agree')).toBe(true);
  });
});
