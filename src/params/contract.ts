// src/params/contract.ts (DES-101, ARCH-064, TASK-097): the single place that knows the
// tunable-parameter contract vocabulary — registration (TASK-099), submission (TASK-100) and the
// v23 describe surface all consume these functions, so the locked-key list and rejection codes
// cannot drift into separate copies.
//
// Pure: no I/O, no clock, no VM, no randomness.

export const LOCKED_KEYS = ['prompt', 'tools', 'skills', 'mcp', 'workdir', 'cwd'] as const;
export const TUNABLE_KEYS = ['model', 'effort', 'timeoutMs', 'appendPrompt'] as const;

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export const EFFORT_RANK: Record<Effort, number> = { low: 0, medium: 1, high: 2, xhigh: 3, max: 4 };
const ALL_EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

export interface ParamSpec {
  type: 'string' | 'number' | 'enum';
  default?: unknown;
  enum?: unknown[];
  min?: number;
  max?: number;
  unit?: string;
  description?: string;
}

export interface ParamContract {
  knobs: Record<string, ParamSpec>;
  args: Record<string, ParamSpec>;
}

// closed: a locked key is UNREPRESENTABLE (ADR-001)
export interface UserOverrides {
  model?: string;
  effort?: Effort;
  timeoutMs?: number;
  appendPrompt?: string;
}

export interface Ceilings {
  maxTimeoutMs: number;
  maxAppendPromptBytes: number;
  maxEffort: Effort;
}

export type Err = {
  ok: false;
  code: 'PARAM_LOCKED' | 'PARAM_OUT_OF_RANGE' | 'PARAM_UNKNOWN' | 'PARAM_CONTRACT_INVALID' | 'UNKNOWN_ALIAS';
  message: string;
  detail: Record<string, unknown>;
};

/** Total declared knobs+args over this bound → PARAM_CONTRACT_INVALID (DES-101 boundary conditions). */
const MAX_DECLARED = 32;

/** A declared enum with more than this many members → PARAM_CONTRACT_INVALID (DES-101 boundary
 *  conditions: "enum ≤ 32 members" — an unbounded enum is served on every `workflow_get`). */
const MAX_ENUM_MEMBERS = 32;

/** Free text in an error detail is reported by size, never in full (DES-101 boundary conditions):
 *  any string value over this many bytes is truncated with `suppliedTruncated:true`. */
const MAX_SUPPLIED_BYTES = 64;

/** REQ-038 precedent (`submission-validator.ts`): an `openrouter/<id>`-shaped model string is a
 *  valid passthrough model though never a pre-listed alias — LiteLLM routes it natively via its
 *  `openrouter/*` wildcard, so it needs no entry in `aliasNames`. */
const OPENROUTER_PASSTHROUGH = /^openrouter\/.+/;

/** D-AUTH-5-B precedent (`harness-defaults.ts:70`): the alias check only applies when the server
 *  has a configured, non-empty alias table — an unconfigured/default-alias server must not reject
 *  every model string. An `openrouter/<id>` passthrough is always accepted regardless. */
export function isKnownAlias(alias: string, aliasNames: Set<string>): boolean {
  if (aliasNames.size === 0) return true;
  if (OPENROUTER_PASSTHROUGH.test(alias)) return true;
  return aliasNames.has(alias);
}

// v21 Gate 8 RE-REVIEW #4 (A2): O(n) buffer slice, not a per-char re-measuring loop — the previous
// shape re-copied the whole string and re-measured its byte length on every iteration (O(n^2)),
// which made rejecting one ~1MB out-of-enum value take ~60s+.
function truncatedSupplied(value: unknown): { supplied: unknown; suppliedTruncated?: true } {
  if (typeof value === 'string') {
    const buf = Buffer.from(value, 'utf8');
    if (buf.byteLength > MAX_SUPPLIED_BYTES) {
      // Back `end` off any UTF-8 continuation bytes (10xxxxxx) at the cut point so the slice lands
      // on a character boundary — cutting mid-sequence would decode to a handful of valid bytes
      // plus a substitute char, overshooting the 64-byte cap the caller relies on.
      let end = MAX_SUPPLIED_BYTES;
      while (end > 0 && (buf[end]! & 0xc0) === 0x80) end--;
      return { supplied: buf.subarray(0, end).toString('utf8'), suppliedTruncated: true };
    }
  }
  return { supplied: value };
}

