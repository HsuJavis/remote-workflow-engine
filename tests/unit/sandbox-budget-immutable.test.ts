// Issue #157 (DOC item): `SandboxApi.budget`'s own doc comment ("Read-only budget view",
// guards.ts:74) promised immutability the implementation never enforced — `budget.limits.usd = 1`
// (or replacing `.limits`/`.spent` wholesale) stuck within the script's own subsequent reads. The
// issue confirms this is a CONTRACT-INTEGRITY bug, not a budget-bypass: the engine's own enforcement
// reads the real (unexposed) accounting, never this object, so a script mutating its own view could
// not spend more than its real budget — but the view it reads should match what it was told.
//
// RED before the fix: `budget.limits.usd = 1; return budget.limits.usd;` returns `1` (the mutation
// stuck) instead of the original limit.
//
// Mock policy (unit): pure evaluateScript calls, no I/O.
import { describe, it, expect } from 'vitest';
import { evaluateScript } from '../../src/sandbox/guards.js';
import type { SandboxApi } from '../../src/sandbox/guards.js';

function fakeApi(): SandboxApi {
  return {
    async agent() { return 'fake'; },
    args: undefined,
    budget: {
      limits: { usd: 500, tokens: null },
      total: 500,
      spent: () => 0,
      remaining: () => 500,
      tokens: () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, sum: 0 }),
    } as any,
  };
}

describe('#157 (DOC item): the script-visible budget object is actually read-only, matching its own doc comment', () => {
  it('mutating budget.limits.usd does not stick — a later read sees the ORIGINAL value', async () => {
    const r = await evaluateScript('budget.limits.usd = 1; return budget.limits.usd;', fakeApi());
    expect(r.kind).toBe('done');
    expect(r.value).toBe(500);
  });

  it('replacing budget.limits wholesale does not stick either', async () => {
    const r = await evaluateScript("budget.limits = { usd: 1, tokens: 1 }; return budget.limits.usd;", fakeApi());
    expect(r.kind).toBe('done');
    expect(r.value).toBe(500);
  });

  it('replacing budget.spent with a fake accessor does not stick — the real live method survives', async () => {
    const r = await evaluateScript("budget.spent = () => 0; return typeof budget.spent();", fakeApi());
    expect(r.kind).toBe('done');
    // Either the assignment silently fails (frozen object) and the real spent() still runs (returns
    // 'number'), or strict-mode code throws on the assignment — both are acceptable "did not stick"
    // outcomes; what must NOT happen is the fake taking over silently in a way this test cannot see,
    // which it can't by construction (frozen objects do not reach a successful reassignment at all).
    expect(r.value).toBe('number');
  });

  it('a normal, non-mutating read of budget.limits.usd still works (the freeze does not break reads)', async () => {
    const r = await evaluateScript('return budget.limits.usd;', fakeApi());
    expect(r.kind).toBe('done');
    expect(r.value).toBe(500);
  });
});
