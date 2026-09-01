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
  checkValueAgainstSpec,
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

  // Gate 6.5+7 (verifier, 2026-09-01): checkValueAgainstSpec's "below the minimum" branch had no
  // covering case — row 7's existing 99-above-max case exercises the sibling "above the maximum"
  // branch only. retries.min is 0, so a negative value is the below-minimum counterpart.
  it('declared args field BELOW its spec minimum → PARAM_OUT_OF_RANGE, param prefixed "args."', () => {
    const r = validateDeclaredArgs(CONTRACT, { retries: -1 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('PARAM_OUT_OF_RANGE');
      expect(r.detail['param']).toBe('args.retries');
      expect(r.detail['allowed']).toEqual({ min: 0, max: 5 });
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

  // v21 Gate 8 send-back re-run (2026-09-01, review 07-review.md §4 B1 ≡ adversarial F1 ≡ quality
  // QD-1): the adopted Gate 2 decision ("effective post-merge model alias-checked at submission via
  // the existing UNKNOWN_ALIAS rule, before any durable work") never reached code — `aliasNames` is
  // accepted as a parameter but the function body never reads it (only reference anywhere is
  // `parseParamContract`'s REGISTRATION-time author-enum check, a different rung). This is checked
  // here against the CANONICAL (no-author-enum) contract specifically, because `checkValueAgainstSpec`
  // only ever consults `spec.enum` — a knob with no author-declared enum (the REQ-090 backward-compat
  // default) currently has NO alias check at all, enum or not.
  it('B1: overrides.model naming an alias absent from aliasNames → rejected even with the canonical (no author-enum) contract', () => {
    const r = validateUserOverrides(canonicalContract(), { model: 'not-a-real-alias' }, ALIASES, CEILINGS);
    expect(r.ok).toBe(false);
  });

  // Passthrough carve-out (B1's fix shape names it explicitly): an `openrouter/<id>` string is a
  // valid model though never a pre-listed alias (submission-validator.ts's existing UNKNOWN_ALIAS
  // rule already grants this carve-out at the script-literal rung). GREEN on write today only
  // because NO check exists yet (the case above proves that) — kept as the regression pin for once
  // B1 lands, same precedent as UT-101's "effort-absent" green pin.
  it('B1 passthrough: overrides.model = openrouter/<id> is never rejected as an unknown alias', () => {
    const r = validateUserOverrides(canonicalContract(), { model: 'openrouter/some-vendor/some-model' }, ALIASES, CEILINGS);
    expect(r.ok).toBe(true);
  });
});

// v21 Gate 8 send-back re-run (2026-09-01, review §4 B4 ≡ quality QD-3, same seam as B1): a
// default-alias server (no `aliases` configured, or an empty table) must skip the model-enum-vs-
// aliasNames check at REGISTRATION the same way `validateHarnessDefaults` (harness-defaults.ts:70)
// already does — "only when the alias table is configured AND non-empty". `parseParamContract`
// unconditionally does `aliasNames.has(entry)`, so on an empty Set every enum entry is rejected;
// `workflow-catalog.ts:117` feeds exactly `new Set()` when unconfigured (`this._aliasNames ?? new
// Set()`) — this is a genuine registration-time rejection today for every default-alias server.
describe('parseParamContract() model-enum vs aliasNames — empty-table skip + openrouter carve-out (DES-101, B4)', () => {
  it('an EMPTY aliasNames table (unconfigured server) skips the model-enum alias check entirely', () => {
    const r = parseParamContract({ knobs: { model: { type: 'enum', enum: ['whatever-alias'] } } }, new Set());
    expect(r.ok).toBe(true);
  });

  it('openrouter/<id> passthrough is accepted in a declared model enum even when NOT literally in aliasNames', () => {
    const r = parseParamContract({ knobs: { model: { type: 'enum', enum: ['openrouter/some-vendor/some-model'] } } }, ALIASES);
    expect(r.ok).toBe(true);
  });
});

// v21 Gate 8 RE-REVIEW #4 (review §Q5 A1, BLOCKING HIGH): `parseParamContract` never checks
// `ParamSpec.type` is one of the 3 literals, nor that a declared `enum` is actually an array, nor
// that `min`/`max` are numbers — only locked-key, unknown-key, `enum.length`, and model-alias
// checks exist (contract.ts:161-197). `enum:'abc'` on `effort` REGISTERS today ('abc'.length===3
// passes the only length guard), and the poisoned row then throws `TypeError: authorEnum.filter is
// not a function` inside `boundEffort` on every subsequent `workflow_get`/`workflow_list` — a
// durable, engine-wide denial of workflow discovery from one poisoned registration. Fix has TWO
// halves, both pinned below: (1) the parser must reject each malformed shape typed, nothing stored;
// (2) `effectiveBounds` must stay TOTAL even over a row that reached storage before this fix
// shipped (a live deployment has one) — never throw, always return a usable contract.
describe('parseParamContract() — malformed ParamSpec shape guard (v21 Gate 8 RE-REVIEW #4, A1 half 1)', () => {
  it('a `type` outside the 3 literals is rejected, not silently accepted (today: registers as-is)', () => {
    const r = parseParamContract({ knobs: { model: { type: 'boolean' } } }, ALIASES);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('PARAM_CONTRACT_INVALID');
      expect(r.detail['param']).toBe('model');
    }
  });

  it('a declared `enum` that is not an array is rejected (today: only `.length` is checked, so a string like "abc" — length 3 — sails through the ≤32 guard)', () => {
    const r = parseParamContract({ knobs: { effort: { type: 'enum', enum: 'abc' as unknown as string[] } } }, ALIASES);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('PARAM_CONTRACT_INVALID');
  });

  it('a non-number `min` is rejected (today: passed through unchecked)', () => {
    const r = parseParamContract({ knobs: { timeoutMs: { type: 'number', min: 'abc' as unknown as number } } }, ALIASES);
    expect(r.ok).toBe(false);
  });

  it('a non-number `max` is rejected (today: passed through unchecked)', () => {
    const r = parseParamContract({ knobs: { timeoutMs: { type: 'number', max: 'abc' as unknown as number } } }, ALIASES);
    expect(r.ok).toBe(false);
  });
});

describe('effectiveBounds() — total over an already-poisoned stored contract, never throws (v21 Gate 8 RE-REVIEW #4, A1 half 2)', () => {
  it('a stored `effort` spec with a non-array `enum` (a row that predates the half-1 parser guard) does not crash boundEffort\'s authorEnum.filter (today: throws TypeError)', () => {
    const poisoned: ParamContract = {
      knobs: { ...canonicalContract().knobs, effort: { type: 'enum', enum: 'abc' as unknown as string[] } },
      args: {},
    };
    expect(() => effectiveBounds(poisoned, CEILINGS)).not.toThrow();
  });

  it('the recovered effort spec still carries a usable (array) enum after surviving a poisoned stored value', () => {
    const poisoned: ParamContract = {
      knobs: { ...canonicalContract().knobs, effort: { type: 'enum', enum: 'abc' as unknown as string[] } },
      args: {},
    };
    const eff = effectiveBounds(poisoned, CEILINGS);
    expect(Array.isArray(eff.knobs.effort?.enum)).toBe(true);
  });
});

// v21 Gate 8 RE-REVIEW #4 (review §Q5 A4, MED, folded into the A1 batch): `min`/`max` on a
// `type:'string'` knob are NaN-inert today — `checkValueAgainstSpec` always compares `(value as
// number)`, so `'x'.repeat(40) > 10` is `NaN > 10` (`false`) and the check never fires
// (contract.ts:222,230). Pinned semantics (same-predicate discipline the A5 fix below relies on):
// for a string-typed spec, `min`/`max` bound the value's UTF-8 BYTE LENGTH (matching how
// `maxAppendPromptBytes`/`MAX_SUPPLIED_BYTES` already express string limits in this module).
describe('checkValueAgainstSpec() — string min/max are byte-length bounds, not NaN-inert (v21 Gate 8 RE-REVIEW #4, A4)', () => {
  it('a string value over a declared `max` is rejected (today: ok:true, NaN comparison never fires)', () => {
    const r = checkValueAgainstSpec('bio', 'x'.repeat(40), { type: 'string', max: 10 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('PARAM_OUT_OF_RANGE');
      expect((r.detail['allowed'] as { max?: number } | undefined)?.max).toBe(10);
    }
  });

  it('a string value under a declared `min` is rejected (today: ok:true)', () => {
    const r = checkValueAgainstSpec('bio', 'ab', { type: 'string', min: 5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('PARAM_OUT_OF_RANGE');
  });

  it('a string value within declared min/max round-trips ok (regression pin, already true today)', () => {
    const r = checkValueAgainstSpec('bio', 'hello', { type: 'string', min: 1, max: 10 });
    expect(r.ok).toBe(true);
  });
});

// v21 Gate 8 RE-REVIEW #4 (review §Q5 A5, MED, folded into the A1/A4 batch): `effectiveBounds`
// narrows only `timeoutMs`/`effort` — the third ceiling, `maxAppendPromptBytes`, is enforced at
// admission (contract.ts's `validateUserOverrides`) but never ADVERTISED, even though the shipped
// tool description names it (server.ts:334). Pinned fix shape: same min(author,ceiling) precedent
// `boundTimeoutMs` already uses, applied to `appendPrompt.max` in BYTES (consistent with the A4 pin
// above: string `max` means byte length).
describe('effectiveBounds() — appendPrompt advertises the maxAppendPromptBytes ceiling (v21 Gate 8 RE-REVIEW #4, A5)', () => {
  it('the effective appendPrompt knob carries max === ceilings.maxAppendPromptBytes (today: undefined — appendPrompt passes through effectiveBounds unchanged)', () => {
    const eff = effectiveBounds(canonicalContract(), CEILINGS);
    expect(eff.knobs.appendPrompt?.max).toBe(CEILINGS.maxAppendPromptBytes);
  });

  it('an author-declared appendPrompt max tighter than the ceiling is preserved (min-of-both, same precedent as timeoutMs)', () => {
    const c: ParamContract = { knobs: { ...canonicalContract().knobs, appendPrompt: { type: 'string', max: 100 } }, args: {} };
    const eff = effectiveBounds(c, CEILINGS);
    expect(eff.knobs.appendPrompt?.max).toBe(100);
  });
});

// v21 Gate 8 RE-REVIEW #4 (review §Q5 A2, BLOCKING HIGH): `truncatedSupplied`'s loop trims ONE
// char per iteration, re-measuring `Buffer.byteLength` and re-copying the whole string every time
// (contract.ts:77-84) — O(n²). Reviewer-reproduced: 611ms@100k chars, 2396ms@200k (clean 4x per
// doubling). Pinned red-test shape (per review §Q5, to avoid a "testing a complexity bug" stall):
// assert the echoed `supplied` is ≤64 bytes AND a generous (<1s) wall-clock ceiling on a ~1MB
// out-of-enum `model` value — the 100-1000x separation between today's ~60s and a fixed O(n) slice
// makes this a robust, non-flaky timing assertion, not a micro-benchmark.
describe('checkValueAgainstSpec() — rejection cost must not scale quadratically with input size (v21 Gate 8 RE-REVIEW #4, A2)', () => {
  it('a ~1MB out-of-enum model value is rejected in well under 1s, echo capped at 64 bytes (today: O(n^2) truncation loop takes ~60s+ at this size)', () => {
    const huge = 'x'.repeat(1_000_000);
    const t0 = Date.now();
    const r = checkValueAgainstSpec('model', huge, { type: 'string', enum: ['sonnet', 'haiku'] });
    const elapsedMs = Date.now() - t0;
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(Buffer.byteLength(String(r.detail['supplied']), 'utf8')).toBeLessThanOrEqual(64);
    }
    expect(elapsedMs).toBeLessThan(1000);
  }, 90_000);
});
