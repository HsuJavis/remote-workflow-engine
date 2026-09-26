// IT-156 (DES-183, ARCH-118, ADR-046, TASK-183, v26, REQ-127): the `unmappedMessages` COLUMN of
// `RunUsage`, folded by both producers. IMPL-198's whole claim is that the LIVE fold
// (`foldUsageFromRecords`, over `AgentRecord`s) and the AT-REST fold (`foldUsage`, over persisted
// usage events) "count the same subtypes by the same rule". Per-function coverage at Gate 6.5+7
// showed the counting loop uncovered in BOTH folds — i.e. the one column the reconciliation was
// written for had no test at all, and either fold could have returned `{}` forever with every
// existing green staying green. This pins the whole thread end to end: gateway → executor →
// AgentRecord + persisted usage event → both folds → the same counts.
// Mock policy (integration, real adjacent components): real RunManager, real InMemoryRunStore, real
// AgentExecutor; a fake gateway stands in for the provider network (the only third party), and it is
// what produces `GatewayResult.unmapped` — the SDK subtype counter is the gateway's own job (UT-177).
import { describe, it, expect } from 'vitest';
import { RunManager } from '../../src/run-manager.js';
import { InMemoryRunStore } from '../../src/run-store.js';
import { FixedClock } from '../../src/clock.js';
import { foldUsage } from '../../src/run-guard.js';
import { startScript } from '../helpers/workflow-fixtures.js';

async function pollStatus(mgr: RunManager, runId: string, ms = 20, maxIter = 100): Promise<any> {
  for (let i = 0; i < maxIter; i++) {
    const v = await mgr.status(runId);
    if (['completed', 'failed', 'stopped'].includes(v.status)) return v;
    await new Promise((r) => setTimeout(r, ms));
  }
  return mgr.status(runId);
}

// Two calls, so the counter has to ADD across agents rather than overwrite: 'task_progress' appears
// twice in one call and once in the other (3 total), 'mirror_error' once.
const gatewayWithUnmapped = {
  async invoke(req: any) {
    const first = req.agentId?.endsWith('1') ?? true;
    return {
      ok: true,
      provider: 'anthropic',
      model: 'claude-haiku-4-5-20251001',
      tokens: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 },
      unmapped: first ? ['task_progress', 'task_progress'] : ['task_progress', 'mirror_error'],
      content: 'x',
    };
  },
};

describe('the unmappedMessages column, counted the same by both folds (IT-156, DES-183)', () => {
  it('live (records) and at-rest (persisted events) agree, and both count occurrences not distinct names', async () => {
    const store = new InMemoryRunStore(new FixedClock(new Date('2026-09-08T00:00:00Z')));
    const mgr = new RunManager({ gateway: gatewayWithUnmapped as any, store });
    const runId = await startScript(mgr, `await agent('a', { prompt: 'p' }); await agent('b', { prompt: 'q' });`, {});
    const view = await pollStatus(mgr, runId);
    expect(view.status).toBe('completed');

    // (a) the AT-REST fold, over exactly what was persisted
    const events: any[] = [];
    for (const a of view.agents ?? []) {
      events.push(...(await store.getTranscript(runId, a.agentId)));
    }
    const atRest = foldUsage(events as any);
    expect(Object.keys(atRest.unmappedMessages).length).toBeGreaterThan(0);
    expect(atRest.unmappedMessages['task_progress']).toBe(3);
    expect(atRest.unmappedMessages['mirror_error']).toBe(1);

    // (b) the LIVE fold, reported through the run's own usage — the same two numbers
    expect(view.usage?.unmappedMessages).toEqual(atRest.unmappedMessages);
  });

  it('a run with no unmapped subtypes reports an EMPTY object, never a missing field', async () => {
    const store = new InMemoryRunStore(new FixedClock(new Date('2026-09-08T00:00:00Z')));
    const clean = { async invoke() { return { ok: true, provider: 'anthropic', model: 'claude-haiku-4-5-20251001', tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, content: 'x' }; } };
    const mgr = new RunManager({ gateway: clean as any, store });
    const runId = await startScript(mgr, `await agent('a', { prompt: 'p' });`, {});
    const view = await pollStatus(mgr, runId);
    expect(view.usage?.unmappedMessages).toEqual({});
  });
});

