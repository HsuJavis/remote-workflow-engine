// src/params/contract.ts (DES-101, ARCH-064, TASK-097; v24 rewrite DES-144/145, ARCH-094,
// TASK-136): the single place that knows the tunable-parameter contract vocabulary —
// registration, submission, and the describe surface all consume these functions, so the
// rejection codes cannot drift into separate copies.
//
// v24 (REQ-107..118, ADR-035): the flat "one set of 4 knobs for the whole workflow" contract is
// RETIRED. Every script agent() label now needs its OWN `params.agents.<label>` declaration
// (model/effort/timeoutMs REQUIRED with a `.default`), and `meta.params.knobs` / `meta.defaults`
// are refused outright (`DEFAULTS_RETIRED`) rather than silently accepted. A no-agent
// (`workflow()`-only) script still parses to an empty contract.
//
// Pure: no I/O, no clock, no VM, no randomness.
import type { ErrorCode } from '../errors.js';

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
  /** v24 (integrator; DES-145 S-3 / TASK-136's own test row): set by `effectiveAgentBounds` ONLY
   *  when the effective `max` came from an ENGINE ceiling rather than the author's declaration, and
   *  naming which one. It exists so the refusal MESSAGE can say `maxTimeoutMs 600000` — a caller
   *  reading `exceeds the maximum of 600000` cannot tell an engine ceiling from an author range
   *  that happens to hold the same number, and the design's own test row requires that it can.
   *  Never persisted (the stored column keeps the author's raw declaration) and never author-set. */
  ceilingKey?: 'maxTimeoutMs' | 'maxAppendPromptBytes' | 'maxEffort';
}

/** v24 (DES-144): one script agent() label's declared contract. `model`/`effort`/`timeoutMs` are
 *  REQUIRED, each with a `.default` — there is no implicit engine default per agent any more
 *  (that is what made the old 5-rung ladder's `'agentType'`/`'call'` rungs unreachable/deleted,
 *  TASK-137). `skills`/`mcp` are author-declared name arrays whose EXISTENCE is not checked here
 *  (ARCH-094) — a name unresolved at dispatch is a materialization-time concern, not a contract
 *  one. */
export interface AgentParamSpec {
  model: ParamSpec;
  effort: ParamSpec;
  timeoutMs: ParamSpec;
  appendPrompt?: ParamSpec;
  skills?: string[];
  mcp?: string[];
}

export interface ParamContract {
  agents: Record<string, AgentParamSpec>;
  args: Record<string, ParamSpec>;
}

// closed: a locked key is UNREPRESENTABLE inside an agent override block (ADR-001)
export interface UserOverrides {
  agents?: Record<string, Partial<{ model: string; effort: Effort; timeoutMs: number; appendPrompt: string }>>;
}

export interface Ceilings {
  maxTimeoutMs: number;
  maxAppendPromptBytes: number;
  maxEffort: Effort;
}

// v21 Gate 8 RE-REVIEW #6 (P6-5, DES-104/ADR-005): THE fail-closed default for the three engine
// ceilings. It used to be re-typed at three independent sites — run-manager.ts, mcp-facade.ts and
// (worst) server.ts's production composition root, which imported neither of the other two — so a
// future change at the "natural" site would leave production on the old number with a green suite.
// One literal, imported everywhere; applied PER KEY, so a config supplying only one still gets sane
// bounds on the other two. Values are DEPLOY §1b's / ADR-005's documented defaults. Pinned
// structurally by tests/unit/params-contract.test.ts: a fourth literal, or a site that stops
// importing this one, goes red.
export const DEFAULT_CEILINGS: Ceilings = { maxTimeoutMs: 600_000, maxAppendPromptBytes: 1024, maxEffort: 'high' };

export type Err = {
  ok: false;
  // v24 (DES-137, DES-144, DES-145): constrained to the closed ErrorCode union at its declaration
  // (one of the upstream unions codedError() reaches through, never as a bare literal).
  code: Extract<
    ErrorCode,
    | 'PARAM_LOCKED'
    | 'PARAM_OUT_OF_RANGE'
    | 'PARAM_UNKNOWN'
    | 'PARAM_CONTRACT_INVALID'
    | 'UNKNOWN_ALIAS'
    | 'AGENT_UNDECLARED'
    | 'AGENT_DECLARED_NOT_IN_SCRIPT'
    | 'DEFAULTS_RETIRED'
    | 'UNKNOWN_AGENT_LABEL'
    | 'LEGACY_REREGISTER'
  >;
  message: string;
  detail: Record<string, unknown>;
};

