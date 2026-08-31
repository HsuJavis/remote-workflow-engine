// UT-098 (DES-101, ARCH-064, TASK-097): pure src/params/contract.ts — locked/tunable vocabulary,
// parseParamContract, validateUserOverrides, validateDeclaredArgs, the total rejection table.
//
// Mock policy (unit): pure module, zero I/O, zero VM, zero clock/randomness.
//
// Red reason: src/params/contract.ts does not exist yet → every import fails at collect time
// (Cannot find module '../../src/params/contract.js') — MODULE NOT FOUND, the correct v21 red
// (same precedent as UT-097/resolve-harness-params.test.ts before src/harness-defaults.ts existed).
import { describe, it, expect } from 'vitest';
import {
  LOCKED_KEYS,
  TUNABLE_KEYS,
  EFFORT_RANK,
  canonicalContract,
  effectiveBounds,
  parseParamContract,
  validateUserOverrides,
  validateDeclaredArgs,
  isEffort,
} from '../../src/params/contract.js';
import type { ParamContract, Ceilings } from '../../src/params/contract.js';

const ALIASES = new Set(['sonnet', 'haiku', 'opus']);
const CEILINGS: Ceilings = { maxTimeoutMs: 600_000, maxAppendPromptBytes: 1024, maxEffort: 'high' };

describe('LOCKED_KEYS / TUNABLE_KEYS / EFFORT_RANK vocabulary (DES-101, ADR-001)', () => {
  it('LOCKED_KEYS is exactly the 6 D12-locked keys', () => {
    expect([...LOCKED_KEYS].sort()).toEqual(['cwd', 'mcp', 'prompt', 'skills', 'tools', 'workdir'].sort());
  });

  it('TUNABLE_KEYS is exactly the 4 engine-global harness knobs', () => {
    expect([...TUNABLE_KEYS].sort()).toEqual(['appendPrompt', 'effort', 'model', 'timeoutMs'].sort());
  });

  it('EFFORT_RANK orders low < medium < high < xhigh < max', () => {
    expect(EFFORT_RANK.low).toBeLessThan(EFFORT_RANK.medium);
    expect(EFFORT_RANK.medium).toBeLessThan(EFFORT_RANK.high);
    expect(EFFORT_RANK.high).toBeLessThan(EFFORT_RANK.xhigh);
    expect(EFFORT_RANK.xhigh).toBeLessThan(EFFORT_RANK.max);
  });

  it('isEffort accepts only the 5 canonical levels', () => {
    expect(isEffort('low')).toBe(true);
    expect(isEffort('max')).toBe(true);
    expect(isEffort('ultra')).toBe(false);
    expect(isEffort(undefined)).toBe(false);
    expect(isEffort(3)).toBe(false);
  });
});

describe('canonicalContract() — what a no-`params`-block script means (REQ-090 backward compat)', () => {
  it('declares exactly the 4 tunable knobs, no author bounds, no declared args', () => {
    const c = canonicalContract();
    expect(Object.keys(c.knobs).sort()).toEqual([...TUNABLE_KEYS].sort());
    for (const spec of Object.values(c.knobs)) {
      expect(spec.enum).toBeUndefined();
      expect(spec.min).toBeUndefined();
      expect(spec.max).toBeUndefined();
    }
    expect(Object.keys(c.args)).toEqual([]);
  });
});

describe('effectiveBounds() — min(author, ceiling), computed at READ time (DES-101 note)', () => {
  it('a NULL/canonical contract is bounded by the engine ceilings, not unbounded', () => {
    const eff = effectiveBounds(canonicalContract(), CEILINGS);
    expect(eff.knobs.timeoutMs?.max).toBe(CEILINGS.maxTimeoutMs);
    expect(eff.knobs.effort?.enum).toEqual(['low', 'medium', 'high']); // maxEffort:'high' clamps the enum
  });

  it('an author bound tighter than the ceiling is preserved (min wins)', () => {
    const c: ParamContract = { knobs: { ...canonicalContract().knobs, timeoutMs: { type: 'number', max: 10_000 } }, args: {} };
    const eff = effectiveBounds(c, CEILINGS);
    expect(eff.knobs.timeoutMs?.max).toBe(10_000);
  });

  it('a lowered ceiling takes effect on a stored (unchanged) author contract without a re-register', () => {
    const c: ParamContract = { knobs: { ...canonicalContract().knobs, timeoutMs: { type: 'number', max: 500_000 } }, args: {} };
    const lowered: Ceilings = { ...CEILINGS, maxTimeoutMs: 60_000 };
    expect(effectiveBounds(c, lowered).knobs.timeoutMs?.max).toBe(60_000);
  });
});