export function isEffort(v: unknown): v is Effort {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(EFFORT_RANK, v);
}

/** What a script with NO `params` block means (REQ-090 backward compat): the 4 tunable knobs,
 *  unbounded by the author, no declared args. The resolver never branches on "contract missing". */
export function canonicalContract(): ParamContract {
  return {
    knobs: {
      model: { type: 'string' },
      effort: { type: 'enum' },
      timeoutMs: { type: 'number' },
      appendPrompt: { type: 'string' },
    },
    args: {},
  };
}

/** min(author, ceiling) on `max`, shared by timeoutMs (ms) and appendPrompt (bytes). Same totality
 *  principle as `boundEffort` (A1 half 2): a stored row that predates the parser's shape guard may
 *  carry a non-number `max` — treated as "author left it unconstrained" rather than propagating
 *  `NaN` (which would otherwise both serve `null` and be inert at admission, a ceiling bypass). */
function boundMax(spec: ParamSpec, ceilingMax: number): ParamSpec {
  const authorMax = typeof spec.max === 'number' ? spec.max : Infinity;
  return { ...spec, max: Math.min(authorMax, ceilingMax) };
}

// v21 Gate 8 RE-REVIEW #4 (A1 half 2): `effectiveBounds` must stay TOTAL even over a stored
// contract that predates the parser's shape guard (a live deployment has one) — a non-array
// `enum` must never crash `.filter`, it must be treated as "author left it unconstrained".
function boundEffort(spec: ParamSpec, ceilings: Ceilings): ParamSpec {
  const authorEnum = Array.isArray(spec.enum) ? (spec.enum as Effort[]) : ALL_EFFORTS;
  const ceilingRank = EFFORT_RANK[ceilings.maxEffort];
  return { ...spec, enum: authorEnum.filter((e) => EFFORT_RANK[e] <= ceilingRank) };
}

/** min(author, ceiling), computed at READ time from live config — the stored column keeps the
 *  author's raw declaration, so lowering a ceiling takes effect without a re-register. */
export function effectiveBounds(c: ParamContract, ceilings: Ceilings): ParamContract {
  const base = canonicalContract();
  const knobs: Record<string, ParamSpec> = {};
  for (const key of TUNABLE_KEYS) {
    const spec = c.knobs[key] ?? base.knobs[key]!;
    knobs[key] = key === 'timeoutMs' ? boundMax(spec, ceilings.maxTimeoutMs)
      : key === 'effort' ? boundEffort(spec, ceilings)
      : key === 'appendPrompt' ? boundMax(spec, ceilings.maxAppendPromptBytes)
      : spec;
  }
  return { knobs, args: c.args };
}

function invalid(param: string, reason: string): Err {
  return { ok: false, code: 'PARAM_CONTRACT_INVALID', message: reason, detail: { param, reason } };
}

const VALID_SPEC_TYPES = ['string', 'number', 'enum'] as const;

// v21 Gate 8 RE-REVIEW #4 (A1 half 1): the parser previously only checked `enum.length` and the
// locked/unknown-key set — a malformed `type`, a non-array `enum`, or a non-number `min`/`max`
// registered as-is and poisoned every later read of the stored row. Typed rejection, nothing
// stored.
function validateSpecShape(param: string, spec: ParamSpec): Err | null {
  if (!(VALID_SPEC_TYPES as readonly string[]).includes(spec.type)) {
    return invalid(param, `type must be one of ${VALID_SPEC_TYPES.join(', ')}`);
  }
  if (spec.enum !== undefined && !Array.isArray(spec.enum)) {
    return invalid(param, 'enum must be an array');
  }
  if (spec.min !== undefined && typeof spec.min !== 'number') {
    return invalid(param, 'min must be a number');
  }
  if (spec.max !== undefined && typeof spec.max !== 'number') {
    return invalid(param, 'max must be a number');
  }
  return null;
}

