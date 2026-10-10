// issue #160 BUG-4 reopen (owner decision, 2026-10-10 third verification): under the pi gateway
// with a provider that never sends mid-turn usage (OpenRouter — the tester's exact repro), an
// attempt aborted by run_suspend/run_stop recorded tokens:0 with no provider/harness signal at
// all. With `budget:{tokens:1}`, repeated suspend/resume cycles never charged ANYTHING, so the
// budget never tripped — contradicting the guide. Fix: when an aborted attempt carries no real
// usage signal from either source (`AgentTranscriptSink.getLiveAttemptUsage`, or the gateway's own
// `result.tokens`), charge a deterministic INPUT-token lower bound estimated from the exact text
// THIS attempt dispatched (`estimateInputTokens`, `ceil(chars/4)`), marked `estimated:true` beside
// `partial:true`, counted toward the run budget exactly like real usage. A real signal — from
// EITHER source — always wins; the estimate never adds on top of it. Applied gateway-neutrally
// (`applyAbortEstimate`), so a `reason:'aborted'` result from `pi-gateway-client.ts`'s OWN internal
// abort check winning the executor's abort race is covered identically to one built by
// `AgentExecutor._finalizeAborted` itself.
// Mock policy (unit, DES-015): a fake GatewayClient stands in for the provider network.
import { describe, it, expect } from 'vitest';
import { AgentExecutor, estimateInputTokens } from '../../src/agent-executor.js';
import { RunGuard } from '../../src/run-guard.js';
import type { GatewayClient, GatewayResult } from '../../src/gateway/client.js';
import type { AgentOpts, Tokens } from '../../src/types.js';
import { defaultRunParams } from '../../src/params/resolve.js';

function req(agentId: string, opts: AgentOpts = {}, signal: AbortSignal = new AbortController().signal, prompt = 'do the thing') {
  return {
    runId: 'run-1', agentId, prompt, opts,
    workspace: '/tmp/ws', signal, runParams: defaultRunParams(undefined),
  };
}

describe('issue #160 BUG-4: estimateInputTokens (pure)', () => {
  it('is a deterministic ceil(chars/4) floor, never a tokenizer', () => {
    expect(estimateInputTokens('')).toBe(0);
    expect(estimateInputTokens('abcd')).toBe(1);
    expect(estimateInputTokens('abcde')).toBe(2);
    expect(estimateInputTokens('a'.repeat(400))).toBe(100);
  });
});

