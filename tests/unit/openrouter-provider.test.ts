// REQ-038: `openrouter` first-class provider — direct-fetch routing (OpenAI-shaped POST to
// openrouter.ai with Bearer OPENROUTER_API_KEY), LiteLLM native `openrouter/<model>` config +
// `openrouter/*` passthrough wildcard, per-provider tool curation, and registration-time
// passthrough acceptance (v22: that check moved out of submission-validator — see the M-6 note
// below). Unit tier (D-I6): a fake fetch transport — never a live network call.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LiteLLMGatewayClient } from '../../src/gateway/client.js';
import type { GatewayConfig } from '../../src/gateway/client.js';
import { generateLiteLLMConfig, toLiteLLMModelName } from '../../src/gateway/litellm-proxy.js';
import { validateScriptEntry } from '../../src/script-checks.js';

const ALIASES: GatewayConfig['aliases'] = {
  or: { provider: 'openrouter', model: 'qwen/qwen-2.5-7b-instruct' },
  default: { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
};

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
    const gw = new LiteLLMGatewayClient({ aliases: ALIASES, timeoutMs: 5000, retries: 0, fetchImpl: fetchRec.impl });
    const result = await gw.invoke({ prompt: 'hi', opts: { model: 'or' }, runId: 'r1', agentId: 'a1' });

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
    const gw = new LiteLLMGatewayClient({ aliases: ALIASES, timeoutMs: 5000, retries: 0, fetchImpl: fetchRec.impl });
    const result = await gw.invoke({ prompt: 'hi', opts: { model: 'or' }, runId: 'r1', agentId: 'a1' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('terminal');
    expect(fetchRec.last()).toBeUndefined(); // never attempted a call without its own key
    delete process.env['OPENAI_API_KEY'];
  });
});

describe('openrouter LiteLLM native naming + passthrough wildcard (REQ-038)', () => {
  it('toLiteLLMModelName yields the native openrouter/<model> form', () => {
    expect(toLiteLLMModelName({ provider: 'openrouter', model: 'qwen/qwen-2.5-7b-instruct' }))
      .toBe('openrouter/qwen/qwen-2.5-7b-instruct');
  });

  it('generated config carries the alias entry AND an openrouter/* passthrough route', () => {
    const yaml = generateLiteLLMConfig(ALIASES);
    expect(yaml).toContain('openrouter/qwen/qwen-2.5-7b-instruct');
    expect(yaml).toContain('model_name: "openrouter/*"');
    expect(yaml).toContain('model: "openrouter/*"');
  });
});

// "openrouter per-provider tool curation (REQ-038)" — REMOVED, not rewritten (v26, DES-173,
// ARCH-112, TASK-173/174, issue #66): it pinned `curateToolsForProvider` dropping Read/adding Bash
// for openrouter, which REQ-123 reverses (no provider-based tool curation at all; openrouter now
// gets the caller's `allowedTools` verbatim, same as ollama). Re-pointed to IT-144
// (`tests/integration/ollama-tools-verbatim.test.ts`, REQ-123) — DES-173's own load-bearing
// behavioural pair for this deletion.

// v22 adjudication #3 (M-6): the alias check these three cases exercise MOVED out of
// SubmissionValidator into `src/script-checks.ts`, enforced at `WorkflowCatalog.register()`
// (ADR-013, REQ-099) — `SubmissionValidatorDeps.aliases`/`openrouterPassthrough` no longer exist.
// The REQ-038 passthrough behaviour they pin is unchanged, so the cases are re-sited onto
// `validateScriptEntry`, whose `openrouterPassthrough` port is the same switch the validator's was.
describe('openrouter passthrough at the registration-time script check (REQ-038)', () => {
  const ports = (openrouterPassthrough: boolean) => ({
    aliases: new Set(Object.keys(ALIASES)),
    openrouterPassthrough,
    mcpLookup: () => true,
  });

  it('accepts an openrouter/<id> model string with no pre-listed alias (passthrough on by default)', () => {
    const res = validateScriptEntry(`return agent('x', { model: 'openrouter/meta-llama/llama-3.1-8b-instruct' });`, ports(true));
    expect(res.ok).toBe(true);
  });

  it('still rejects a genuinely unknown alias as UNKNOWN_ALIAS', () => {
    const res = validateScriptEntry(`return agent('x', { model: 'totally-unknown' });`, ports(true));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.some((e) => e.code === 'UNKNOWN_ALIAS')).toBe(true);
  });

  it('with passthrough disabled, an openrouter/<id> string is UNKNOWN_ALIAS unless pre-listed', () => {
    const res = validateScriptEntry(`return agent('x', { model: 'openrouter/meta-llama/llama-3.1-8b-instruct' });`, ports(false));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.some((e) => e.code === 'UNKNOWN_ALIAS')).toBe(true);
  });
});
