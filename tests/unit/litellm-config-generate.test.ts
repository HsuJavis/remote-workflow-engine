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

  it('generateLiteLLMConfig never emits "openai/" (STATIC_OPENAI retired)', () => {
    const config = generateLiteLLMConfig();
    expect(config).not.toContain('openai/');
  });
});

// 2026-09-26 (alias mechanism removed, owner decision 8): the proxy's model_list is now STATIC —
// two wildcard routes, no per-alias row, no `rwe-proxy-*` cloak name anywhere in the config. Real
// routing (does litellm's `ollama/*`/`openrouter/*` wildcard actually dispatch) is verified at real
// tier, not here — this pins the CONFIG SHAPE the real-tier proxy is booted from.
describe('generateLiteLLMConfig — static two-wildcard shape (owner decision 8)', () => {
  const ORIGINAL_OLLAMA_BASE_URL = process.env['OLLAMA_BASE_URL'];

  it('contains exactly the openrouter/* and ollama/* wildcards, and no per-model row', () => {
    delete process.env['OLLAMA_BASE_URL'];
    try {
      const config = generateLiteLLMConfig();
      expect(config).toContain('model_name: "openrouter/*"');
      expect(config).toContain('model: "openrouter/*"');
      expect(config).toContain('model_name: "ollama/*"');
      expect(config).toContain('model: "ollama/*"');
      expect(config).not.toContain('rwe-proxy-');
      // Default api_base when OLLAMA_BASE_URL is unset.
      expect(config).toContain('api_base: "http://127.0.0.1:11434"');
    } finally {
      if (ORIGINAL_OLLAMA_BASE_URL === undefined) delete process.env['OLLAMA_BASE_URL'];
      else process.env['OLLAMA_BASE_URL'] = ORIGINAL_OLLAMA_BASE_URL;
    }
  });

  it('the ollama wildcard\'s api_base follows OLLAMA_BASE_URL when set', () => {
    process.env['OLLAMA_BASE_URL'] = 'http://custom-ollama-host:9999';
    try {
      const config = generateLiteLLMConfig();
      expect(config).toContain('api_base: "http://custom-ollama-host:9999"');
    } finally {
      if (ORIGINAL_OLLAMA_BASE_URL === undefined) delete process.env['OLLAMA_BASE_URL'];
      else process.env['OLLAMA_BASE_URL'] = ORIGINAL_OLLAMA_BASE_URL;
    }
  });
});
