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
// #157 (final blocker): the script body now runs as a STRICT-mode function (see guards.ts's own
// `evaluateScript` doc) — an assignment to a non-writable property of a frozen object, which sloppy
// mode silently swallowed (the original shape of this test: the mutation attempt is a no-op, so the
// SUBSEQUENT `return` sees the real value), now THROWS a TypeError instead, before that `return` ever
// runs. Both are valid "did not stick" outcomes for the contract this test defends (mutating the
// read-only budget view has no effect on what the engine's own accounting uses) — strict mode is
// simply a stronger one (the script is told immediately, not left to silently believe a mutation that
// never happened). Each case below accepts either shape rather than asserting the no-longer-reachable
// sloppy-mode one specifically.
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
  it('mutating budget.limits.usd does not stick — either a later read sees the ORIGINAL value, or strict mode rejects the write outright', async () => {
    const r = await evaluateScript('budget.limits.usd = 1; return budget.limits.usd;', fakeApi());
    if (r.kind === 'done') {
      expect(r.value).toBe(500);
    } else {
      expect(r.error!.code).toBe('SCRIPT_ERROR');
      expect(r.error!.message).toMatch(/read only|not extensible|Cannot assign/i);
    }
  });

  it('replacing budget.limits wholesale does not stick either', async () => {
    const r = await evaluateScript("budget.limits = { usd: 1, tokens: 1 }; return budget.limits.usd;", fakeApi());
    if (r.kind === 'done') {
      expect(r.value).toBe(500);
    } else {
      expect(r.error!.code).toBe('SCRIPT_ERROR');
      expect(r.error!.message).toMatch(/read only|not extensible|Cannot assign/i);
    }
  });

  it('replacing budget.spent with a fake accessor does not stick — the real live method survives', async () => {
    const r = await evaluateScript("budget.spent = () => 0; return typeof budget.spent();", fakeApi());
    if (r.kind === 'done') {
      // The assignment silently failed (sloppy-mode shape) and the real spent() still ran.
      expect(r.value).toBe('number');
    } else {
      // Strict mode rejected the assignment outright — the fake never had a chance to take over.
      expect(r.error!.code).toBe('SCRIPT_ERROR');
      expect(r.error!.message).toMatch(/read only|not extensible|Cannot assign/i);
    }
  });

  it('a normal, non-mutating read of budget.limits.usd still works (the freeze does not break reads)', async () => {
    const r = await evaluateScript('return budget.limits.usd;', fakeApi());
    expect(r.kind).toBe('done');
    expect(r.value).toBe(500);
  });
});
