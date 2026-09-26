// UT-178 (DES-172, ARCH-112, ADR-041, ADR-045, TASK-171, v26, issue #66) — REWRITTEN for the
// alias-removal iteration (2026-09-26 owner decisions): `validateAliases`/`resolveAlias` are GONE
// (no alias table exists any more — every model is a full `<provider>/<model-id>` ref, split at
// the FIRST `/`). This file now covers `parseModelRef` (the one normalizer) and `checkModelRef`
// (existence: openrouter/ollama checked against a live catalog snapshot when available, refused
// when the listing IS available and the id is absent, warned when the listing is unavailable;
// anthropic checked against the static price table, warned-never-refused on an unknown id so a
// brand-new Anthropic model is never blocked).
// Mock policy (unit): pure, no I/O — every catalog snapshot below is a literal, never a live fetch.
import { describe, it, expect } from 'vitest';
import { PROVIDERS, PROVIDER_CAPS, isProvider, parseModelRef, checkModelRef, type ModelCatalogSnapshot } from '../../src/providers.js';

describe('providers.ts — closed union, one capability table (UT-178, DES-172)', () => {
  it('PROVIDERS is exactly the three-member closed set', () => {
    expect([...PROVIDERS].sort()).toEqual(['anthropic', 'ollama', 'openrouter']);
  });

  it('isProvider narrows correctly', () => {
    expect(isProvider('anthropic')).toBe(true);
    expect(isProvider('openai')).toBe(false);
    expect(isProvider('gemini')).toBe(false);
    expect(isProvider('bogus')).toBe(false);
  });

  it('PROVIDER_CAPS.anthropic keeps output_config.effort, sdk-default thinking', () => {
    expect(PROVIDER_CAPS.anthropic.tools).toBe('all');
    expect(PROVIDER_CAPS.anthropic.effort?.restPath).toEqual(['output_config', 'effort']);
    expect(PROVIDER_CAPS.anthropic.thinking).toBe('sdk-default');
  });

  it('PROVIDER_CAPS.openrouter is budget-when-declared', () => {
    expect(PROVIDER_CAPS.openrouter.thinking).toBe('budget-when-declared');
    expect(PROVIDER_CAPS.openrouter.effort?.restPath).toEqual(['thinking', 'budget_tokens']);
  });

  it('PROVIDER_CAPS.ollama has no effort dial and disabled thinking', () => {
    expect(PROVIDER_CAPS.ollama.effort).toBeNull();
    expect(PROVIDER_CAPS.ollama.thinking).toBe('disabled');
  });
});

describe('parseModelRef — split at the FIRST "/" only (owner decision 1)', () => {
  it('parses a plain anthropic ref', () => {
    expect(parseModelRef('anthropic/claude-haiku-4-5-20251001')).toEqual({ provider: 'anthropic', model: 'claude-haiku-4-5-20251001' });
  });

  it('parses an ollama ref whose model id carries a colon', () => {
    expect(parseModelRef('ollama/qwen2.5:7b')).toEqual({ provider: 'ollama', model: 'qwen2.5:7b' });
  });

  it('parses an openrouter ref whose model id carries a SECOND slash (split at the FIRST one only)', () => {
    expect(parseModelRef('openrouter/openai/gpt-4.1')).toEqual({ provider: 'openrouter', model: 'openai/gpt-4.1' });
  });

  it('parses an openrouter ref whose model id carries a dot and a free-tier colon-suffix', () => {
    expect(parseModelRef('openrouter/inclusionai/ling-3.0-flash-vl:free')).toEqual({ provider: 'openrouter', model: 'inclusionai/ling-3.0-flash-vl:free' });
  });

  it('refuses a bare name with no slash at all', () => {
    expect(parseModelRef('haiku')).toBeUndefined();
  });

  it('refuses the literal "default"', () => {
    expect(parseModelRef('default')).toBeUndefined();
  });

  it('refuses an unknown provider prefix', () => {
    expect(parseModelRef('openai/gpt-4.1')).toBeUndefined();
  });

  it('refuses an empty model id after the slash', () => {
    expect(parseModelRef('anthropic/')).toBeUndefined();
  });

  it('refuses a leading slash (empty provider segment)', () => {
    expect(parseModelRef('/claude-haiku')).toBeUndefined();
  });

  it('refuses non-string input', () => {
    expect(parseModelRef(undefined)).toBeUndefined();
    expect(parseModelRef(42)).toBeUndefined();
    expect(parseModelRef(null)).toBeUndefined();
  });
});

