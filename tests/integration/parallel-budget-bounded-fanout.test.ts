// IT-037: under a bounded (but sufficient) budget, `parallel()` must actually dispatch its calls —
// REWRITTEN (not deleted), and RENAMED, for v25's REQ-120 owner ruling.
//
// The file was `parallel-budget-estimate-reservation.test.ts` and its subject was `RunGuard.reserve()`,
// the per-call budget RESERVATION. That mechanism no longer exists, so a file named after it named
// nothing (v21-v23 rule 3: moving/removing a check is not finished until everything describing its
// old site points at the new one).
//
// Original subject (Gate 8 v2 review, finding V4, D-V2G8-2): `reserve()` claimed 100% of the
// remaining budget for ONE in-flight call, collapsing `parallel()` to one call at a time. The v2 fix
// made it claim a flat HALF of the TOTAL instead — which is what issue #61 then hit from the other
// side: two concurrent calls held 100%, so a THIRD branch of any budgeted `parallel()` threw
// `BudgetExceededError` with nothing actually spent. Both are the same mistake in opposite
// directions, and the owner's 2026-09-07 ruling removes the mechanism rather than re-tuning it: what
// one call will cost is unknowable before it finishes, so every per-call reservation is a guess.
//
// What is pinned now: (1) a bounded budget with headroom does not throttle a fan-out at all, and
// (2) a budget SMALLER than the fan-out does not truncate it either — it is a stop-dispatching
// signal, so one concurrency window overshoots and the NEXT call is refused by name. Case (2) is
// deliberately the honest replacement for the old `succeeded < CALLS` oracle, which asserted a
// ceiling the engine never actually held (it held `1/RESERVATION_FRACTION` instead).
//
// Mock policy (DES-015, integration tier) unchanged: real RunManager + real RunGuard/AgentExecutor +
// real sandbox child process + real `parallel()` VM guard (src/sandbox/guards.ts); only the
// GatewayClient (third-party network) is faked, with an artificial resolve delay so overlap is
// deterministically observable (not a timing coin-flip) — IT-030's own technique.
import { describe, it, expect, vi } from 'vitest';
import { RunManager } from '../../src/run-manager.js';
import type { GatewayClient } from '../../src/gateway/client.js';
import { startScript } from '../helpers/workflow-fixtures.js';

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

describe('a bounded budget does not throttle parallel() (IT-037, REQ-120 owner ruling)', () => {
  it('a generously-bounded budget lets parallel([a,b,c]) dispatch ALL of its calls concurrently to the gateway', async () => {
    const CALLS = 3;
    const TOKENS_PER_CALL = 100;
    const BUDGET = 1000; // ample headroom for all 3 calls — concurrency should NOT collapse

    const { gateway, maxInFlight } = makeTrackedGateway(TOKENS_PER_CALL, 40);
    const mgr = new RunManager({ gateway, concurrency: CALLS });

    const runId = await startScript(mgr, `
        const thunks = [];
        for (let i = 0; i < ${CALLS}; i++) {
          // v24 (ADR-029): literal label + prompt-in-options; a computed label is
          // AGENT_LABEL_NOT_LITERAL. One label, CALLS distinct prompts — the concurrency/budget
          // oracles below count dispatches, not labels.
          thunks.push(async () => agent('call', { prompt: 'call-' + i }));
        }
        const results = await parallel(thunks);
        return { results };
      `, {
      budget: BUDGET,
    });

    const view = await pollUntilSettled(mgr, runId);
    expect(view.status).toBe('completed');

    // The original red (v2): reserve() claimed the entire remaining budget for the FIRST call, so
    // maxInFlight() was stuck at 1. The v2 fix raised that to 2 — and stopped there, which is #61.
    // Strengthened for v25: with headroom and a concurrency cap of CALLS, ALL of them run at once.
    expect(maxInFlight()).toBe(CALLS);
  }, 15000);

  it('a budget SMALLER than the fan-out does not truncate it — one window overshoots, the next call is refused by name', async () => {
    const CALLS = 3;
    const TOKENS_PER_CALL = 100;
    const BUDGET = 150; // less than the fan-out costs (300), more than one call

    const { gateway } = makeTrackedGateway(TOKENS_PER_CALL, 30);
    const mgr = new RunManager({ gateway, concurrency: CALLS });

    const runId = await startScript(mgr, `
        const thunks = [];
        for (let i = 0; i < ${CALLS}; i++) {
          thunks.push(async () => agent('call', { prompt: 'call-' + i }));
        }
        const results = await parallel(thunks);
        let refusedCode = null;
        try {
          await agent('call', { prompt: 'one-more' });
        } catch (e) {
          refusedCode = e && (e.code || e.name);
        }
        // v26 (owner ruling Q5, ADR-037, DES-182): budget.spent() is USD; the TOKEN counter this
        // token-limited run is accounted against is budget.tokens().sum. Same number, new accessor.
        return { results, refusedCode, finalSpent: budget.tokens().sum };
      `, {
      budget: BUDGET,
    });

    const view = await pollUntilSettled(mgr, runId);
    expect(view.status).toBe('completed');
    const result = await mgr.result(runId);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable: asserted above');

    const { results, refusedCode, finalSpent } = result.value as { results: unknown[]; refusedCode: string | null; finalSpent: number };
    const succeeded = results.filter((r) => r !== null).length;

    // REWRITTEN ORACLE. Was: `expect(succeeded).toBeLessThan(CALLS)` — i.e. an insufficient budget
    // must lose a branch. That is exactly the behaviour issue #61 reported as a BUG, and it was only
    // ever true because of the reservation. The engine cannot know a call's cost before dispatching
    // it, so the branch that would exceed the budget is indistinguishable from the one that fits.
    expect(succeeded).toBe(CALLS);
    expect(finalSpent).toBe(CALLS * TOKENS_PER_CALL);
    // The bound that IS enforceable, and the one the authoring guide states: overshoot is limited to
    // the calls already in flight — one concurrency window — and dispatch stops immediately after.
    expect(finalSpent).toBeLessThanOrEqual(BUDGET + CALLS * TOKENS_PER_CALL);
    expect(refusedCode).toBe('BUDGET_EXCEEDED');
  }, 15000);
});