/** Total declared agents+args over this bound → PARAM_CONTRACT_INVALID (structural bound, same
 *  purpose as v21's — an unbounded declaration surface is served on every `workflow_get`). */
const MAX_DECLARED = 32;

/** A declared enum with more than this many members → PARAM_CONTRACT_INVALID (DES-101 boundary
 *  conditions, carried into v24 unchanged: "enum ≤ 32 members" — an unbounded enum is served on
 *  every `workflow_get`). */
const MAX_ENUM_MEMBERS = 32;

/** Free text in an error detail is reported by size, never in full (DES-101 boundary conditions):
 *  any string value over this many bytes is truncated with `suppliedTruncated:true`. */
const MAX_SUPPLIED_BYTES = 64;

/** REQ-038 precedent (`submission-validator.ts`): an `openrouter/<id>`-shaped model string is a
 *  valid passthrough model though never a pre-listed alias — LiteLLM routes it natively via its
 *  `openrouter/*` wildcard, so it needs no entry in `aliasNames`. */
const OPENROUTER_PASSTHROUGH = /^openrouter\/.+/;

/** v21 Gate 8 RE-REVIEW #5 (F2, MED — BLOCKING): mirrors resolve.ts's `USER_INSTRUCTIONS_CLOSE`
 *  frame marker (ADR-007's structural control) without importing resolve.ts — this module is pure
 *  and resolve.ts already imports types from here, so importing the value back would create a
 *  cycle. Matches the tighter `<` + `/user-instructions` shape (not the exact closing tag text) so
 *  a variant like `</user-instructions >` cannot slip a literal-string check; a non-owner
 *  submitter embedding this in `agents.<label>.appendPrompt` would otherwise close the untrusted
 *  frame early and attribute trailing text to the workflow author (cross-principal attribution
 *  forgery). [AMENDED v21 Gate 8 RE-REVIEW #6, P6-1]: widened to `i` (case) + tolerate whitespace
 *  around the `/` — the exact-literal form let `</USER-INSTRUCTIONS>`/`</ user-instructions>`
 *  variants close the untrusted frame unrefused. Pattern stays linear (no nested quantifiers) so
 *  the A2 quadratic-cost fix stays intact. Still the exact same control in v24 — only the address
 *  of the field it guards moved from a flat `appendPrompt` to `agents.<label>.appendPrompt`. */
export const FRAME_CLOSE_FORGERY = /<\s*\/\s*user-instructions/i;

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

/** min(author, ceiling) on `max`, shared by timeoutMs (ms) and appendPrompt (bytes). Same totality
 *  principle as `boundEffort`: a stored row that predates the parser's shape guard may carry a
 *  non-number `max` — treated as "author left it unconstrained" rather than propagating `NaN`
 *  (which would otherwise both serve `null` and be inert at admission, a ceiling bypass). */
function boundMax(spec: ParamSpec, ceilingMax: number, ceilingKey: NonNullable<ParamSpec['ceilingKey']>): ParamSpec {
  const authorMax = typeof spec.max === 'number' ? spec.max : Infinity;
  const effective = Math.min(authorMax, ceilingMax);
  // The ceiling is named only when it is the bound that actually WON; when the author's own range
  // is tighter, the message must not blame an engine ceiling the caller could not have hit.
  return { ...spec, max: effective, ...(effective === ceilingMax && authorMax >= ceilingMax ? { ceilingKey } : {}) };
}

// v21 Gate 8 RE-REVIEW #4 (A1 half 2): `effectiveAgentBounds` must stay TOTAL even over a stored
// contract that predates the parser's shape guard (a live deployment has one) — a non-array
// `enum` must never crash `.filter`, it must be treated as "author left it unconstrained".
function boundEffort(spec: ParamSpec, ceilings: Ceilings): ParamSpec {
  const authorEnum = Array.isArray(spec.enum) ? (spec.enum as Effort[]) : ALL_EFFORTS;
  const ceilingRank = EFFORT_RANK[ceilings.maxEffort];
  return { ...spec, enum: authorEnum.filter((e) => EFFORT_RANK[e] <= ceilingRank) };
}

