// UT-178 (DES-172, ARCH-112, ADR-041, ADR-045, TASK-171, v26, issue #66): `providers.ts` — the
// closed three-member `Provider` union, `PROVIDER_CAPS`, `validateAliases` (names EVERY offending
// row), `resolveAlias`. Written test-first (Gate 5, RED): `src/providers.ts` does not exist yet —
// whole-file import failure.
// Mock policy (unit): pure, no I/O.
import { describe, it, expect } from 'vitest';
import { PROVIDERS, PROVIDER_CAPS, isProvider, validateAliases, resolveAlias } from '../../src/providers.js';

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

  it('validateAliases: an all-valid map is ok', () => {
    const result = validateAliases({ sonnet: { provider: 'anthropic', model: 'claude-sonnet-5' } } as any);
    expect(result.ok).toBe(true);
  });

  it('validateAliases: an empty map is ok', () => {
    expect(validateAliases({} as any).ok).toBe(true);
  });

  it('validateAliases: one bad row names it', () => {
    const result = validateAliases({ gpt41: { provider: 'openai', model: 'gpt-4.1' } } as any) as any;
    expect(result.ok).toBe(false);
    expect(result.offenders).toEqual([{ alias: 'gpt41', provider: 'openai' }]);
    expect(result.allowed).toEqual(PROVIDERS);
  });

  it('validateAliases: FOUR bad rows all named — the enumerate-everything rule', () => {
    const aliases = {
      gpt4omini: { provider: 'openai', model: 'gpt-4o-mini' },
      gpt41mini: { provider: 'openai', model: 'gpt-4.1-mini' },
      gpt41nano: { provider: 'openai', model: 'gpt-4.1-nano' },
      gpt41: { provider: 'openai', model: 'gpt-4.1' },
      sonnet: { provider: 'anthropic', model: 'claude-sonnet-5' },
    } as any;
    const result = validateAliases(aliases) as any;
    expect(result.ok).toBe(false);
    expect(result.offenders).toHaveLength(4);
    expect(result.offenders.map((o: any) => o.alias).sort()).toEqual(['gpt41', 'gpt41mini', 'gpt41nano', 'gpt4omini']);
  });

  it('validateAliases: a case-sensitive bad provider spelling is still caught', () => {
    const result = validateAliases({ x: { provider: 'OpenAI', model: 'm' } } as any) as any;
    expect(result.ok).toBe(false);
  });

  it('resolveAlias resolves a known alias', () => {
    const aliases = { sonnet: { provider: 'anthropic', model: 'claude-sonnet-5' } } as any;
    expect(resolveAlias(aliases, 'sonnet')).toEqual({ provider: 'anthropic', model: 'claude-sonnet-5' });
  });

  it('resolveAlias returns undefined for an unknown alias', () => {
    const aliases = { sonnet: { provider: 'anthropic', model: 'claude-sonnet-5' } } as any;
    expect(resolveAlias(aliases, 'nonexistent')).toBeUndefined();
  });
});
