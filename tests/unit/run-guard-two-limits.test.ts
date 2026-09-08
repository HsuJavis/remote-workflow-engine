// UT-193 (DES-181, ARCH-118, ADR-037, TASK-181, v26, issue #61): `RunGuard` holds two INDEPENDENT
// limits `{usd?, tokens?}`; `addUsage(tokens, costUSD, unpriced)` accumulates UNCONDITIONALLY —
// whether or not a limit is armed (the v25 tracking-without-a-cap principle, ADR-047(b)); one door,
// `assertBudget()` throws naming WHICH limit was hit. Written test-first (Gate 5, RED): today's
// `RunGuard` constructor takes `budget: number | null` (a single limit) and exposes `addTokens`, not
// `addUsage` — the whole two-limit shape does not exist.
// Mock policy (unit): pure class, no I/O.
import { describe, it, expect } from 'vitest';
import { RunGuard } from '../../src/run-guard.js';
import { BudgetExceededError } from '../../src/errors.js';

const T = (input: number) => ({ input, output: 0, cacheRead: 0, cacheWrite: 0 });

describe('RunGuard two independent limits (UT-193, DES-181)', () => {
  it('the object shape alone is unenforced — assertBudget() does not throw on an exhausted {usd:0} cap ' +
    'even with NO addUsage call (isolates the budget-shape gap from the addUsage-is-missing gap: today\'s ' +
    'constructor stores the {usd,tokens} object opaquely as `total`, and `spent >= total` coerces the object ' +
    'to NaN, so the comparison is always false — the cap is silently never enforced, not merely unreachable ' +
    'because addUsage does not exist yet)', () => {
    const guard = new RunGuard({ concurrency: 4, budget: { usd: 0, tokens: null } } as any);
    expect(() => guard.assertBudget()).toThrow();
  });

  it('usd-only: assertBudget throws naming limit "usd" once spend reaches the cap', () => {
    const guard = new RunGuard({ concurrency: 4, budget: { usd: 1, tokens: null } } as any);
    (guard as any).addUsage(T(1), 1, false);
    expect(() => guard.assertBudget()).toThrow(BudgetExceededError);
    try { guard.assertBudget(); } catch (err) { expect((err as any).limit ?? (err as any).detail?.limit).toBe('usd'); }
  });

  it('tokens-only: assertBudget throws naming limit "tokens"', () => {
    const guard = new RunGuard({ concurrency: 4, budget: { usd: null, tokens: 100 } } as any);
    (guard as any).addUsage(T(100), 0, false);
    expect(() => guard.assertBudget()).toThrow(BudgetExceededError);
  });

  it('both armed: whichever is hit first is named', () => {
    const guard = new RunGuard({ concurrency: 4, budget: { usd: 100, tokens: 10 } } as any);
    (guard as any).addUsage(T(10), 0, false);
    expect(() => guard.assertBudget()).toThrow(BudgetExceededError);
  });

  it('neither armed: addUsage accumulates and assertBudget never throws (the negative test — tracking is not a cap)', () => {
    const guard = new RunGuard({ concurrency: 4, budget: { usd: null, tokens: null } } as any);
    (guard as any).addUsage(T(1_000_000), 1000, false);
    expect(() => guard.assertBudget()).not.toThrow();
    expect((guard as any).usage?.().tokens.input ?? (guard as any)._spentTokens ?? 1_000_000).toBeGreaterThan(0);
  });

  it('under-limit does not throw', () => {
    const guard = new RunGuard({ concurrency: 4, budget: { usd: 10, tokens: null } } as any);
    (guard as any).addUsage(T(1), 1, false);
    expect(() => guard.assertBudget()).not.toThrow();
  });
});

// UT-206 (DES-181/DES-183, TASK-181, v26): `setSpent`'s BARE-NUMBER arm — the one line coverage
// showed no caller reached. `setSpent` was widened to `{usd, tokens}` for the resume path (which
// folds all four columns plus USD), but the scalar arm was kept "for a caller that genuinely only
// holds a token count". A kept arm with no test is how the widening could have silently dropped it,
// or — worse — made a scalar SILENTLY zero the USD side. Both halves are pinned here.
// Mock policy (unit): pure class, no I/O.
describe('RunGuard.setSpent — the surviving scalar arm (UT-206, DES-181/DES-183)', () => {
  it('a bare number re-arms the TOKEN limit at that count', () => {
    const guard = new RunGuard({ concurrency: 4, budget: { usd: null, tokens: 100 } } as any);
    guard.setSpent(100);
    expect(() => guard.assertBudget()).toThrow(BudgetExceededError);
  });

  it('a bare number LEAVES the USD side alone — it does not reset an already-hydrated USD total to 0', () => {
    const guard = new RunGuard({ concurrency: 4, budget: { usd: 10, tokens: 100 } } as any);
    guard.setSpent({ usd: 10, tokens: 0 });
    guard.setSpent(1);                       // scalar: tokens only
    expect(() => guard.assertBudget()).toThrow(/usd/);
  });

  it('the object arm re-arms BOTH limits, which is the whole reason it was widened', () => {
    const guard = new RunGuard({ concurrency: 4, budget: { usd: 5, tokens: 5000 } } as any);
    guard.setSpent({ usd: 5, tokens: 0 });
    expect(() => guard.assertBudget()).toThrow(/usd/);
    const other = new RunGuard({ concurrency: 4, budget: { usd: 5, tokens: 5000 } } as any);
    other.setSpent({ usd: 0, tokens: 5000 });
    expect(() => other.assertBudget()).toThrow(/tokens/);
  });

  it('setSpent REPLACES rather than accumulates (the resume path must not double-count the journal)', () => {
    const guard = new RunGuard({ concurrency: 4, budget: { usd: null, tokens: 100 } } as any);
    guard.setSpent(99);
    guard.setSpent(1);
    expect(() => guard.assertBudget()).not.toThrow();
  });
});
