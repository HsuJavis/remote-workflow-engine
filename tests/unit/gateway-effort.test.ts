// UT-101 (DES-106, ARCH-069, TASK-102): effort actually reaches the wire — one shared `mapEffort`
// consumed by LiteLLMGatewayClient (direct-fetch path); `thinkingFor` stays the SOLE writer of
// options.thinking for the SDK gateway (regression pin lives in claude-agent-sdk-gateway-thinking.test.ts).
//
// Mock policy (unit): fetchImpl spy intercepts the outbound HTTP call — no network, no live creds.
//
// Red reason: today's LiteLLMGatewayClient never reads req.opts.effort anywhere in callProvider() —
// a 'low' and a 'max' request produce a byte-identical body. Genuine v21 behavioral red.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LiteLLMGatewayClient } from '../../src/gateway/client.js';
import type { GatewayConfig } from '../../src/gateway/client.js';

const ALIASES: GatewayConfig['aliases'] = {
  sonnet: { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
  local: { provider: 'ollama', model: 'qwen2.5:7b' },
};

function spyFetch(): { fetchImpl: typeof fetch; bodies: string[] } {
  const bodies: string[] = [];
  const fetchImpl = (async (_url: unknown, init?: { body?: unknown }) => {
    bodies.push(String(init?.body ?? ''));
    return {
      ok: true,
      status: 200,
      json: async () => ({ content: [{ text: 'ok' }], usage: { input_tokens: 1, output_tokens: 1 } }),
    };
  }) as unknown as typeof fetch;
  return { fetchImpl, bodies };
}

describe('LiteLLMGatewayClient effort-on-the-wire (UT-101, DES-106)', () => {
  const ORIGINAL_KEY = process.env['ANTHROPIC_API_KEY'];
  beforeEach(() => { process.env['ANTHROPIC_API_KEY'] = 'fake-unit-test-key'; });
  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env['ANTHROPIC_API_KEY'];
    else process.env['ANTHROPIC_API_KEY'] = ORIGINAL_KEY;
  });

  it('a provider with a reasoning dial: low vs max produce different outbound request bodies', async () => {
    const low = spyFetch();
    const gwLow = new LiteLLMGatewayClient({ aliases: ALIASES, timeoutMs: 5000, retries: 0, fetchImpl: low.fetchImpl });
    await gwLow.invoke({ prompt: 'hi', opts: { model: 'sonnet', effort: 'low' }, runId: 'r1', agentId: 'a1' });

    const max = spyFetch();
    const gwMax = new LiteLLMGatewayClient({ aliases: ALIASES, timeoutMs: 5000, retries: 0, fetchImpl: max.fetchImpl });
    await gwMax.invoke({ prompt: 'hi', opts: { model: 'sonnet', effort: 'max' }, runId: 'r1', agentId: 'a1' });

    expect(low.bodies[0]).not.toEqual(max.bodies[0]);
  });

  it('effort-absent request composition is byte-identical to a request with no effort key at all (pre-v21 regression pin)', async () => {
    const a = spyFetch();
    const gwA = new LiteLLMGatewayClient({ aliases: ALIASES, timeoutMs: 5000, retries: 0, fetchImpl: a.fetchImpl });
    await gwA.invoke({ prompt: 'hi', opts: { model: 'sonnet' }, runId: 'r1', agentId: 'a1' });

    const b = spyFetch();
    const gwB = new LiteLLMGatewayClient({ aliases: ALIASES, timeoutMs: 5000, retries: 0, fetchImpl: b.fetchImpl });
    await gwB.invoke({ prompt: 'hi', opts: { model: 'sonnet', effort: undefined }, runId: 'r1', agentId: 'a1' });

    expect(a.bodies[0]).toEqual(b.bodies[0]);
  });

  it('a provider with NO reasoning dial (ollama): the harness descriptor records effortApplied:{applied:false,reason} — no 400, no crash', async () => {
    const { fetchImpl } = spyFetch();
    const gw = new LiteLLMGatewayClient({ aliases: ALIASES, timeoutMs: 5000, retries: 0, fetchImpl });
    let captured: { effortApplied?: unknown } | undefined;
    const onHarness = async (h: unknown): Promise<void> => { captured = h as { effortApplied?: unknown }; };
    const result = await gw.invoke({ prompt: 'hi', opts: { model: 'local', effort: 'max' }, runId: 'r1', agentId: 'a1', onHarness });

    expect(result.ok).toBe(true);
    expect(captured?.effortApplied).toEqual(expect.objectContaining({ applied: false }));
  });
});
