// IT-037: under a bounded (but sufficient) budget, parallel([a,b,c]) must actually dispatch its
// calls CONCURRENTLY to the gateway — not collapse to one-at-a-time because reserve() claims 100% of
// the remaining budget for a single in-flight call — while the hard budget ceiling still holds once
// the budget is genuinely insufficient for every call (Gate 8 v2 review, adversarial.md finding V4
// MEDIUM; binding D-V2G8-2 — a regression pin against my own v1 D-G8-6 overcorrection).
//
// Bug (review evidence): `src/run-guard.ts:79-84` `reserve()` reserves
// `total - _spent - _reserved` — the ENTIRE currently-remaining budget — for ONE about-to-dispatch
// call. `run-manager.ts:331-338` calls `assertBudget()` then `reserve()` synchronously (no `await`
// between them) before `acquireSlot()`. Under `parallel([a,b,c])`, the first concurrent agent() call
// to reach `_handleAgentRequest` reserves the WHOLE remaining budget; every other call arriving
// before the first one's `finally` release sees `_spent + _reserved >= total` and throws
// `BudgetExceededError` immediately — `makeParallel` (src/sandbox/guards.ts) swallows that to `null`
// — so under ANY bounded budget, `parallel()` silently loses all concurrency: exactly one agent()
// call ever reaches the gateway, no matter how much headroom the budget actually has.
//
// Mock policy (DES-015, integration tier): real RunManager + real RunGuard/AgentExecutor + real
// sandbox child process + real `parallel()` VM guard (src/sandbox/guards.ts); only the GatewayClient
// (third-party network) is faked, with an artificial resolve delay so overlap is deterministically
// observable (not a timing coin-flip) — same technique IT-030's own concurrency test relies on.
import { describe, it, expect, vi } from 'vitest';
import { RunManager } from '../../src/run-manager.js';
import type { GatewayClient } from '../../src/gateway/client.js';

async function pollUntilSettled(mgr: RunManager, runId: string) {
  let view = await mgr.status(runId);
  for (let i = 0; i < 200 && (view.status === 'running' || view.status === 'queued'); i++) {
    await new Promise((r) => setTimeout(r, 30));
    view = await mgr.status(runId);
  }
  return view;
}

function makeTrackedGateway(tokensPerCall: number, delayMs: number) {
  let inFlight = 0;
  let maxInFlight = 0;
  const invoke = vi.fn(
    () =>
      new Promise((resolve) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        setTimeout(() => {
          inFlight -= 1;
          resolve({
            ok: true,
            provider: 'fake',
            model: 'fake',
            tokens: { input: tokensPerCall / 2, output: tokensPerCall / 2 },
            content: 'ok',
          });
        }, delayMs);
      }),
  );
  return { gateway: { invoke } as unknown as GatewayClient, maxInFlight: () => maxInFlight };
}

describe('RunGuard budget-estimate reservation preserves parallel() concurrency under a bounded budget (IT-037, D-V2G8-2)', () => {
  it('a generously-bounded budget still lets parallel([a,b,c]) dispatch more than one call concurrently to the gateway', async () => {
    const CALLS = 3;
    const TOKENS_PER_CALL = 100;
    const BUDGET = 1000; // ample headroom for all 3 calls — concurrency should NOT collapse

    const { gateway, maxInFlight } = makeTrackedGateway(TOKENS_PER_CALL, 40);
    const mgr = new RunManager({ gateway, concurrency: CALLS });

    const runId = await mgr.start({
      script: `
        const thunks = [];
        for (let i = 0; i < ${CALLS}; i++) {
          thunks.push(async () => agent('call-' + i));
        }
        const results = await parallel(thunks);
        return { results };
      `,
      budget: BUDGET,
    });

    const view = await pollUntilSettled(mgr, runId);
    expect(view.status).toBe('completed');

    // Forcing red today: reserve() claims the entire remaining budget for the FIRST call to arrive,
    // so every other concurrent call throws BudgetExceededError before ever reaching the gateway —
    // maxInFlight() is 1 today, never more, regardless of how much budget headroom exists.
    expect(maxInFlight()).toBeGreaterThan(1);
  }, 15000);

  it('the hard budget ceiling still throws once the budget is genuinely insufficient for every call', async () => {
    const CALLS = 3;
    const TOKENS_PER_CALL = 100;
    const BUDGET = 150; // insufficient for all 3 calls (300 total) but enough for at least one

    const { gateway } = makeTrackedGateway(TOKENS_PER_CALL, 30);
    const mgr = new RunManager({ gateway, concurrency: CALLS });

    const runId = await mgr.start({
      script: `
        const thunks = [];
        for (let i = 0; i < ${CALLS}; i++) {
          thunks.push(async () => agent('call-' + i));
        }
        const results = await parallel(thunks);
        return { results, finalSpent: budget.spent() };
      `,
      budget: BUDGET,
    });

    const view = await pollUntilSettled(mgr, runId);
    expect(view.status).toBe('completed');
    const result = await mgr.result(runId);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable: asserted above');

    const { results, finalSpent } = result.value as { results: unknown[]; finalSpent: number };
    const succeeded = results.filter((r) => r !== null).length;

    // The ceiling must still hold: not every call can succeed against an insufficient budget, and
    // real spend cannot overshoot the ceiling by more than roughly one call's worth.
    expect(succeeded).toBeLessThan(CALLS);
    expect(finalSpent).toBeLessThanOrEqual(BUDGET + TOKENS_PER_CALL);
  }, 15000);
});
