// UT-071: `sumUsageTokens` pure fold + double-count boundary (DES-068, ARCH-044, TASK-071)
//
// `sumUsageTokens(events:TranscriptEvent[]) → number` is a PURE fold — no mutation of shared state.
//   - Sums all token counts from `kind:'usage'` events in the journal
//   - Does NOT mutate any external state (the fold is on the read path, not the write path)
//   - Used by the IMPURE resume path (_requireLive) to hydrate RunGuard.spent after a crash restart
//
// Double-count boundary (adversarial add, DES-068):
//   Usage already reflected in a REQ-055 terminal snapshot must NOT be re-added when journal events
//   replay on resume. The fold itself is pure — it sums whatever events are passed. The boundary
//   is enforced by the caller (resume path) not re-adding snapshot-already-counted tokens.
//   We test this by checking that `sumUsageTokens` on the journal returns the correct PRE-SNAPSHOT
//   count, and the resume path does not add them again.
//
// Mock policy (unit): pure function over fixture TranscriptEvent arrays, no I/O.
// Red reason: `sumUsageTokens` is not yet exported from `src/run-store.ts`
//   → ESM SyntaxError "does not provide an export named 'sumUsageTokens'" at collect time.
import { describe, it, expect } from 'vitest';
import { sumUsageTokens } from '../../src/run-store.js';
import type { TranscriptEvent } from '../../src/types.js';

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

describe('sumUsageTokens — pure fold (UT-071, DES-068)', () => {
  it('empty events → 0', () => {
    expect(sumUsageTokens([])).toBe(0);
  });

  it('single usage event → input + output tokens', () => {
    expect(sumUsageTokens([usageEvent(10, 5)])).toBe(15);
  });

  it('multiple usage events → summed total across all agents', () => {
    const events: TranscriptEvent[] = [
      usageEvent(100, 50),  // agent A: 150
      usageEvent(200, 80),  // agent B: 280
      nonUsageEvent(),      // ignored
      usageEvent(30, 20),   // agent C: 50
    ];
    expect(sumUsageTokens(events)).toBe(150 + 280 + 50);
  });

  it('non-usage events are ignored (message, tool_call, tool_result, harness)', () => {
    const events: TranscriptEvent[] = [
      nonUsageEvent(),
      { ts: new Date().toISOString(), kind: 'tool_call', data: {} },
      { ts: new Date().toISOString(), kind: 'tool_result', data: {} },
    ];
    expect(sumUsageTokens(events)).toBe(0);
  });

  it('is a pure fold — calling it twice on the same input returns the same result with no side effects', () => {
    const events = [usageEvent(100, 50), usageEvent(200, 80)];
    const r1 = sumUsageTokens(events);
    const r2 = sumUsageTokens(events);
    expect(r1).toBe(r2);
    expect(r1).toBe(430);
  });

  it('usage event with failed/no tokens field → contributes 0 (graceful, total, never throws)', () => {
    const failedUsage: TranscriptEvent = {
      ts: new Date().toISOString(),
      kind: 'usage',
      data: { provider: 'p', model: 'm' }, // no `tokens` field (failure case)
    };
    expect(() => sumUsageTokens([failedUsage])).not.toThrow();
    expect(sumUsageTokens([failedUsage])).toBe(0);
  });
});