/** Registration-time parse of `meta.params` (DES-101 row 8). Post-eval structural bounds only —
 *  the pre-eval source-size bound lives in workflow-meta.ts, because this only ever sees a value
 *  that already survived evaluation. */
export function parseParamContract(
  metaParams: unknown,
  aliasNames: Set<string>,
): { ok: true; value: ParamContract } | Err {
  if (metaParams === undefined) return { ok: true, value: canonicalContract() };
  if (typeof metaParams !== 'object' || metaParams === null || Array.isArray(metaParams)) {
    return invalid('root', 'meta.params must be an object');
  }

  const raw = metaParams as { knobs?: unknown; args?: unknown };
  if (raw.knobs !== undefined && (typeof raw.knobs !== 'object' || raw.knobs === null || Array.isArray(raw.knobs))) {
    return invalid('knobs', 'params.knobs must be an object');
  }
  if (raw.args !== undefined && (typeof raw.args !== 'object' || raw.args === null || Array.isArray(raw.args))) {
    return invalid('args', 'params.args must be an object');
  }

  const knobsIn = (raw.knobs ?? {}) as Record<string, ParamSpec>;
  const argsIn = (raw.args ?? {}) as Record<string, ParamSpec>;

  if (Object.keys(knobsIn).length + Object.keys(argsIn).length > MAX_DECLARED) {
    return invalid('root', `more than ${MAX_DECLARED} declared knobs+args`);
  }

  const knobs: Record<string, ParamSpec> = { ...canonicalContract().knobs };
  for (const [key, spec] of Object.entries(knobsIn)) {
    if ((LOCKED_KEYS as readonly string[]).includes(key)) {
      return invalid(key, 'locked key cannot be declared as a tunable knob');
    }
    if (!(TUNABLE_KEYS as readonly string[]).includes(key)) {
      return invalid(key, 'unknown knob');
    }
    const shapeErr = validateSpecShape(key, spec);
    if (shapeErr) return shapeErr;
    if (spec.enum !== undefined && spec.enum.length > MAX_ENUM_MEMBERS) {
      return invalid(key, `enum has more than ${MAX_ENUM_MEMBERS} members`);
    }
    // model enum entries validated against aliasNames at REGISTRATION only (DES-101 note); at
    // submission only the effective model is re-checked via the existing UNKNOWN_ALIAS rule.
    if (key === 'model' && spec.enum !== undefined) {
      for (const entry of spec.enum) {
        if (!isKnownAlias(entry as string, aliasNames)) {
          return invalid(key, `model enum entry not a known alias: ${String(entry)}`);
        }
      }
    }
    // v21 Gate 8 re-review #3 (P-A4): a declared `model.default` is the SAME registration-time
    // alias check as an enum entry above — without it, knob-default normalization
    // (workflow-catalog.ts's effectiveDefaults loop) would inject an unvalidated model string into
    // the stored `defaults`, making the register-time control that should catch it never fire.
    if (key === 'model' && typeof spec.default === 'string' && !isKnownAlias(spec.default, aliasNames)) {
      return invalid(key, `model default not a known alias: ${String(spec.default)}`);
    }
    knobs[key] = spec;
  }

  for (const [key, spec] of Object.entries(argsIn)) {
    const shapeErr = validateSpecShape(`args.${key}`, spec);
    if (shapeErr) return shapeErr;
    if (spec.enum !== undefined && spec.enum.length > MAX_ENUM_MEMBERS) {
      return invalid(`args.${key}`, `enum has more than ${MAX_ENUM_MEMBERS} members`);
    }
  }
  const args: Record<string, ParamSpec> = { ...argsIn };

  return { ok: true, value: { knobs, args } };
}