describe('parseParamContract() — registration-time parse of meta.params (DES-101 row 8)', () => {
  it('a params block naming a locked key → PARAM_CONTRACT_INVALID, nothing returned', () => {
    const r = parseParamContract({ knobs: { tools: { type: 'string' } } }, ALIASES);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('PARAM_CONTRACT_INVALID');
      expect(r.detail['param']).toBe('tools');
    }
  });

  it('a params block declaring only tunable knobs with a constraining enum parses ok', () => {
    const r = parseParamContract({ knobs: { model: { type: 'enum', enum: ['sonnet', 'haiku'] } } }, ALIASES);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.knobs.model?.enum).toEqual(['sonnet', 'haiku']);
  });

  it('model enum entries not in aliasNames → PARAM_CONTRACT_INVALID at registration', () => {
    const r = parseParamContract({ knobs: { model: { type: 'enum', enum: ['not-a-real-alias'] } } }, ALIASES);
    expect(r.ok).toBe(false);
  });

  it('malformed params (not an object) → PARAM_CONTRACT_INVALID', () => {
    const r = parseParamContract('not-an-object', ALIASES);
    expect(r.ok).toBe(false);
  });

  // v21 Gate 5 addendum Part 2 (DES-101 rejection table row 8 — clause-coverage sweep): row 8 names
  // FOUR conditions (locked key, unknown knob, malformed, over bounds); locked-key/malformed/over-32
  // were each already covered above, but no case exercised "unknown knob" — a knob name that is
  // neither locked nor a recognized tunable key.
  it('row 8: an unrecognized knob name at registration → PARAM_CONTRACT_INVALID, nothing returned', () => {
    const r = parseParamContract({ knobs: { bogusKnob: { type: 'string' } } }, ALIASES);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('PARAM_CONTRACT_INVALID');
      expect(r.detail['param']).toBe('bogusKnob');
    }
  });

  it('undefined metaParams (no params block at all) parses to the canonical contract', () => {
    const r = parseParamContract(undefined, ALIASES);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual(canonicalContract());
  });

  it('structural bound: more than 32 declared knobs+args → PARAM_CONTRACT_INVALID', () => {
    const knobs: Record<string, unknown> = {};
    for (let i = 0; i < 40; i++) knobs[`k${i}`] = { type: 'string' };
    const r = parseParamContract({ knobs }, ALIASES);
    expect(r.ok).toBe(false);
  });

  // v21 Gate 5 addendum (B-1, DES-101, REQ-090): the sibling `enum ≤ 32 members` structural bound —
  // distinct from the >32-knobs+args bound above. An unbounded enum is served on every
  // `workflow_get`, so the cap is load-bearing (the `nesting depth ≤ 4` bound was DROPPED in the
  // same adjudication and gets no test — ParamSpec is flat, nothing reads nested keys).
  it('structural bound: a declared enum with more than 32 members → PARAM_CONTRACT_INVALID, nothing stored', () => {
    const enumValues = Array.from({ length: 33 }, (_, i) => `v${i}`);
    const r = parseParamContract({ knobs: { effort: { type: 'enum', enum: enumValues } } }, ALIASES);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('PARAM_CONTRACT_INVALID');
  });

  // v21 adjudication C-1: DES-101's structural bounds read unqualified over knobs AND args, and the
  // sibling >32-knobs+args count bound already spans both, so the enum cap applies to args specs too.
  // The branch shipped at contract.ts:169-173 without this case; C-1 pre-authorized writing it.
  it('structural bound: an ARGS spec with a >32-member enum → PARAM_CONTRACT_INVALID naming args.<key>', () => {
    const enumValues = Array.from({ length: 33 }, (_, i) => `v${i}`);
    const r = parseParamContract({ args: { region: { type: 'enum', enum: enumValues } } }, ALIASES);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('PARAM_CONTRACT_INVALID');
      expect(r.detail['param']).toBe('args.region');
    }
  });
});

