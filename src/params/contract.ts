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
// Pure: no I/O, no clock, no VM, no randomness. `catalog` (a `ModelCatalogSnapshot`) is DATA, not a
// live fetch — the caller (an async function, e.g. `WorkflowCatalog.validateRegistration`) resolves
// the live/last-good/static snapshot itself and hands the resolved value in.
import type { ErrorCode } from '../errors.js';
import { checkModelRef, EMPTY_MODEL_CATALOG as EMPTY_CATALOG, type ModelCatalogSnapshot } from '../providers.js';
export type { ModelCatalogSnapshot } from '../providers.js';

// v25 (issue #55, adjudication #9 I-1.2): the second member was spelled `tools` while the pipeline
// that curates an agent's tool surface reads `allowedTools` at every rung (per-call opts >
// `defaultAllowedTools`; v25 also had a per-definition frontmatter rung in between, retired at
// v34). `allowedTools` is the name that MOVED here, because it is the one that already works: it
// is what `AgentOpts` now declares, what `agent-executor.ts` resolves and what
// `claude-agent-sdk-client.ts` puts on the session. Renaming the pipeline instead would have had to
// move that frontmatter key (since deleted) and the whole precedence chain to satisfy a list that
// reaches nothing. This list is PUBLIC — it renders into
// `workflow_authoring_guide`, `run_start.overrides`'s schema description and
// `workflow_describe.lockedKeys` — so the name in it must be the name an author would write.
// Issue #78(c): `bash` (the agent() option `bash:'readonly'`) is author-locked like `allowedTools` —
// a run_start override must never turn a read-only shell back into a writable one.
export const LOCKED_KEYS = ['prompt', 'allowedTools', 'bash', 'skills', 'mcp', 'workdir', 'cwd'] as const;
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
 *  (that is what made the old 5-rung ladder's per-definition and call-level rungs
 *  unreachable/deleted, TASK-137). `skills`/`mcp` are author-declared name arrays whose EXISTENCE is not checked here
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

/** v40 (DES-271, ARCH-188/189, TASK-268): one script `decide()`/`generateImage()` label's declared
 *  contract — `model`/`timeoutMs`/`retries` all REQUIRED with a `.default`, same "no implicit
 *  engine default" posture as `AgentParamSpec`. No `effort` (decide/generateImage never take one). */
export interface PrimitiveParamSpec {
  model: ParamSpec;
  timeoutMs: ParamSpec;
  retries: ParamSpec;
}

/** v40 (DES-271): the engine-owned ceiling on `retries.default` for a `decisions`/`images` label —
 *  a CODE constant (unlike `DEFAULT_CEILINGS`), never a `Ceilings` field, so it carries no config
 *  wiring obligation. */
export const MAX_PRIMITIVE_RETRIES = 5;

export interface ParamContract {
  agents: Record<string, AgentParamSpec>;
  args: Record<string, ParamSpec>;
  /** v40 (DES-271): present iff `meta.params.decisions`/`.images` is itself declared (even as
   *  `{}`) — absent, never `{}`, when the author never wrote the key at all (keeps
   *  `parseParamContract`'s zero-primitive result byte-identical to its pre-v40 shape). */
  decisions?: Record<string, PrimitiveParamSpec>;
  images?: Record<string, PrimitiveParamSpec>;
}