/** min(author, ceiling), computed at READ time from live config, for ONE agent's ceiling-bearing
 *  knobs — the stored column keeps the author's raw declaration, so lowering a ceiling takes
 *  effect without a re-register. v24 successor of the old flat `effectiveBounds` (DES-101), now
 *  addressed per `agents.<label>` (ARCH-094) rather than once for the whole workflow. */
export function effectiveAgentBounds(spec: AgentParamSpec, ceilings: Ceilings): AgentParamSpec {
  return {
    ...spec,
    timeoutMs: boundMax(spec.timeoutMs, ceilings.maxTimeoutMs, 'maxTimeoutMs'),
    effort: boundEffort(spec.effort, ceilings),
    appendPrompt: spec.appendPrompt ? boundMax(spec.appendPrompt, ceilings.maxAppendPromptBytes, 'maxAppendPromptBytes') : spec.appendPrompt,
  };
}

function invalid(param: string, reason: string): Err {
  return { ok: false, code: 'PARAM_CONTRACT_INVALID', message: reason, detail: { param, reason } };
}

function retiredDefaults(param: string): Err {
  return {
    ok: false,
    code: 'DEFAULTS_RETIRED',
    message: `${param} is retired (ADR-035) — declare meta.params.agents.<label>.<key>.default instead`,
    detail: { param },
  };
}

const VALID_SPEC_TYPES = ['string', 'number', 'enum'] as const;

// v21 Gate 8 RE-REVIEW #4 (A1 half 1): a malformed `type`, a non-array `enum`, or a non-number
// `min`/`max` must never register as-is and poison every later read of the stored row. Typed
// rejection, nothing stored. Unchanged in v24 — still the one shape guard every declared spec
// (an agent's model/effort/timeoutMs/appendPrompt, or an args entry) goes through.
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
  // v21 Gate 8 RE-REVIEW #6 (P6-4): `type:'enum'` specs are string-only by construction
  // (checkValueAgainstSpec's expectedType ternary sends 'enum'->'string' before membership ever
  // runs), so a non-string member (mixed or fully numeric) registers an unusable knob that admits
  // no value at all. Reject the declaration outright, same precedent as the enum-vs-min/max check
  // below.
  if (spec.enum !== undefined && !spec.enum.every((e) => typeof e === 'string')) {
    return invalid(param, 'enum members must be strings');
  }
  // v21 Gate 8 RE-REVIEW #5 (F4, residual edge of A4): a `type:'enum'` spec is bounded by its own
  // membership (checkValueAgainstSpec's `enum.includes(value)`) — the numeric min/max branch never
  // applies to it (NaN-inert), so a declared min/max on an enum spec was advertised on
  // `workflow_get` but silently never enforced. Reject the declaration outright rather than ship a
  // second, dead bound.
  if (spec.type === 'enum' && (spec.min !== undefined || spec.max !== undefined)) {
    return invalid(param, "min/max do not apply to a type:'enum' spec — enum membership is its own bound");
  }
  return null;
}

/** model/effort/timeoutMs share one shape: declared, spec-valid, and carrying a `.default` — v24's
 *  "all three REQUIRED with .default" (DES-144). Extra semantic checks (alias / effort-rank /
 *  ceiling) are layered on top per key by the caller. */
function validateRequiredKeySpec(param: string, spec: unknown): Err | null {
  if (typeof spec !== 'object' || spec === null || Array.isArray(spec)) {
    return invalid(param, 'must be an object');
  }
  const shapeErr = validateSpecShape(param, spec as ParamSpec);
  if (shapeErr) return shapeErr;
  if ((spec as ParamSpec).default === undefined) {
    return invalid(param, 'must declare a default (v24: no implicit engine default per agent)');
  }
  if ((spec as ParamSpec).enum !== undefined && (spec as ParamSpec).enum!.length > MAX_ENUM_MEMBERS) {
    return invalid(param, `enum has more than ${MAX_ENUM_MEMBERS} members`);
  }
  return null;
}

/** `skills`/`mcp` on an agent block: a name array, existence unchecked here (ARCH-094). */
function validateNameArray(param: string, value: unknown): Err | null {
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string' && /^[A-Za-z0-9][\w.-]*$/.test(v) && !v.startsWith('rwe-'))) {
    return invalid(param, 'must be an array of plain names (no rwe- prefix)');
  }
  return null;
}