/** v21 adjudication #6 (F-2): the single bounds predicate shared with `workflow-catalog.ts`'s
 *  own-spec-violation check — two hand-rolled type/enum/min/max checkers over the same ParamSpec
 *  shape drift (an advertised bound disagreeing with an enforced one, P-A2's failure class). This
 *  is the one exported so the catalog's own-default check reuses it instead of re-typing it. */
export function checkValueAgainstSpec(param: string, value: unknown, spec: ParamSpec): { ok: true } | Err {
  const expectedType = spec.type === 'number' ? 'number' : 'string';
  if (typeof value !== expectedType) {
    return {
      ok: false,
      code: 'PARAM_OUT_OF_RANGE',
      message: `${param} has the wrong type`,
      detail: { param, suppliedType: typeof value, expectedType },
    };
  }
  if (spec.enum !== undefined && !spec.enum.includes(value)) {
    return {
      ok: false,
      code: 'PARAM_OUT_OF_RANGE',
      message: `${param} is not in the allowed set`,
      detail: { param, ...truncatedSupplied(value), allowed: { enum: spec.enum } },
    };
  }
  // v21 Gate 8 RE-REVIEW #4 (A4): for a `type:'string'` spec, `min`/`max` bound the value's UTF-8
  // BYTE LENGTH — comparing the string itself against a numeric bound is NaN-inert and the check
  // never fires. This matches how `maxAppendPromptBytes`/`MAX_SUPPLIED_BYTES` already express
  // string limits elsewhere in this module.
  const bound = spec.type === 'string' ? Buffer.byteLength(value as string, 'utf8') : (value as number);
  if (spec.min !== undefined && bound < spec.min) {
    return {
      ok: false,
      code: 'PARAM_OUT_OF_RANGE',
      message: `${param} is below the minimum`,
      detail: { param, ...truncatedSupplied(value), allowed: { min: spec.min, max: spec.max } },
    };
  }
  if (spec.max !== undefined && bound > spec.max) {
    return {
      ok: false,
      code: 'PARAM_OUT_OF_RANGE',
      message: `${param} is above the maximum`,
      detail: { param, ...truncatedSupplied(value), allowed: { min: spec.min, max: spec.max } },
    };
  }
  return { ok: true };
}

