// IT-166 (DES-193, ARCH-128, TASK-198, REQ-141): ARCH-128 promises the SAME usage projection on
// BOTH `RunStore` implementations — nothing enforces that today. This file runs the identical
// scenario through `InMemoryRunStore` (SqliteRunStore's own UT-233 already covers the SQL half).
//
// Tier: integration (real adjacent component — the in-memory store itself is the SUT here, no
// external network to fake).
//
// Red reason (measured): `InMemoryRunStore.listRuns()` builds a `RunSummary` with none of the four
// v27 fields, and `backfillUsage` does not exist on it either.
import { describe, it, expect } from 'vitest';
import { InMemoryRunStore } from '../../src/run-store.js';
import { FixedClock } from '../../src/clock.js';
import type { RunSummary, RunUsage } from '../../src/types.js';

type ProjectedSummary = RunSummary & { costUSD?: number; unpricedCalls?: number; tokensTotal?: number; agentCount?: number };

const FULL_USAGE: RunUsage = { tokens: { input: 10, output: 5, cacheRead: 1, cacheWrite: 2 }, costUSD: 0.5, unpricedCalls: 0, unmappedMessages: {} };

describe('InMemoryRunStore matches the SAME usage projection as SqliteRunStore (IT-166, ARCH-128 parity)', () => {
  it('a terminal run with a full snapshot+usage projects costUSD/tokensTotal/agentCount; a snapshot-less run omits all four', async () => {
    const store = new InMemoryRunStore(new FixedClock(new Date('2026-09-11T00:00:00.000Z')));
    const withUsage = await store.createRun({ name: 'a', args: {} });
    await store.recordTransition(withUsage, 'running', 'completed', '2026-09-11T00:01:00.000Z');
    const agent = (agentId: string) => ({ agentId, state: 'done' as const, provider: 'anthropic', model: 'claude-3-5-sonnet-20241022', tokens: { input: 0, output: 0 } });
    await store.saveSnapshot(withUsage, { phases: [], agents: [agent('x'), agent('y')], workflowNodes: [], usage: FULL_USAGE });

    const noSnapshot = await store.createRun({ name: 'b', args: {} });
    await store.recordTransition(noSnapshot, 'running', 'completed', '2026-09-11T00:01:00.000Z');

    const rows = (await store.listRuns()) as ProjectedSummary[];
    const withUsageRow = rows.find((r) => r.runId === withUsage)!;
    const noSnapshotRow = rows.find((r) => r.runId === noSnapshot)!;

    expect(withUsageRow.costUSD).toBe(0.5);
    expect(withUsageRow.tokensTotal).toBe(18);
    expect(withUsageRow.agentCount).toBe(2);

    expect(noSnapshotRow.costUSD).toBeUndefined();
    expect(noSnapshotRow.tokensTotal).toBeUndefined();
    expect(noSnapshotRow.agentCount).toBeUndefined();
  });

  it('backfillUsage exists on InMemoryRunStore and writes a {usage}-only backfill for a terminal run lacking one', async () => {
    const store = new InMemoryRunStore(new FixedClock(new Date('2026-09-11T00:00:00.000Z')));
    const runId = await store.createRun({ name: 'c', args: {} });
    await store.recordTransition(runId, 'running', 'completed', '2026-09-11T00:01:00.000Z');
    await (store as unknown as { backfillUsage(runId: string, usage: RunUsage): Promise<void> }).backfillUsage(runId, FULL_USAGE);
    const [row] = (await store.listRuns()) as ProjectedSummary[];
    expect(row?.costUSD).toBe(0.5);
  });
});