function validateOneAgentSpec(label: string, raw: unknown, aliasNames: Set<string>): Err | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return invalid(`agents.${label}`, 'must be an object');
  }
  const spec = raw as Partial<AgentParamSpec>;

  const modelErr = validateRequiredKeySpec(`agents.${label}.model`, spec.model);
  if (modelErr) return modelErr;
  const model = spec.model as ParamSpec;
  if (typeof model.default === 'string' && !isKnownAlias(model.default, aliasNames)) {
    return invalid(`agents.${label}.model`, `default not a known alias: ${String(model.default)}`);
  }
  if (model.enum !== undefined) {
    for (const entry of model.enum) {
      if (!isKnownAlias(entry as string, aliasNames)) {
        return invalid(`agents.${label}.model`, `enum entry not a known alias: ${String(entry)}`);
      }
    }
  }

  const effortErr = validateRequiredKeySpec(`agents.${label}.effort`, spec.effort);
  if (effortErr) return effortErr;
  const effort = spec.effort as ParamSpec;
  if (!isEffort(effort.default)) {
    return invalid(`agents.${label}.effort`, `default must be one of ${ALL_EFFORTS.join(', ')}`);
  }
  if (EFFORT_RANK[effort.default] > EFFORT_RANK[DEFAULT_CEILINGS.maxEffort]) {
    return invalid(`agents.${label}.effort`, `default exceeds the engine ceiling ${DEFAULT_CEILINGS.maxEffort}`);
  }

  const timeoutErr = validateRequiredKeySpec(`agents.${label}.timeoutMs`, spec.timeoutMs);
  if (timeoutErr) return timeoutErr;
  const timeoutMs = spec.timeoutMs as ParamSpec;
  if (typeof timeoutMs.default !== 'number' || !Number.isInteger(timeoutMs.default) || timeoutMs.default < 1) {
    return invalid(`agents.${label}.timeoutMs`, 'default must be an integer >= 1');
  }
  if (timeoutMs.default > DEFAULT_CEILINGS.maxTimeoutMs) {
    return invalid(`agents.${label}.timeoutMs`, `default exceeds the engine ceiling ${DEFAULT_CEILINGS.maxTimeoutMs}`);
  }

  if (spec.appendPrompt !== undefined) {
    const shapeErr = validateSpecShape(`agents.${label}.appendPrompt`, spec.appendPrompt);
    if (shapeErr) return shapeErr;
    // v24 (integrator; DES-144's boundary "`appendPrompt.default` byte-capped + frame-delimiter
    // checked", found by the Batch-A executor): the v24 contract rewrite dropped BOTH checks on the
    // AUTHOR-declared default and kept them only on the caller-supplied override. v22
    // adjudication #3 (M-2) deliberately MOVED this refusal to REGISTRATION (REQ-099/ADR-013) so a
    // forged frame-close delimiter can never be STORED; catching it later, at admission, on every
    // run, is the state that ruling exists to end. Reported by SIZE, never by echoing the text
    // (DES-101 row 6).
    const declaredDefault = (spec.appendPrompt as ParamSpec).default;
    if (typeof declaredDefault === 'string') {
      if (FRAME_CLOSE_FORGERY.test(declaredDefault)) {
        return invalid(`agents.${label}.appendPrompt`, 'default cannot contain the user-instructions frame close delimiter');
      }
      const bytes = Buffer.byteLength(declaredDefault, 'utf8');
      if (bytes > DEFAULT_CEILINGS.maxAppendPromptBytes) {
        return invalid(`agents.${label}.appendPrompt`, `default is ${bytes} bytes, over the engine ceiling maxAppendPromptBytes ${DEFAULT_CEILINGS.maxAppendPromptBytes}`);
      }
    }
  }
  if (spec.skills !== undefined) {
    const skillsErr = validateNameArray(`agents.${label}.skills`, spec.skills);
    if (skillsErr) return skillsErr;
  }
  if (spec.mcp !== undefined) {
    const mcpErr = validateNameArray(`agents.${label}.mcp`, spec.mcp);
    if (mcpErr) return mcpErr;
  }
  return null;
}

/** Registration-time parse of `meta.params` (DES-144). v24: EVERY script agent() label needs a
 *  matching `agents.<label>` declaration (model/effort/timeoutMs all required, each with a
 *  `.default`) — there is no more "no params block means the 4 engine-global knobs" fallback. A
 *  zero-label (`workflow()`-only) script still parses to `{agents:{}, args:{}}`. Post-eval
 *  structural bounds only — the pre-eval source-size bound lives in workflow-meta.ts, because this
 *  only ever sees a value that already survived evaluation. */
