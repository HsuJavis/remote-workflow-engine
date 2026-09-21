// UT-307 (REQ-217, ARCH-172/ADR-080, DES-250): `RunStore.workflowMetrics()` — a per-workflow-name
// full-history aggregate computed by the STORE (a real SQL AVG()/COUNT() for SqliteRunStore, an
// in-process fold over `computeWorkflowMetrics` for the in-memory fake) so `/api/home`'s
// `avgCostUSD`/`successRate` keep FULL-HISTORY semantics after `listSummaries()` was paginated
// (K5). Both implementations of the port must agree — v36 already shipped `failedAgentCount` on
// `SqliteRunStore` alone once, with `InMemoryRunStore` silently answering `undefined` and the suite
// staying green throughout (DES-234/ADR item, review-flagged); this is the guard that would have
// caught it for THIS field.
//
// Red reason (measured against a `git archive HEAD` copy, never a working-tree checkout — CLAUDE.md):
// neither `SqliteRunStore` nor `InMemoryRunStore` had a `workflowMetrics` method at HEAD (`ed7fa2a`)
// — `TypeError: store.workflowMetrics is not a function` / `sqlite.workflowMetrics is not a function`
// at all 6 cases below.
//
// Mock policy (unit): both REAL implementations of the port (InMemoryRunStore is real, not a mock) —
// same convention as UT-303 (run-store-last-run-at.test.ts).
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteRunStore } from '../../src/store/sqlite-run-store.js';
import { InMemoryRunStore } from '../../src/run-store.js';
import type { RunStore } from '../../src/run-store.js';
import { FixedClock } from '../../src/clock.js';
import type { RunUsage, AgentRecord } from '../../src/types.js';

const T0 = '2026-09-22T00:00:00.000Z';
const clock = new FixedClock(new Date(T0));
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function newSqlite(): RunStore {
  const dir = mkdtempSync(join(tmpdir(), 'rwe-ut307-'));
  dirs.push(dir);
  return new SqliteRunStore(dir, clock);
}

const usage = (costUSD: number): RunUsage => ({
  tokens: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0 }, costUSD, unpricedCalls: 0, unmappedMessages: {},
});
const doneAgent = (id: string, state: AgentRecord['state'] = 'done'): AgentRecord => ({
  agentId: id, state, provider: 'anthropic', model: 'x',
});

/** Seeds ONE fixture, through the port only (createRun/recordTransition/saveSnapshot — never a
 *  direct SQL write), covering every boundary REQ-217 names:
 *  - 'wm-priced': 2 completed (priced) + 1 failed (priced) + 1 completed zero-agent (unpriced,
 *    REQ-186's "absent, not zero" case lives here) + 1 still-running (excluded entirely).
 *  - 'wm-unpriced': 1 completed, zero-agent (NO run in this name is ever priced — pins REQ-217's
 *    own zero-run case: AVG() over zero priced rows is null, not 0).
 *  - 'wm-active-only': 1 running run, no terminal run at all → ABSENT from the map.
 *  - unnamed (name undefined): 1 completed, priced → grouped under the `undefined` key.
 */
async function seedFixture(store: RunStore): Promise<void> {
  // wm-priced
  const p1 = await store.createRun({ name: 'wm-priced', args: {} });
  await store.recordTransition(p1, 'running', 'completed', '2026-09-22T00:01:00.000Z');
  await store.saveSnapshot(p1, { phases: [], agents: [doneAgent('a1')], workflowNodes: [], usage: usage(0.5) });

  const p2 = await store.createRun({ name: 'wm-priced', args: {} });
  await store.recordTransition(p2, 'running', 'completed', '2026-09-22T00:02:00.000Z');
  await store.saveSnapshot(p2, { phases: [], agents: [doneAgent('a2')], workflowNodes: [], usage: usage(1.5) });

  const p3 = await store.createRun({ name: 'wm-priced', args: {} });
  await store.recordTransition(p3, 'running', 'failed', '2026-09-22T00:03:00.000Z');
  await store.saveSnapshot(p3, { phases: [], agents: [doneAgent('a3', 'failed')], workflowNodes: [], usage: usage(0.4) });

  const p4 = await store.createRun({ name: 'wm-priced', args: {} });
  await store.recordTransition(p4, 'running', 'completed', '2026-09-22T00:04:00.000Z');
  await store.saveSnapshot(p4, { phases: [], agents: [], workflowNodes: [], usage: usage(0) }); // zero-agent: unpriced despite costUSD:0 in the raw fold

  const p5 = await store.createRun({ name: 'wm-priced', args: {} });
  await store.recordTransition(p5, 'queued', 'running', '2026-09-22T00:05:00.000Z'); // never terminal

  // wm-unpriced: the ONLY run is zero-agent — never priced at all.
  const u1 = await store.createRun({ name: 'wm-unpriced', args: {} });
  await store.recordTransition(u1, 'running', 'completed', '2026-09-22T00:06:00.000Z');
  await store.saveSnapshot(u1, { phases: [], agents: [], workflowNodes: [], usage: usage(0) });

  // wm-active-only: no terminal run ever.
  const a1 = await store.createRun({ name: 'wm-active-only', args: {} });
  await store.recordTransition(a1, 'queued', 'running', '2026-09-22T00:07:00.000Z');

  // unnamed
  const n1 = await store.createRun({ args: {} });
  await store.recordTransition(n1, 'running', 'completed', '2026-09-22T00:08:00.000Z');
  await store.saveSnapshot(n1, { phases: [], agents: [doneAgent('a4')], workflowNodes: [], usage: usage(0.9) });
}

