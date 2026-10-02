// issue #127: usage spent on a call that the gateway reports as a non-success outcome is currently
// dropped on the floor at TWO points `AgentExecutor`/`AgentTranscriptSink` own:
//  (1) `capture()`'s failed branch (agent-executor.ts) writes ZERO_TOKENS/costUSD:0 unconditionally
//      and never calls `RunGuard.addUsage` — so even when the gateway NOW reports real tokens on a
//      failure (issue #127's gateway-side fix), the executor still throws them away and the budget
//      ledger never sees them.
//  (2) `_finalizeAborted` (run_suspend/run_stop cutting a call short) records a synthetic failure with
//      no tokens at all — the gateway's own returned Promise is abandoned by the executor's abort
//      race, so whatever it would eventually have reported is lost UNLESS something already streamed
//      it onto the live record before the abort landed.
// This pins the fix: a gateway-reported `tokens`/`partial` on a failed GatewayResult is priced and
// charged via `addUsage` exactly like a success, and a LIVE `onUsage` callback keeps the in-flight
// agent's record hot so `_finalizeAborted` can read it even when the gateway's own Promise never
// settles from this process's point of view.
// Mock policy (unit, DES-015): a fake GatewayClient stands in for the provider network.
import { describe, it, expect } from 'vitest';
import { AgentExecutor } from '../../src/agent-executor.js';
import { RunGuard } from '../../src/run-guard.js';
import type { GatewayClient, GatewayResult } from '../../src/gateway/client.js';
import type { AgentOpts, Tokens } from '../../src/types.js';
import { defaultRunParams } from '../../src/params/resolve.js';

function req(agentId: string, opts: AgentOpts = {}, signal: AbortSignal = new AbortController().signal) {
  return {
    runId: 'run-1', agentId, prompt: 'do the thing', opts,
    workspace: '/tmp/ws', signal, runParams: defaultRunParams(undefined),
  };
}

const T: Tokens = { input: 7, output: 3, cacheRead: 0, cacheWrite: 0 };

describe('issue #127: AgentExecutor/AgentTranscriptSink partial usage accounting', () => {
  it('a failed GatewayResult carrying tokens prices and charges them (addUsage), never ZERO_TOKENS', async () => {
    const gw: GatewayClient = { invoke: async () => ({ ok: false, provider: 'anthropic', reason: 'aborted', detail: 'cut short', tokens: T, partial: true } as GatewayResult) };
    const guard = new RunGuard({ concurrency: 4, budget: { usd: null, tokens: null } } as never);
    let addUsageCalls = 0;
    let addUsageArgs: unknown[] = [];
    const origAddUsage = guard.addUsage.bind(guard);
    guard.addUsage = ((...args: Parameters<RunGuard['addUsage']>) => { addUsageCalls += 1; addUsageArgs = args; return origAddUsage(...args); }) as RunGuard['addUsage'];
    const executor = new AgentExecutor({ gateway: gw, guard });

    executor.markQueued('a-1');
    const out = await executor.run(req('a-1'));
    expect(out.kind).toBe('null');

    expect(addUsageCalls).toBe(1);
    expect(addUsageArgs[0]).toEqual(T);

    const record = executor.getRecord('a-1');
    expect(record?.state).toBe('failed');
    expect(record?.tokens).toEqual(T);
    expect(record?.partial).toBe(true);
    // priced with no pinned price (no priceBook) -> unpriced, costUSD 0, but still ACCOUNTED (not
    // the pre-#127 "never dispatched" shape).
    expect(record?.unpriced).toBe(true);
    expect(record?.costUSD).toBe(0);
  });

  it('a failed GatewayResult with NO tokens keeps the pre-#127 shape (ZERO_TOKENS, no addUsage call, no partial)', async () => {
    const gw: GatewayClient = { invoke: async () => ({ ok: false, provider: 'anthropic', reason: 'terminal', detail: 'refused before dispatch' }) };
    const guard = new RunGuard({ concurrency: 4, budget: { usd: null, tokens: null } } as never);
    let addUsageCalls = 0;
    guard.addUsage = ((...args: Parameters<RunGuard['addUsage']>) => { addUsageCalls += 1; return RunGuard.prototype.addUsage.apply(guard, args); }) as RunGuard['addUsage'];
    const executor = new AgentExecutor({ gateway: gw, guard });

    executor.markQueued('a-2');
    await executor.run(req('a-2'));

    expect(addUsageCalls).toBe(0);
    const record = executor.getRecord('a-2');
    expect(record?.tokens).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
    expect(record?.partial).toBeUndefined();
  });

  it('a call aborted mid-flight still records the live-streamed usage (gateway Promise abandoned)', async () => {
    const gw: GatewayClient = {
      invoke: async (r) => {
        r.onUsage?.(T);
        return new Promise<GatewayResult>(() => {}); // never settles — models the abandoned attempt
      },
    };
    const guard = new RunGuard({ concurrency: 4, budget: { usd: null, tokens: null } } as never);
    const executor = new AgentExecutor({ gateway: gw, guard });
    const ac = new AbortController();

    executor.markQueued('a-3');
    const p = executor.run(req('a-3', {}, ac.signal));
    await new Promise((r) => setTimeout(r, 20)); // let onUsage land before aborting
    ac.abort();
    const out = await p;

    expect(out.kind).toBe('null');
    expect((out as { aborted?: boolean }).aborted).toBe(true);
    const record = executor.getRecord('a-3');
    expect(record?.state).toBe('failed');
    expect(record?.failReason).toBe('aborted');
    expect(record?.tokens).toEqual(T);
    expect(record?.partial).toBe(true);
  });

  it('budget: repeated aborts of a usage-heavy agent eventually trip the token budget', async () => {
    const gw: GatewayClient = {
      invoke: async (r) => {
        r.onUsage?.({ input: 400, output: 0, cacheRead: 0, cacheWrite: 0 });
        return new Promise<GatewayResult>(() => {});
      },
    };
    const guard = new RunGuard({ concurrency: 4, budget: { usd: null, tokens: 1000 } } as never);
    const executor = new AgentExecutor({ gateway: gw, guard });

    for (let i = 0; i < 3; i++) {
      const ac = new AbortController();
      executor.markQueued(`a-budget-${i}`);
      const p = executor.run(req(`a-budget-${i}`, {}, ac.signal));
      await new Promise((r) => setTimeout(r, 15));
      ac.abort();
      await p;
    }
    // 3 * 400 = 1200 >= 1000 token budget
    expect(() => guard.assertBudget()).toThrow();
  });
});