export function parseParamContract(
  metaParams: unknown,
  scriptLabels: string[],
  aliasNames: Set<string>,
): { ok: true; value: ParamContract } | Err {
  if (metaParams === undefined) {
    if (scriptLabels.length === 0) return { ok: true, value: { agents: {}, args: {} } };
    return {
      ok: false,
      code: 'AGENT_UNDECLARED',
      message: `agent label "${scriptLabels[0]}" has no params.agents.${scriptLabels[0]} declaration`,
      detail: { label: scriptLabels[0] },
    };
  }
  if (typeof metaParams !== 'object' || metaParams === null || Array.isArray(metaParams)) {
    return invalid('root', 'meta.params must be an object');
  }

  const raw = metaParams as { agents?: unknown; args?: unknown; knobs?: unknown; defaults?: unknown };
  // v24 (ADR-035): both retired sites refused BY NAME, before anything else is parsed.
  if (raw.knobs !== undefined) return retiredDefaults('meta.params.knobs');
  if (raw.defaults !== undefined) return retiredDefaults('meta.defaults');

  if (raw.agents !== undefined && (typeof raw.agents !== 'object' || raw.agents === null || Array.isArray(raw.agents))) {
    return invalid('agents', 'params.agents must be an object');
  }
  if (raw.args !== undefined && (typeof raw.args !== 'object' || raw.args === null || Array.isArray(raw.args))) {
    return invalid('args', 'params.args must be an object');
  }

  const agentsIn = (raw.agents ?? {}) as Record<string, unknown>;
  const argsIn = (raw.args ?? {}) as Record<string, ParamSpec>;

  if (Object.keys(agentsIn).length + Object.keys(argsIn).length > MAX_DECLARED) {
    return invalid('root', `more than ${MAX_DECLARED} declared agents+args`);
  }

  const scriptSet = new Set(scriptLabels);
  for (const label of scriptLabels) {
    if (!(label in agentsIn)) {
      return { ok: false, code: 'AGENT_UNDECLARED', message: `agent label "${label}" has no params.agents.${label} declaration`, detail: { label } };
    }
  }
  for (const label of Object.keys(agentsIn)) {
    if (!scriptSet.has(label)) {
      return {
        ok: false,
        code: 'AGENT_DECLARED_NOT_IN_SCRIPT',
        message: `params.agents.${label} is declared but no agent() call in the script uses it`,
        detail: { label },
      };
    }
  }

  const agents: Record<string, AgentParamSpec> = {};
  for (const [label, spec] of Object.entries(agentsIn)) {
    const specErr = validateOneAgentSpec(label, spec, aliasNames);
    if (specErr) return specErr;
    agents[label] = spec as AgentParamSpec;
  }

  const args: Record<string, ParamSpec> = {};
  for (const [key, spec] of Object.entries(argsIn)) {
    const shapeErr = validateSpecShape(`args.${key}`, spec);
    if (shapeErr) return shapeErr;
    // v21 Gate 8 RE-REVIEW #6 (P6-3): a declared args.<k>.default is parsed and served on
    // workflow_get, but nothing ever reads or applies a per-arg default — so it is silent
    // `undefined` to the script, advertised but never enforced. Reject the declaration outright.
    if (spec.default !== undefined) {
      return invalid(`args.${key}`, 'args spec cannot declare a default (never applied)');
    }
    if (spec.enum !== undefined && spec.enum.length > MAX_ENUM_MEMBERS) {
      return invalid(`args.${key}`, `enum has more than ${MAX_ENUM_MEMBERS} members`);
    }
    args[key] = spec;
  }

  return { ok: true, value: { agents, args } };
}

