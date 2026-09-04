// IT-030: concurrent agent() dispatches account for in-flight spend — parallel() cannot
// materially overshoot the hard budget (Gate 8 review D-G8-6, adversarial.md finding V2, MEDIUM
// cost — REQ-002, ARCH-002 "hard-throw at ceiling").
//
// Bug (review evidence): `src/run-manager.ts:314` calls `entry.guard.assertBudget()` (throws only
// if `_spent >= total`) BEFORE dispatch, but tokens are only added AFTER the gateway returns
// (`src/agent-executor.ts`'s `AgentTranscriptSink.capture()` -> `guard.addTokens(delta)`,
// post-`invoke`). Under `parallel()`, many concurrent agent() calls all read the SAME stale
// `_spent` (still 0) before any of them has had a chance to record its own spend — so all of them
// pass the pre-dispatch check and all get dispatched, spending far more than the budget ceiling.
//
// Mock policy (DES-015, integration tier): real RunManager + real AgentGuard/AgentExecutor + real
// sandbox child process + real `parallel()` VM guard; only the GatewayClient (third-party network)
// is faked, with an artificial resolve delay so the race is deterministic (not a timing coin-flip)
// — by the time the FIRST call's token accounting could possibly land, every concurrent call has
// already had its own pre-dispatch budget check evaluated (same "burst of concurrent IPC messages
// arrives well before any one promise chain resolves" reasoning IT-002's own concurrency test relies
// on, just with an explicit delay here to remove any doubt).
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

describe('RunGuard budget accounting under concurrent parallel() dispatch (IT-030, D-G8-6)', () => {
  it('a near-exhausted budget cannot be materially overshot by a burst of concurrent agent() calls; excess calls throw', async () => {
    const CALLS = 10;
    const TOKENS_PER_CALL = 1000;
    const BUDGET = 1000; // exactly one call's worth

    const gateway: GatewayClient = {
      invoke: vi.fn(
        () =>
          new Promise((resolve) => {
            // Artificial delay: guarantees every one of the CALLS concurrent agent() IPC messages
            // has already reached RunManager's pre-dispatch assertBudget() check before ANY call's
            // token accounting could possibly land — removes timing doubt from the repro.
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
    const mgr = new RunManager({ gateway, concurrency: CALLS });

    // v24 (ADR-029, scanAgentCalls): literal label first, prompt in the options object — a computed
    // `'call-' + i` label is AGENT_LABEL_NOT_LITERAL by design, so one declared label carries all
    // CALLS iterations and only the prompt varies. The budget oracle is unchanged (it counts
    // dispatches and spend, never labels) and each call still journals a distinct CallKey.
    const runId = await startScript(mgr, `
        const thunks = [];
        for (let i = 0; i < ${CALLS}; i++) {
          thunks.push(async () => agent('call', { prompt: 'call-' + i }));
        }
        const results = await parallel(thunks);
        return { results, finalSpent: budget.spent() };
      `, {
      budget: BUDGET,
    });

    const view = await pollUntilSettled(mgr, runId);
    expect(view.status).toBe('completed');
    const result = await mgr.result(runId);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable: asserted above');

    const { results, finalSpent } = result.value as { results: unknown[]; finalSpent: number };

    // parallel() (src/sandbox/guards.ts) turns a rejected thunk into `null` — a call blocked by
    // the budget ceiling never reaches the gateway and its slot in `results` is null.
    const succeeded = results.filter((r) => r !== null).length;

    // Forcing red today: the stale pre-dispatch check lets every one of the CALLS concurrent calls
    // through before any of them has recorded spend, so all CALLS calls succeed and dispatch —
    // spending ~CALLS * TOKENS_PER_CALL against a BUDGET ceiling of exactly one call's worth.
    expect(succeeded).toBeLessThanOrEqual(2);
    expect(finalSpent).toBeLessThanOrEqual(BUDGET + TOKENS_PER_CALL);
    // No successful result without a real dispatch — sanity link between the two observables.
    expect(gateway.invoke).toHaveBeenCalledTimes(succeeded);
  }, 15000);
});
