// UT-101 (DES-106, ARCH-069, TASK-102): effort actually reaches the wire — one shared `mapEffort`
// consumed by LiteLLMGatewayClient (direct-fetch path); `thinkingFor` stays the SOLE writer of
// options.thinking for the SDK gateway (regression pin lives in claude-agent-sdk-gateway-thinking.test.ts).
//
// Mock policy (unit): fetchImpl spy intercepts the outbound HTTP call — no network, no live creds.
//
// Red reason: today's LiteLLMGatewayClient never reads req.opts.effort anywhere in callProvider() —
// a 'low' and a 'max' request produce a byte-identical body. Genuine v21 behavioral red.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import { LiteLLMGatewayClient } from '../../src/gateway/client.js';
import type { GatewayConfig } from '../../src/gateway/client.js';
import { LiteLLMProxyManager } from '../../src/gateway/litellm-proxy.js';

const ALIASES: GatewayConfig['aliases'] = {
  sonnet: { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
  local: { provider: 'ollama', model: 'qwen2.5:7b' },
};

// Same fake-proxy pattern as tests/integration/gateway-provider-down.test.ts (IT-005): the proxy's
// OWN health-check spawn/fetch are faked so proxy.start() resolves instantly with no real
// subprocess — GatewayConfig.fetchImpl (spyFetch below) is a SEPARATE injection point that captures
// the actual outbound /v1/messages call.
function makeFakeProxyManager(): LiteLLMProxyManager {
  const fakeSpawn = vi.fn(() => ({ exitCode: null, kill: vi.fn() }) as unknown as ChildProcess);
  const fakeHealthFetch = vi.fn(async () => ({ ok: true }) as unknown as Response);
  return new LiteLLMProxyManager(ALIASES, {
    spawnImpl: fakeSpawn as unknown as typeof import('node:child_process').spawn,
    fetchImpl: fakeHealthFetch as unknown as typeof fetch,
  });
}

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

// v21 Gate 5 re-run (2026-08-31, A-7 / 04-design.md "Orchestrator adjudication — v21 Gate 6
// send-back"): `mapEffort` is called ONCE per invoke and the SAME `applied` object already flows to
// BOTH `callProvider` (direct-fetch) and `callViaLiteLLMProxy` (proxy) — only the direct-fetch
// branch has a red test pinning it today (the case above). This adds the proxy branch's own
// contract test, per DES-108's per-tier mock policy (UT tier, no network): the proxy's own
// health-check spawn/fetch are faked (makeFakeProxyManager), GatewayConfig.fetchImpl captures the
// real outbound /v1/messages body.
describe('LiteLLMGatewayClient effort-on-the-wire — LiteLLM-proxy branch (UT-101, DES-106, v21 Gate 5 re-run A-7)', () => {
  const ORIGINAL_KEY = process.env['ANTHROPIC_API_KEY'];
  beforeEach(() => { process.env['ANTHROPIC_API_KEY'] = 'fake-unit-test-key'; });
  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env['ANTHROPIC_API_KEY'];
    else process.env['ANTHROPIC_API_KEY'] = ORIGINAL_KEY;
  });

  it('the mapped effort value reaches the outbound request on the LiteLLM-proxy branch', async () => {
    const { fetchImpl, bodies } = spyFetch();
    const gw = new LiteLLMGatewayClient({
      aliases: ALIASES, timeoutMs: 5000, retries: 0,
      useLiteLLMProxy: true, proxyManager: makeFakeProxyManager(),
      fetchImpl,
    });
    await gw.invoke({ prompt: 'hi', opts: { model: 'sonnet', effort: 'max' }, runId: 'r1', agentId: 'a1' });

    expect(bodies).toHaveLength(1);
    const parsed = JSON.parse(bodies[0]!) as { effort?: string };
    expect(parsed.effort).toBe('max');
  });

  it('a provider with NO reasoning dial on the proxy branch: onHarness records applied:false and no effort key reaches the outbound proxy body', async () => {
    const { fetchImpl, bodies } = spyFetch();
    const gw = new LiteLLMGatewayClient({
      aliases: ALIASES, timeoutMs: 5000, retries: 0,
      useLiteLLMProxy: true, proxyManager: makeFakeProxyManager(),
      fetchImpl,
    });
    let captured: { effortApplied?: unknown } | undefined;
    const onHarness = async (h: unknown): Promise<void> => { captured = h as { effortApplied?: unknown }; };
    const result = await gw.invoke({ prompt: 'hi', opts: { model: 'local', effort: 'max' }, runId: 'r1', agentId: 'a1', onHarness });

    expect(result.ok).toBe(true);
    expect(captured?.effortApplied).toEqual(expect.objectContaining({ applied: false }));
    const parsed = JSON.parse(bodies[0]!) as Record<string, unknown>;
    expect(parsed['effort']).toBeUndefined();
  });
});
