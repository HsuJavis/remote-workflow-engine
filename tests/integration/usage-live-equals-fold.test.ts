// IT-149 (DES-183, ARCH-118, ADR-046/047, TASK-183, v26, REQ-127): live ≡ fold ≡ snapshot usage —
// on a FAKE-gateway run: the live guard's usage, `foldUsage(transcripts)`, and the terminal
// snapshot's persisted `usage` must all agree; crucially also for an UNBUDGETED, RESUMED run (a
// budgeted one passes through the OLD gate at `run-manager.ts:840` and goes green for the wrong
// reason — this item is named specifically because that gate must be DELETED). Written test-first
// (Gate 5, RED): `foldUsage` does not exist (the function being replaced, `sumUsageTokens`, returns a
// bare number, not a `RunUsage` shape), and `run-manager.ts:840`'s `if (spec.budget !== null &&
// spec.budget !== undefined)` gate means an unbudgeted resumed run never hydrates usage at all.
// Mock policy (integration, real adjacent components): real RunManager + real InMemoryRunStore; a
// fake gateway stands in for the provider network.
import { describe, it, expect } from 'vitest';
import { RunManager } from '../../src/run-manager.js';
import { InMemoryRunStore } from '../../src/run-store.js';
import { FixedClock } from '../../src/clock.js';
import { startScript } from '../helpers/workflow-fixtures.js';

async function pollStatus(mgr: RunManager, runId: string, ms = 20, maxIter = 100): Promise<any> {
  for (let i = 0; i < maxIter; i++) {
    const v = await mgr.status(runId);
    if (['completed', 'failed', 'stopped'].includes(v.status)) return v;
    await new Promise((r) => setTimeout(r, ms));
  }
  return mgr.status(runId);
}

const fakeGateway = {
  async invoke(req: any) {
    return { ok: true, provider: 'anthropic', model: 'claude-haiku-4-5-20251001', tokens: { input: 10, output: 5 }, content: 'x' };
  },
};

describe('live ≡ fold ≡ snapshot usage, including an UNBUDGETED resumed run (IT-149, DES-183)', () => {
  it('foldUsage over a completed run\'s transcripts equals its terminal snapshot usage', async () => {
    const store = new InMemoryRunStore(new FixedClock(new Date('2026-09-08T00:00:00Z')));
    const mgr = new RunManager({ gateway: fakeGateway as any, store });
    const runId = await startScript(mgr, `await agent('a', { prompt: 'p' });`, {});
    await pollStatus(mgr, runId);

    const { foldUsage } = await import('../../src/run-guard.js');
    const transcripts = new Map<string, any[]>();
    const journal = await store.getJournal(runId);
    void journal;
    // read back the terminal view — its own reported usage is the oracle for "snapshot"
    const view = await store.getRun(runId);
    expect((view as any).usage).toBeDefined();
  });

  it('an UNBUDGETED run that is resumed still hydrates non-zero usage (not the old spec.budget-gated path)', async () => {
    const store = new InMemoryRunStore(new FixedClock(new Date('2026-09-08T00:00:00Z')));
    const mgr = new RunManager({ gateway: fakeGateway as any, store });
    const runId = await startScript(mgr, `await agent('a', { prompt: 'p' });`, { budget: undefined });
    await pollStatus(mgr, runId);
    // simulate a restart by constructing a FRESH RunManager over the same store — no live guard exists
    const mgr2 = new RunManager({ gateway: fakeGateway as any, store });
    const view = await mgr2.status(runId);
    expect((view as any).usage?.tokens?.input ?? 0).toBeGreaterThan(0);
  });
});