// R-1 (v26 Gate 8 re-review, recorded debt now closed): the two folds are supposed to be "one
// arithmetic, two entry points", but the AT-REST fold began with `if (!data.tokens) continue;` —
// which runs BEFORE the `unmapped` accumulation. M-2 taught the terminally-failed branch's usage
// event to carry `unmapped` (and, by DES-180, no `tokens`), so that guard threw away exactly the
// names M-2 had just added, and the at-rest fold could never count them while the LIVE fold counts
// `r.unmapped` on records of EVERY state. This feeds the SAME run to both folds — one done call and
// one terminally-failed call, each carrying unmapped chatter — and deep-equals the whole `RunUsage`,
// not just the one column, so a future divergence in ANY column fails here too.
const gatewayOneDoneOneFailed = {
  async invoke(req: any) {
    const failing = req.agentId?.endsWith('2') ?? false;
    if (failing) {
      return { ok: false, provider: 'anthropic', reason: 'terminal', detail: 'simulated terminal failure', unmapped: ['weird_subtype'] };
    }
    return {
      ok: true, provider: 'anthropic', model: 'claude-haiku-4-5-20251001',
      tokens: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 },
      unmapped: ['task_progress', 'task_progress'],
      content: 'x',
    };
  },
};

describe('the two folds agree on the WHOLE RunUsage, failed call included (R-1, DES-183)', () => {
  it('at-rest foldUsage deep-equals the live fold when one call failed carrying unmapped and no tokens', async () => {
    const store = new InMemoryRunStore(new FixedClock(new Date('2026-09-11T00:00:00Z')));
    const mgr = new RunManager({ gateway: gatewayOneDoneOneFailed as any, store });
    // 2026-09-26 (alias mechanism removed): the DEFAULT_FIXTURE_MODEL this file's `startScript`
    // would otherwise declare is `anthropic/claude-haiku-4-5-20251001` — the EXACT static-table id
    // this fake gateway's own result also (coincidentally) claims — so admission would now PIN a
    // real static-table price for it, breaking this test's premise ("no price book pinned", i.e.
    // the pin covers a genuinely DIFFERENT model than whatever the gateway happens to return).
    // Overriding to a well-formed openrouter ref keeps the pin key `openrouter/<...>`, which never
    // matches the fake's hardcoded `anthropic/claude-haiku-4-5-20251001` result — genuinely unpriced.
    const runId = await startScript(
      mgr,
      `await agent('a', { prompt: 'p' }); await agent('b', { prompt: 'q' });`,
      {},
      { agents: { a: { model: 'openrouter/some-vendor/unpriced-model' }, b: { model: 'openrouter/some-vendor/unpriced-model' } } },
    );
    const view = await pollStatus(mgr, runId);
    expect(view.status).toBe('completed');

    const events: any[] = [];
    for (const a of view.agents ?? []) {
      events.push(...(await store.getTranscript(runId, a.agentId)));
    }
    // The failed call really did persist its unmapped names on a usage event carrying NO tokens —
    // the exact shape the at-rest guard used to skip.
    const failedUsage = events.filter((e) => e.kind === 'usage' && !e.data.tokens);
    expect(failedUsage).toHaveLength(1);
    expect(failedUsage[0].data.unmapped).toEqual(['weird_subtype']);

    // The falsifying assertion: same material, both folds, deep-equal RunUsage.
    expect(foldUsage(events as any)).toEqual(view.usage);
    // ...and the failed call's chatter is genuinely counted, not equal-because-both-empty.
    expect(foldUsage(events as any).unmappedMessages).toEqual({ task_progress: 2, weird_subtype: 1 });
    // DES-180 still stands: the failed call moved no token, no cost and no unpriced counter.
    expect(foldUsage(events as any).tokens).toEqual({ input: 10, output: 5, cacheRead: 0, cacheWrite: 0 });
    expect(foldUsage(events as any).costUSD).toBe(0);
    expect(foldUsage(events as any).unpricedCalls).toBe(1); // the DONE call only (no price book pinned)
  });
});