describe('UT-307: RunStore.workflowMetrics() — both stores agree, full-history, absent means unmeasured', () => {
  it('SqliteRunStore: wm-priced — terminalCount 4 (p1,p2,p3,p4; p5 running excluded), successRate 3/4 (p1,p2,p4 completed), avgCostUSD over the THREE priced runs (0.5,1.5,0.4 -> mean 0.8; p3 failed but priced, p4 zero-agent excluded), unpricedRuns 1', async () => {
    const store = newSqlite();
    await seedFixture(store);
    const map = await (store as unknown as { workflowMetrics(): Promise<Map<string | undefined, { successRate: number | null; terminalCount: number; avgCostUSD: number | null; unpricedRuns: number }>> }).workflowMetrics();
    const m = map.get('wm-priced');
    expect(m).toBeDefined();
    expect(m!.terminalCount).toBe(4); // p5 (running) excluded
    expect(m!.successRate).toBeCloseTo(3 / 4);
    expect(m!.avgCostUSD).toBeCloseTo(0.8); // (0.5+1.5+0.4)/3 — p4 (zero-agent) excluded, p3 (failed) IS priced
    expect(m!.unpricedRuns).toBe(1); // p4 only
  });

  it('REQ-186 precedent, REQ-217\'s own zero-run case: a name whose terminal runs are ALL zero-agent -> avgCostUSD is null (never 0), unpricedRuns === terminalCount', async () => {
    const store = newSqlite();
    await seedFixture(store);
    const map = await (store as unknown as { workflowMetrics(): Promise<Map<string | undefined, { avgCostUSD: number | null; unpricedRuns: number; terminalCount: number }>> }).workflowMetrics();
    const m = map.get('wm-unpriced');
    expect(m).toBeDefined();
    expect(m!.avgCostUSD).toBeNull();
    expect(m!.terminalCount).toBe(1);
    expect(m!.unpricedRuns).toBe(1);
  });

  it('a name with only ACTIVE (non-terminal) runs is ABSENT from the map, never a zero-valued row', async () => {
    const store = newSqlite();
    await seedFixture(store);
    const map = await (store as unknown as { workflowMetrics(): Promise<Map<string | undefined, unknown>> }).workflowMetrics();
    expect(map.has('wm-active-only')).toBe(false);
  });

  it('an unnamed (inline) run groups under the undefined key', async () => {
    const store = newSqlite();
    await seedFixture(store);
    const map = await (store as unknown as { workflowMetrics(): Promise<Map<string | undefined, { terminalCount: number; avgCostUSD: number | null }>> }).workflowMetrics();
    const m = map.get(undefined);
    expect(m).toBeDefined();
    expect(m!.terminalCount).toBe(1);
    expect(m!.avgCostUSD).toBeCloseTo(0.9);
  });

  it('a genuinely empty runs table -> an empty map (both stores)', async () => {
    const sqlite = newSqlite();
    const mem = new InMemoryRunStore(clock);
    const fromSqlite = await (sqlite as unknown as { workflowMetrics(): Promise<Map<unknown, unknown>> }).workflowMetrics();
    const fromMem = await (mem as unknown as { workflowMetrics(): Promise<Map<unknown, unknown>> }).workflowMetrics();
    expect(fromSqlite.size).toBe(0);
    expect(fromMem.size).toBe(0);
  });

  it('BOTH-STORES AGREEMENT: SqliteRunStore and InMemoryRunStore answer the SAME numbers over the SAME fixture, seeded through the port only', async () => {
    const sqlite = newSqlite();
    const mem = new InMemoryRunStore(clock);
    await seedFixture(sqlite);
    await seedFixture(mem);
    const fromSqlite = await (sqlite as unknown as { workflowMetrics(): Promise<Map<string | undefined, { successRate: number | null; avgDurationMs: number | null; terminalCount: number; avgCostUSD: number | null; unpricedRuns: number }>> }).workflowMetrics();
    const fromMem = await (mem as unknown as { workflowMetrics(): Promise<Map<string | undefined, { successRate: number | null; avgDurationMs: number | null; terminalCount: number; avgCostUSD: number | null; unpricedRuns: number }>> }).workflowMetrics();

    expect([...fromSqlite.keys()].sort()).toEqual([...fromMem.keys()].sort());
    for (const [name, sq] of fromSqlite) {
      const im = fromMem.get(name)!;
      expect(im).toBeDefined();
      expect(im.terminalCount).toBe(sq.terminalCount);
      expect(im.unpricedRuns).toBe(sq.unpricedRuns);
      if (sq.successRate === null) expect(im.successRate).toBeNull(); else expect(im.successRate).toBeCloseTo(sq.successRate);
      if (sq.avgCostUSD === null) expect(im.avgCostUSD).toBeNull(); else expect(im.avgCostUSD).toBeCloseTo(sq.avgCostUSD, 6);
      // avgDurationMs: SQL uses julianday (a double, day-granularity) vs the in-memory Date.parse
      // fold (integer ms) — agree to within 1ms, not bit-for-bit (advisor-flagged precision trap).
      if (sq.avgDurationMs === null) { expect(im.avgDurationMs).toBeNull(); } else {
        expect(im.avgDurationMs).not.toBeNull();
        expect(Math.abs(im.avgDurationMs! - sq.avgDurationMs)).toBeLessThan(1);
      }
    }
  });
});