/** The 8-row rejection table (rows 1-6; row 7 is validateDeclaredArgs, row 8 is parseParamContract). */
export function validateUserOverrides(
  c: ParamContract,
  raw: unknown,
  aliasNames: Set<string>,
  ceilings: Ceilings,
): { ok: true; value: UserOverrides } | Err {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const eff = effectiveBounds(c, ceilings);
  const value: Record<string, unknown> = {};

  for (const [key, val] of Object.entries(obj)) {
    if ((LOCKED_KEYS as readonly string[]).includes(key)) {
      return {
        ok: false,
        code: 'PARAM_LOCKED',
        message: `"${key}" is a locked parameter and cannot be overridden`,
        detail: { param: key, tunable: [...TUNABLE_KEYS] },
      };
    }
    if (!(TUNABLE_KEYS as readonly string[]).includes(key)) {
      return {
        ok: false,
        code: 'PARAM_UNKNOWN',
        message: `"${key}" is not a recognized override`,
        detail: { param: key, tunable: [...TUNABLE_KEYS] },
      };
    }

    const spec = eff.knobs[key]!;

    // appendPrompt is reported by size, never by content (DES-101 note): checked in bytes against
    // the EFFECTIVE bound (min(author, ceiling), post-A5) before any generic spec check — an
    // author-declared bound tighter than the raw ceiling must refuse the same way, and neither path
    // may let the oversized text reach a detail object (unlike checkValueAgainstSpec's generic
    // min/max branches, which echo a truncated `supplied` — appendPrompt is excluded from those
    // branches below for exactly this reason).
    if (key === 'appendPrompt' && typeof val === 'string') {
      const bytes = Buffer.byteLength(val, 'utf8');
      if (spec.min !== undefined && bytes < spec.min) {
        return {
          ok: false,
          code: 'PARAM_OUT_OF_RANGE',
          message: 'appendPrompt is below the minimum byte length',
          detail: { param: 'appendPrompt', suppliedBytes: bytes, minBytes: spec.min },
        };
      }
      if (spec.max !== undefined && bytes > spec.max) {
        return {
          ok: false,
          code: 'PARAM_OUT_OF_RANGE',
          message: 'appendPrompt exceeds the byte ceiling',
          detail: { param: 'appendPrompt', suppliedBytes: bytes, maxBytes: spec.max },
        };
      }
    }

    // appendPrompt's min/max were already enforced size-only above without echoing content; strip
    // them before the generic check so checkValueAgainstSpec's min/max branches (which echo a
    // truncated `supplied`) never fire a second time for this key.
    const specForCheck = key === 'appendPrompt' ? { ...spec, min: undefined, max: undefined } : spec;
    const result = checkValueAgainstSpec(key, val, specForCheck);
    // DES-101 row 6 is UNCONDITIONAL: an appendPrompt rejection reports size, never content —
    // whichever constraint the text violated. Stripping min/max above only covers the two branches
    // this function re-implements; an author may also declare an `enum` on `appendPrompt` (it is a
    // tunable knob and `validateSpecShape` accepts any array enum), and that branch echoes a
    // 64-byte `truncatedSupplied` — a fragment of caller-supplied free text, which is exactly the
    // leak row 6 exists to forbid. Sanitize the rejection here rather than stripping `enum` from
    // `specForCheck`: dropping the constraint would leave a bound that is advertised but not
    // enforced (this iteration's P-A2 failure class). The author's own `allowed` presets are not
    // caller text and stay, so the rejection remains actionable.
    if (!result.ok) {
      if (key !== 'appendPrompt') return result;
      const safe: Record<string, unknown> = { ...result.detail };
      delete safe['supplied'];
      delete safe['suppliedTruncated'];
      if (typeof val === 'string') safe['suppliedBytes'] = Buffer.byteLength(val, 'utf8');
      return { ...result, detail: safe };
    }

    // D-AUTH-5-B / UNKNOWN_ALIAS precedent, applied at submission for the case the author left
    // `model` unconstrained (no enum — the REQ-090 canonical/backward-compat default): a spec with
    // its own `enum` already screens this via checkValueAgainstSpec above.
    // The code is the PRE-EXISTING `UNKNOWN_ALIAS` (ARCH-064's interface table; the same code
    // `submission-validator.ts:112` already returns for this same condition at the script-literal
    // rung), NOT `PARAM_OUT_OF_RANGE` — an unresolvable alias is a different rejection from "outside
    // the author's declared bounds", and one condition must not answer under two codes.
    if (key === 'model' && typeof val === 'string' && spec.enum === undefined && !isKnownAlias(val, aliasNames)) {
      return {
        ok: false,
        code: 'UNKNOWN_ALIAS',
        message: `model is not a known alias: ${val}`,
        detail: { param: 'model', ...truncatedSupplied(val), allowed: { enum: [...aliasNames] } },
      };
    }

    value[key] = val;
  }

  return { ok: true, value: value as UserOverrides };
}

/** Declared `args` are checked only for fields the contract declares; undeclared keys pass
 *  through unchanged (backward compat). */
export function validateDeclaredArgs(c: ParamContract, args: unknown): { ok: true } | Err {
  const obj = (args ?? {}) as Record<string, unknown>;
  for (const [key, spec] of Object.entries(c.args)) {
    if (!(key in obj)) continue;
    const result = checkValueAgainstSpec(`args.${key}`, obj[key], spec);
    if (!result.ok) return result;
  }
  return { ok: true };
}
