// IT-019: workflow_suspend aborts an in-flight gateway call (D-F9a, REQ-006 1st acceptance)
//
// D-F9(a) (binding): thread the run abort signal from RunManager through AgentExecutor into gateway
// invoke() (REQ-006's own acceptance line: "in-flight agents are stopped" on suspend).
//
// 08-validation.md round-2/3 VAL-006 confirmed this is a REAL defect, not mock-only: RunManager DOES
// abort its own AbortController on suspend (entry.abortController.abort() — run-manager.ts:152) and
// AgentExecutor._invokeOnce DOES race the gateway promise against that same signal (so the run
// itself transitions to 'suspended' correctly) — but the signal is never forwarded INTO the
// gateway.invoke() request object at all, so a real GatewayClient implementation has no way to
// actually cancel the in-flight provider call; it just keeps running, unobserved, until the provider
// itself responds or its own internal timeoutMs elapses (a real-money concern for a paid provider).
//
// Mock policy (DES-015, integration tier): real RunManager + real AgentExecutor + real sandbox child
// process (real IPC); only the GatewayClient (third-party network) is faked — and observing whether
// a signal ever reaches it IS the seam contract this integration test exists to prove (not provable
// at unit tier on AgentExecutor alone, since AgentExecutor already races its OWN local signal
// correctly — the gap is one level further out, in what it forwards to the gateway).
//
// Red reason: AgentExecutor._invokeOnce builds the gateway request as
// `{ prompt, opts, runId: req.runId, agentId: req.agentId }` — no `signal` field at all (confirmed
// by reading agent-executor.ts) — so receivedSignal below is always undefined today.
import { describe, it, expect } from 'vitest';
import { RunManager } from '../../src/run-manager.js';
import { startScript } from '../helpers/workflow-fixtures.js';
import type { GatewayClient } from '../../src/gateway/client.js';

describe('workflow_suspend aborts an in-flight gateway call (IT-019, D-F9a)', () => {
  it('the gateway request carries a real AbortSignal that fires when the run is suspended', async () => {
    let receivedSignal: AbortSignal | undefined;
    let abortObserved = false;
    let invokeCalled!: () => void;
    const invokeCalledPromise = new Promise<void>((resolve) => {
      invokeCalled = resolve;
    });

    const gateway: GatewayClient = {
      invoke: async (req) => {
        receivedSignal = (req as unknown as { signal?: AbortSignal }).signal;
        invokeCalled();
        await new Promise<void>((resolve) => {
          if (receivedSignal) {
            receivedSignal.addEventListener('abort', () => { abortObserved = true; resolve(); }, { once: true });
          } else {
            // No signal reaches the gateway today — nothing to listen to. Bounded so THIS TEST
            // doesn't hang the suite; a test-side safety net, not a claim about src's behavior.
            setTimeout(resolve, 3000);
          }
        });
        return { ok: false, provider: 'fake', reason: 'timeout' };
      },
    };
    const mgr = new RunManager({ gateway });

    const runId = await startScript(mgr, `return await agent('slow-call');`);

    // Deterministic: wait for the agent() call to have actually reached the gateway (not merely for
    // status==='running', which flips before the sandbox child even boots) before suspending — avoids
    // a race against the real child process's own startup time.
    await invokeCalledPromise;
    await mgr.suspend(runId);

    // Give the fake gateway's own abort listener a moment to fire, if wired.
    await new Promise((r) => setTimeout(r, 300));

    const view = await mgr.status(runId);
    expect(view.status).toBe('suspended'); // sanity: the status transition itself already works, real, unchanged

    // Forcing red.
    expect(receivedSignal).toBeInstanceOf(AbortSignal);
    expect(abortObserved).toBe(true);
  }, 10000);
});
