// UT (DES-231, ARCH-143, TASK-235, REQ-205/207): `RunStore.recordError`/`getError` — a new
// additive `runs.error` column plus a `{type:'error'}` journal line, in that order, on BOTH
// `RunStore` implementations. Written test-first (Gate 5, RED) — neither `InMemoryRunStore` nor
// `SqliteRunStore` declares `recordError`/`getError` today.
//
// Mock policy (unit): `InMemoryRunStore` is a real implementation of the port (not a mock);
// `SqliteRunStore` runs against a real temp better-sqlite3 file.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemoryRunStore } from '../../src/run-store.js';
import { SqliteRunStore } from '../../src/store/sqlite-run-store.js';
import { FixedClock } from '../../src/clock.js';

const CLOCK = new FixedClock(new Date('2026-09-21T00:00:00.000Z'));
const ERR = { code: 'SCRIPT_ERROR', message: 'boom, run-store-error UT' };

describe('RunStore.recordError/getError — InMemoryRunStore (DES-231)', () => {
  it('recordError then getError returns the byte-identical value', async () => {
    const store = new InMemoryRunStore(CLOCK);
    const runId = await store.createRun({ origin: 'local', script: 'return 1;' });
    await (store as unknown as { recordError(runId: string, err: unknown): Promise<void> }).recordError(runId, ERR);
    const got = await (store as unknown as { getError(runId: string): Promise<unknown> }).getError(runId);
    expect(got).toEqual(ERR);
  });

  it('getError is null before any recordError call', async () => {
    const store = new InMemoryRunStore(CLOCK);
    const runId = await store.createRun({ origin: 'local', script: 'return 1;' });
    const got = await (store as unknown as { getError(runId: string): Promise<unknown> }).getError(runId);
    expect(got).toBeNull();
  });
});

describe('RunStore.recordError/getError — SqliteRunStore (DES-231)', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'rwe-ut-runstore-error-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('recordError writes the runs.error column AND appends a {type:"error"} journal.jsonl line, byte-identical value', async () => {
    const store = new SqliteRunStore(dir, CLOCK);
    const runId = await store.createRun({ origin: 'local', script: 'return 1;' });
    await (store as unknown as { recordError(runId: string, err: unknown): Promise<void> }).recordError(runId, ERR);

    const got = await (store as unknown as { getError(runId: string): Promise<unknown> }).getError(runId);
    expect(got).toEqual(ERR);

    const runDir = join(dir, 'runs', runId);
    const journalText = readFileSync(join(runDir, 'journal.jsonl'), 'utf8');
    const lines = journalText.trim().split('\n').map((l) => JSON.parse(l));
    const errorLine = lines.find((l) => l.type === 'error');
    expect(errorLine).toBeDefined();
    expect(errorLine).toMatchObject(ERR);
  });

  it('column BEFORE journal: if the column write throws, no journal line is appended', async () => {
    const store = new SqliteRunStore(dir, CLOCK);
    const runId = await store.createRun({ origin: 'local', script: 'return 1;' });
    const db = (store as unknown as { _db: { prepare: (sql: string) => { run: (...a: unknown[]) => unknown } } })._db;
    const origPrepare = db.prepare.bind(db);
    db.prepare = ((sql: string) => {
      const stmt = origPrepare(sql);
      if (/UPDATE runs SET error/.test(sql)) {
        stmt.run = () => { throw new Error('simulated column-write failure'); };
      }
      return stmt;
    }) as typeof db.prepare;

    await expect(
      (store as unknown as { recordError(runId: string, err: unknown): Promise<void> }).recordError(runId, ERR),
    ).rejects.toThrow();

    const runDir = join(dir, 'runs', runId);
    expect(() => readFileSync(join(runDir, 'journal.jsonl'), 'utf8')).toThrow(); // journal never written
  });

  it('getError is null for an unknown runId (never throws)', async () => {
    const store = new SqliteRunStore(dir, CLOCK);
    const got = await (store as unknown as { getError(runId: string): Promise<unknown> }).getError('no-such-run');
    expect(got).toBeNull();
  });
});