describe('issue #160 BUG-4: AgentExecutor charges an input-token estimate on a silent abort', () => {
  it('a call aborted mid-flight with NO usage signal at all (dispatched, pi/OpenRouter-shaped) is charged an estimated input floor, marked estimated+partial', async () => {
    const gw: GatewayClient = {
      invoke: async () => new Promise<GatewayResult>(() => {}), // never settles, never calls onUsage — the OpenRouter repro
    };
    const guard = new RunGuard({ concurrency: 4, budget: { usd: null, tokens: null } } as never);
    let addUsageCalls = 0;
    let addUsageArgs: unknown[] = [];
    guard.addUsage = ((...args: Parameters<RunGuard['addUsage']>) => { addUsageCalls += 1; addUsageArgs = args; return RunGuard.prototype.addUsage.apply(guard, args); }) as RunGuard['addUsage'];
    const executor = new AgentExecutor({ gateway: gw, guard });
    const ac = new AbortController();
    const prompt = 'x'.repeat(400); // ceil(400/4) = 100 estimated input tokens

    executor.markQueued('a-1');
    const p = executor.run(req('a-1', {}, ac.signal, prompt));
    await new Promise((r) => setTimeout(r, 20));
    ac.abort();
    const out = await p;

    expect(out.kind).toBe('null');
    const record = executor.getRecord('a-1');
    expect(record?.state).toBe('failed');
    expect(record?.failReason).toBe('aborted');
    expect(record?.tokens).toEqual({ input: 100, output: 0, cacheRead: 0, cacheWrite: 0 });
    expect(record?.partial).toBe(true);
    expect(record?.estimated).toBe(true);
    // counted toward the run budget exactly like real usage
    expect(addUsageCalls).toBe(1);
    expect(addUsageArgs[0]).toEqual({ input: 100, output: 0, cacheRead: 0, cacheWrite: 0 });
  });

  it('a call aborted BEFORE the signal was even checked (nothing ever dispatched) stays an honest zero, never estimated', async () => {
    const gw: GatewayClient = { invoke: async () => { throw new Error('must never be called'); } };
    const guard = new RunGuard({ concurrency: 4, budget: { usd: null, tokens: null } } as never);
    const executor = new AgentExecutor({ gateway: gw, guard });
    const ac = new AbortController();
    ac.abort(); // already aborted before run() is ever called

    executor.markQueued('a-2');
    const out = await executor.run(req('a-2', {}, ac.signal, 'x'.repeat(400)));

    expect(out.kind).toBe('null');
    const record = executor.getRecord('a-2');
    expect(record?.tokens).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
    expect(record?.partial).toBe(true);
    expect(record?.estimated).toBeUndefined();
  });

  it('a real (even partial) usage signal always wins — the estimate never adds on top of it', async () => {
    const REAL: Tokens = { input: 11, output: 4, cacheRead: 0, cacheWrite: 0 };
    const gw: GatewayClient = {
      invoke: async (r) => {
        r.onUsage?.(REAL);
        return new Promise<GatewayResult>(() => {});
      },
    };
    const guard = new RunGuard({ concurrency: 4, budget: { usd: null, tokens: null } } as never);
    const executor = new AgentExecutor({ gateway: gw, guard });
    const ac = new AbortController();

    executor.markQueued('a-3');
    const p = executor.run(req('a-3', {}, ac.signal, 'x'.repeat(4000)));
    await new Promise((r) => setTimeout(r, 20));
    ac.abort();
    await p;

    const record = executor.getRecord('a-3');
    expect(record?.tokens).toEqual(REAL);
    expect(record?.partial).toBe(true);
    expect(record?.estimated).toBeUndefined();
  });

  it('a gateway that reports reason:aborted directly (its OWN abort check winning the race, e.g. pi) is estimated identically — the fix is gateway-neutral', async () => {
    const ZERO: Tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    const gw: GatewayClient = {
      invoke: async (r) => {
        await new Promise<void>((resolve) => r.signal?.addEventListener('abort', () => resolve(), { once: true }));
        // pi-gateway-client.ts's own shape: ALWAYS populates `tokens` (even all-zero) with partial:true,
        // never the executor-level 'aborted' sentinel.
        return { ok: false, provider: 'openrouter', transport: 'pi', reason: 'aborted', tokens: ZERO, partial: true, detail: 'aborted' };
      },
    };
    const guard = new RunGuard({ concurrency: 4, budget: { usd: null, tokens: null } } as never);
    const executor = new AgentExecutor({ gateway: gw, guard });
    const ac = new AbortController();
    const prompt = 'y'.repeat(800); // ceil(800/4) = 200

    executor.markQueued('a-4');
    const p = executor.run(req('a-4', {}, ac.signal, prompt));
    await new Promise((r) => setTimeout(r, 20));
    ac.abort();
    await p;

    const record = executor.getRecord('a-4');
    expect(record?.state).toBe('failed');
    expect(record?.tokens).toEqual({ input: 200, output: 0, cacheRead: 0, cacheWrite: 0 });
    expect(record?.partial).toBe(true);
    expect(record?.estimated).toBe(true);
  });

  it('budget: repeated silent aborts of a usage-heavy prompt eventually trip a token budget (the tester\'s exact repro)', async () => {
    const gw: GatewayClient = { invoke: async () => new Promise<GatewayResult>(() => {}) };
    const guard = new RunGuard({ concurrency: 4, budget: { usd: null, tokens: 50 } } as never);
    const executor = new AgentExecutor({ gateway: gw, guard });
    const prompt = 'z'.repeat(400); // 100 estimated tokens per aborted attempt

    for (let i = 0; i < 3; i++) {
      const ac = new AbortController();
      executor.markQueued(`a-budget-${i}`);
      const p = executor.run(req(`a-budget-${i}`, {}, ac.signal, prompt));
      await new Promise((r) => setTimeout(r, 15));
      ac.abort();
      await p;
    }
    expect(() => guard.assertBudget()).toThrow();
  });
});