describe('validateUserOverrides() — the 8-row rejection table (DES-101)', () => {
  const CONTRACT: ParamContract = {
    knobs: {
      model: { type: 'enum', enum: ['sonnet', 'haiku'] },
      effort: { type: 'enum' },
      timeoutMs: { type: 'number', max: 30_000 },
      appendPrompt: { type: 'string' },
    },
    args: { retries: { type: 'number', min: 0, max: 5 } },
  };

  it('row 1: overrides names a D12-locked key → PARAM_LOCKED, detail.tunable lists the 4 knobs', () => {
    const r = validateUserOverrides(CONTRACT, { prompt: 'x' }, ALIASES, CEILINGS);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('PARAM_LOCKED');
      expect(r.detail['tunable']).toEqual(expect.arrayContaining([...TUNABLE_KEYS]));
    }
  });

  it('row 2: overrides names an unrecognized key → PARAM_UNKNOWN', () => {
    const r = validateUserOverrides(CONTRACT, { bogus: 1 }, ALIASES, CEILINGS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('PARAM_UNKNOWN');
  });

  it('row 3: wrong type (timeoutMs:"fast") → PARAM_OUT_OF_RANGE with suppliedType/expectedType', () => {
    const r = validateUserOverrides(CONTRACT, { timeoutMs: 'fast' }, ALIASES, CEILINGS);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('PARAM_OUT_OF_RANGE');
      expect(r.detail['suppliedType']).toBe('string');
      expect(r.detail['expectedType']).toBe('number');
    }
  });

  it('row 4: outside the author-declared enum → PARAM_OUT_OF_RANGE with {supplied, allowed}', () => {
    const r = validateUserOverrides(CONTRACT, { model: 'opus' }, ALIASES, CEILINGS);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('PARAM_OUT_OF_RANGE');
      expect(r.detail['supplied']).toBe('opus');
      expect(r.detail['allowed']).toEqual({ enum: ['sonnet', 'haiku'] });
    }
  });

  // v21 Gate 5 addendum Part 2 (DES-101 boundary condition — clause-coverage sweep): "Free text is
  // reported by size, never by content ... Any string value over 64 bytes is truncated with
  // suppliedTruncated:true." Row 6's own appendPrompt-over-cap case never echoes the value at all;
  // this is the separate, more general rule for OTHER rejected string values (e.g. an out-of-enum
  // `model` string) that end up in an error detail's `supplied` field — long values must not bloat
  // logged error envelopes.
  it('a rejected string value over 64 bytes is truncated in the error detail, with suppliedTruncated:true', () => {
    const longValue = 'x'.repeat(200);
    const r = validateUserOverrides(CONTRACT, { model: longValue }, ALIASES, CEILINGS);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('PARAM_OUT_OF_RANGE');
      expect(Buffer.byteLength(r.detail['supplied'] as string, 'utf8')).toBeLessThanOrEqual(64);
      expect(r.detail['suppliedTruncated']).toBe(true);
    }
  });

  it('row 5: above the engine ceiling → PARAM_OUT_OF_RANGE, allowed is the EFFECTIVE bound', () => {
    const looseContract: ParamContract = { ...CONTRACT, knobs: { ...CONTRACT.knobs, timeoutMs: { type: 'number' } } };
    const r = validateUserOverrides(looseContract, { timeoutMs: 10_000_000 }, ALIASES, CEILINGS);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('PARAM_OUT_OF_RANGE');
      expect((r.detail['allowed'] as { max?: number }).max).toBe(CEILINGS.maxTimeoutMs);
    }
  });

  it('row 6: appendPrompt over maxAppendPromptBytes → PARAM_OUT_OF_RANGE, text NEVER echoed', () => {
    const big = 'x'.repeat(CEILINGS.maxAppendPromptBytes + 1);
    const r = validateUserOverrides(CONTRACT, { appendPrompt: big }, ALIASES, CEILINGS);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('PARAM_OUT_OF_RANGE');
      expect(r.detail['param']).toBe('appendPrompt');
      expect(r.detail['maxBytes']).toBe(CEILINGS.maxAppendPromptBytes);
      expect(JSON.stringify(r.detail)).not.toContain(big);
    }
  });

  it('row 7: declared args field violates its spec → PARAM_OUT_OF_RANGE, param prefixed "args."', () => {
    const r = validateDeclaredArgs(CONTRACT, { retries: 99 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('PARAM_OUT_OF_RANGE');
      expect(r.detail['param']).toBe('args.retries');
    }
  });

  it('undeclared args keys pass through unchanged (backward compat)', () => {
    const r = validateDeclaredArgs(CONTRACT, { retries: 2, somethingElse: 'whatever' });
    expect(r.ok).toBe(true);
  });

  it('maxEffort ceiling refuses xhigh/max by default (EFFORT_RANK comparison)', () => {
    const r = validateUserOverrides(CONTRACT, { effort: 'max' }, ALIASES, CEILINGS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('PARAM_OUT_OF_RANGE');
  });

  it('a fully valid overrides object satisfying the contract → ok:true, value echoes back exactly the 4 fields', () => {
    const r = validateUserOverrides(CONTRACT, { model: 'sonnet', timeoutMs: 5_000 }, ALIASES, CEILINGS);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ model: 'sonnet', timeoutMs: 5_000 });
  });

  it('no overrides at all → ok:true, value:{} (REQ-091: identical to pre-v21 when absent)', () => {
    const r = validateUserOverrides(CONTRACT, {}, ALIASES, CEILINGS);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({});
  });
});
