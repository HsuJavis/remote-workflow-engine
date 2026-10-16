// UT-363 (DES-277, ARCH-188, ruling R-13, REQ-227 "retries … 可被 run 覆寫", TASK-274): run-time
// overrides for `decisions`/`images`. `validateUserOverrides` widens its closed top level from
// `{agents}` to `{agents, decisions, images}`; a label the contract does not declare takes the
// EXISTING unknown-label refusal (`UNKNOWN_AGENT_LABEL`, detail names the block); per-label keys are
// closed to `{model, timeoutMs, retries}`; `retries` is bounded by `MAX_PRIMITIVE_RETRIES` on the
// override path too; `model` must stay an `openrouter/` ref. `resolvePrimitiveParams` folds a
// validated override over the declared defaults (override › default, per key).
//
// Mock policy (unit): pure functions, hand-built contract, EMPTY model catalog (an openrouter ref is
// then a warning, never a refusal — the same posture `agents` overrides already have).
//
// Red reason: `overrides.decisions`/`overrides.images` are refused `PARAM_UNKNOWN` at the top level
// today ("overrides has exactly one key: agents"), and `resolvePrimitiveParams` does not exist
// (run-manager's `buildPrimitiveParamsSlice` is contract-default only).
import { describe, it, expect } from 'vitest';
import { validateUserOverrides, type ParamContract } from '../../src/params/contract.js';
import * as resolve from '../../src/params/resolve.js';

const CONTRACT = {
  agents: {},
  args: {},
  decisions: {
    gate: { model: { type: 'string', default: 'openrouter/typesafe/jev-1.13' }, timeoutMs: { type: 'number', default: 5000 }, retries: { type: 'number', default: 1 } },
  },
  images: {
    hero: { model: { type: 'string', default: 'openrouter/black-forest-labs/flux-1.1-pro' }, timeoutMs: { type: 'number', default: 120000 }, retries: { type: 'number', default: 0 } },
  },
} as unknown as ParamContract;

type R = { ok: boolean; code?: string; message?: string; detail?: Record<string, unknown>; value?: Record<string, unknown> };
const v = (raw: unknown): R => validateUserOverrides(CONTRACT, raw) as unknown as R;

describe('UT-363: validateUserOverrides — decisions/images overrides (DES-277)', () => {
  it('regression guard: an empty overrides object and an agents-only one still pass', () => {
    expect(v({}).ok).toBe(true);
    expect(v({ agents: {} }).ok).toBe(true);
  });

  it('a valid decisions override is accepted and returned on value.decisions', () => {
    const r = v({ decisions: { gate: { retries: 5, timeoutMs: 8000 } } });
    expect(r.ok).toBe(true);
    expect((r.value as { decisions?: unknown }).decisions).toEqual({ gate: { retries: 5, timeoutMs: 8000 } });
  });

  it('an images override for the declared label is accepted', () => {
    const r = v({ images: { hero: { model: 'openrouter/google/gemini-2.5-flash-image' } } });
    expect(r.ok).toBe(true);
  });

  it('an override for an UNDECLARED decisions label takes the existing unknown-label refusal (UNKNOWN_AGENT_LABEL), naming the block and the known labels', () => {
    const r = v({ decisions: { nope: { retries: 1 } } });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('UNKNOWN_AGENT_LABEL');
    expect(r.detail).toMatchObject({ label: 'nope', block: 'decisions', known: ['gate'] });
  });

  it('an override for an UNDECLARED images label is refused the same way', () => {
    const r = v({ images: { gate: { retries: 0 } } });
    expect(r).toMatchObject({ ok: false, code: 'UNKNOWN_AGENT_LABEL' });
    expect(r.detail).toMatchObject({ label: 'gate', block: 'images', known: ['hero'] });
  });

  it('retries above MAX_PRIMITIVE_RETRIES is refused PARAM_OUT_OF_RANGE naming "maxRetries 5"', () => {
    const r = v({ decisions: { gate: { retries: 6 } } });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('PARAM_OUT_OF_RANGE');
    expect(r.message).toMatch(/maxRetries 5/);
  });

  it('a negative or non-integer retries is refused PARAM_OUT_OF_RANGE', () => {
    expect(v({ decisions: { gate: { retries: -1 } } }).code).toBe('PARAM_OUT_OF_RANGE');
    expect(v({ decisions: { gate: { retries: 1.5 } } }).code).toBe('PARAM_OUT_OF_RANGE');
  });

  it('timeoutMs above the engine ceiling is refused PARAM_OUT_OF_RANGE naming maxTimeoutMs', () => {
    const r = v({ images: { hero: { timeoutMs: 600_001 } } });
    expect(r.code).toBe('PARAM_OUT_OF_RANGE');
    expect(r.message).toMatch(/maxTimeoutMs/);
  });

  it('a key outside {model,timeoutMs,retries} (e.g. effort) is refused PARAM_UNKNOWN naming the per-label path', () => {
    const r = v({ decisions: { gate: { effort: 'high' } } });
    expect(r.code).toBe('PARAM_UNKNOWN');
    expect(r.detail).toMatchObject({ param: 'decisions.gate.effort' });
  });

  it('a non-openrouter model override is refused PRIMITIVE_PROVIDER_UNSUPPORTED', () => {
    const r = v({ decisions: { gate: { model: 'anthropic/claude-haiku-4-5-20251001' } } });
    expect(r.code).toBe('PRIMITIVE_PROVIDER_UNSUPPORTED');
  });
});

describe('UT-363: resolvePrimitiveParams — override › declared default, per key (DES-277)', () => {
  const resolvePrimitiveParams = (resolve as unknown as {
    resolvePrimitiveParams?: (specs: unknown, overrides?: unknown) => Record<string, { model: string; timeoutMs: number; retries: number }>;
  }).resolvePrimitiveParams;

  it('is exported by src/params/resolve.ts', () => {
    expect(typeof resolvePrimitiveParams).toBe('function');
  });

  it('no override -> the declared defaults', () => {
    expect(resolvePrimitiveParams!((CONTRACT as { decisions: unknown }).decisions)).toEqual({
      gate: { model: 'openrouter/typesafe/jev-1.13', timeoutMs: 5000, retries: 1 },
    });
  });

  it('an override replaces only the keys it names', () => {
    expect(resolvePrimitiveParams!((CONTRACT as { decisions: unknown }).decisions, { gate: { retries: 4 } })).toEqual({
      gate: { model: 'openrouter/typesafe/jev-1.13', timeoutMs: 5000, retries: 4 },
    });
  });
});
