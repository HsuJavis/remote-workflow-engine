// pi harness v1, design change 5 (pi-spike-report.md): registerProvider()'s typed API requires a
// COMPLETE ProviderModelConfig — the bare `{id}` shorthand pi's own file-based models.json docs show
// throws at REQUEST time (not registration time) through the programmatic API (spike evidence:
// "Cannot read properties of undefined (reading 'includes')"). This test asserts the engine always
// builds the full shape, never the shorthand.
import { describe, it, expect } from 'vitest';
import { buildModelConfig } from '../../src/gateway/pi-child/session-runner.js';

const REQUIRED_KEYS = ['id', 'name', 'input', 'cost', 'reasoning', 'contextWindow', 'maxTokens'] as const;

describe('buildModelConfig — always a complete ProviderModelConfig (design change 5)', () => {
  it('carries every mandatory field the typed registerProvider() API requires', () => {
    const cfg = buildModelConfig('qwen2.5:7b', false);
    for (const key of REQUIRED_KEYS) expect(cfg).toHaveProperty(key);
    expect(cfg.id).toBe('qwen2.5:7b');
    expect(Array.isArray(cfg.input)).toBe(true);
    expect(typeof cfg.contextWindow).toBe('number');
    expect(typeof cfg.maxTokens).toBe('number');
  });

  it('cost is all-zero — the engine prices usage itself, pi\'s own cost figure is never trusted', () => {
    const cfg = buildModelConfig('any/model', true);
    expect(cfg.cost).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
  });

  it('reasoning is set per-call, never hardcoded (openrouter true, ollama false in session-runner.ts)', () => {
    expect(buildModelConfig('m', true).reasoning).toBe(true);
    expect(buildModelConfig('m', false).reasoning).toBe(false);
  });

  it('never produces the bare {id}-only shorthand the spike found throws at request time', () => {
    const cfg = buildModelConfig('x', false);
    expect(Object.keys(cfg).length).toBeGreaterThan(1);
  });
});
