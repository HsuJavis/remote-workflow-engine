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
  code: 'PARAM_LOCKED' | 'PARAM_OUT_OF_RANGE' | 'PARAM_UNKNOWN' | 'PARAM_CONTRACT_INVALID';
  message: string;
  detail: Record<string, unknown>;
};

/** Total declared knobs+args over this bound → PARAM_CONTRACT_INVALID (DES-101 boundary conditions). */
const MAX_DECLARED = 32;

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

function boundTimeoutMs(spec: ParamSpec, ceilings: Ceilings): ParamSpec {
  const authorMax = spec.max ?? Infinity;
  return { ...spec, max: Math.min(authorMax, ceilings.maxTimeoutMs) };
}

function boundEffort(spec: ParamSpec, ceilings: Ceilings): ParamSpec {
  const authorEnum = (spec.enum as Effort[] | undefined) ?? ALL_EFFORTS;
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
    knobs[key] = key === 'timeoutMs' ? boundTimeoutMs(spec, ceilings)
      : key === 'effort' ? boundEffort(spec, ceilings)
      : spec;
  }
  return { knobs, args: c.args };
}

function invalid(param: string, reason: string): Err {
  return { ok: false, code: 'PARAM_CONTRACT_INVALID', message: reason, detail: { param, reason } };
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
    // model enum entries validated against aliasNames at REGISTRATION only (DES-101 note); at
    // submission only the effective model is re-checked via the existing UNKNOWN_ALIAS rule.
    if (key === 'model' && spec.enum !== undefined) {
      for (const entry of spec.enum) {
        if (!aliasNames.has(entry as string)) {
          return invalid(key, `model enum entry not a known alias: ${String(entry)}`);
        }
      }
    }
    knobs[key] = spec;
  }

  const args: Record<string, ParamSpec> = { ...argsIn };

  return { ok: true, value: { knobs, args } };
}

function checkValueAgainstSpec(param: string, value: unknown, spec: ParamSpec): { ok: true } | Err {
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
      detail: { param, supplied: value, allowed: { enum: spec.enum } },
    };
  }
  if (spec.min !== undefined && (value as number) < spec.min) {
    return {
      ok: false,
      code: 'PARAM_OUT_OF_RANGE',
      message: `${param} is below the minimum`,
      detail: { param, supplied: value, allowed: { min: spec.min, max: spec.max } },
    };
  }
  if (spec.max !== undefined && (value as number) > spec.max) {
    return {
      ok: false,
      code: 'PARAM_OUT_OF_RANGE',
      message: `${param} is above the maximum`,
      detail: { param, supplied: value, allowed: { min: spec.min, max: spec.max } },
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

    // appendPrompt is reported by size, never by content (DES-101 note): checked against the raw
    // ceiling before any generic spec check, so the oversized text never reaches a detail object.
    if (key === 'appendPrompt' && typeof val === 'string') {
      const bytes = Buffer.byteLength(val, 'utf8');
      if (bytes > ceilings.maxAppendPromptBytes) {
        return {
          ok: false,
          code: 'PARAM_OUT_OF_RANGE',
          message: 'appendPrompt exceeds the byte ceiling',
          detail: { param: 'appendPrompt', suppliedBytes: bytes, maxBytes: ceilings.maxAppendPromptBytes },
        };
      }
    }

    const spec = eff.knobs[key]!;
    const result = checkValueAgainstSpec(key, val, spec);
    if (!result.ok) return result;

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
