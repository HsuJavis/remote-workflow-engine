// v8 Slice 4 — durable on-completion chaining (REQ-053). TEST-FIRST (RED).
//
// ContinuationStore mirrors SqliteSchedulerPort: SQLite-persisted, engine-owned side table (no change
// to RunSpec/RunStore), a RunManagerPort seam to start run B. Behavior:
//   completed(A) → start B once, record spawnedRunId, inherit rootRunId; failed/stopped(A) → skipped.
//   durable: a boot reconcile fires/skips a pending continuation whose target already terminated.
//   idempotent: two terminal transitions (stop→resume→complete) start B at most once.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ContinuationStore } from '../../src/continuation-store.js';
import { FixedClock } from '../../src/clock.js';
import type { RunStatusView } from '../../src/types.js';

const CLOCK = new FixedClock(new Date('2024-01-01T00:00:00Z'));

/** Minimal fake store: hands back a preset terminal status per runId (the boot-reconcile source). */
function fakeStore(statuses: Map<string, RunStatusView['status']>) {
  return {
    async getRun(runId: string): Promise<RunStatusView | null> {
      const status = statuses.get(runId);
      if (!status) return null;
      return { runId, status, phases: [], agents: [], workflowNodes: [], scriptVersion: 'v1' };
    },
  };
}

/** Fake RunManager recording every start(); returns a deterministic runId per call. */
function fakeRunManager() {
  const started: Array<{ name?: string; args?: unknown }> = [];
  let n = 0;
  return {
    started,
    async start(spec: { name?: string; args?: unknown }): Promise<string> {
      started.push({ name: spec.name, args: spec.args });
      return `spawned-${++n}`;
    },
  };
}

describe('ContinuationStore — durable on-completion chaining (v8 Slice 4, REQ-053)', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'rwe-cont-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('starts run B exactly once when the target completes; records spawnedRunId', async () => {
    const statuses = new Map<string, RunStatusView['status']>([['A', 'running']]);
    const rm = fakeRunManager();
    const store = new ContinuationStore({ clock: CLOCK, runManager: rm, store: fakeStore(statuses), dbPath: join(dir, 'c.db') });

    const created = await store.chainCreate({ afterRunId: 'A', run: { workflow: 'B', args: { x: 1 } } });
    expect(created.chainId).toBeTruthy();
    expect(rm.started.length).toBe(0); // not yet — A still running

    await store.onTerminal('A', 'completed');
    expect(rm.started).toEqual([{ name: 'B', args: { x: 1 } }]); // fired once
    await store.onTerminal('A', 'completed'); // idempotent — no second start
    expect(rm.started.length).toBe(1);

    const list = await store.list();
    const row = list.find((c) => c.chainId === created.chainId)!;
    expect(row.status).toBe('fired');
    expect(row.spawnedRunId).toBe('spawned-1');
  });

  it('skips (does not start B) when the target fails or is stopped', async () => {
    const rm = fakeRunManager();
    const store = new ContinuationStore({ clock: CLOCK, runManager: rm, store: fakeStore(new Map<string, RunStatusView['status']>([['A', 'running']])), dbPath: join(dir, 'c.db') });
    const c = await store.chainCreate({ afterRunId: 'A', run: { workflow: 'B' } });
    await store.onTerminal('A', 'failed');
    expect(rm.started.length).toBe(0);
    const row = (await store.list()).find((x) => x.chainId === c.chainId)!;
    expect(row.status).toBe('skipped');
  });

  it('is idempotent across a stop→(resume)→complete cycle — B starts at most once', async () => {
    const rm = fakeRunManager();
    const store = new ContinuationStore({ clock: CLOCK, runManager: rm, store: fakeStore(new Map<string, RunStatusView['status']>([['A', 'running']])), dbPath: join(dir, 'c.db') });
    await store.chainCreate({ afterRunId: 'A', run: { workflow: 'B' } });
    await store.onTerminal('A', 'stopped');   // transient terminal → skipped
    await store.onTerminal('A', 'completed'); // later completion must NOT re-fire (row no longer pending)
    expect(rm.started.length).toBe(0);
  });

  it('returns CHAIN_TARGET_NOT_FOUND for an unknown afterRunId', async () => {
    const store = new ContinuationStore({ clock: CLOCK, runManager: fakeRunManager(), store: fakeStore(new Map()), dbPath: join(dir, 'c.db') });
    const r = await store.chainCreate({ afterRunId: 'nope', run: { workflow: 'B' } });
    expect(r.error?.code).toBe('CHAIN_TARGET_NOT_FOUND');
  });

  it('DURABLE: a boot reconcile fires a pending continuation whose target already terminated', async () => {
    const dbPath = join(dir, 'c.db');
    // Instance 1: create the continuation while A is still running; nothing fires.
    const statuses = new Map<string, RunStatusView['status']>([['A', 'running']]);
    const rm1 = fakeRunManager();
    const s1 = new ContinuationStore({ clock: CLOCK, runManager: rm1, store: fakeStore(statuses), dbPath });
    await s1.chainCreate({ afterRunId: 'A', run: { workflow: 'B' } });
    expect(rm1.started.length).toBe(0);

    // Simulate: engine restarts; while down, A completed. New instance on the SAME db, A now terminal.
    statuses.set('A', 'completed');
    const rm2 = fakeRunManager();
    const s2 = new ContinuationStore({ clock: CLOCK, runManager: rm2, store: fakeStore(statuses), dbPath });
    await s2.rearmAtBoot();
    expect(rm2.started).toEqual([{ name: 'B', args: undefined }]); // reconciled + fired once on boot
    expect((await s2.list()).find((c) => c.afterRunId === 'A')!.status).toBe('fired');
  });

  it('inherits rootRunId: a chain-of-chains keeps the original root', async () => {
    const rm = fakeRunManager(); // start() returns spawned-1, spawned-2, …
    const statuses = new Map<string, RunStatusView['status']>([['A', 'running']]);
    const store = new ContinuationStore({ clock: CLOCK, runManager: rm, store: fakeStore(statuses), dbPath: join(dir, 'c.db') });

    // A → B (B = spawned-1). Root of B is A.
    await store.chainCreate({ afterRunId: 'A', run: { workflow: 'B' } });
    await store.onTerminal('A', 'completed');
    const bRow = (await store.list()).find((c) => c.afterRunId === 'A')!;
    expect(bRow.rootRunId).toBe('A');
    expect(bRow.spawnedRunId).toBe('spawned-1');

    // Now chain after B (spawned-1) → C. C's continuation must inherit root 'A', not 'spawned-1'.
    statuses.set('spawned-1', 'running');
    await store.chainCreate({ afterRunId: 'spawned-1', run: { workflow: 'C' } });
    const cRow = (await store.list()).find((c) => c.afterRunId === 'spawned-1')!;
    expect(cRow.rootRunId).toBe('A');
  });
});
