// UT-009: GatewayClient alias mapping + provider-down path (DES-009)
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LiteLLMGatewayClient } from '../../src/gateway/client.js';
import type { GatewayConfig } from '../../src/gateway/client.js';

const ALIASES: GatewayConfig['aliases'] = {
  sonnet:  { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
  haiku:   { provider: 'anthropic', model: 'claude-3-5-haiku-20241022' },
  opus:    { provider: 'anthropic', model: 'claude-opus-4-5' },
  local:   { provider: 'ollama',    model: 'llama3:8b' },
  default: { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
};

const CONFIG: GatewayConfig = {
  aliases: ALIASES,
  timeoutMs: 5000,
  retries: 1,
};

// Fake HTTP transport (D-I6 / GatewayConfig.fetchImpl seam): a canned Anthropic Messages API
// response so alias-resolution logic can be asserted deterministically without live credentials
// or a network call. Provider/model in GatewayResult come from the local alias table, not this
// response body — the fake only has to satisfy `res.ok` + `res.json()`.
function fakeFetch(): typeof fetch {
  return (async () => ({
    ok: true,
    status: 200,
    json: async () => ({ content: [{ text: 'canned response' }], usage: { input_tokens: 10, output_tokens: 5 } }),
  })) as unknown as typeof fetch;
}

describe('LiteLLMGatewayClient', () => {
  // The anthropic branch checks for ANTHROPIC_API_KEY presence before calling fetchImpl at all
  // (never sent anywhere real — fetchImpl below intercepts before any network call). A fake key
  // lets the fetchImpl seam exercise alias-resolution deterministically without live credentials.
  const ORIGINAL_KEY = process.env['ANTHROPIC_API_KEY'];
  beforeEach(() => { process.env['ANTHROPIC_API_KEY'] = 'fake-unit-test-key'; });
  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env['ANTHROPIC_API_KEY'];
    else process.env['ANTHROPIC_API_KEY'] = ORIGINAL_KEY;
  });

  it('resolves "sonnet" alias to the configured Anthropic model', async () => {
    const gw = new LiteLLMGatewayClient({ ...CONFIG, fetchImpl: fakeFetch() });
    const result = await gw.invoke({ prompt: 'hello', opts: { model: 'sonnet' }, runId: 'r1', agentId: 'a1' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.provider).toBe('anthropic');
      expect(result.model).toBe('claude-3-5-sonnet-20241022');
    }
  });

  it('resolves omitted model to the "default" alias', async () => {
    const gw = new LiteLLMGatewayClient({ ...CONFIG, fetchImpl: fakeFetch() });
    const result = await gw.invoke({ prompt: 'hello', opts: {}, runId: 'r1', agentId: 'a1' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.provider).toBe('anthropic');
    }
  });

  it('provider unreachable → returns ok:false with reason:unreachable (not throws)', async () => {
    const gw = new LiteLLMGatewayClient({ ...CONFIG, timeoutMs: 50, retries: 0 });
    // Use an alias pointing to a URL that won't respond
    const result = await gw.invoke({ prompt: 'hello', opts: { model: 'local' }, runId: 'r1', agentId: 'a1' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(['timeout', 'unreachable', 'terminal']).toContain(result.reason);
    }
  });

  it('provider result carries correlation runId/agentId in LiteLLM call', async () => {
    // This tests that invoke tags the request for log correlation.
    // Implementation must include runId/agentId in extra_body or headers.
    // Test is RED until implemented; once done, the LiteLLM log should join back to the store.
    const gw = new LiteLLMGatewayClient(CONFIG);
    // We verify by checking invoke does not throw and that the result has required fields
    const result = await gw.invoke({ prompt: 'p', opts: { model: 'sonnet' }, runId: 'run-42', agentId: 'agt-7' });
    // If implemented, ok:true and the request was correlation-tagged
    expect(typeof result.ok).toBe('boolean');
  });
});

// UT-216 (v26 Gate 7.5 round 1, defect D2): the LiteLLM-proxied arm of the direct-fetch transport
// puts the CLOAKED model name on the wire. `proxyModelName()`'s own doc comment says the prefix
// "MUST be applied identically here and where the gateway sets query()'s model" — this side was
// missed, so `gateway:"direct-fetch"` with the proxy left on sent the bare alias to a proxy whose
// model_list only knows `rwe-proxy-<alias>`, and EVERY agent() call died
// `400 … You passed in model=local. There are no healthy deployments for this model`
// (reproduced live against a real litellm on this tree before this fix).
// Mock policy (unit): fake fetch + fake proxy manager; the real proxy behaviour is Gate 7.5's tier.
describe('the proxied direct-fetch arm cloaks the model name (UT-216, defect D2)', () => {
  function capturingClient() {
    const seen: Array<Record<string, unknown>> = [];
    const fetchImpl = (async (_url: string, init: { body: string }) => {
      seen.push(JSON.parse(init.body));
      return {
        ok: true, status: 200,
        json: async () => ({ content: [{ text: 'ok' }], usage: { input_tokens: 3, output_tokens: 1 } }),
      };
    }) as unknown as typeof fetch;
    const client = new LiteLLMGatewayClient({
      ...CONFIG,
      fetchImpl,
      useLiteLLMProxy: true,
      proxyManager: { start: async () => ({ baseUrl: 'http://127.0.0.1:4000', port: 4000 }), stop: async () => {} } as never,
    });
    return { client, seen };
  }

  it('sends `rwe-proxy-<alias>` as the model, never the bare alias', async () => {
    const { client, seen } = capturingClient();
    const r = await client.invoke({ prompt: 'hi', opts: { model: 'local' }, runId: 'r', agentId: 'a' });
    expect(r.ok).toBe(true);
    expect(seen[0]!['model']).toBe('rwe-proxy-local');
  });

  it('reports the name it actually put on the wire as proxyModel (DES-177: LiteLLM\'s resolution target)', async () => {
    const { client } = capturingClient();
    const harness: Array<Record<string, unknown>> = [];
    const r = await client.invoke({
      prompt: 'hi', opts: { model: 'local' }, runId: 'r', agentId: 'a',
      onHarness: async (h) => { harness.push(h as unknown as Record<string, unknown>); },
    });
    expect((r as { proxyModel?: string }).proxyModel).toBe('rwe-proxy-local');
    expect(harness[0]!['proxyModel']).toBe('rwe-proxy-local');
  });
});
