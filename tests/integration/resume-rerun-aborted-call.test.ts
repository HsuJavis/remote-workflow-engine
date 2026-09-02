// IT-025: workflow_resume RE-RUNS an in-flight agent() call that was aborted by workflow_suspend,
// rather than replaying the journaled null from the resume cache (D-F13, REQ-006 1st acceptance
// clause: "only unfinished calls run live, producing the same final result as an uninterrupted
// run").
//
// D-F13 (binding): the journal must distinguish terminal-null (agent genuinely failed after
// retries — replay from cache is correct) from aborted-null (suspend/stop interrupted it — MUST
// re-run live on resume). `08-validation.md` round-5 VAL-006 real repro (only reachable now that
// D-F10c's real subprocess-kill fix landed — before that, the subprocess ran to natural completion
// in the background regardless of suspend, so this exact interaction was unreachable): suspending a
// real in-flight agent() call then resuming returned `{"status":"completed"}` with
// `result:null` in well under 1s — no real inference time elapsed. Root cause: the abort path
// journals `{value:null}` from `src/run-manager.ts`'s `_handleAgentRequest` exactly like a
// genuinely-completed terminal-provider-error null (REQ-003's own legitimate outcome) —
// `src/types.ts`'s `JournalEntry` has no field distinguishing the two, so `ResumeCache.replay()`
// (correctly, per its own "same script+args -> 100% cache hit" contract) treats ANY journaled
// `(prompt,opts)` entry as a completed cache hit and replays it, never re-invoking the gateway.
//
// Mock policy (DES-015, integration tier): real RunManager + real RunGuard + real AgentExecutor +
// real sandbox child process; only GatewayClient (third-party network) is faked — its first
// invocation hangs forever (modeling the real subprocess an abort orphans/kills, matching
// AgentExecutor._invokeOnce's own signal-race semantics) and its SECOND invocation (the live
// re-run this test exists to force) resolves for real, with content distinguishable from the
// aborted null.
//
// Red reason: confirmed via `npx vitest run` this file — after resume, the fake gateway's invoke()
// is called exactly ONCE total (never a second time) and the final result stays `null` — the
// resumed run reaches "completed" in well under a second, exactly matching the real round-5 repro,
// not an import/syntax error and not a hang (the test's own bound would time out if it hung, which
// it does not).
import { describe, it, expect } from 'vitest';
import { RunManager } from '../../src/run-manager.js';
import { startScript } from '../helpers/workflow-fixtures.js';
import type { GatewayClient } from '../../src/gateway/client.js';

async function pollUntilSettled(mgr: RunManager, runId: string, maxIters = 60) {
  let view = await mgr.status(runId);
  for (let i = 0; i < maxIters && view.status === 'running'; i++) {
    await new Promise((r) => setTimeout(r, 50));
    view = await mgr.status(runId);
  }
  return view;
}

describe('workflow_resume re-runs an aborted-mid-flight agent() call live (IT-025, D-F13)', () => {
  it('the aborted call is genuinely re-invoked on resume, producing the uninterrupted-run result — not the cached aborted null', async () => {
    let invokeCount = 0;
    let firstInvokeStarted!: () => void;
    const firstInvokeStartedPromise = new Promise<void>((resolve) => { firstInvokeStarted = resolve; });

    const gateway: GatewayClient = {
      invoke: async () => {
        invokeCount += 1;
        if (invokeCount === 1) {
          firstInvokeStarted();
          // Models a genuinely in-flight real provider call that the abort orphans (the local
          // AgentExecutor race resolves via the run's own AbortSignal, per D-F10c, not via this
          // promise ever settling) — never resolves on its own.
          return await new Promise<never>(() => {});
        }
        // Second call — the live re-run this test exists to force — completes for real, with a
        // result unambiguously distinguishable from the aborted call's null.
        return { ok: true, provider: 'fake', model: 'm', tokens: { input: 5, output: 5 }, content: 'REAL-RESULT' };
      },
    };
    const mgr = new RunManager({ gateway });

    const runId = await startScript(mgr, `return await agent('slow-call');`);

    // Deterministic: wait for the agent() call to have actually reached the gateway before
    // suspending — avoids a race against the real child process's own startup time.
    await firstInvokeStartedPromise;
    await mgr.suspend(runId);

    // Give the journal-write that follows the abort's local race a moment to land (same
    // convention as IT-019's post-suspend settle wait) before resuming.
    await new Promise((r) => setTimeout(r, 300));

    let view = await mgr.status(runId);
    expect(view.status).toBe('suspended'); // sanity: the status transition itself already works, real, unchanged

    await mgr.resume(runId);
    const finalView = await pollUntilSettled(mgr, runId);
    expect(finalView.status).toBe('completed'); // sanity: resume itself already reaches a terminal state, unchanged

    const result = await mgr.result(runId);

    // Forcing red: today's ResumeCache treats the aborted call's journaled null as a completed
    // cache hit, so the gateway is never invoked a second time and the final result stays null —
    // exactly the real round-5 repro (resumed in well under 1s, result:null, no real inference).
    expect(invokeCount).toBe(2);
    expect(result).toEqual({ ok: true, value: 'REAL-RESULT' });
  }, 15000);
});
