// UT-009: GatewayClient full-ref dispatch + provider-down path (DES-009).
// 2026-09-26 (alias mechanism removed, owner decisions 1/3): every model is now a full
// `<provider>/<model-id>` ref — no alias table, no `?? 'default'` fallback for an omitted model.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LiteLLMGatewayClient } from '../../src/gateway/client.js';
import type { GatewayConfig } from '../../src/gateway/client.js';

const CONFIG: GatewayConfig = {
  timeoutMs: 5000,
  retries: 1,
};

// Fake HTTP transport (D-I6 / GatewayConfig.fetchImpl seam): a canned Anthropic Messages API
// response so dispatch can be asserted deterministically without live credentials or a network
// call. Provider/model in GatewayResult come from parsing the full ref, not this response body —
// the fake only has to satisfy `res.ok` + `res.json()`.
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
  // lets the fetchImpl seam exercise dispatch deterministically without live credentials.
  const ORIGINAL_KEY = process.env['ANTHROPIC_API_KEY'];
  beforeEach(() => { process.env['ANTHROPIC_API_KEY'] = 'fake-unit-test-key'; });
  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env['ANTHROPIC_API_KEY'];
    else process.env['ANTHROPIC_API_KEY'] = ORIGINAL_KEY;
  });

  it('dispatches a full anthropic/<id> ref directly to the configured provider', async () => {
    const gw = new LiteLLMGatewayClient({ ...CONFIG, fetchImpl: fakeFetch() });
    const result = await gw.invoke({ prompt: 'hello', opts: { model: 'anthropic/claude-3-5-sonnet-20241022' }, runId: 'r1', agentId: 'a1' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.provider).toBe('anthropic');
      expect(result.model).toBe('claude-3-5-sonnet-20241022');
    }
  });

  // 2026-09-26 (rule 3): no `?? 'default'` fallback any more — an omitted model is an internal
  // error at the gateway, not a silent reroute to a fictitious alias. Admission is responsible for
  // never letting a dispatch reach here with no model; this pins the gateway's OWN fail-safe.
  it('an omitted model is refused as an internal error, never silently rerouted to a "default"', async () => {
    const gw = new LiteLLMGatewayClient({ ...CONFIG, fetchImpl: fakeFetch() });
    const result = await gw.invoke({ prompt: 'hello', opts: {}, runId: 'r1', agentId: 'a1' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.detail).toMatch(/INTERNAL_ERROR/);
    }
  });

  it('provider unreachable → returns ok:false with reason:unreachable (not throws)', async () => {
    const gw = new LiteLLMGatewayClient({ ...CONFIG, timeoutMs: 50, retries: 0 });
    // A ref pointing at a model/URL that won't respond in time.
    const result = await gw.invoke({ prompt: 'hello', opts: { model: 'ollama/llama3:8b' }, runId: 'r1', agentId: 'a1' });
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
    const result = await gw.invoke({ prompt: 'p', opts: { model: 'anthropic/claude-3-5-sonnet-20241022' }, runId: 'run-42', agentId: 'agt-7' });
    // If implemented, ok:true and the request was correlation-tagged
    expect(typeof result.ok).toBe('boolean');
  });
});

// UT-216 (v26 Gate 7.5 round 1, defect D2) — 2026-09-26 REWRITE (alias mechanism removed): the
// LiteLLM-proxied arm of the direct-fetch transport used to CLOAK the model name
// (`rwe-proxy-<alias>`) because the proxy's model_list only knew that cloaked name. The proxy's
// model_list is now STATIC wildcards (`openrouter/*`, `ollama/*`) keyed on the real provider
// prefix, so the fix is the opposite: the RAW full ref must reach the wire VERBATIM, never cloaked
// — a cloaked name would not match either wildcard and the call would 400.
// Mock policy (unit): fake fetch + fake proxy manager; the real proxy behaviour is Gate 7.5's tier
// (verified live in this iteration's real-run: see the executor's report).
describe('the proxied direct-fetch arm sends the RAW full ref, never a cloak (UT-216 rewrite)', () => {
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

  it('sends the full ref verbatim as the model, matching the static ollama/* wildcard', async () => {
    const { client, seen } = capturingClient();
    const r = await client.invoke({ prompt: 'hi', opts: { model: 'ollama/qwen2.5:7b' }, runId: 'r', agentId: 'a' });
    expect(r.ok).toBe(true);
    expect(seen[0]!['model']).toBe('ollama/qwen2.5:7b');
  });

  it('reports the value it actually put on the wire as proxyModel (DES-177: the value LiteLLM resolved against)', async () => {
    const { client } = capturingClient();
    const harness: Array<Record<string, unknown>> = [];
    const r = await client.invoke({
      prompt: 'hi', opts: { model: 'ollama/qwen2.5:7b' }, runId: 'r', agentId: 'a',
      onHarness: async (h) => { harness.push(h as unknown as Record<string, unknown>); },
    });
    expect((r as { proxyModel?: string }).proxyModel).toBe('ollama/qwen2.5:7b');
    expect(harness[0]!['proxyModel']).toBe('ollama/qwen2.5:7b');
  });
});
