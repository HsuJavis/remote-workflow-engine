// IT-030: concurrent agent() dispatches cannot run away with the budget — REWRITTEN (not deleted)
// for v25's REQ-120 owner ruling. What it pins is now the HONEST bound the engine can actually hold.
//
// Original subject (Gate 8 review D-G8-6, adversarial finding V2): `assertBudget()` ran before
// dispatch but tokens were only added after the gateway returned, so a burst of concurrent calls all
// read the same stale `_spent` (0) and all dispatched — 10 calls against a one-call budget. The v2
// fix bolted a RESERVATION onto the guard (each call reserved half the TOTAL), and this file's
// oracle became `succeeded <= 2` — which is not a budget property at all, it is `1/RESERVATION_FRACTION`.
//
// Why that oracle is gone (owner ruling 2026-09-07, REQ-120, issue #61): the reservation cost the
// engine every fan-out wider than 2 (a third branch threw with nothing spent — issue #61), and no
// re-tuned formula can do better, because what one call costs is unknowable before it finishes.
// Reservations are removed. Budget now means cumulative spend, and the enforceable statement is:
//
//   dispatch STOPS as soon as recorded spend reaches the total, so a run can overshoot by at most
//   ONE CONCURRENCY WINDOW (concurrency x one call's cost) — the calls already in flight.
//
// That is what this file asserts, deterministically, with an explicit concurrency of 2: wave 1 (a
// full window arriving with nothing spent) dispatches and overshoots; wave 2 meets recorded spend
// and is refused with a NAMED code the script can catch. The original defect — an unbounded burst
// spending N x the budget — is still caught: with concurrency 2, 10 thunks cannot spend 10 calls'
// worth. `workflow_authoring_guide` teaches exactly this bound.
//
// Mock policy (DES-015, integration tier) unchanged: real RunManager + real RunGuard/AgentExecutor +
// real sandbox child process + real `parallel()` VM guard; only the GatewayClient is faked, with an
// artificial resolve delay so the burst is deterministic rather than a timing coin-flip.
import { describe, it, expect, vi } from 'vitest';
import { RunManager } from '../../src/run-manager.js';
import type { GatewayClient } from '../../src/gateway/client.js';
import { startScript } from '../helpers/workflow-fixtures.js';

async function pollUntilSettled(mgr: RunManager, runId: string) {
  let view = await mgr.status(runId);
  for (let i = 0; i < 100 && (view.status === 'running' || view.status === 'queued'); i++) {
    await new Promise((r) => setTimeout(r, 30));
    view = await mgr.status(runId);
  }
  return view;
}

describe('RunGuard budget accounting under concurrent parallel() dispatch (IT-030, REQ-120 owner ruling)', () => {
  it('a burst cannot spend more than one concurrency window past the budget, and the next call is refused by name', async () => {
    const CALLS = 10;
    const TOKENS_PER_CALL = 1000;
    const BUDGET = 1000; // exactly one call's worth
    const CONCURRENCY = 2;

    const gateway: GatewayClient = {
      invoke: vi.fn(
        () =>
          new Promise((resolve) => {
            // Artificial delay: guarantees every concurrent agent() IPC message reaches RunManager's
            // pre-dispatch budget check before ANY call's token accounting can land — removes
            // timing doubt from the repro.
            setTimeout(
              () =>
                resolve({
                  ok: true,
                  provider: 'fake',
                  model: 'fake',
                  tokens: { input: TOKENS_PER_CALL / 2, output: TOKENS_PER_CALL / 2 },
                  content: 'ok',
                }),
              30,
            );
          }),
      ),
    };
    const mgr = new RunManager({ gateway, concurrency: CONCURRENCY });

    // v24 (ADR-029, scanAgentCalls): literal label first, prompt in the options object — one declared
    // label carries all CALLS iterations and only the prompt varies. The budget oracle is unchanged
    // in kind (it counts dispatches and spend, never labels).
    // v25: the script CATCHES the refusal, because an engine refusal now propagates out of
    // parallel() instead of being swallowed to null (REQ-120) — catching it is what lets this test
    // read `budget.spent()` afterwards, and it doubles as the pattern the authoring guide teaches.
    const runId = await startScript(mgr, `
        const thunks = [];
        for (let i = 0; i < ${CALLS}; i++) {
          thunks.push(async () => agent('call', { prompt: 'call-' + i }));
        }
        let refusedCode = null;
        let results = [];
        try {
          results = await parallel(thunks);
        } catch (e) {
          refusedCode = e && (e.code || e.name);
        }
        return { results, refusedCode, finalSpent: budget.spent() };
      `, {
      budget: BUDGET,
    });

    const view = await pollUntilSettled(mgr, runId);
    expect(view.status).toBe('completed');
    const result = await mgr.result(runId);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable: asserted above');

    const { refusedCode } = result.value as { refusedCode: string | null; finalSpent: number };

    // The refusal reaches the caller with a name — the half of #61 that was silent.
    expect(refusedCode).toBe('BUDGET_EXCEEDED');

    // The bound the engine can hold: only the calls already in flight when spend was still 0 can
    // dispatch, i.e. at most one concurrency window. 10 thunks cannot spend 10 calls' worth.
    expect(gateway.invoke).toHaveBeenCalledTimes(CONCURRENCY);
    const spentFromRecords = view.agents
      .filter((a) => a.state === 'done')
      .reduce((sum, a) => sum + a.tokens.input + a.tokens.output, 0);
    expect(spentFromRecords).toBeLessThanOrEqual(BUDGET + CONCURRENCY * TOKENS_PER_CALL);

    // Every refused call is visible with its reason instead of vanishing (issue #61).
    const refused = view.agents.filter((a) => a.state === 'refused');
    expect(refused.length).toBe(CALLS - CONCURRENCY);
    for (const a of refused) expect(a.reasonCode).toBe('BUDGET_EXCEEDED');
  }, 15000);
});
