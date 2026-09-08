// UT-071: the resume-hydration pure fold + double-count boundary (DES-068, ARCH-044, TASK-071)
//
// v26 (DES-181, TASK-181, integrator): this file's subject moves from `sumUsageTokens` to
// `foldUsage`, and NOT ONE of its properties changes. `sumUsageTokens` summed two columns
// (input+output) and carried no USD; the live accumulator since v26 sums all FOUR columns and
// tracks USD, so a resumed run hydrated from the old fold enforced a different total than the same
// run would have reached without a restart. `foldUsage` is the one read path both sides now use,
// and `sumUsageTokens` is deleted (it is one of the ten identifiers `no-retired-surface.test.ts`
// requires gone from src/, and DES-181 named it for deletion in the same breath).
//
// `foldUsage(events: TranscriptEvent[]) → RunUsage` is a PURE fold — no mutation of shared state.
//   - Sums the token counts of every `kind:'usage'` event in the journal
//   - Does NOT mutate any external state (the fold is on the read path, not the write path)
//   - Used by the IMPURE resume path (_requireLive) to hydrate RunGuard's spent totals after a
//     crash restart, via `guard.setSpent({usd, tokens})`
//
// Double-count boundary (adversarial add, DES-068): usage already reflected in a REQ-055 terminal
// snapshot must NOT be re-added when journal events replay on resume. The fold itself is pure — it
// sums whatever events are passed. The boundary is enforced by the caller (the resume path) not
// re-adding snapshot-already-counted tokens. This file checks that the fold returns the correct
// PRE-SNAPSHOT count, which is what makes that caller-side boundary checkable at all.
//
// Every oracle below is a LITERAL (DES-181's own test line), never a second call to the function
// under test.
//
// Mock policy (unit): pure function over fixture TranscriptEvent arrays, no I/O.
import { describe, it, expect } from 'vitest';
import { foldUsage, sumTokens } from '../../src/run-guard.js';
import type { TranscriptEvent } from '../../src/types.js';

/** A pre-v26 (two-column) usage event — exactly the shape a stored v25 journal holds. */
function usageEvent(input: number, output: number): TranscriptEvent {
  return {
    ts: new Date().toISOString(),
    kind: 'usage',
    data: { tokens: { input, output }, provider: 'p', model: 'm' },
  };
}

function nonUsageEvent(): TranscriptEvent {
  return { ts: new Date().toISOString(), kind: 'message', data: { text: 'hello' } };
}

/** The scalar the resume path hydrates the guard's TOKEN counter with. */
function foldedTokens(events: TranscriptEvent[]): number {
  return sumTokens(foldUsage(events).tokens);
}

describe('foldUsage — pure fold, the resume path\'s hydration source (UT-071, DES-068/DES-181)', () => {
  it('empty events → 0', () => {
    expect(foldedTokens([])).toBe(0);
  });

  it('single usage event → input + output tokens', () => {
    expect(foldedTokens([usageEvent(10, 5)])).toBe(15);
  });

  it('multiple usage events → summed total across all agents', () => {
    const events: TranscriptEvent[] = [
      usageEvent(100, 50),  // agent A: 150
      usageEvent(200, 80),  // agent B: 280
      nonUsageEvent(),      // ignored
      usageEvent(30, 20),   // agent C: 50
    ];
    expect(foldedTokens(events)).toBe(480); // 150 + 280 + 50, as a literal
  });

  it('non-usage events are ignored (message, tool_call, tool_result, harness)', () => {
    const events: TranscriptEvent[] = [
      nonUsageEvent(),
      { ts: new Date().toISOString(), kind: 'tool_call', data: {} },
      { ts: new Date().toISOString(), kind: 'tool_result', data: {} },
    ];
    expect(foldedTokens(events)).toBe(0);
  });

  it('is a pure fold — calling it twice on the same input returns the same result with no side effects', () => {
    const events = [usageEvent(100, 50), usageEvent(200, 80)];
    const r1 = foldedTokens(events);
    const r2 = foldedTokens(events);
    expect(r1).toBe(r2);
    expect(r1).toBe(430);
  });

  it('usage event with failed/no tokens field → contributes 0 (graceful, total, never throws)', () => {
    const failedUsage: TranscriptEvent = {
      ts: new Date().toISOString(),
      kind: 'usage',
      data: { provider: 'p', model: 'm' }, // no `tokens` field (failure case)
    };
    expect(() => foldUsage([failedUsage])).not.toThrow();
    expect(foldedTokens([failedUsage])).toBe(0);
  });

  it('counts all FOUR columns, which is the reason the two-column fold was retired', () => {
    const withCache: TranscriptEvent = {
      ts: new Date().toISOString(),
      kind: 'usage',
      data: { tokens: { input: 10, output: 5, cacheRead: 100, cacheWrite: 40 }, provider: 'p', model: 'm' },
    };
    expect(foldedTokens([withCache])).toBe(155);
    expect(foldUsage([withCache]).tokens).toEqual({ input: 10, output: 5, cacheRead: 100, cacheWrite: 40 });
  });

  it('a stored v25 journal folds with zero cache columns, costUSD 0, and every call counted UNPRICED — never re-priced against today\'s catalog', () => {
    const v25Journal = [usageEvent(100, 50), usageEvent(200, 80)];
    expect(foldUsage(v25Journal)).toEqual({
      tokens: { input: 300, output: 130, cacheRead: 0, cacheWrite: 0 },
      costUSD: 0,
      unpricedCalls: 2,
      unmappedMessages: {},
    });
  });

  it('hydrates the USD counter too — the half the two-column fold could never carry', () => {
    const priced: TranscriptEvent = {
      ts: new Date().toISOString(),
      kind: 'usage',
      data: { tokens: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 }, costUSD: 0.25, unpriced: false, provider: 'p', model: 'm' },
    };
    const folded = foldUsage([priced, priced]);
    expect(folded.costUSD).toBe(0.5);
    expect(folded.unpricedCalls).toBe(0);
  });
});
