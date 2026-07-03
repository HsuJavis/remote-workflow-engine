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

  it('assertBudget throws BudgetExceededError when spent reaches the total', () => {
    const guard = new RunGuard({ concurrency: 4, budget: 100 });
    guard.addTokens(100);
    expect(() => guard.assertBudget()).toThrow(BudgetExceededError);
  });

  it('remaining() is Infinity when budget total is null', () => {
    const guard = new RunGuard({ concurrency: 4, budget: null });
    guard.addTokens(9999);
    expect(guard.budgetView().remaining()).toBe(Infinity);
    expect(() => guard.assertBudget()).not.toThrow();
  });
});