describe('checkModelRef — existence (owner decision 6)', () => {
  const liveCatalog: ModelCatalogSnapshot = {
    source: 'live',
    entries: [
      { provider: 'ollama', model: 'qwen2.5:7b' },
      { provider: 'openrouter', model: 'openai/gpt-4.1' },
    ],
  };

  it('a malformed ref is refused regardless of catalog', () => {
    const v = checkModelRef('haiku', liveCatalog);
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.message).toMatch(/anthropic/);
      expect(v.message).toMatch(/openrouter/);
      expect(v.message).toMatch(/ollama/);
    }
  });

  it('an anthropic ref in the static table is accepted with no warning', () => {
    const v = checkModelRef('anthropic/claude-haiku-4-5-20251001', liveCatalog);
    expect(v).toEqual({ ok: true, provider: 'anthropic', model: 'claude-haiku-4-5-20251001' });
  });

  it('an anthropic ref NOT in the static table is accepted WITH a warning — never refused', () => {
    const v = checkModelRef('anthropic/claude-brand-new-9', liveCatalog);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.warning).toBeDefined();
  });

  it('an ollama ref present in a live listing is accepted with no warning', () => {
    const v = checkModelRef('ollama/qwen2.5:7b', liveCatalog);
    expect(v).toEqual({ ok: true, provider: 'ollama', model: 'qwen2.5:7b' });
  });

  it('an ollama ref ABSENT from a live listing is refused', () => {
    const v = checkModelRef('ollama/not-installed:7b', liveCatalog);
    expect(v.ok).toBe(false);
  });

  it('an openrouter ref present in a live listing is accepted with no warning', () => {
    const v = checkModelRef('openrouter/openai/gpt-4.1', liveCatalog);
    expect(v).toEqual({ ok: true, provider: 'openrouter', model: 'openai/gpt-4.1' });
  });

  it('an openrouter ref ABSENT from a live listing is refused', () => {
    const v = checkModelRef('openrouter/openai/does-not-exist', liveCatalog);
    expect(v.ok).toBe(false);
  });

  it('when the ollama listing is unavailable (no ollama rows at all), an ollama ref is accepted with a warning', () => {
    const catalog: ModelCatalogSnapshot = { source: 'live', entries: [{ provider: 'openrouter', model: 'openai/gpt-4.1' }] };
    const v = checkModelRef('ollama/qwen2.5:7b', catalog);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.warning).toBeDefined();
  });

  it('when source is "static" (the live source has never once succeeded), openrouter/ollama refs are accepted with a warning', () => {
    const catalog: ModelCatalogSnapshot = { source: 'static', entries: [] };
    const v1 = checkModelRef('openrouter/openai/gpt-4.1', catalog);
    const v2 = checkModelRef('ollama/qwen2.5:7b', catalog);
    expect(v1.ok).toBe(true);
    expect(v2.ok).toBe(true);
    if (v1.ok) expect(v1.warning).toBeDefined();
    if (v2.ok) expect(v2.warning).toBeDefined();
  });

  it('the default (empty) catalog treats every openrouter/ollama ref as unavailable-to-verify, never refused', () => {
    const v = checkModelRef('ollama/anything:7b');
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.warning).toBeDefined();
  });
});
