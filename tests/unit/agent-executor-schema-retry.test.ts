// UT-016: AgentExecutor — schema outcome performs real JSON-schema validation with
// retry-on-mismatch, never a type-cast passthrough (DES-007, D-V4).
// Fake transport (fakeGateway below) — unit tier per DES-015, mocks freely.
//
// Red reason (2026-07-03, before Gate 6 rework): AgentExecutor.run() (src/agent-executor.ts)
// currently does `if (req.opts.schema) return { kind: 'object', value: result.content as object }`
// — a single gateway.invoke() call, no JSON.parse, no schema validation, no retry. A nonconforming
// first response is returned as-is (still a raw string at runtime despite the `as object` cast),
// so every assertion below fails against today's implementation.
import { describe, it, expect, vi } from 'vitest';
import { AgentExecutor } from '../../src/agent-executor.js';
import type { GatewayClient, GatewayResult } from '../../src/gateway/client.js';
import type { AgentOpts } from '../../src/types.js';
import { defaultRunParams } from '../../src/params/resolve.js';

const ANSWER_SCHEMA = { type: 'object', properties: { answer: { type: 'number' } }, required: ['answer'] };

function req(opts: AgentOpts = {}) {
  return {
    runId: 'run-1',
    agentId: 'agent-1',
    prompt: 'Return a JSON object with field answer set to 42',
    opts,
    workspace: '/tmp/ws',
    signal: new AbortController().signal,
    runParams: defaultRunParams(undefined),
  };
}

function okResult(content: unknown): GatewayResult {
  return { ok: true, provider: 'anthropic', model: 'claude-3', tokens: { input: 10, output: 5 }, content };
}

describe('AgentExecutor schema validation + retry (UT-016, DES-007)', () => {
  it('nonconforming first response retries, then resolves the validated object (no passthrough)', async () => {
    const invoke = vi
      .fn()
      // First attempt: JSON parses, but `answer` violates the schema's `type: number`.
      .mockResolvedValueOnce(okResult('{"answer": "not-a-number"}'))
      // Second attempt: conforms.
      .mockResolvedValueOnce(okResult('{"answer": 42}'));
    const gw: GatewayClient = { invoke };
    const executor = new AgentExecutor({ gateway: gw });

    const out = await executor.run(req({ schema: ANSWER_SCHEMA }));

    // Retry must be observable: the gateway was asked twice, not once.
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(out.kind).toBe('object');
    const value = (out as Extract<typeof out, { kind: 'object' }>).value as { answer: number };
    // No type-cast passthrough: the value is genuinely the parsed+validated object, not the raw string.
    expect(typeof value).toBe('object');
    expect(value.answer).toBe(42);
  });

  it('still-nonconforming after the retry budget is exhausted resolves null (never rejects)', async () => {
    const invoke = vi.fn().mockResolvedValue(okResult('{"answer": "still-not-a-number"}'));
    const gw: GatewayClient = { invoke };
    const executor = new AgentExecutor({ gateway: gw });

    const out = await executor.run(req({ schema: ANSWER_SCHEMA }));

    expect(out.kind).toBe('null');
    // Bounded retries, not an infinite loop.
    expect(invoke.mock.calls.length).toBeGreaterThan(0);
    expect(invoke.mock.calls.length).toBeLessThan(10);
  });
});
