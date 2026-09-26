// REQ-038: `openrouter` first-class provider — direct-fetch routing (OpenAI-shaped POST to
// openrouter.ai with Bearer OPENROUTER_API_KEY) and the LiteLLM `openrouter/*` passthrough
// wildcard. Unit tier (D-I6): a fake fetch transport — never a live network call.
//
// 2026-09-26 (alias mechanism removed): every model is now a full `<provider>/<model-id>` ref —
// `toLiteLLMModelName`/the per-alias LiteLLM config row are RETIRED (the proxy's model_list is a
// static two-wildcard config, see litellm-config-generate.test.ts); the registration-time
// "openrouter passthrough at the script check" describe below is REMOVED (not rewritten) — that
// mechanism (`ScriptCheckPorts.aliases`, `script-checks.ts`'s model-literal scan) is deleted
// entirely, and the model-ref check now lives ONLY in `params/contract.ts`'s registration-time
// `checkModelRef`, already covered by `tests/unit/params-contract.test.ts`'s full-ref rewrite.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LiteLLMGatewayClient } from '../../src/gateway/client.js';
import { generateLiteLLMConfig } from '../../src/gateway/litellm-proxy.js';

/** Records the last request and returns a canned OpenAI-shaped chat completion. */
function recordingFetch(): { impl: typeof fetch; last: () => { url: string; init: RequestInit } | undefined } {
  let last: { url: string; init: RequestInit } | undefined;
  const impl = (async (url: string, init: RequestInit) => {
    last = { url, init };
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'canned openrouter response' } }], usage: { prompt_tokens: 7, completion_tokens: 3 } }),
    };
  }) as unknown as typeof fetch;
  return { impl, last: () => last };
}

describe('openrouter provider — direct-fetch routing (REQ-038)', () => {
  const ORIGINAL = process.env['OPENROUTER_API_KEY'];
  beforeEach(() => { process.env['OPENROUTER_API_KEY'] = 'sk-or-fake-unit-key'; });
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env['OPENROUTER_API_KEY'];
    else process.env['OPENROUTER_API_KEY'] = ORIGINAL;
  });

  it('POSTs OpenAI-format to openrouter.ai with a Bearer OPENROUTER_API_KEY header', async () => {
    const fetchRec = recordingFetch();
    const gw = new LiteLLMGatewayClient({ timeoutMs: 5000, retries: 0, fetchImpl: fetchRec.impl });
    const result = await gw.invoke({ prompt: 'hi', opts: { model: 'openrouter/qwen/qwen-2.5-7b-instruct' }, runId: 'r1', agentId: 'a1' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.provider).toBe('openrouter');
      expect(result.model).toBe('qwen/qwen-2.5-7b-instruct');
      // v26 (DES-180, TASK-180): tokens widened to four columns — cacheRead/cacheWrite are a KNOWN
      // 0 here (the fixture's `usage` carries no `prompt_tokens_details`/`cache_write_tokens`).
      expect(result.tokens).toEqual({ input: 7, output: 3, cacheRead: 0, cacheWrite: 0 });
      expect(result.content).toBe('canned openrouter response');
    }
    const call = fetchRec.last()!;
    expect(call.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    const headers = call.init.headers as Record<string, string>;
    expect(headers['authorization']).toBe('Bearer sk-or-fake-unit-key');
    expect(JSON.parse(String(call.init.body))['model']).toBe('qwen/qwen-2.5-7b-instruct');
  });

  it('missing OPENROUTER_API_KEY → typed terminal failure (never a hang, never OpenAI key)', async () => {
    delete process.env['OPENROUTER_API_KEY'];
    process.env['OPENAI_API_KEY'] = 'sk-openai-must-not-be-used';
    const fetchRec = recordingFetch();
    const gw = new LiteLLMGatewayClient({ timeoutMs: 5000, retries: 0, fetchImpl: fetchRec.impl });
    const result = await gw.invoke({ prompt: 'hi', opts: { model: 'openrouter/qwen/qwen-2.5-7b-instruct' }, runId: 'r1', agentId: 'a1' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('terminal');
    expect(fetchRec.last()).toBeUndefined(); // never attempted a call without its own key
    delete process.env['OPENAI_API_KEY'];
  });
});

describe('openrouter LiteLLM passthrough wildcard (REQ-038) — 2026-09-26: static config, no per-alias row', () => {
  it('the generated config carries the openrouter/* passthrough route (see litellm-config-generate.test.ts for the full shape)', () => {
    const yaml = generateLiteLLMConfig();
    expect(yaml).toContain('model_name: "openrouter/*"');
    expect(yaml).toContain('model: "openrouter/*"');
  });
});
