// issue #127: a FAILED usage event can now carry real `tokens`/`costUSD`/`unpriced`/`partial`
// (agent-executor.ts's `capture()` failed branch, when the gateway reported usage before failing).
// `deriveAgentRecords`'s old discriminator — "a usage event WITH `tokens` derives `state:'done'`,
// without derives `state:'failed'`" (run-store.ts) — breaks the instant a failed event can ALSO
// carry `tokens`: a restart after an abort would rebuild the agent as `done`, losing `failReason`/
// `detail` and misreporting the run's own outcome. The discriminator must be `reason` presence
// (a `done` usage event never carries one; a `failed` one always does — agent-executor.ts's two
// branches), not `tokens` presence.
// Mock policy (unit): pure function, hand-written transcript fixtures, no I/O.
import { describe, it, expect } from 'vitest';
import { deriveAgentRecords } from '../../src/run-store.js';

describe('deriveAgentRecords — a failed usage event carrying tokens stays state:failed (issue #127)', () => {
  it('a failed usage event with tokens+partial derives state:failed, carries the tokens/costUSD/partial, keeps failReason/detail', () => {
    const transcripts = new Map([
      ['a1', [
        { ts: 't0', kind: 'harness' as const, data: { agentId: 'a1', descriptor: { model: 'the-model', provider: 'anthropic' } } },
        {
          ts: 't1', kind: 'usage' as const,
          data: {
            reason: 'aborted', provider: 'anthropic', detail: 'ABORTED: the run was suspended or stopped while this call was in flight',
            tokens: { input: 7, output: 3, cacheRead: 0, cacheWrite: 0 }, costUSD: 0, unpriced: true, partial: true,
          },
        },
      ]],
    ]);
    const records = deriveAgentRecords(transcripts, 'completed');
    const record = records.find((r) => r.agentId === 'a1') as any;
    expect(record.state).toBe('failed');
    expect(record.failReason).toBe('aborted');
    expect(record.detail).toBe('ABORTED: the run was suspended or stopped while this call was in flight');
    expect(record.tokens).toEqual({ input: 7, output: 3, cacheRead: 0, cacheWrite: 0 });
    expect(record.costUSD).toBe(0);
    expect(record.unpriced).toBe(true);
    expect(record.partial).toBe(true);
  });

  it('a done usage event never carries a partial flag, even when present:false-ish on the event (absence rule)', () => {
    const transcripts = new Map([
      ['a2', [
        { ts: 't0', kind: 'harness' as const, data: { agentId: 'a2', descriptor: { model: 'the-model', provider: 'anthropic' } } },
        { ts: 't1', kind: 'usage' as const, data: { tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, provider: 'anthropic', model: 'the-model', costUSD: 0, unpriced: true } },
      ]],
    ]);
    const records = deriveAgentRecords(transcripts, 'completed');
    const record = records.find((r) => r.agentId === 'a2') as any;
    expect(record.state).toBe('done');
    expect('partial' in record).toBe(false);
  });
});
