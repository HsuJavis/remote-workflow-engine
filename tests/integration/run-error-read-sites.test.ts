// IT (DES-231, ARCH-143, TASK-235, REQ-205/207): the four read sites (`listRuns`, `list`,
// `getRun`, `getError`) all surface `error` for a `failed` run and NONE surface it for a stale
// column (status `interrupted`, the crash-window row); plus the `failedAgentCount` five-case
// matrix on the `_USAGE_PROJECTION` read surface (`listRuns`/`list`, DES-234's cases (i)/(ii)/
// (iv)/(v) — the `running` case (iii) needs a live RunManager and lives in
// run-health-count.test.ts instead). Written test-first (Gate 5, RED) — `error`/`failedAgentCount`
// are not selected by either query today, and `recordError`/`getError` don't exist.
//
// Mock policy (integration): real SqliteRunStore over a real temp better-sqlite3 file — no mocks.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteRunStore } from '../../src/store/sqlite-run-store.js';
import { FixedClock } from '../../src/clock.js';
import type { RunSummary, RunStatusView } from '../../src/types.js';

const CLOCK = new FixedClock(new Date('2026-09-21T00:00:00.000Z'));
const ERR = { code: 'SCRIPT_ERROR', message: 'boom, IT-read-sites' };

type StoreWithError = SqliteRunStore & {
  recordError(runId: string, err: { code: string; message: string }): Promise<void>;
  getError(runId: string): Promise<{ code: string; message: string } | null>;
};
type ProjectedSummary = RunSummary & { failedAgentCount?: number };
type ProjectedView = RunStatusView & { error?: { code: string; message: string } };

function db(store: SqliteRunStore) {
  return (store as unknown as { _db: { prepare: (sql: string) => { run: (...a: unknown[]) => unknown } } })._db;
}

function setStatus(store: SqliteRunStore, runId: string, status: string): void {
  db(store).prepare("UPDATE runs SET status = ? WHERE runId = ?").run(status, runId);
}

function writeSnapshot(store: SqliteRunStore, runId: string, snapshot: Record<string, unknown>): void {
  db(store).prepare('INSERT OR REPLACE INTO run_snapshots (runId, json) VALUES (?, ?)').run(runId, JSON.stringify(snapshot));
}

describe('RunStore error — four read sites agree, gated on status===failed (DES-231, IT)', () => {
  let dir: string;
  let store: StoreWithError;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rwe-it-error-sites-'));
    store = new SqliteRunStore(dir, CLOCK) as StoreWithError;
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('a failed run surfaces error on listRuns, list, getRun AND getError — all four, one test', async () => {
    const runId = await store.createRun({ script: 'return 1;' });
    setStatus(store, runId, 'failed');
    await store.recordError(runId, ERR);

    const fromList = (await store.listRuns()) as ProjectedSummary[];
    const fromFilteredList = (await store.list()) as ProjectedSummary[];
    const fromGetRun = (await store.getRun(runId)) as ProjectedView | null;
    const fromGetError = await store.getError(runId);

    expect((fromList.find((r) => r.runId === runId) as unknown as { error?: unknown })?.error).toEqual(ERR);
    expect((fromFilteredList.find((r) => r.runId === runId) as unknown as { error?: unknown })?.error).toEqual(ERR);
    expect(fromGetRun?.error).toEqual(ERR);
    expect(fromGetError).toEqual(ERR);
  });

  it('the crash-window row (error non-NULL, status interrupted) surfaces NOTHING on any read site', async () => {
    const runId = await store.createRun({ script: 'return 1;' });
    setStatus(store, runId, 'failed');
    await store.recordError(runId, ERR);
    setStatus(store, runId, 'interrupted'); // REQ-060 reclassification after a crash

    const fromGetRun = (await store.getRun(runId)) as ProjectedView | null;
    expect((fromGetRun as unknown as { error?: unknown })?.error).toBeUndefined();
    // getError() itself may still read the raw column back (it's the store-level accessor);
    // the GATE is applied by run-manager.result() (DES-232), asserted separately there. What must
    // be true HERE is that getRun's status-derived view never surfaces it.
  });

  it('a completed run with no recorded error surfaces nothing (never a crash, never undefined-as-string)', async () => {
    const runId = await store.createRun({ script: 'return 1;' });
    setStatus(store, runId, 'completed');
    const view = (await store.getRun(runId)) as ProjectedView | null;
    expect(view?.error).toBeUndefined();
  });
});

describe('failedAgentCount on the _USAGE_PROJECTION read surface (DES-234 cases i/ii/iv/v; IT)', () => {
  let dir: string;
  let store: SqliteRunStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rwe-it-failed-count-'));
    store = new SqliteRunStore(dir, CLOCK);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  async function makeTerminalRun(name: string): Promise<string> {
    const runId = await store.createRun({ script: 'return 1;' });
    setStatus(store, runId, 'completed');
    return runId;
  }

  it('(i) terminal, mixed pass/fail -> present, matches the number of failed/refused agents', async () => {
    const runId = await makeTerminalRun('r1');
    writeSnapshot(store, runId, { phases: [], agents: [{ state: 'done' }, { state: 'failed' }, { state: 'refused' }], workflowNodes: [] });
    const rows = (await store.listRuns()) as Array<RunSummary & { failedAgentCount?: number }>;
    expect(rows.find((r) => r.runId === runId)?.failedAgentCount).toBe(2);
  });

  it('(ii) terminal, zero agents -> OMITTED (never 0)', async () => {
    const runId = await makeTerminalRun('r2');
    writeSnapshot(store, runId, { phases: [], agents: [], workflowNodes: [] });
    const rows = (await store.listRuns()) as Array<RunSummary & { failedAgentCount?: number }>;
    expect(rows.find((r) => r.runId === runId)?.failedAgentCount).toBeUndefined();
  });

  it('(iv) a pre-v35 row with no snapshot -> OMITTED, no crash', async () => {
    const runId = await makeTerminalRun('r4');
    const rows = (await store.listRuns()) as Array<RunSummary & { failedAgentCount?: number }>;
    expect(rows.find((r) => r.runId === runId)?.failedAgentCount).toBeUndefined();
  });

  it('(v) terminal with a {usage}-only snapshot -> OMITTED (agentCount itself is absent here)', async () => {
    const runId = await makeTerminalRun('r5');
    writeSnapshot(store, runId, { usage: { tokens: { input: 1, output: 1 }, costUSD: 0.01, unpricedCalls: 0, unmappedMessages: {} } });
    const rows = (await store.listRuns()) as Array<RunSummary & { failedAgentCount?: number }>;
    expect(rows.find((r) => r.runId === runId)?.failedAgentCount).toBeUndefined();
  });

  it('the guard is `agentCount != null && > 0`, NOT `(agentCount ?? 1) > 0` — a run with all-done agents reads 0, never omitted, never confused with "no snapshot"', async () => {
    const runId = await makeTerminalRun('r6');
    writeSnapshot(store, runId, { phases: [], agents: [{ state: 'done' }, { state: 'done' }], workflowNodes: [] });
    const rows = (await store.listRuns()) as Array<RunSummary & { failedAgentCount?: number }>;
    expect(rows.find((r) => r.runId === runId)?.failedAgentCount).toBe(0);
  });
});