/** v21 adjudication #6 (F-2): the single bounds predicate shared with `workflow-catalog.ts`'s
 *  own-spec-violation check — two hand-rolled type/enum/min/max checkers over the same ParamSpec
 *  shape drift (an advertised bound disagreeing with an enforced one, P-A2's failure class). This
 *  is the one exported so the catalog's own-default check reuses it instead of re-typing it.
 *  Unchanged in v24 (address-agnostic: takes a `ParamSpec` directly, not a `ParamContract`). */
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
      message: `${param} is below the minimum of ${spec.min}`,
      detail: { param, ...truncatedSupplied(value), allowed: { min: spec.min, max: spec.max } },
    };
  }
  if (spec.max !== undefined && bound > spec.max) {
    return {
      ok: false,
      code: 'PARAM_OUT_OF_RANGE',
      // v24 (UT-147): the ceiling-vs-author-range direction must be readable from the message
      // itself, not just `detail.allowed` — the caller needs to see WHICH bound (author or engine)
      // fired without re-deriving effectiveAgentBounds.
      message: spec.ceilingKey !== undefined
        ? `${param} exceeds the engine ceiling ${spec.ceilingKey} ${spec.max}`
        : `${param} exceeds the maximum of ${spec.max}`,
      detail: { param, ...truncatedSupplied(value), allowed: { min: spec.min, max: spec.max }, ...(spec.ceilingKey !== undefined ? { ceiling: spec.ceilingKey } : {}) },
    };
  }
  return { ok: true };
}

/** The rejection table over ONE agent's overrides — reused per label by `validateUserOverrides`.
 *  `spec` is already the EFFECTIVE (author ∩ ceiling) bound for this agent (via
 *  `effectiveAgentBounds`). */
function validateOneAgentOverride(
  label: string,
  eff: AgentParamSpec,
  raw: Record<string, unknown>,
  aliasNames: Set<string>,
): { ok: true; value: Record<string, unknown> } | Err {
  const value: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(raw)) {
    if ((LOCKED_KEYS as readonly string[]).includes(key)) {
      return {
        ok: false,
        code: 'PARAM_LOCKED',
        message: `"${key}" is a locked parameter and cannot be overridden`,
        detail: { param: key, agent: label, tunable: [...TUNABLE_KEYS] },
      };
    }
    if (!(TUNABLE_KEYS as readonly string[]).includes(key)) {
      return {
        ok: false,
        code: 'PARAM_UNKNOWN',
        message: `"${key}" is not a recognized override`,
        detail: { param: key, agent: label, tunable: [...TUNABLE_KEYS] },
      };
    }

    const spec = (eff as unknown as Record<string, ParamSpec>)[key];
    if (!spec) {
      return {
        ok: false,
        code: 'PARAM_UNKNOWN',
        message: `agent "${label}" does not declare "${key}"`,
        detail: { param: key, agent: label },
      };
    }

    // appendPrompt is reported by size, never by content (DES-101 note, unchanged in v24): checked
    // in bytes against the EFFECTIVE bound (min(author, ceiling)) before any generic spec check —
    // an author-declared bound tighter than the raw ceiling must refuse the same way, and neither
    // path may let the oversized text reach a detail object.
    if (key === 'appendPrompt' && typeof val === 'string') {
      const bytes = Buffer.byteLength(val, 'utf8');
      if (FRAME_CLOSE_FORGERY.test(val)) {
        return {
          ok: false,
          code: 'PARAM_OUT_OF_RANGE',
          message: 'appendPrompt cannot contain the user-instructions frame close delimiter',
          detail: { param: 'appendPrompt', agent: label, suppliedBytes: bytes },
        };
      }
      if (spec.min !== undefined && bytes < spec.min) {
        return {
          ok: false,
          code: 'PARAM_OUT_OF_RANGE',
          message: 'appendPrompt is below the minimum byte length',
          detail: { param: 'appendPrompt', agent: label, suppliedBytes: bytes, minBytes: spec.min },
        };
      }
      if (spec.max !== undefined && bytes > spec.max) {
        return {
          ok: false,
          code: 'PARAM_OUT_OF_RANGE',
          message: 'appendPrompt exceeds the byte ceiling',
          detail: { param: 'appendPrompt', agent: label, suppliedBytes: bytes, maxBytes: spec.max },
        };
      }
    }

    // appendPrompt's min/max were already enforced size-only above without echoing content; strip
    // them before the generic check so checkValueAgainstSpec's min/max branches (which echo a
    // truncated `supplied`) never fire a second time for this key.
    const specForCheck = key === 'appendPrompt' ? { ...spec, min: undefined, max: undefined } : spec;
    const result = checkValueAgainstSpec(key, val, specForCheck);
    if (!result.ok) {
      if (key !== 'appendPrompt') return { ...result, detail: { ...result.detail, agent: label } };
      const safe: Record<string, unknown> = { ...result.detail, agent: label };
      delete safe['supplied'];
      delete safe['suppliedTruncated'];
      if (typeof val === 'string') safe['suppliedBytes'] = Buffer.byteLength(val, 'utf8');
      return { ...result, detail: safe };
    }

    // D-AUTH-5-B / UNKNOWN_ALIAS precedent, applied at submission for the case the author left
    // `model` unconstrained (no enum): a spec with its own `enum` already screens this via
    // checkValueAgainstSpec above. The code is the PRE-EXISTING `UNKNOWN_ALIAS`, NOT
    // `PARAM_OUT_OF_RANGE` — an unresolvable alias is a different rejection from "outside the
    // author's declared bounds".
    if (key === 'model' && typeof val === 'string' && spec.enum === undefined && !isKnownAlias(val, aliasNames)) {
      return {
        ok: false,
        code: 'UNKNOWN_ALIAS',
        message: `model is not a known alias: ${val}`,
        detail: { param: 'model', agent: label, ...truncatedSupplied(val), allowed: { enum: [...aliasNames] } },
      };
    }

    value[key] = val;
  }
  return { ok: true, value };
}

