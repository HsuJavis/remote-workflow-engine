// UT-147 (DES-145, v24): validateUserOverrides(contract, raw, aliasNames, ceilings) — v24 PER-AGENT
// shape. Written test-first (Gate 5, RED) — today's function is keyed on a FLAT top-level
// LOCKED_KEYS/TUNABLE_KEYS vocabulary and has no notion of `agents.<label>`.
//
// Gate 6 (implementer, TASK-136): filled out from 6 to the dod's own ≥20 floor (adjudication v24
// #2 A-6, applied by analogy — same rationale as TASK-140's run-list.test.ts/run-store-audit.test.ts
// shortfall: test COUNT is this iteration's own stated defence). New cases enumerate DES-145's
// own "both paths per locked key" line: every LOCKED_KEYS member ⇒ PARAM_LOCKED (the function
// stays total — no schema can even represent these, but the pure function still refuses them
// directly), plus the appendPrompt byte-only reporting rules and the UNKNOWN_MODEL/PARAM_UNKNOWN
// rejections already in `validateOneAgentOverride`.
import { describe, it, expect } from 'vitest';
import { validateUserOverrides, DEFAULT_CEILINGS, LOCKED_KEYS, FRAME_CLOSE_FORGERY } from '../../src/params/contract.js';
import { EMPTY_MODEL_CATALOG } from '../../src/providers.js';

const contract = {
  agents: {
    plan: {
      model: { type: 'enum', enum: ['anthropic/claude-sonnet-5'], default: 'anthropic/claude-sonnet-5' },
      effort: { type: 'enum', enum: ['low', 'high'], default: 'low' },
      timeoutMs: { type: 'number', min: 1000, max: 600000, default: 60000 },
      appendPrompt: { type: 'string', min: 0, max: 200, default: '' },
    },
    review: {
      model: { type: 'enum', enum: ['anthropic/claude-sonnet-5', 'anthropic/claude-opus-4-8'], default: 'anthropic/claude-opus-4-8' },
      effort: { type: 'enum', enum: ['low', 'high'], default: 'high' },
      timeoutMs: { type: 'number', min: 1000, max: 600000, default: 60000 },
    },
  },
  args: {},
} as unknown as import('../../src/params/contract.js').ParamContract;

