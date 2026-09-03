// UT-147 (DES-145, v24): validateUserOverrides(contract, raw, aliasNames, ceilings) — v24 PER-AGENT
// shape. Written test-first (Gate 5, RED) — today's function is keyed on a FLAT top-level
// LOCKED_KEYS/TUNABLE_KEYS vocabulary and has no notion of `agents.<label>`.
import { describe, it, expect } from 'vitest';
import { validateUserOverrides, DEFAULT_CEILINGS } from '../../src/params/contract.js';

const contract = {
  agents: {
    plan: {
      model: { type: 'enum', enum: ['sonnet-5'], default: 'sonnet-5' },
      effort: { type: 'enum', enum: ['low', 'high'], default: 'low' },
      timeoutMs: { type: 'number', min: 1000, max: 600000, default: 60000 },
    },
  },
  args: {},
} as unknown as import('../../src/params/contract.js').ParamContract;

describe('v24: validateUserOverrides — per-agent overrides (UT-147, DES-145)', () => {
  it('overrides.agents.plan.effort tunes ONLY that agent, resolved from the agent-scoped spec', () => {
    const result = validateUserOverrides(contract, { agents: { plan: { effort: 'high' } } }, new Set(['sonnet-5']), DEFAULT_CEILINGS);
    expect(result.ok).toBe(true);
    expect((result as { value: { agents?: Record<string, unknown> } }).value.agents).toEqual({ plan: { effort: 'high' } });
  });

  it('an unknown agent label ⇒ UNKNOWN_AGENT_LABEL{label, known}', () => {
    const result = validateUserOverrides(contract, { agents: { ghost: { effort: 'high' } } }, new Set(['sonnet-5']), DEFAULT_CEILINGS);
    expect(result.ok).toBe(false);
    expect((result as { code?: string }).code).toBe('UNKNOWN_AGENT_LABEL');
    expect((result as { detail?: { known?: string[] } }).detail?.known).toEqual(['plan']);
  });

  it('a locked key inside an agent block (e.g. skills) ⇒ PARAM_LOCKED for BOTH the schema path and this pure function', () => {
    const result = validateUserOverrides(contract, { agents: { plan: { skills: ['x'] } } }, new Set(['sonnet-5']), DEFAULT_CEILINGS);
    expect(result.ok).toBe(false);
    expect((result as { code?: string }).code).toBe('PARAM_LOCKED');
  });

  it('agents:{} is a legal no-op (provenance all default)', () => {
    const result = validateUserOverrides(contract, { agents: {} }, new Set(['sonnet-5']), DEFAULT_CEILINGS);
    expect(result).toEqual({ ok: true, value: { agents: {} } });
  });

  it('author range narrower than engine ceiling wins (whichever is narrower, refuse never clamp)', () => {
    const narrow = {
      agents: { plan: { ...contract.agents.plan, timeoutMs: { type: 'number', min: 1000, max: 5000, default: 5000 } } },
      args: {},
    } as unknown as import('../../src/params/contract.js').ParamContract;
    const result = validateUserOverrides(narrow, { agents: { plan: { timeoutMs: 10000 } } }, new Set(['sonnet-5']), DEFAULT_CEILINGS);
    expect(result.ok).toBe(false);
    expect((result as { code?: string }).code).toBe('PARAM_OUT_OF_RANGE');
  });

  it('engine ceiling narrower than author range wins the other direction', () => {
    const wide = {
      agents: { plan: { ...contract.agents.plan, timeoutMs: { type: 'number', min: 1000, max: 900000, default: 60000 } } },
      args: {},
    } as unknown as import('../../src/params/contract.js').ParamContract;
    const result = validateUserOverrides(wide, { agents: { plan: { timeoutMs: 700000 } } }, new Set(['sonnet-5']), DEFAULT_CEILINGS);
    expect(result.ok).toBe(false);
    expect((result as { code?: string }).code).toBe('PARAM_OUT_OF_RANGE');
    expect((result as { message?: string }).message).toMatch(/600000/);
  });
});
