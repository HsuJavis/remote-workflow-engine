// UT-002: RunGuard concurrency gate + budget + agent counter (DES-002)
import { describe, it, expect } from 'vitest';
import { RunGuard } from '../../src/run-guard.js';
import { AgentCapError, BudgetExceededError } from '../../src/errors.js';

describe('RunGuard', () => {
  it('acquireSlot resolves immediately when under the concurrency cap', async () => {
    const guard = new RunGuard({ concurrency: 2, budget: null });
    const release = await guard.acquireSlot();
    expect(typeof release).toBe('function');
    release();
  });

  it('third acquireSlot queues when concurrency=2 with two slots held', async () => {
    const guard = new RunGuard({ concurrency: 2, budget: null });
    const r1 = await guard.acquireSlot();
    const r2 = await guard.acquireSlot();

    let thirdResolved = false;
    const p3 = guard.acquireSlot().then((rel) => { thirdResolved = true; return rel; });

    // After a tick, the third should still be pending
    await new Promise((r) => setImmediate(r));
    expect(thirdResolved).toBe(false);

    // Releasing one slot unblocks the third
    r1();
    await p3;
    expect(thirdResolved).toBe(true);
    r2();
  });

  it('nextAgentId returns incrementing IDs until 1000 then throws AgentCapError', () => {
    const guard = new RunGuard({ concurrency: 16, budget: null });
    for (let i = 0; i < 1000; i++) guard.nextAgentId();
    expect(() => guard.nextAgentId()).toThrow(AgentCapError);
  });

  it('addTokens accumulates in budgetView().spent()', () => {
    const guard = new RunGuard({ concurrency: 4, budget: 500 });
    guard.addTokens(100);
    guard.addTokens(200);
    expect(guard.budgetView().spent()).toBe(300);
    expect(guard.budgetView().remaining()).toBe(200);
    expect(guard.budgetView().total).toBe(500);
  });

  // v25 (DES-167, REQ-120, issue #61, owner ruling 2026-09-07) — REWRITTEN, not deleted. The two
  // cases below used to read `assertBudget()` while a RESERVATION mechanism also existed; that
  // mechanism (RESERVATION_FRACTION / reserve() / releaseReserved() / _reserved) is now GONE, so
  // what they pin is the whole budget door rather than one half of it. The behaviour they asserted
  // is unchanged and still asserted: a spent budget refuses, an unbounded one never does.
  it('assertBudget throws BudgetExceededError when spent reaches the total', () => {
    const guard = new RunGuard({ concurrency: 4, budget: 100 });
    guard.addTokens(100);
    expect(() => guard.assertBudget()).toThrow(BudgetExceededError);
  });

  it('remaining() is Infinity and assertBudget never throws when budget total is null', () => {
    const guard = new RunGuard({ concurrency: 4, budget: null });
    guard.addTokens(9999);
    expect(guard.budgetView().remaining()).toBe(Infinity);
    // "Omitted or null means unbounded" (tool-specs.ts) — pinned as a non-regressable clause of
    // REQ-120, not merely inherited behaviour.
    expect(() => guard.assertBudget()).not.toThrow();
  });

  // ── UT-170 (v25, DES-167, REQ-120, issue #61): budget is SPEND, and only spend ──────────────
  it('an unspent budget admits an arbitrarily wide burst — no reservation caps it at two', () => {
    // The exact arithmetic from the report: reserve() took 50% of the TOTAL per call, so two
    // concurrent calls held 100% and the third threw BudgetExceededError with ZERO tokens spent.
    // Nothing may refuse a call while the run has spent nothing, however many calls are in flight.
    const guard = new RunGuard({ concurrency: 24, budget: 1_500_000 });
    for (let i = 0; i < 24; i++) expect(() => guard.assertBudget()).not.toThrow();
  });

  it('refuses exactly when cumulative spend reaches the total, and not one call before', () => {
    const guard = new RunGuard({ concurrency: 24, budget: 1000 });
    guard.addTokens(999);
    expect(() => guard.assertBudget()).not.toThrow(); // 1 token left is still budget left
    guard.addTokens(1);
    expect(() => guard.assertBudget()).toThrow(BudgetExceededError);
  });

});