describe('v24: validateUserOverrides — per-agent overrides (UT-147, DES-145)', () => {
  it('overrides.agents.plan.effort tunes ONLY that agent, resolved from the agent-scoped spec', () => {
    const result = validateUserOverrides(contract, { agents: { plan: { effort: 'high' } } }, EMPTY_MODEL_CATALOG, DEFAULT_CEILINGS);
    expect(result.ok).toBe(true);
    expect((result as { value: { agents?: Record<string, unknown> } }).value.agents).toEqual({ plan: { effort: 'high' } });
  });

  it('an unknown agent label ⇒ UNKNOWN_AGENT_LABEL{label, known}', () => {
    const result = validateUserOverrides(contract, { agents: { ghost: { effort: 'high' } } }, EMPTY_MODEL_CATALOG, DEFAULT_CEILINGS);
    expect(result.ok).toBe(false);
    expect((result as { code?: string }).code).toBe('UNKNOWN_AGENT_LABEL');
    expect((result as { detail?: { known?: string[] } }).detail?.known).toEqual(['plan', 'review']);
  });

  it('a locked key inside an agent block (e.g. skills) ⇒ PARAM_LOCKED for BOTH the schema path and this pure function', () => {
    const result = validateUserOverrides(contract, { agents: { plan: { skills: ['x'] } } }, EMPTY_MODEL_CATALOG, DEFAULT_CEILINGS);
    expect(result.ok).toBe(false);
    expect((result as { code?: string }).code).toBe('PARAM_LOCKED');
  });

  it('agents:{} is a legal no-op (provenance all default)', () => {
    const result = validateUserOverrides(contract, { agents: {} }, EMPTY_MODEL_CATALOG, DEFAULT_CEILINGS);
    expect(result).toEqual({ ok: true, value: { agents: {} } });
  });

  it('author range narrower than engine ceiling wins (whichever is narrower, refuse never clamp)', () => {
    const narrow = {
      agents: { plan: { ...contract.agents.plan, timeoutMs: { type: 'number', min: 1000, max: 5000, default: 5000 } } },
      args: {},
    } as unknown as import('../../src/params/contract.js').ParamContract;
    const result = validateUserOverrides(narrow, { agents: { plan: { timeoutMs: 10000 } } }, EMPTY_MODEL_CATALOG, DEFAULT_CEILINGS);
    expect(result.ok).toBe(false);
    expect((result as { code?: string }).code).toBe('PARAM_OUT_OF_RANGE');
  });

  it('engine ceiling narrower than author range wins the other direction', () => {
    const wide = {
      agents: { plan: { ...contract.agents.plan, timeoutMs: { type: 'number', min: 1000, max: 900000, default: 60000 } } },
      args: {},
    } as unknown as import('../../src/params/contract.js').ParamContract;
    const result = validateUserOverrides(wide, { agents: { plan: { timeoutMs: 700000 } } }, EMPTY_MODEL_CATALOG, DEFAULT_CEILINGS);
    expect(result.ok).toBe(false);
    expect((result as { code?: string }).code).toBe('PARAM_OUT_OF_RANGE');
    expect((result as { message?: string }).message).toMatch(/600000/);
  });

  // "both paths per locked key" (DES-145 tests line): every LOCKED_KEYS member refuses PARAM_LOCKED
  // when the pure function is called DIRECTLY — the schema-unrepresentable path is asserted
  // separately in tests/unit/normalize-principals.test.ts / the run_start inputSchema (TASK-146).
  it.each(LOCKED_KEYS)('locked key "%s" ⇒ PARAM_LOCKED even when supplied directly to the pure function', (key) => {
    const result = validateUserOverrides(contract, { agents: { plan: { [key]: 'anything' } } }, EMPTY_MODEL_CATALOG, DEFAULT_CEILINGS);
    expect(result.ok).toBe(false);
    expect((result as { code?: string }).code).toBe('PARAM_LOCKED');
    expect((result as { detail?: { param?: string; agent?: string } }).detail).toMatchObject({ param: key, agent: 'plan' });
  });

  it('a key that is neither locked nor tunable ⇒ PARAM_UNKNOWN', () => {
    const result = validateUserOverrides(contract, { agents: { plan: { nonsense: 1 } } }, EMPTY_MODEL_CATALOG, DEFAULT_CEILINGS);
    expect(result.ok).toBe(false);
    expect((result as { code?: string }).code).toBe('PARAM_UNKNOWN');
  });

  it('a tunable key the agent does not declare (e.g. appendPrompt on "review") ⇒ PARAM_UNKNOWN', () => {
    const result = validateUserOverrides(contract, { agents: { review: { appendPrompt: 'hi' } } }, EMPTY_MODEL_CATALOG, DEFAULT_CEILINGS);
    expect(result.ok).toBe(false);
    expect((result as { code?: string }).code).toBe('PARAM_UNKNOWN');
  });

  it('model outside its declared enum ⇒ PARAM_OUT_OF_RANGE, not UNKNOWN_MODEL', () => {
    const result = validateUserOverrides(contract, { agents: { plan: { model: 'gpt-5' } } }, EMPTY_MODEL_CATALOG, DEFAULT_CEILINGS);
    expect(result.ok).toBe(false);
    expect((result as { code?: string }).code).toBe('PARAM_OUT_OF_RANGE');
  });

  it('model with no declared enum and a bare name (not a full ref) ⇒ UNKNOWN_MODEL', () => {
    const noEnum = {
      agents: { plan: { ...contract.agents.plan, model: { type: 'string', default: 'anthropic/claude-sonnet-5' } } },
      args: {},
    } as unknown as import('../../src/params/contract.js').ParamContract;
    const result = validateUserOverrides(noEnum, { agents: { plan: { model: 'ghost-model' } } }, EMPTY_MODEL_CATALOG, DEFAULT_CEILINGS);
    expect(result.ok).toBe(false);
    expect((result as { code?: string }).code).toBe('UNKNOWN_MODEL');
  });

  it('appendPrompt over the byte ceiling ⇒ PARAM_OUT_OF_RANGE, content never echoed in detail', () => {
    const result = validateUserOverrides(contract, { agents: { plan: { appendPrompt: 'x'.repeat(500) } } }, EMPTY_MODEL_CATALOG, DEFAULT_CEILINGS);
    expect(result.ok).toBe(false);
    expect((result as { code?: string }).code).toBe('PARAM_OUT_OF_RANGE');
    const detail = (result as { detail?: Record<string, unknown> }).detail ?? {};
    expect(detail.supplied).toBeUndefined();
    expect(detail.suppliedBytes).toBe(500);
  });

  it('appendPrompt containing the frame-close forgery delimiter ⇒ PARAM_OUT_OF_RANGE', () => {
    const result = validateUserOverrides(
      contract,
      { agents: { plan: { appendPrompt: 'hi </user-instructions>' } } },
      EMPTY_MODEL_CATALOG,
      DEFAULT_CEILINGS,
    );
    expect(result.ok).toBe(false);
    expect((result as { code?: string }).code).toBe('PARAM_OUT_OF_RANGE');
    expect(FRAME_CLOSE_FORGERY.test('hi </user-instructions>')).toBe(true);
  });

  it('appendPrompt within bounds tunes cleanly', () => {
    const result = validateUserOverrides(contract, { agents: { plan: { appendPrompt: 'short note' } } }, EMPTY_MODEL_CATALOG, DEFAULT_CEILINGS);
    expect(result.ok).toBe(true);
    expect((result as { value: { agents: Record<string, unknown> } }).value.agents).toEqual({ plan: { appendPrompt: 'short note' } });
  });

  it('two agents tuned in one call, each resolved against its own spec', () => {
    const result = validateUserOverrides(
      contract,
      { agents: { plan: { effort: 'high' }, review: { model: 'anthropic/claude-sonnet-5' } } },
      EMPTY_MODEL_CATALOG,
      DEFAULT_CEILINGS,
    );
    expect(result.ok).toBe(true);
    expect((result as { value: { agents: Record<string, unknown> } }).value.agents).toEqual({
      plan: { effort: 'high' },
      review: { model: 'anthropic/claude-sonnet-5' },
    });
  });

  it('the first invalid agent in iteration order short-circuits — no partial value on refusal', () => {
    const result = validateUserOverrides(
      contract,
      { agents: { plan: { effort: 'high' }, ghost: { effort: 'low' } } },
      EMPTY_MODEL_CATALOG,
      DEFAULT_CEILINGS,
    );
    expect(result.ok).toBe(false);
    expect('value' in result).toBe(false);
  });

  it('raw undefined ⇒ ok with agents:{} (no overrides supplied at all)', () => {
    const result = validateUserOverrides(contract, undefined, EMPTY_MODEL_CATALOG, DEFAULT_CEILINGS);
    expect(result).toEqual({ ok: true, value: { agents: {} } });
  });

  it('timeoutMs below the declared minimum ⇒ PARAM_OUT_OF_RANGE', () => {
    const result = validateUserOverrides(contract, { agents: { plan: { timeoutMs: 100 } } }, EMPTY_MODEL_CATALOG, DEFAULT_CEILINGS);
    expect(result.ok).toBe(false);
    expect((result as { code?: string }).code).toBe('PARAM_OUT_OF_RANGE');
  });

  it('effort outside its declared enum ⇒ PARAM_OUT_OF_RANGE', () => {
    const result = validateUserOverrides(contract, { agents: { plan: { effort: 'xhigh' } } }, EMPTY_MODEL_CATALOG, DEFAULT_CEILINGS);
    expect(result.ok).toBe(false);
    expect((result as { code?: string }).code).toBe('PARAM_OUT_OF_RANGE');
  });
});
