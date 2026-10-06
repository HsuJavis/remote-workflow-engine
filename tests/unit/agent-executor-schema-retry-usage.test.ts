// issue #141: a schema-bearing agent() call's bounded re-ask loop (D-V4, SCHEMA_RETRY_ATTEMPTS) used
// to let each attempt's capture() REPLACE the live AgentRecord's tokens/costUSD instead of adding to
// it — only the LAST attempt's figures survived. That undercounted the run's displayed costUSD/
// tokens and a resumed run's re-armed budget (both fold from the SAME AgentRecords), and the record
// briefly showed state:'done' with an endedAt after the FIRST (still-retrying) attempt before being
// silently rewritten. The #127 fix made a FAILED call's usage addable instead of droppable; this is
// the analogous fix for the EXECUTOR-level schema re-ask path (never touched by #127, which is about
// a single gateway.invoke() call's own internal retry/abort).
//
// Mock policy (unit, DES-015): a fake GatewayClient stands in for the provider network, exactly like
// agent-executor-schema-retry.test.ts (UT-016) and agent-executor-partial-usage.test.ts (#127).
import { describe, it, expect, vi } from 'vitest';
import { AgentExecutor } from '../../src/agent-executor.js';
import { RunGuard } from '../../src/run-guard.js';
import { InMemoryRunStore, deriveAgentRecords } from '../../src/run-store.js';
import { FixedClock } from '../../src/clock.js';
import type { GatewayClient, GatewayResult } from '../../src/gateway/client.js';
import type { AgentOpts, HarnessDescriptor, PriceBook, Tokens } from '../../src/types.js';
import { defaultRunParams } from '../../src/params/resolve.js';

const ANSWER_SCHEMA = { type: 'object', properties: { answer: { type: 'number' } }, required: ['answer'] };

// `runId` defaults to 'run-1' for the guard-only tests below (no RunStore, so the value is never
// looked up); the store-backed tests pass the REAL id `store.createRun()` returned — InMemoryRunStore
// silently drops `appendTranscript` calls for an unknown runId, so a mismatched literal here would
// make every assertion against `store.getTranscript` false-negative (empty), not a real failure.
function req(agentId: string, opts: AgentOpts = {}, signal: AbortSignal = new AbortController().signal, runId = 'run-1') {
  return {
    runId, agentId, prompt: 'Return a JSON object with field answer set to 42', opts,
    workspace: '/tmp/ws', signal, runParams: defaultRunParams(undefined),
  };
}

function okResult(tokens: { input: number; output: number }, content: unknown): GatewayResult {
  return { ok: true, provider: 'anthropic', model: 'claude-3', tokens: { ...tokens, cacheRead: 0, cacheWrite: 0 }, content };
}

const BOOK: PriceBook = {
  fetchedAt: '2026-10-05T00:00:00Z',
  source: 'static',
  pinned: {
    'anthropic/claude-3': { price: { in: 0.001, out: 0.002, cacheRead: 0, cacheWrite: 0 }, caps: { reasoning: 'unknown', tools: 'unknown', source: 'static' } },
  },
};