// closed: a locked key is UNREPRESENTABLE inside an agent override block (ADR-001)
// v40 Gate 6 delta (DES-277, ARCH-188/189, R-13, TASK-274): widened to `{agents, decisions, images}`
// — a run-time `decisions.<label>`/`images.<label>` override of `model`/`timeoutMs`/`retries`.
export interface UserOverrides {
  agents?: Record<string, Partial<{ model: string; effort: Effort; timeoutMs: number; appendPrompt: string }>>;
  decisions?: Record<string, Partial<{ model: string; timeoutMs: number; retries: number }>>;
  images?: Record<string, Partial<{ model: string; timeoutMs: number; retries: number }>>;
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
    | 'UNKNOWN_MODEL'
    | 'PROVIDER_UNSUPPORTED_BY_HARNESS'
    | 'AGENT_UNDECLARED'
    | 'AGENT_DECLARED_NOT_IN_SCRIPT'
    | 'DEFAULTS_RETIRED'
    | 'UNKNOWN_AGENT_LABEL'
    | 'LEGACY_REREGISTER'
    // v40 (DES-271, ARCH-188/189, TASK-268): decisions/images declared<=>used + provider gate.
    | 'DECISION_UNDECLARED'
    | 'DECISION_DECLARED_NOT_IN_SCRIPT'
    | 'IMAGE_UNDECLARED'
    | 'IMAGE_DECLARED_NOT_IN_SCRIPT'
    | 'PRIMITIVE_PROVIDER_UNSUPPORTED'
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

/** 2026-09-26 (alias mechanism removed, owner decisions 1/6): one non-fatal model-ref warning —
 *  produced when `checkModelRef` accepts a ref it could not fully verify (an unknown-but-plausible
 *  anthropic id, or an openrouter/ollama id the live catalog listing was unavailable to check).
 *  `label` is the agent label the ref was declared/overridden on (or the literal `'<enum>'` marker
 *  for a `model.enum` entry, which has no single label of its own). */
export interface ModelRefWarning {
  // v40 Gate 6 delta (DES-271, R-11, TASK-268): `'MODEL_TYPE_UNVERIFIED'` — `checkPrimitiveModelType`
  // (providers.ts) could not confirm a label's declared model is the right primitive type (unknown
  // type, or an id-heuristic guess) — a warning, never a refusal (that is `MODEL_TYPE_MISMATCH`, a
  // thrown `codedError`, not a `ModelRefWarning`).
  code: 'MODEL_CATALOG_UNVERIFIED' | 'MODEL_TYPE_UNVERIFIED';
  label: string;
  model: string;
  message: string;
}

/** The one UNKNOWN_MODEL-shaped `Err` both the registration-time (`validateOneAgentSpec`) and
 *  admission-time (`validateOneAgentOverride`) doors throw from — never re-typed at either call
 *  site. `warn`, when supplied, collects `checkModelRef`'s warning instead of throwing (the ref is
 *  syntactically/existentially fine, just unverified) — the caller decides whether the label is
 *  `'<enum>'` or a declared agent label. */
function checkModelRefOrErr(
  param: string,
  label: string,
  ref: string,
  catalog: ModelCatalogSnapshot,
  warn: (w: ModelRefWarning) => void,
): Err | null {
  const verdict = checkModelRef(ref, catalog);
  if (!verdict.ok) return invalid(param, verdict.message, verdict.code ?? 'UNKNOWN_MODEL');
  if (verdict.warning) warn({ code: 'MODEL_CATALOG_UNVERIFIED', label, model: ref, message: verdict.warning });
  return null;
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

function invalid(param: string, reason: string, code: Err['code'] = 'PARAM_CONTRACT_INVALID'): Err {
  return { ok: false, code, message: reason, detail: { param, reason } };
}

export function retiredDefaults(param: string): Err {
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
function validateSpecShape(param: string, spec: ParamSpec, effortLenient = false): Err | null {
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
  // issue #161 B3: a type:'enum' spec with no `enum` at all registers a knob that is misleadingly
  // UNRESTRICTED (checkValueAgainstSpec's membership check only fires `enum !== undefined`, so
  // `{type:'enum'}` alone accepts any string); `enum:[]` is the opposite and worse failure — it
  // registers a knob that admits NO value at all (`[].includes(x)` is always false). Reject both at
  // registration, same precedent as the min/max-on-enum rejection above.
  // EXCEPTION — the agent's own `effort` key (`effortLenient`): omitting `enum` there has an
  // existing, documented meaning — `boundEffort` (above) defaults a missing/non-array `enum` to
  // `ALL_EFFORTS`, clamped by the `maxEffort` ceiling — so `{type:'enum', default:'low'}` with no
  // `enum` is "every effort the ceiling allows", not an unrestricted/unusable knob. An EXPLICIT
  // `enum:[]` on effort is still rejected: `Array.isArray([])` is true, so `boundEffort` does NOT
  // fall back for it — a declared empty array disables every override regardless of the key.
  if (spec.type === 'enum' && spec.enum === undefined && !effortLenient) {
    return invalid(param, "a type:'enum' spec requires a non-empty enum array");
  }
  if (spec.type === 'enum' && Array.isArray(spec.enum) && spec.enum.length === 0) {
    return invalid(param, "a type:'enum' spec requires a non-empty enum array");
  }
  // issue #161 B4: min > max registers a knob that rejects every value — neither bound is wrong
  // individually (both are numbers), only their relationship is.
  if (spec.min !== undefined && spec.max !== undefined && spec.min > spec.max) {
    return invalid(param, 'min must be <= max');
  }
  // issue #161 B5: an unknown field (a typo like `maxLength`/`required`, or the engine-internal
  // `ceilingKey` — never author-set per its own doc comment on ParamSpec) silently registers as a
  // no-op today. `unit`/`description` are legitimate author-facing documentation fields: an `args`
  // entry's ParamSpec is surfaced VERBATIM on `workflow_describe` (workflow-view.ts), so both are
  // read by a caller even though neither is enforced here.
  const KNOWN_SPEC_FIELDS = ['type', 'default', 'enum', 'min', 'max', 'unit', 'description'];
  for (const k of Object.keys(spec)) {
    if (!KNOWN_SPEC_FIELDS.includes(k)) {
      return invalid(param, `unknown field "${k}"`);
    }
  }
  return null;
}

/** model/effort/timeoutMs share one shape: declared, spec-valid, and carrying a `.default` — v24's
 *  "all three REQUIRED with .default" (DES-144). Extra semantic checks (alias / effort-rank /
 *  ceiling) are layered on top per key by the caller. */
function validateRequiredKeySpec(param: string, spec: unknown, effortLenient = false): Err | null {
  if (typeof spec !== 'object' || spec === null || Array.isArray(spec)) {
    return invalid(param, 'must be an object');
  }
  const shapeErr = validateSpecShape(param, spec as ParamSpec, effortLenient);
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

function validateOneAgentSpec(
  label: string,
  raw: unknown,
  catalog: ModelCatalogSnapshot,
  warn: (w: ModelRefWarning) => void,
): Err | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return invalid(`agents.${label}`, 'must be an object');
  }
  const spec = raw as Partial<AgentParamSpec>;

  const modelErr = validateRequiredKeySpec(`agents.${label}.model`, spec.model);
  if (modelErr) return modelErr;
  const model = spec.model as ParamSpec;
  // Owner decision 2: `.default` stays REQUIRED (validateRequiredKeySpec above) and must now be a
  // full <provider>/<model-id> ref — no bare name, no 'default', no alias table.
  if (typeof model.default === 'string') {
    const err = checkModelRefOrErr(`agents.${label}.model`, label, model.default, catalog, warn);
    if (err) return err;
  }
  if (model.enum !== undefined) {
    for (const entry of model.enum) {
      if (typeof entry !== 'string') continue; // validateSpecShape above already refused a non-string enum member
      const err = checkModelRefOrErr(`agents.${label}.model`, `${label}.enum`, entry, catalog, warn);
      if (err) return err;
    }
  }
  // Issue #154 B3: every semantic check above validates `model.default` against the ENGINE's own
  // concerns (catalog existence, format) — none of them check it against THIS SAME SPEC's own
  // declared `enum`. A `default` outside the author's own `enum` registered fine, then the
  // IDENTICAL value as a run-time override was refused `PARAM_OUT_OF_RANGE` — a self-contradictory
  // contract. `checkValueAgainstSpec` is the SAME validator `args.*` defaults already go through
  // (line ~472) for exactly this purpose; reused here, not re-typed.
  if (typeof model.default === 'string') {
    const ownBoundsErr = checkValueAgainstSpec(`agents.${label}.model.default`, model.default, model);
    if (!ownBoundsErr.ok) return invalid(`agents.${label}.model`, ownBoundsErr.message);
  }

  const effortErr = validateRequiredKeySpec(`agents.${label}.effort`, spec.effort, /* effortLenient */ true);
  if (effortErr) return effortErr;
  const effort = spec.effort as ParamSpec;
  if (!isEffort(effort.default)) {
    return invalid(`agents.${label}.effort`, `default must be one of ${ALL_EFFORTS.join(', ')}`);
  }
  if (EFFORT_RANK[effort.default] > EFFORT_RANK[DEFAULT_CEILINGS.maxEffort]) {
    return invalid(`agents.${label}.effort`, `default exceeds the engine ceiling ${DEFAULT_CEILINGS.maxEffort}`);
  }
  // Issue #154 B3: same asymmetry as model above — `isEffort`/the ceiling check never consult THIS
  // SPEC's own `effort.enum` (e.g. an author narrowing the choices to `['medium','high']`).
  {
    const ownBoundsErr = checkValueAgainstSpec(`agents.${label}.effort.default`, effort.default, effort);
    if (!ownBoundsErr.ok) return invalid(`agents.${label}.effort`, ownBoundsErr.message);
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
  // Issue #154 B3: same asymmetry again — only the ENGINE ceiling was ever checked; an author's own
  // declared `min`/`max` on this same spec (e.g. `min: 70000`) never gated `.default` at
  // registration, only a later override attempt (`PARAM_OUT_OF_RANGE`).
  {
    const ownBoundsErr = checkValueAgainstSpec(`agents.${label}.timeoutMs.default`, timeoutMs.default, timeoutMs);
    if (!ownBoundsErr.ok) return invalid(`agents.${label}.timeoutMs`, ownBoundsErr.message);
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
  // Issue #78(c): the Bash mode is declared on the agent() call beside the allowedTools it narrows
  // (where registration checks the pair). This block reads no `bash` key, so accepting one here
  // would be a read-only declaration that reaches nothing.
  if (Object.hasOwn(spec, 'bash')) {
    return invalid(`agents.${label}.bash`, "declare bash: 'readonly' in the agent() options beside allowedTools, not in meta.params");
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

/** v40 (DES-271, TASK-268): one `decisions.<label>`/`images.<label>` spec — `model`/`timeoutMs`/
 *  `retries` all required with a `.default`. `kind` picks the PRIMITIVE_PROVIDER_UNSUPPORTED,
 *  DECISION_(UNDECLARED|DECLARED_NOT_IN_SCRIPT) vs IMAGE_(UNDECLARED|DECLARED_NOT_IN_SCRIPT)
 *  vocabulary and whether the label belongs in `decisions` or `images`. The
 *  `startsWith('openrouter/')` provider gate runs BEFORE `checkModelRefOrErr` — decide()/
 *  generateImage() only ever dispatch through the openrouter gateway (TASK-263), so a non-openrouter
 *  ref is refused by NAME, never by whatever `checkModelRef` would say about it against an
 *  unrelated provider's rules. */
function validateOnePrimitiveSpec(
  kind: 'decisions' | 'images',
  label: string,
  raw: unknown,
  catalog: ModelCatalogSnapshot,
  warn: (w: ModelRefWarning) => void,
): Err | null {
  const param = `${kind}.${label}`;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return invalid(param, 'must be an object');
  }
  const spec = raw as Partial<PrimitiveParamSpec>;

  const modelErr = validateRequiredKeySpec(`${param}.model`, spec.model);
  if (modelErr) return modelErr;
  const model = spec.model as ParamSpec;
  if (typeof model.default === 'string' && !model.default.startsWith('openrouter/')) {
    return invalid(
      `${param}.model`,
      `default must be an "openrouter/<model-id>" ref — decide()/generateImage() only dispatch through the openrouter gateway`,
      'PRIMITIVE_PROVIDER_UNSUPPORTED',
    );
  }
  if (typeof model.default === 'string') {
    const err = checkModelRefOrErr(`${param}.model`, label, model.default, catalog, warn);
    if (err) return err;
  }

  const timeoutErr = validateRequiredKeySpec(`${param}.timeoutMs`, spec.timeoutMs);
  if (timeoutErr) return timeoutErr;
  const timeoutMs = spec.timeoutMs as ParamSpec;
  if (typeof timeoutMs.default !== 'number' || !Number.isInteger(timeoutMs.default) || timeoutMs.default < 1) {
    return invalid(`${param}.timeoutMs`, 'default must be an integer >= 1');
  }
  if (timeoutMs.default > DEFAULT_CEILINGS.maxTimeoutMs) {
    return invalid(`${param}.timeoutMs`, `default exceeds the engine ceiling ${DEFAULT_CEILINGS.maxTimeoutMs}`);
  }

  const retriesErr = validateRequiredKeySpec(`${param}.retries`, spec.retries);
  if (retriesErr) return retriesErr;
  const retries = spec.retries as ParamSpec;
  if (typeof retries.default !== 'number' || !Number.isInteger(retries.default) || retries.default < 0) {
    return invalid(`${param}.retries`, 'default must be an integer >= 0');
  }
  if (retries.default > MAX_PRIMITIVE_RETRIES) {
    return invalid(`${param}.retries`, `default exceeds maxRetries ${MAX_PRIMITIVE_RETRIES}`);
  }

  return null;
}

/** Registration-time parse of `meta.params` (DES-144). v24: EVERY script agent() label needs a
 *  matching `agents.<label>` declaration (model/effort/timeoutMs all required, each with a
 *  `.default`) — there is no more "no params block means the 4 engine-global knobs" fallback. A
 *  zero-label (`workflow()`-only) script still parses to `{agents:{}, args:{}}`. Post-eval
 *  structural bounds only — the pre-eval source-size bound lives in workflow-meta.ts, because this
 *  only ever sees a value that already survived evaluation.
 *
 *  v40 (DES-271, ARCH-188/189, TASK-268): `primitiveLabels` is a 4th, OPTIONAL parameter — defaults
 *  to `{decide:[], generateImage:[]}` so every EXISTING 3-arg (agent-only) call site is untouched —
 *  the script's own `decide()`/`generateImage()` call labels (`scanPrimitiveCalls`,
 *  workflow-meta.ts), checked declared<=>used against `meta.params.decisions`/`.images` the same
 *  way `agents` is checked against `scriptLabels` above. */
export function parseParamContract(
  metaParams: unknown,
  scriptLabels: string[],
  catalog: ModelCatalogSnapshot = EMPTY_CATALOG,
  primitiveLabels: { decide: string[]; generateImage: string[] } = { decide: [], generateImage: [] },
): { ok: true; value: ParamContract; warnings?: ModelRefWarning[] } | Err {
  if (metaParams === undefined) {
    if (scriptLabels.length === 0 && primitiveLabels.decide.length === 0 && primitiveLabels.generateImage.length === 0) {
      return { ok: true, value: { agents: {}, args: {} } };
    }
    if (scriptLabels.length > 0) {
      return {
        ok: false,
        code: 'AGENT_UNDECLARED',
        message: `agent label "${scriptLabels[0]}" has no params.agents.${scriptLabels[0]} declaration`,
        detail: { label: scriptLabels[0] },
      };
    }
    if (primitiveLabels.decide.length > 0) {
      return { ok: false, code: 'DECISION_UNDECLARED', message: `decide label "${primitiveLabels.decide[0]}" has no params.decisions.${primitiveLabels.decide[0]} declaration`, detail: { label: primitiveLabels.decide[0] } };
    }
    return { ok: false, code: 'IMAGE_UNDECLARED', message: `generateImage label "${primitiveLabels.generateImage[0]}" has no params.images.${primitiveLabels.generateImage[0]} declaration`, detail: { label: primitiveLabels.generateImage[0] } };
  }
  if (typeof metaParams !== 'object' || metaParams === null || Array.isArray(metaParams)) {
    return invalid('root', 'meta.params must be an object');
  }

  const raw = metaParams as { agents?: unknown; args?: unknown; knobs?: unknown; defaults?: unknown; decisions?: unknown; images?: unknown };
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
  const warnings: ModelRefWarning[] = [];
  for (const [label, spec] of Object.entries(agentsIn)) {
    const specErr = validateOneAgentSpec(label, spec, catalog, (w) => warnings.push(w));
    if (specErr) return specErr;
    agents[label] = spec as AgentParamSpec;
  }

  const args: Record<string, ParamSpec> = {};
  for (const [key, spec] of Object.entries(argsIn)) {
    const shapeErr = validateSpecShape(`args.${key}`, spec);
    if (shapeErr) return shapeErr;
    // v35 (DES-235, TASK-231, REQ-206): the v21 P6-3 ban (below, deleted) is REVERSED FOR CAUSE —
    // `materializeArgDefaults` (below) now genuinely applies a declared default, so the premise
    // that a default was "advertised but never enforced" no longer holds. A declared default is
    // validated the same way any other value is, via the EXISTING checkValueAgainstSpec path.
    if (spec.default !== undefined) {
      const defaultErr = checkValueAgainstSpec(`args.${key}.default`, spec.default, spec);
      if (!defaultErr.ok) return invalid(`args.${key}`, defaultErr.message);
    }
    if (spec.enum !== undefined && spec.enum.length > MAX_ENUM_MEMBERS) {
      return invalid(`args.${key}`, `enum has more than ${MAX_ENUM_MEMBERS} members`);
    }
    args[key] = spec;
  }

  // v40 (DES-271, ARCH-188/189, TASK-268): decisions/images — same declared<=>used shape as
  // agents/scriptLabels above, each against its OWN primitiveLabels array and its OWN pair of
  // error codes.
  if (raw.decisions !== undefined && (typeof raw.decisions !== 'object' || raw.decisions === null || Array.isArray(raw.decisions))) {
    return invalid('decisions', 'params.decisions must be an object');
  }
  if (raw.images !== undefined && (typeof raw.images !== 'object' || raw.images === null || Array.isArray(raw.images))) {
    return invalid('images', 'params.images must be an object');
  }
  const decisionsIn = (raw.decisions ?? {}) as Record<string, unknown>;
  const imagesIn = (raw.images ?? {}) as Record<string, unknown>;

  const decideSet = new Set(primitiveLabels.decide);
  for (const label of primitiveLabels.decide) {
    if (!Object.hasOwn(decisionsIn, label)) {
      return { ok: false, code: 'DECISION_UNDECLARED', message: `decide label "${label}" has no params.decisions.${label} declaration`, detail: { label } };
    }
  }
  for (const label of Object.keys(decisionsIn)) {
    if (!decideSet.has(label)) {
      return { ok: false, code: 'DECISION_DECLARED_NOT_IN_SCRIPT', message: `params.decisions.${label} is declared but no decide() call in the script uses it`, detail: { label } };
    }
  }
  const imageSet = new Set(primitiveLabels.generateImage);
  for (const label of primitiveLabels.generateImage) {
    if (!Object.hasOwn(imagesIn, label)) {
      return { ok: false, code: 'IMAGE_UNDECLARED', message: `generateImage label "${label}" has no params.images.${label} declaration`, detail: { label } };
    }
  }
  for (const label of Object.keys(imagesIn)) {
    if (!imageSet.has(label)) {
      return { ok: false, code: 'IMAGE_DECLARED_NOT_IN_SCRIPT', message: `params.images.${label} is declared but no generateImage() call in the script uses it`, detail: { label } };
    }
  }

  const decisions: Record<string, PrimitiveParamSpec> = {};
  for (const [label, spec] of Object.entries(decisionsIn)) {
    const specErr = validateOnePrimitiveSpec('decisions', label, spec, catalog, (w) => warnings.push(w));
    if (specErr) return specErr;
    decisions[label] = spec as PrimitiveParamSpec;
  }
  const images: Record<string, PrimitiveParamSpec> = {};
  for (const [label, spec] of Object.entries(imagesIn)) {
    const specErr = validateOnePrimitiveSpec('images', label, spec, catalog, (w) => warnings.push(w));
    if (specErr) return specErr;
    images[label] = spec as PrimitiveParamSpec;
  }

  return {
    ok: true,
    value: {
      agents,
      args,
      ...(raw.decisions !== undefined ? { decisions } : {}),
      ...(raw.images !== undefined ? { images } : {}),
    },
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

/** v35 (DES-235, ARCH-145, TASK-231, REQ-206): fills declared-but-absent `args` keys from their
 *  `.default`; a caller-supplied value (including an explicit `undefined`) always wins. Pure — no
 *  mutation of either input — so the admission site stays a caller and needs no engine to test. */
export function materializeArgDefaults(
  args: Record<string, unknown>,
  specs?: Record<string, ParamSpec>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...args };
  if (specs) {
    for (const [key, spec] of Object.entries(specs)) {
      if (spec.default === undefined) continue;
      // issue #161 B2: `result[key] === undefined` cannot tell "the caller wrote `key: undefined`
      // explicitly" from "the caller never mentioned `key` at all" — both read identically. Only
      // `Object.hasOwn` distinguishes them; an explicit own key (even one valued `undefined`) must
      // win over the default, per the guide's documented contract ("an explicit caller-supplied
      // value always wins, including an explicit `undefined`").
      if (!Object.hasOwn(result, key)) result[key] = spec.default;
    }
  }
  return result;
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
  // issue #156/#161 DOC: for a type:'string' spec, `min`/`max` bound the UTF-8 BYTE length (see
  // `bound` above) — the message must say so, or a caller sees e.g. "exceeds the maximum of 5" for
  // '中文' (6 bytes, 2 characters) with no indication the 5 is a byte count, not a character count.
  const unitSuffix = spec.type === 'string' ? ' bytes' : '';
  if (spec.min !== undefined && bound < spec.min) {
    return {
      ok: false,
      code: 'PARAM_OUT_OF_RANGE',
      message: `${param} is below the minimum of ${spec.min}${unitSuffix}`,
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
        : `${param} exceeds the maximum of ${spec.max}${unitSuffix}`,
      detail: { param, ...truncatedSupplied(value), allowed: { min: spec.min, max: spec.max }, ...(spec.ceilingKey !== undefined ? { ceiling: spec.ceilingKey } : {}) },
    };
  }
  return { ok: true };
}

/** The rejection table over ONE agent's overrides — reused per label by `validateUserOverrides`.
 *  `spec` is already the EFFECTIVE (author ∩ ceiling) bound for this agent (via
 *  `effectiveAgentBounds`). */
/** issue #156/#161 DOC: a non-object value (a string, array, or null) passed where this module
 *  expects a plain `{key: value}` map — guarded BEFORE any `Object.entries`/`Object.keys` call over
 *  it, because JS iterates a string character-by-character and an array by numeric index, producing
 *  a confusing `"0"`-keyed refusal instead of a shape error. */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function validateOneAgentOverride(
  label: string,
  eff: AgentParamSpec,
  raw: unknown,
  catalog: ModelCatalogSnapshot,
  warn: (w: ModelRefWarning) => void,
): { ok: true; value: Record<string, unknown> } | Err {
  if (!isPlainObject(raw)) {
    return invalid(
      `agents.${label}`,
      `agent override must be an object mapping tunable key to value, not ${raw === null ? 'null' : Array.isArray(raw) ? 'an array' : typeof raw}`,
    );
  }
  // issue #156 DOC: a locked/unknown-key refusal's `detail.tunable` must list only the keys THIS
  // agent actually declared — advertising e.g. `appendPrompt` to an agent that never declared it
  // tells the caller a knob exists that `PARAM_UNKNOWN` will immediately refuse.
  const declaredTunable = (TUNABLE_KEYS as readonly string[]).filter(
    (k) => (eff as unknown as Record<string, unknown>)[k] !== undefined,
  );
  const value: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(raw)) {
    if ((LOCKED_KEYS as readonly string[]).includes(key)) {
      return {
        ok: false,
        code: 'PARAM_LOCKED',
        message: `"${key}" is a locked parameter and cannot be overridden`,
        detail: { param: key, agent: label, tunable: declaredTunable },
      };
    }
    if (!(TUNABLE_KEYS as readonly string[]).includes(key)) {
      return {
        ok: false,
        code: 'PARAM_UNKNOWN',
        message: `"${key}" is not a recognized override`,
        detail: { param: key, agent: label, tunable: declaredTunable },
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

    // issue #156 B1: timeoutMs needs a hard engine-side floor (integer >= 1) independent of the
    // author's own min — unlike REGISTRATION (validateOneAgentSpec above, "default must be an
    // integer >= 1"), this OVERRIDE door only ever enforced an author-declared min/max, so an agent
    // whose author left timeoutMs unbounded admitted 0 / -1 / 1.5 into the stored "effective"
    // snapshot. Checked before the generic spec check (which has no opinion on integrality) and
    // only when `val` is actually a number (a wrong-type value like "fast" still gets the generic
    // PARAM_OUT_OF_RANGE "wrong type" message below, unchanged).
    if (key === 'timeoutMs' && typeof val === 'number' && (!Number.isInteger(val) || val < 1)) {
      return {
        ok: false,
        code: 'PARAM_OUT_OF_RANGE',
        message: 'timeoutMs must be an integer >= 1',
        detail: { param: 'timeoutMs', agent: label, supplied: val },
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
          // DES-223: mirrors the generic branch above — the ceiling-vs-author-range direction
          // must be readable from the message itself, not just `detail.ceiling`.
          message: spec.ceilingKey !== undefined
            ? `appendPrompt exceeds the engine ceiling ${spec.ceilingKey} ${spec.max}`
            : `appendPrompt exceeds the maximum of ${spec.max}`,
          detail: { param: 'appendPrompt', agent: label, suppliedBytes: bytes, maxBytes: spec.max, ...(spec.ceilingKey !== undefined ? { ceiling: spec.ceilingKey } : {}) },
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

    // Owner decisions 1/2: a run_start override's `model` must also be a full <provider>/<model-id>
    // ref — applied for the case the author left `model` unconstrained (no enum); a spec with its
    // own `enum` already screened its members at REGISTRATION time (validateOneAgentSpec above).
    // UNKNOWN_MODEL (not PARAM_OUT_OF_RANGE) — an unresolvable ref is a different rejection from
    // "outside the author's declared bounds".
    if (key === 'model' && typeof val === 'string' && spec.enum === undefined) {
      const verdict = checkModelRef(val, catalog);
      if (!verdict.ok) {
        return {
          ok: false,
          code: verdict.code ?? 'UNKNOWN_MODEL',
          message: verdict.message,
          detail: { param: 'model', agent: label, ...truncatedSupplied(val) },
        };
      }
      if (verdict.warning) warn({ code: 'MODEL_CATALOG_UNVERIFIED', label, model: val, message: verdict.warning });
    }

    value[key] = val;
  }
  return { ok: true, value };
}

/** v40 Gate 6 delta (DES-277, ARCH-188/189, R-13, TASK-274): the per-label rejection table for ONE
 *  `decisions.<label>`/`images.<label>` run override — closed to `{model, timeoutMs, retries}`
 *  (anything else is `PARAM_UNKNOWN{param:'<block>.<label>.<key>'}`). `retries` is bounded
 *  `0..MAX_PRIMITIVE_RETRIES`, `timeoutMs` `1..ceilings.maxTimeoutMs`, both `PARAM_OUT_OF_RANGE`
 *  naming the bound that fired; `model` must be an `openrouter/` ref (else
 *  `PRIMITIVE_PROVIDER_UNSUPPORTED` — decide()/generateImage() only ever dispatch through the
 *  openrouter gateway, same gate `validateOnePrimitiveSpec` applies at registration), then the SAME
 *  existence/warning path (`checkModelRefOrErr`) an `agents` override already goes through. No
 *  model-type gate here — ADMISSION never re-checks `modelType` (V40-Q6, DES-276). */
function validatePrimitiveOverride(
  block: 'decisions' | 'images',
  label: string,
  raw: unknown,
  ceilings: Ceilings,
  catalog: ModelCatalogSnapshot,
  warn: (w: ModelRefWarning) => void,
): { ok: true; value: Partial<{ model: string; timeoutMs: number; retries: number }> } | Err {
  if (!isPlainObject(raw)) {
    return invalid(
      `${block}.${label}`,
      `override must be an object mapping tunable key to value, not ${raw === null ? 'null' : Array.isArray(raw) ? 'an array' : typeof raw}`,
    );
  }
  const value: Partial<{ model: string; timeoutMs: number; retries: number }> = {};
  for (const [key, val] of Object.entries(raw)) {
    if (key !== 'model' && key !== 'timeoutMs' && key !== 'retries') {
      return {
        ok: false,
        code: 'PARAM_UNKNOWN',
        message: `"${key}" is not a recognized override for ${block}.${label}`,
        detail: { param: `${block}.${label}.${key}` },
      };
    }
    if (key === 'retries') {
      if (typeof val !== 'number' || !Number.isInteger(val) || val < 0 || val > MAX_PRIMITIVE_RETRIES) {
        return {
          ok: false,
          code: 'PARAM_OUT_OF_RANGE',
          message: `${block}.${label}.retries must be an integer between 0 and maxRetries ${MAX_PRIMITIVE_RETRIES}`,
          detail: { param: `${block}.${label}.retries`, ...truncatedSupplied(val) },
        };
      }
      value.retries = val;
      continue;
    }
    if (key === 'timeoutMs') {
      if (typeof val !== 'number' || !Number.isInteger(val) || val < 1 || val > ceilings.maxTimeoutMs) {
        return {
          ok: false,
          code: 'PARAM_OUT_OF_RANGE',
          message: `${block}.${label}.timeoutMs must be an integer between 1 and the engine ceiling maxTimeoutMs ${ceilings.maxTimeoutMs}`,
          detail: { param: `${block}.${label}.timeoutMs`, ...truncatedSupplied(val) },
        };
      }
      value.timeoutMs = val;
      continue;
    }
    // key === 'model'
    if (typeof val !== 'string') {
      return {
        ok: false,
        code: 'PARAM_OUT_OF_RANGE',
        message: `${block}.${label}.model has the wrong type`,
        detail: { param: `${block}.${label}.model`, suppliedType: typeof val, expectedType: 'string' },
      };
    }
    if (!val.startsWith('openrouter/')) {
      return {
        ok: false,
        code: 'PRIMITIVE_PROVIDER_UNSUPPORTED',
        message: `"${block}.${label}.model" must be an "openrouter/<model-id>" ref — decide()/generateImage() only dispatch through the openrouter gateway`,
        detail: { param: `${block}.${label}.model`, ...truncatedSupplied(val) },
      };
    }
    const err = checkModelRefOrErr(`${block}.${label}.model`, label, val, catalog, warn);
    if (err) return err;
    value.model = val;
  }
  return { ok: true, value };
}

/** v24 (DES-145): the per-agent rejection table. `raw.agents.<label>` is validated against
 *  `contract.agents[label]`'s EFFECTIVE (author ∩ ceiling) bound; an unknown label is
 *  `UNKNOWN_AGENT_LABEL{label, known}`.
 *  v40 Gate 6 delta (DES-277, R-13, TASK-274): the top level widens to `{agents, decisions,
 *  images}` — `raw.decisions.<label>`/`raw.images.<label>` are validated against
 *  `c.decisions[label]`/`c.images[label]` the same way, via `validatePrimitiveOverride` above; an
 *  unknown label takes the SAME `UNKNOWN_AGENT_LABEL` code, with `detail.block` naming which one. */
export function validateUserOverrides(
  c: ParamContract,
  raw: unknown,
  catalog: ModelCatalogSnapshot = EMPTY_CATALOG,
  ceilings: Ceilings = DEFAULT_CEILINGS,
): { ok: true; value: UserOverrides; warnings?: ModelRefWarning[] } | Err {
  const obj = (raw ?? {}) as {
    agents?: Record<string, Record<string, unknown>>;
    decisions?: Record<string, Record<string, unknown>>;
    images?: Record<string, Record<string, unknown>>;
  };
  // v24 (integrator; DES-145/ADR-001): the TOP level of `overrides` is closed to `{agents}`. It
  // used to be unread — every key other than `agents` was silently dropped, so the whole v21 FLAT
  // shape (`overrides:{model,effort,timeoutMs,appendPrompt}`), which the plugin docs and every
  // pre-v24 caller still spell, was accepted and then did NOTHING: the run started with the
  // author's defaults and the caller was told it had been honoured. A locked key (`prompt`, …)
  // vanished the same way, turning ADR-001's type-level guarantee into a silent no-op at the wire,
  // where it matters. Locked keys keep their own code because it is the actionable one.
  // v40 Gate 6 delta (DES-277, TASK-274): closed set widened to `{agents, decisions, images}`.
  for (const key of Object.keys(obj)) {
    if (key === 'agents' || key === 'decisions' || key === 'images') continue;
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
        : `"${key}" is not a recognized override; overrides has exactly {agents, decisions, images}`,
      detail: { param: key, tunable: [...TUNABLE_KEYS] },
    };
  }
  // issue #156 NEW-1: `?? {}` treats an explicit `null` the same as an omitted (`undefined`) key —
  // only `undefined` means "the caller didn't say", so `null` must reach the isPlainObject guard
  // below and be refused the same way a string/array already is, not be laundered into `{}` first.
  const agentsIn = obj.agents === undefined ? {} : obj.agents;
  // issue #156 DOC: `overrides.agents` itself must be a plain object — a string or array used to be
  // iterated char/index-wise by the `Object.entries` loop below, producing a confusing numeric-
  // looking label (`"0"`) instead of a shape refusal.
  if (!isPlainObject(agentsIn)) {
    return invalid(
      'agents',
      `overrides.agents must be an object mapping agent label to its override fields, not ${agentsIn === null ? 'null' : Array.isArray(agentsIn) ? 'an array' : typeof agentsIn}`,
    );
  }
  const known = Object.keys(c.agents);
  const resultAgents: Record<string, Record<string, unknown>> = {};
  const warnings: ModelRefWarning[] = [];

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
    // issue #156 NEW-1: same `undefined`-only default as `agentsIn` above — an explicit
    // `{a: null}` must reach validateOneAgentOverride's own isPlainObject guard and be refused,
    // not be laundered into `{}` and silently accepted.
    const result = validateOneAgentOverride(label, eff, overridesForLabel === undefined ? {} : overridesForLabel, catalog, (w) => warnings.push(w));
    if (!result.ok) return result;
    resultAgents[label] = result.value;
  }

  // v40 Gate 6 delta (DES-277, R-13, TASK-274): same shape as `agents` above, once per block, each
  // against its OWN declared label set (`c.decisions`/`c.images`) and its OWN result slice.
  const resultByBlock: { decisions?: Record<string, Record<string, unknown>>; images?: Record<string, Record<string, unknown>> } = {};
  for (const block of ['decisions', 'images'] as const) {
    const blockIn = obj[block];
    if (blockIn === undefined) continue;
    if (!isPlainObject(blockIn)) {
      return invalid(
        block,
        `overrides.${block} must be an object mapping label to its override fields, not ${blockIn === null ? 'null' : Array.isArray(blockIn) ? 'an array' : typeof blockIn}`,
      );
    }
    const declared = (c[block] ?? {}) as Record<string, unknown>;
    const knownForBlock = Object.keys(declared);
    const resultForBlock: Record<string, Record<string, unknown>> = {};
    for (const [label, overridesForLabel] of Object.entries(blockIn)) {
      if (!Object.hasOwn(declared, label)) {
        return {
          ok: false,
          code: 'UNKNOWN_AGENT_LABEL',
          message: `"${label}" is not a declared ${block} label`,
          detail: { label, block, known: knownForBlock },
        };
      }
      const result = validatePrimitiveOverride(block, label, overridesForLabel === undefined ? {} : overridesForLabel, ceilings, catalog, (w) => warnings.push(w));
      if (!result.ok) return result;
      resultForBlock[label] = result.value;
    }
    resultByBlock[block] = resultForBlock;
  }

  return { ok: true, value: { agents: resultAgents, ...resultByBlock }, ...(warnings.length > 0 ? { warnings } : {}) };
}

/** Declared `args` fields are checked only against what the contract declares; undeclared keys
 *  pass through unchanged (backward compat), even on a contract with NO declared args at all.
 *  Independent of that per-key check, the top-level `args` value must always be a plain object
 *  (or absent/null) — an array/string/number is refused with `PARAM_OUT_OF_RANGE`, whether or not
 *  the contract declares any args keys (issue #161 B6). Unchanged in v24 — `args` still lives flat
 *  on `ParamContract`, untouched by the agents/knobs split. */
export function validateDeclaredArgs(c: ParamContract, args: unknown): { ok: true } | Err {
  // Review send-back LOW-1 (issue #107 follow-up): `key in obj` below throws a bare, uncoded
  // `TypeError` when `args` is a non-record primitive (string/number/boolean) — reachable from
  // BOTH `start()` and a nested `workflow()` call (this function is the one door both share) the
  // instant the contract declares at least one `args` key. Refused the same way any other wrong-
  // shaped args value is: `PARAM_OUT_OF_RANGE`, reported by type only (never the value — same
  // convention `checkValueAgainstSpec` already uses).
  //
  // issue #161 B6 (owner-approved): a contract declaring NO args at all used to skip this shape
  // check entirely (the `Object.keys(c.args).length > 0` guard this comment used to describe), so
  // run_start/nested workflow() args of any shape — an array, a bare string — passed straight
  // through to the script unchecked, unlike a contract that DOES declare args. The top-level shape
  // check now always runs; only the *per-key* loop below is skipped when there is nothing declared
  // to check a key against. Undeclared KEYS inside an otherwise-plain-object `args` still pass
  // through unchanged either way (#107/#161 B1 — kept). `undefined`/`null` still degrade to `{}`.
  if (args !== undefined && args !== null) {
    const isRecord = typeof args === 'object' && !Array.isArray(args);
    if (!isRecord) {
      return {
        ok: false,
        code: 'PARAM_OUT_OF_RANGE',
        message: 'args has the wrong type',
        detail: { param: 'args', suppliedType: Array.isArray(args) ? 'array' : typeof args, expectedType: 'object' },
      };
    }
  }
  const obj = (args ?? {}) as Record<string, unknown>;
  for (const [key, spec] of Object.entries(c.args)) {
    // issue #161 B2: an own key present with the literal value `undefined` is the caller's
    // explicit "no value" signal, not a value to type-check — `key in obj` alone cannot tell it
    // apart from a genuinely-supplied value, and `materializeArgDefaults` (the door this runs
    // after, both at run_start and a nested workflow() call) deliberately leaves such a key
    // AT `undefined` rather than filling its default (same issue, same "explicit wins" contract).
    // Checking it against `expectedType` here would turn the caller's explicit `undefined` into a
    // hard PARAM_OUT_OF_RANGE refusal instead of the no-op the guide promises.
    if (!(key in obj) || obj[key] === undefined) continue;
    const result = checkValueAgainstSpec(`args.${key}`, obj[key], spec);
    if (!result.ok) return result;
  }
  return { ok: true };
}