/** v24 (DES-145): the per-agent rejection table. `raw.agents.<label>` is validated against
 *  `contract.agents[label]`'s EFFECTIVE (author ∩ ceiling) bound; an unknown label is
 *  `UNKNOWN_AGENT_LABEL{label, known}`. */
export function validateUserOverrides(
  c: ParamContract,
  raw: unknown,
  aliasNames: Set<string>,
  ceilings: Ceilings,
): { ok: true; value: UserOverrides } | Err {
  const obj = (raw ?? {}) as { agents?: Record<string, Record<string, unknown>> };
  // v24 (integrator; DES-145/ADR-001): the TOP level of `overrides` is closed to `{agents}`. It
  // used to be unread — every key other than `agents` was silently dropped, so the whole v21 FLAT
  // shape (`overrides:{model,effort,timeoutMs,appendPrompt}`), which the plugin docs and every
  // pre-v24 caller still spell, was accepted and then did NOTHING: the run started with the
  // author's defaults and the caller was told it had been honoured. A locked key (`prompt`, …)
  // vanished the same way, turning ADR-001's type-level guarantee into a silent no-op at the wire,
  // where it matters. Locked keys keep their own code because it is the actionable one.
  for (const key of Object.keys(obj)) {
    if (key === 'agents') continue;
    if ((LOCKED_KEYS as readonly string[]).includes(key)) {
      return {
        ok: false,
        code: 'PARAM_LOCKED',
        message: `"${key}" is a locked parameter and cannot be overridden`,
        detail: { param: key, tunable: [...TUNABLE_KEYS] },
      };
    }
    return {
      ok: false,
      code: 'PARAM_UNKNOWN',
      message: (TUNABLE_KEYS as readonly string[]).includes(key)
        ? `"${key}" is a per-agent override in v24 — spell it as overrides.agents.<label>.${key}`
        : `"${key}" is not a recognized override; overrides has exactly one key: agents`,
      detail: { param: key, tunable: [...TUNABLE_KEYS] },
    };
  }
  const agentsIn = obj.agents ?? {};
  const known = Object.keys(c.agents);
  const resultAgents: Record<string, Record<string, unknown>> = {};

  for (const [label, overridesForLabel] of Object.entries(agentsIn)) {
    const spec = c.agents[label];
    if (!spec) {
      return {
        ok: false,
        code: 'UNKNOWN_AGENT_LABEL',
        message: `"${label}" is not a declared agent label`,
        detail: { label, known },
      };
    }
    const eff = effectiveAgentBounds(spec, ceilings);
    const result = validateOneAgentOverride(label, eff, overridesForLabel ?? {}, aliasNames);
    if (!result.ok) return result;
    resultAgents[label] = result.value;
  }

  return { ok: true, value: { agents: resultAgents } };
}

/** Declared `args` are checked only for fields the contract declares; undeclared keys pass
 *  through unchanged (backward compat). Unchanged in v24 — `args` still lives flat on
 *  `ParamContract`, untouched by the agents/knobs split. */
export function validateDeclaredArgs(c: ParamContract, args: unknown): { ok: true } | Err {
  const obj = (args ?? {}) as Record<string, unknown>;
  for (const [key, spec] of Object.entries(c.args)) {
    if (!(key in obj)) continue;
    const result = checkValueAgainstSpec(`args.${key}`, obj[key], spec);
    if (!result.ok) return result;
  }
  return { ok: true };
}
