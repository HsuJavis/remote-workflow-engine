// IT-145 (DES-175, ARCH-114, TASK-186, v26): INV-V26-1 — `CallKey` stays byte-identical to v25;
// `phase` is NEVER written into `key.opts`. The receipt-time phase snapshot (DES-175) travels as a
// SIDE CHANNEL (a 4th `AgentRequestHandler` argument, an `AgentRecord.phase`/`phaseIndex` field) —
// never merged onto the replay key, or every pre-upgrade journal misses at callSeq 0 and re-dispatches
// paid calls on the first resume. This is a REGRESSION LOCK (Mode C characterization): the assertion
// is already true today (nothing currently writes `phase` into `opts` from a real dispatch) and MUST
// STAY true once DES-175 lands the phase-tracking feature — written test-first, green now, held green
// through implementation, per the verifier contract's Mode C.
// Mock policy (integration, real adjacent components): real RunManager + real InMemoryRunStore; a
// fake AgentSpawner stands in for the gateway/provider network boundary.
import { describe, it, expect } from 'vitest';
import { RunManager } from '../../src/run-manager.js';
import { InMemoryRunStore } from '../../src/run-store.js';
import { FixedClock } from '../../src/clock.js';
import { startScript } from '../helpers/workflow-fixtures.js';
import type { AgentSpawner } from '../../src/agent-executor.js';

async function pollStatus(mgr: RunManager, runId: string, ms = 20, maxIter = 100): Promise<any> {
  for (let i = 0; i < maxIter; i++) {
    const v = await mgr.status(runId);
    if (['completed', 'failed', 'stopped'].includes(v.status)) return v;
    await new Promise((r) => setTimeout(r, ms));
  }
  return mgr.status(runId);
}

const fakeSpawner: AgentSpawner = {
  async run() { return { kind: 'text', value: 'ok' }; },
};

describe('INV-V26-1: CallKey.opts never gains a phase field (IT-145, DES-175) — green now, held green through v26', () => {
  it('a journal entry for a dispatch inside a phase() carries opts with NO phase key at all', async () => {
    const store = new InMemoryRunStore(new FixedClock(new Date('2026-09-08T00:00:00Z')));
    const mgr = new RunManager({ spawner: fakeSpawner, store });
    const runId = await startScript(mgr, `phase('A'); await agent('a', { prompt: 'p' });`, {});
    await pollStatus(mgr, runId);
    const journal = await store.getJournal(runId);
    expect(journal).toHaveLength(1);
    expect(Object.hasOwn(journal[0]!.key.opts as object, 'phase')).toBe(false);
  });

  it('a v25-shaped journal fixture (no phase in opts) still replays as a HIT under the current ResumeCache', async () => {
    const { ResumeCache } = await import('../../src/resume-cache.js');
    const v25Entry = {
      callSeq: 0,
      key: { prompt: 'p', opts: { label: 'a' } },
      value: 'cached-result',
      ts: '2026-08-01T00:00:00.000Z',
      scriptVersion: 'v1',
    };
    const plan = ResumeCache.build([v25Entry as any], 'phase("A"); await agent("a", {prompt:"p"});');
    const result = plan.replay(0, { prompt: 'p', opts: { label: 'a' } });
    expect(result).toBe('cached-result');
  });
});
