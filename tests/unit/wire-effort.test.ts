// UT-187 (DES-179, ARCH-117, ADR-045, TASK-179, v26, issue #71): `wireEffort` — the single writer of
// `options.thinking` AND `options.effort`, resolved as provider profile × the PINNED model
// capability (never a fresh lookup at dispatch). `applied` is ALWAYS present. Written test-first
// (Gate 5, RED): `wireEffort` does not exist yet in src/gateway/client.ts — whole-file import
// failure (`thinkingFor`/`mapEffort`/`profileFor` are the pre-v26 functions it replaces).
// Mock policy (unit): pure function, no I/O.
import { describe, it, expect } from 'vitest';
import { wireEffort } from '../../src/gateway/client.js';

describe('wireEffort — total over provider x pinned capability (UT-187, DES-179)', () => {
  it('anthropic: SDK-default thinking, effort on output_config.effort', () => {
    const r = wireEffort('anthropic', { reasoning: true, tools: true, source: 'static' }, 'high') as any;
    expect(r.thinking).toBeUndefined();
    expect(r.effort).toBe('high');
    expect(r.applied).toEqual({ applied: true, param: 'effort', restPath: ['output_config', 'effort'], value: 'high' });
  });

  it('openrouter with caps.reasoning===true: thinking.budgetTokens, applied:true', () => {
    const r = wireEffort('openrouter', { reasoning: true, tools: true, source: 'upstream' }, 'low') as any;
    expect(r.thinking).toEqual({ type: 'enabled', budgetTokens: 1024 });
    expect(r.applied.applied).toBe(true);
    expect(r.applied.param).toBe('thinking');
    expect(r.applied.restPath).toEqual(['thinking', 'budget_tokens']);
  });

  it('openrouter with caps.reasoning===false: thinking disabled, applied:false naming "does not declare"', () => {
    const r = wireEffort('openrouter', { reasoning: false, tools: true, source: 'upstream' }, 'low') as any;
    expect(r.thinking).toEqual({ type: 'disabled' });
    expect(r.applied).toEqual({ applied: false, reason: expect.stringMatching(/does not declare/i) });
  });

  it('openrouter with caps.reasoning==="unknown": thinking disabled, applied:false naming "unknown"', () => {
    const r = wireEffort('openrouter', { reasoning: 'unknown', tools: 'unknown', source: 'unknown' }, 'low') as any;
    expect(r.thinking).toEqual({ type: 'disabled' });
    expect(r.applied).toEqual({ applied: false, reason: expect.stringMatching(/unknown/i) });
  });

  it('the two openrouter non-reasoning reasons are DISTINCT strings', () => {
    const rFalse = wireEffort('openrouter', { reasoning: false, tools: true, source: 'upstream' }, 'low') as any;
    const rUnknown = wireEffort('openrouter', { reasoning: 'unknown', tools: 'unknown', source: 'unknown' }, 'low') as any;
    expect(rFalse.applied.reason).not.toBe(rUnknown.applied.reason);
  });

  it('ollama: thinking disabled, applied:false naming "no reasoning dial"', () => {
    const r = wireEffort('ollama', { reasoning: false, tools: true, source: 'static' }, 'low') as any;
    expect(r.thinking).toEqual({ type: 'disabled' });
    expect(r.applied).toEqual({ applied: false, reason: expect.stringMatching(/no reasoning dial/i) });
  });

  it('provider === undefined: thinking disabled, applied:false (fail-safe branch)', () => {
    const r = wireEffort(undefined, { reasoning: 'unknown', tools: 'unknown', source: 'unknown' }, 'low') as any;
    expect(r.thinking).toEqual({ type: 'disabled' });
    expect(r.applied.applied).toBe(false);
  });

  it('no effort requested at all: applied is still present (never absent)', () => {
    const r = wireEffort('anthropic', { reasoning: true, tools: true, source: 'static' }, undefined) as any;
    expect(r.applied).toBeDefined();
  });
});
