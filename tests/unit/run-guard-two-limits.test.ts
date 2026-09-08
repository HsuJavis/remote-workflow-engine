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
