// UT-181 (DES-173, ARCH-112, TASK-174, v26, issue #66): the deletion's paired BEHAVIOURAL
// assertions — a grep proves a NAME is gone, not that a BEHAVIOUR is. (1) `models_list` carries no
// static openai catalog row once `STATIC_OPENAI` is deleted from model-catalog.ts. (2)
// `generateLiteLLMConfig` over a three-provider-only alias table never emits the `openai` provider
// prefix. Written test-first (Gate 5, RED): `STATIC_OPENAI` is still spread into `buildCatalog`'s
// entries today (model-catalog.ts), so (1) is red now.
// Mock policy (unit): pure functions, no network (buildCatalog's live sources are faked to reject).
import { describe, it, expect } from 'vitest';
import { buildCatalog } from '../../src/models/model-catalog.js';
import { generateLiteLLMConfig } from '../../src/gateway/litellm-proxy.js';

describe('the deletion is behavioural, not just a grep pass (UT-181, DES-173)', () => {
  it('models_list carries no static openai row once STATIC_OPENAI is retired', async () => {
    const entries = await buildCatalog({
      includeStatic: true,
      ollamaFetch: (async () => { throw new Error('no network in unit tier'); }) as unknown as typeof fetch,
      openrouterFetch: (async () => { throw new Error('no network in unit tier'); }) as unknown as typeof fetch,
    });
    const openaiRows = entries.filter((e) => e.provider === 'openai');
    expect(openaiRows).toEqual([]);
  });

  it('generateLiteLLMConfig over a three-provider-only alias table never emits "openai/"', () => {
    const config = generateLiteLLMConfig({
      sonnet: { provider: 'anthropic', model: 'claude-sonnet-5' },
      or: { provider: 'openrouter', model: 'google/gemini-3.8-flash' },
      default: { provider: 'ollama', model: 'qwen2.5:7b' },
    } as any);
    expect(config).not.toContain('openai/');
  });
});