describe('issue #141: schema re-ask attempts SUM onto one AgentRecord, never replace it', () => {
  it('fails once then passes: tokens/costUSD equal the SUM of both attempts, in ONE usage event, charged to the guard per attempt', async () => {
    const guard = new RunGuard({ concurrency: 4, budget: { usd: null, tokens: null } } as never);
    const addUsageArgs: Array<[Tokens, number, boolean]> = [];
    const orig = guard.addUsage.bind(guard);
    guard.addUsage = ((...args: Parameters<RunGuard['addUsage']>) => {
      addUsageArgs.push([args[0], args[1], args[2]]);
      return orig(...args);
    }) as RunGuard['addUsage'];

    const invoke = vi
      .fn()
      .mockResolvedValueOnce(okResult({ input: 100, output: 50 }, '{"answer": "not-a-number"}'))
      .mockResolvedValueOnce(okResult({ input: 40, output: 20 }, '{"answer": 42}'));
    const gw: GatewayClient = { invoke };
    const store = new InMemoryRunStore(new FixedClock(new Date('2026-10-05T00:00:00Z')));
    const runId = await store.createRun({ name: 'ut141-sum', script: 'return 1;' } as any);
    const executor = new AgentExecutor({ gateway: gw, guard, store, priceBook: BOOK });

    const out = await executor.run(req('a-1', { schema: ANSWER_SCHEMA }, new AbortController().signal, runId));

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(out.kind).toBe('object');

    // Guard charged ONCE PER ATTEMPT, with that attempt's OWN delta — never the running total.
    expect(addUsageArgs).toHaveLength(2);
    expect(addUsageArgs[0]![0]).toEqual({ input: 100, output: 50, cacheRead: 0, cacheWrite: 0 });
    expect(addUsageArgs[1]![0]).toEqual({ input: 40, output: 20, cacheRead: 0, cacheWrite: 0 });

    const record = executor.getRecord('a-1');
    expect(record?.state).toBe('done');
    expect(record?.tokens).toEqual({ input: 140, output: 70, cacheRead: 0, cacheWrite: 0 });
    // costUSD = (100*0.001+50*0.002) + (40*0.001+20*0.002) = 0.2 + 0.08 = 0.28
    expect(record?.costUSD).toBeCloseTo(0.28, 10);
    expect(record?.unpriced).toBe(false);

    // Exactly ONE usage transcript event for this agentId, carrying the FULL sum.
    const events = await store.getTranscript(runId, 'a-1');
    const usageEvents = events.filter((e) => e.kind === 'usage');
    expect(usageEvents).toHaveLength(1);
    const usageData = usageEvents[0]!.data as { tokens: Tokens; costUSD: number };
    expect(usageData.tokens).toEqual({ input: 140, output: 70, cacheRead: 0, cacheWrite: 0 });
    expect(usageData.costUSD).toBeCloseTo(0.28, 10);
  });

  it('fails three times then resolves null: total is the sum of all three attempts, schema-exhausted outcome is unchanged (state stays done)', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce(okResult({ input: 10, output: 10 }, '{"answer": "nope-1"}'))
      .mockResolvedValueOnce(okResult({ input: 20, output: 20 }, '{"answer": "nope-2"}'))
      .mockResolvedValueOnce(okResult({ input: 30, output: 30 }, '{"answer": "nope-3"}'));
    const gw: GatewayClient = { invoke };
    const executor = new AgentExecutor({ gateway: gw });

    const out = await executor.run(req('a-2', { schema: ANSWER_SCHEMA }));

    expect(invoke).toHaveBeenCalledTimes(3); // SCHEMA_RETRY_ATTEMPTS
    expect(out.kind).toBe('null'); // schema-exhausted outcome: unchanged

    const record = executor.getRecord('a-2');
    expect(record?.state).toBe('done'); // schema exhaustion is not a gateway failure — unchanged
    expect(record?.tokens).toEqual({ input: 60, output: 60, cacheRead: 0, cacheWrite: 0 });
    expect(record?.endedAt).toBeDefined();
    // issue #162 (owner-approved): the exhausted outcome now ALSO stamps schemaExhausted/
    // reaskCount, so summarizeAgentFailures (run-manager.ts) can surface it in agentFailures even
    // though `state` stays 'done'. reaskCount:2 — the LAST attempt (0-indexed) is the one that ends
    // the loop (SCHEMA_RETRY_ATTEMPTS=3, so attempts are 0/1/2).
    expect(record?.schemaExhausted).toBe(true);
    expect(record?.reaskCount).toBe(2);
  });

  // issue #162: the conforming case (every OTHER test in this file where `out.kind === 'object'`)
  // must NEVER carry schemaExhausted, even on a call whose first attempt(s) failed validation and
  // a LATER one conformed — otherwise a perfectly successful retried call would misreport as a
  // failure in agentFailures.
  it('conforms on a later attempt: schemaExhausted is absent, even though earlier attempts retried', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce(okResult({ input: 5, output: 5 }, '{"answer": "nope"}'))
      .mockResolvedValueOnce(okResult({ input: 5, output: 5 }, '{"answer": 42}'));
    const gw: GatewayClient = { invoke };
    const executor = new AgentExecutor({ gateway: gw });

    const out = await executor.run(req('a-2b', { schema: ANSWER_SCHEMA }));
    expect(out.kind).toBe('object');

    const record = executor.getRecord('a-2b');
    expect(record?.schemaExhausted).toBeUndefined();
    expect(record?.reaskCount).toBeUndefined();
  });

  // RED WAS NOT OBSERVED for this one (recorded honestly, same convention as this repo's IT-174):
  // `RunGuard.addUsage` was already called once PER ATTEMPT before this fix (agent-executor.ts's
  // `capture()` called it unconditionally in its `ok` branch, on every attempt) — the guard's own
  // running total was never the bug; only the per-agent RECORD (and anything that folds FROM it,
  // e.g. a resumed run's re-armed budget) forgot everything but the last attempt. This test still
  // passes pre-fix. It is kept as a regression LOCK for the guard's own accumulation, not a repro.
  it('the budget trips on the SUMMED amount, not just the last attempt\'s', async () => {
    const guard = new RunGuard({ concurrency: 4, budget: { usd: null, tokens: 150 } } as never);
    const invoke = vi
      .fn()
      .mockResolvedValueOnce(okResult({ input: 60, output: 40 }, '{"answer": "nope"}')) // 100 tokens
      .mockResolvedValueOnce(okResult({ input: 40, output: 20 }, '{"answer": 42}'));      // +60 tokens = 160 > 150
    const gw: GatewayClient = { invoke };
    const executor = new AgentExecutor({ gateway: gw, guard });

    const out = await executor.run(req('a-3', { schema: ANSWER_SCHEMA }));
    expect(out.kind).toBe('object'); // the in-flight call itself still completes (D-F exact budget semantics)

    expect(() => guard.assertBudget()).toThrow();
  });

  it('no transient "done" state is observable between attempts — an intermediate attempt stays "running"', async () => {
    let executor!: AgentExecutor;
    let stateDuringAttempt1: string | undefined;
    const invoke = vi
      .fn()
      .mockResolvedValueOnce(okResult({ input: 5, output: 5 }, '{"answer": "nope"}'))
      .mockImplementationOnce(async () => {
        // Attempt 0 has already resolved and called capture() by the time attempt 1 dispatches.
        stateDuringAttempt1 = executor.getRecord('a-4')?.state;
        return okResult({ input: 5, output: 5 }, '{"answer": 42}');
      });
    const gw: GatewayClient = { invoke };
    executor = new AgentExecutor({ gateway: gw });

    const out = await executor.run(req('a-4', { schema: ANSWER_SCHEMA }));

    expect(out.kind).toBe('object');
    expect(stateDuringAttempt1).toBe('running'); // never 'done' mid-retry
  });

  it('fold after restart equals live: deriveAgentRecords over the persisted transcript matches executor.getRecord', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce(okResult({ input: 12, output: 8 }, '{"answer": "nope"}'))
      .mockResolvedValueOnce(okResult({ input: 6, output: 4 }, '{"answer": 42}'));
    const gw: GatewayClient = { invoke };
    const store = new InMemoryRunStore(new FixedClock(new Date('2026-10-05T00:00:00Z')));
    const runId = await store.createRun({ name: 'ut141-fold', script: 'return 1;' } as any);
    const executor = new AgentExecutor({ gateway: gw, store });

    await executor.run(req('a-5', { schema: ANSWER_SCHEMA }, new AbortController().signal, runId));

    const live = executor.getRecord('a-5')!;
    const events = await store.getTranscript(runId, 'a-5');
    const derived = deriveAgentRecords(new Map([['a-5', events]]), 'completed').find((r) => r.agentId === 'a-5')!;

    expect(derived.state).toBe(live.state);
    expect(derived.tokens).toEqual(live.tokens);
    expect(derived.costUSD).toEqual(live.costUSD);
    expect(derived.unpriced).toEqual(live.unpriced);
  });

  // issue #162: the SAME derived≡snapshot-less-restart lock as the test directly above, but for the
  // EXHAUSTED outcome specifically — schemaExhausted/reaskCount must survive a restart that has no
  // terminal snapshot and reconstructs purely from the persisted usage event (deriveAgentRecords).
  it('fold after restart equals live for the EXHAUSTED outcome too: schemaExhausted/reaskCount both survive', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce(okResult({ input: 10, output: 10 }, '{"answer": "nope-1"}'))
      .mockResolvedValueOnce(okResult({ input: 10, output: 10 }, '{"answer": "nope-2"}'))
      .mockResolvedValueOnce(okResult({ input: 10, output: 10 }, '{"answer": "nope-3"}'));
    const gw: GatewayClient = { invoke };
    const store = new InMemoryRunStore(new FixedClock(new Date('2026-10-05T00:00:00Z')));
    const runId = await store.createRun({ name: 'ut162-fold-exhausted', script: 'return 1;' } as any);
    const executor = new AgentExecutor({ gateway: gw, store });

    const out = await executor.run(req('a-6', { schema: ANSWER_SCHEMA }, new AbortController().signal, runId));
    expect(out.kind).toBe('null');

    const live = executor.getRecord('a-6')!;
    expect(live.schemaExhausted).toBe(true);
    expect(live.reaskCount).toBe(2);

    const events = await store.getTranscript(runId, 'a-6');
    const derived = deriveAgentRecords(new Map([['a-6', events]]), 'completed').find((r) => r.agentId === 'a-6')!;

    expect(derived.state).toBe(live.state);
    expect(derived.schemaExhausted).toBe(live.schemaExhausted);
    expect(derived.reaskCount).toBe(live.reaskCount);
  });

  it('abort during a re-ask keeps the committed attempt-0 total AND the in-flight attempt-1 partial figure, charging the guard exactly once per attempt (#127 partial semantics)', async () => {
    const guard = new RunGuard({ concurrency: 4, budget: { usd: null, tokens: null } } as never);
    const addUsageArgs: Tokens[] = [];
    const orig = guard.addUsage.bind(guard);
    guard.addUsage = ((...args: Parameters<RunGuard['addUsage']>) => {
      addUsageArgs.push(args[0]);
      return orig(...args);
    }) as RunGuard['addUsage'];

    let calls = 0;
    const gw: GatewayClient = {
      invoke: async (r) => {
        calls += 1;
        if (calls === 1) return okResult({ input: 100, output: 50 }, '{"answer": "nope"}');
        // Attempt 1 (the re-ask): streams a partial figure, then the gateway's own Promise is
        // abandoned — models the abort race `_invokeOnce` loses against.
        r.onUsage?.({ input: 10, output: 5, cacheRead: 0, cacheWrite: 0 });
        return new Promise<GatewayResult>(() => {});
      },
    };
    const executor = new AgentExecutor({ gateway: gw, guard });
    const ac = new AbortController();

    const p = executor.run(req('a-6', { schema: ANSWER_SCHEMA }, ac.signal));
    await new Promise((r) => setTimeout(r, 20)); // let attempt 0 resolve and attempt 1's onUsage land
    ac.abort();
    const out = await p;

    expect(out.kind).toBe('null');
    expect((out as { aborted?: boolean }).aborted).toBe(true);

    const record = executor.getRecord('a-6');
    expect(record?.state).toBe('failed');
    expect(record?.failReason).toBe('aborted');
    // 100+10 input, 50+5 output — attempt 0's committed total PLUS attempt 1's in-flight partial.
    expect(record?.tokens).toEqual({ input: 110, output: 55, cacheRead: 0, cacheWrite: 0 });
    expect(record?.partial).toBe(true);

    // The guard was charged attempt 0's delta at its own (non-final) capture, and attempt 1's delta
    // at the abort-finalize capture — never attempt 0's total a second time.
    expect(addUsageArgs).toHaveLength(2);
    expect(addUsageArgs[0]).toEqual({ input: 100, output: 50, cacheRead: 0, cacheWrite: 0 });
    expect(addUsageArgs[1]).toEqual({ input: 10, output: 5, cacheRead: 0, cacheWrite: 0 });
  });

  it('harness.prompt stays the verbatim dispatched string (ADR-061) on every attempt — never pinned back to attempt 0’s; reaskCount names how many re-asks preceded it', async () => {
    const descriptorFor = (prompt: string): HarnessDescriptor => ({
      model: 'claude-3', provider: 'anthropic', prompt, tools: [], skills: [], mcpServers: [], surfaceType: 'none',
    });
    const promptsSeenByGateway: string[] = [];
    let calls = 0;
    const gw: GatewayClient = {
      invoke: async (r) => {
        calls += 1;
        promptsSeenByGateway.push(r.prompt);
        await r.onHarness?.(descriptorFor(r.prompt));
        return calls === 1
          ? okResult({ input: 1, output: 1 }, '{"answer": "nope"}')
          : okResult({ input: 1, output: 1 }, '{"answer": 42}');
      },
    };
    const store = new InMemoryRunStore(new FixedClock(new Date('2026-10-05T00:00:00Z')));
    const runId = await store.createRun({ name: 'ut141-harness', script: 'return 1;' } as any);
    const executor = new AgentExecutor({ gateway: gw, store });

    await executor.run(req('a-7', { schema: ANSWER_SCHEMA }, new AbortController().signal, runId));

    expect(promptsSeenByGateway).toHaveLength(2);
    const events = await store.getTranscript(runId, 'a-7');
    const harnessEvents = events.filter((e) => e.kind === 'harness');
    expect(harnessEvents).toHaveLength(2);
    const d0 = (harnessEvents[0]!.data as { descriptor: HarnessDescriptor }).descriptor;
    const d1 = (harnessEvents[1]!.data as { descriptor: HarnessDescriptor }).descriptor;
    // The real ADR-061 pin: each PERSISTED descriptor's prompt is EXACTLY what the gateway was
    // handed on THAT call — agent-executor.ts's `onHarness` decoration must not overwrite `prompt`
    // back to attempt 0's (the option this fix explicitly rejected — see `reaskCount`'s own doc).
    expect(d0.prompt).toBe(promptsSeenByGateway[0]);
    expect(d1.prompt).toBe(promptsSeenByGateway[1]);
    expect(d0.reaskCount).toBeUndefined();
    expect(d1.reaskCount).toBe(1);
    // ADR-061: each descriptor's prompt is the EXACT string THAT dispatch sent — the re-ask nudge
    // makes attempt 1's prompt a strict extension of attempt 0's, never pinned back to attempt 0's.
    expect(d1.prompt.startsWith(d0.prompt)).toBe(true);
    expect(d1.prompt).not.toBe(d0.prompt);
  });
});
