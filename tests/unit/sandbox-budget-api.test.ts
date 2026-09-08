// UT-195 (DES-182, ARCH-118/114, TASK-182, v26, REQ-127/REQ-120/REQ-001): the sandbox budget wire —
// `budget: {usd, tokens}|null` on the IPC `start` message, `spent: {usd, tokens}` on `agentResult`,
// and the script-visible object rebuilt as `{limits:{usd,tokens}; total; spent(); remaining();
// tokens()}`. `remaining()`/`total` return `null` (not `Infinity`) when no USD limit exists. Written
// test-first (Gate 5, RED): today's IPC `budgetTotal: number|null` and `spent?: number` are single-
// number shapes, and `child-entry.ts`'s script-visible budget object has no `limits`/`tokens()`.
// Mock policy (unit, real subprocess per DES-006's own master-test-seam precedent): a REAL
// SandboxHost spawning a REAL forked child.
import { describe, it, expect } from 'vitest';
import { SandboxHost } from '../../src/sandbox/host.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const WORK_DIR = join(tmpdir(), 'rwe-ut195-sandbox-budget');

describe('the sandbox budget wire is {usd, tokens} end to end (UT-195, DES-182)', () => {
  it('budget: null in the child -> limits.usd === null, total === null, remaining() === null', async () => {
    const host = new SandboxHost({ workspaceRoot: WORK_DIR, budget: null as any });
    const r = await host.run('ut195-null', `return { total: budget.total, remainingUsd: budget.remaining(), limitsUsd: budget.limits ? budget.limits.usd : 'NO-LIMITS-FIELD' };`, undefined, null);
    const result = (r as any).result;
    expect(result.total).toBeNull();
    expect(result.remainingUsd).toBeNull();
    expect(result.limitsUsd).toBeNull();
  });

  it('a tokens-only budget: limits.tokens is a number, limits.usd is null', async () => {
    const host = new SandboxHost({ workspaceRoot: WORK_DIR, budget: { usd: null, tokens: 5000 } as any });
    const r = await host.run('ut195-tokens', `return { tokensLimit: budget.limits ? budget.limits.tokens : 'NO-LIMITS-FIELD', usdLimit: budget.limits ? budget.limits.usd : 'NO-LIMITS-FIELD' };`, undefined, null);
    const result = (r as any).result;
    expect(result.tokensLimit).toBe(5000);
    expect(result.usdLimit).toBeNull();
  });

  it('tokens().sum equals the four columns', async () => {
    const host = new SandboxHost({ workspaceRoot: WORK_DIR, budget: null as any, onBudgetSnapshot: (() => ({ usd: 0, tokens: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 } })) as any });
    const r = await host.run('ut195-tokens-sum', `return budget.tokens ? budget.tokens().sum : 'NO-TOKENS-FN';`, undefined, null);
    expect((r as any).result).toBe(10);
  });
});
