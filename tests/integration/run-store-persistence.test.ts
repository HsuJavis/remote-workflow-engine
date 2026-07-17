// IT-006: RunStore journal.jsonl + SQLite — survives restart simulation (ARCH-006)
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FixedClock } from '../../src/clock.js';
import type { Clock } from '../../src/clock.js';

// The on-disk RunStore implementation (to be created at Gate 6).
// We import from the path it will live at to keep tests red now.
let SqliteRunStore: new (dir: string, clock: Clock) => import('../../src/run-store.js').RunStore;
try {
  ({ SqliteRunStore } = await import('../../src/store/sqlite-run-store.js'));
} catch {
  // Not implemented yet — all tests in this file will fail
}

const CLOCK = new FixedClock(new Date('2024-01-01T00:00:00Z'));

describe('SqliteRunStore persistence (ARCH-006)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rwe-store-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('createRun persists so a new store instance can getRun', async () => {
    if (!SqliteRunStore) throw new Error('SqliteRunStore: not implemented');
    const store1 = new SqliteRunStore(dir, CLOCK);
    const runId = await store1.createRun({ script: 'return 1;', name: 'persist-test' });

    // New instance simulates restart
    const store2 = new SqliteRunStore(dir, CLOCK);
    const view = await store2.getRun(runId);
    expect(view).not.toBeNull();
    expect(view!.runId).toBe(runId);
  });

  it('appendJournal entries survive restart', async () => {
    if (!SqliteRunStore) throw new Error('SqliteRunStore: not implemented');
    const store1 = new SqliteRunStore(dir, CLOCK);
    const runId = await store1.createRun({ script: 'return 1;' });
    await store1.appendJournal(runId, {
      callSeq: 0,
      key: { prompt: 'p', opts: {} },
      value: 'v',
      ts: CLOCK.isoNow(),
      scriptVersion: 'v1',
    });

    const store2 = new SqliteRunStore(dir, CLOCK);
    const view = await store2.getRun(runId);
    expect(view).not.toBeNull();
  });

  it('hydrateAll enumerates all runs on restart', async () => {
    if (!SqliteRunStore) throw new Error('SqliteRunStore: not implemented');
    const store1 = new SqliteRunStore(dir, CLOCK);
    await store1.createRun({ script: 'return 1;', name: 'a' });
    await store1.createRun({ script: 'return 2;', name: 'b' });

    const store2 = new SqliteRunStore(dir, CLOCK);
    const runs = await store2.hydrateAll();
    expect(runs.length).toBe(2);
  });

  it('O-2: the state-transition audit trail (from/to/ts) survives restart', async () => {
    if (!SqliteRunStore) throw new Error('SqliteRunStore: not implemented');
    const store1 = new SqliteRunStore(dir, CLOCK);
    const runId = await store1.createRun({ script: 'return 1;' });
    await store1.recordTransition(runId, null, 'queued', '2024-01-01T00:00:00Z');
    await store1.recordTransition(runId, 'queued', 'running', '2024-01-01T00:00:01Z');
    await store1.recordTransition(runId, 'running', 'completed', '2024-01-01T00:00:02Z');

    // Fresh instance simulates restart — the trail must be read back off disk, in order.
    const store2 = new SqliteRunStore(dir, CLOCK);
    const trail = await store2.getTransitions(runId);
    expect(trail).toEqual([
      { from: null, to: 'queued', ts: '2024-01-01T00:00:00Z' },
      { from: 'queued', to: 'running', ts: '2024-01-01T00:00:01Z' },
      { from: 'running', to: 'completed', ts: '2024-01-01T00:00:02Z' },
    ]);
  });

  it('running runs re-hydrate as failed on restart (not silently left as running)', async () => {
    if (!SqliteRunStore) throw new Error('SqliteRunStore: not implemented');
    const store1 = new SqliteRunStore(dir, CLOCK);
    const runId = await store1.createRun({ script: 'return 1;' });
    await store1.recordTransition(runId, 'queued', 'running', CLOCK.isoNow());

    // Simulate crash + restart
    const store2 = new SqliteRunStore(dir, CLOCK);
    await store2.hydrateAll();  // must re-classify running → failed
    const view = await store2.getRun(runId);
    expect(view!.status).toBe('failed');
  });
});
