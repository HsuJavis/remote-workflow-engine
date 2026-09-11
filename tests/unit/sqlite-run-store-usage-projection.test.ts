// UT-233 (DES-193, ARCH-128, TASK-198, REQ-141): `listRuns()`/`list()` gain a one-batched-read
// LEFT JOIN projecting `costUSD`/`unpricedCalls`/`tokensTotal`/`agentCount` off `run_snapshots` —
// presence keyed on `usage IS NOT NULL AND agents.length > 0`, never on the arithmetic (a $0 run
// must still be PRESENT). `RunStore.backfillUsage` merges a `{usage}`-only row into a snapshot that
// has none, and is a no-op otherwise.
//
// Tier: unit — real temp `better-sqlite3` file (no mock of the SUT boundary; DES-193's own tests
// line: "against a real temp better-sqlite3 file, five rows").
//
// Red reason (measured): `listRuns()`/`list()` select only `runId,name,status,scriptVersion,
// createdAt,started_by,terminalAt` today — no LEFT JOIN on `run_snapshots` at all, so every
// projected field below reads `undefined`; `RunStore.backfillUsage` does not exist
// (`TypeError: store.backfillUsage is not a function`).
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { SqliteRunStore } from '../../src/store/sqlite-run-store.js';
import { FixedClock } from '../../src/clock.js';
import type { RunUsage, RunSummary } from '../../src/types.js';

type ProjectedSummary = RunSummary & { costUSD?: number; unpricedCalls?: number; tokensTotal?: number; agentCount?: number };

function newStore(): { store: SqliteRunStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'rwe-ut233-'));
  return { store: new SqliteRunStore(dir, new FixedClock(new Date('2026-09-11T00:00:00.000Z'))), dir };
}

async function makeRun(store: SqliteRunStore, name: string): Promise<string> {
  const runId = await store.createRun({ name, args: {} });
  const db = (store as unknown as { _db: Database.Database })._db;
  db.prepare("UPDATE runs SET status = 'completed' WHERE runId = ?").run(runId);
  return runId;
}

function writeSnapshot(store: SqliteRunStore, runId: string, snapshot: Record<string, unknown>): void {
  const db = (store as unknown as { _db: Database.Database })._db;
  db.prepare('INSERT OR REPLACE INTO run_snapshots (runId, json) VALUES (?, ?)').run(runId, JSON.stringify(snapshot));
}

const FULL_USAGE: RunUsage = { tokens: { input: 10, output: 5, cacheRead: 1, cacheWrite: 2 }, costUSD: 0.5, unpricedCalls: 0, unmappedMessages: {} };

describe('SqliteRunStore usage projection over listRuns()/list() (UT-233, DES-193)', () => {
  it('five rows project exactly per DES-193: absent, present, present, present (tokensTotal never NULL), absent', async () => {
    const { store, dir } = newStore();
    try {
      // row 1: no snapshot at all -> all four absent.
      const r1 = await makeRun(store, 'r1');
      // row 2: full snapshot with usage + 2 agents -> all four present.
      const r2 = await makeRun(store, 'r2');
      writeSnapshot(store, r2, { phases: [], agents: [{ agentId: 'a' }, { agentId: 'b' }], workflowNodes: [], usage: FULL_USAGE });
      // row 3: {usage}-only snapshot (no `agents` key at all) -> agentCount absent, other three present.
      const r3 = await makeRun(store, 'r3');
      writeSnapshot(store, r3, { usage: FULL_USAGE });
      // row 4: usage.tokens missing cacheWrite -> tokensTotal must still be a number (COALESCE), never NULL.
      const r4 = await makeRun(store, 'r4');
      writeSnapshot(store, r4, { phases: [], agents: [{ agentId: 'a' }], workflowNodes: [], usage: { tokens: { input: 1, output: 1, cacheRead: 1 }, costUSD: 0.1, unpricedCalls: 0, unmappedMessages: {} } });
      // row 5: full snapshot whose agents is [] -> all four absent (v26 R-1's exact shape: a
      // terminal run with zero agent() calls, NOT the same as "no snapshot").
      const r5 = await makeRun(store, 'r5');
      writeSnapshot(store, r5, { phases: [], agents: [], workflowNodes: [], usage: { tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, costUSD: 0, unpricedCalls: 0, unmappedMessages: {} } });

      const rows = (await store.listRuns()) as ProjectedSummary[];
      const byId = new Map(rows.map((r) => [r.runId, r]));
      const row1 = byId.get(r1)!;
      const row2 = byId.get(r2)!;
      const row3 = byId.get(r3)!;
      const row4 = byId.get(r4)!;
      const row5 = byId.get(r5)!;

      expect(row1.costUSD).toBeUndefined();
      expect(row1.unpricedCalls).toBeUndefined();
      expect(row1.tokensTotal).toBeUndefined();
      expect(row1.agentCount).toBeUndefined();

      expect(row2.costUSD).toBe(0.5);
      expect(row2.tokensTotal).toBe(18);
      expect(row2.agentCount).toBe(2);

      expect(row3.costUSD).toBe(0.5);
      expect(row3.tokensTotal).toBe(18);
      expect(row3.agentCount).toBeUndefined();

      expect(row4.tokensTotal).toBe(3); // 1+1+1+COALESCE(NULL,0) — never NULL
      expect(row4.costUSD).toBe(0.1);

      expect(row5.costUSD).toBeUndefined();
      expect(row5.tokensTotal).toBeUndefined();
      expect(row5.agentCount).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the SAME projection applies through list(filter) (single-run-record path)', async () => {
    const { store, dir } = newStore();
    try {
      const r1 = await makeRun(store, 'filtered');
      writeSnapshot(store, r1, { phases: [], agents: [{ agentId: 'a' }], workflowNodes: [], usage: FULL_USAGE });
      const rows = (await store.list({ workflow: 'filtered' })) as ProjectedSummary[];
      expect(rows[0]?.costUSD).toBe(0.5);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('backfillUsage writes a {usage}-only row for a terminal run with no persisted usage, and is idempotent', async () => {
    const { store, dir } = newStore();
    try {
      const r1 = await makeRun(store, 'backfill-me');
      await (store as unknown as { backfillUsage(runId: string, usage: RunUsage): Promise<void> }).backfillUsage(r1, FULL_USAGE);
      const [row] = (await store.listRuns()) as ProjectedSummary[];
      expect(row?.costUSD).toBe(0.5);
      // second call must not throw and must not change the number (idempotent no-op once usage exists).
      await (store as unknown as { backfillUsage(runId: string, usage: RunUsage): Promise<void> }).backfillUsage(r1, { ...FULL_USAGE, costUSD: 999 });
      const [rowAfter] = (await store.listRuns()) as ProjectedSummary[];
      expect(rowAfter?.costUSD).toBe(0.5);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('backfillUsage on a NON-terminal run is a no-op (guards the write path, not just the read)', async () => {
    const { store, dir } = newStore();
    try {
      const runId = await store.createRun({ name: 'still-running', args: {} }); // status stays 'queued'
      await (store as unknown as { backfillUsage(runId: string, usage: RunUsage): Promise<void> }).backfillUsage(runId, FULL_USAGE);
      const [row] = (await store.listRuns()) as ProjectedSummary[];
      expect(row?.costUSD).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
