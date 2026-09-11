// src/params/resolve.ts (DES-102, ARCH-065, TASK-098): pure two-moment merge of the tunable
// parameter contract — admission-time snapshot (RunParams) and dispatch-time per-call resolution
// (EffectiveCallParams) — plus five-segment prompt composition and provider effort mapping.
//
// Pure throughout: no I/O, no clock, no VM, no randomness. Provenance is emitted by the function
// that computes the value (one pass, {value, rung} per key) — never inferred afterwards by
// comparing values, which lies whenever two rungs happen to hold the same value.

import type { Effort, UserOverrides } from './contract.js';
import type { HarnessDefaults } from '../harness-defaults.js';
import { codedError } from '../errors.js';

/** v24 (DES-146, TASK-137/158): the slice of `contract.ts`'s `AgentParamSpec` that
 *  `resolveAgentParams` actually reads — just the `.default` on each tunable key. A deliberately
 *  narrower structural type rather than importing `AgentParamSpec` itself: this function is pure
 *  and cares only about defaults, never about the validation-only fields (`type`, `enum`,
 *  `min`/`max`, `unit`) that `AgentParamSpec`'s `ParamSpec` carries for registration-time checking.
 *  `default` is typed `unknown` here (matching `ParamSpec.default?: unknown` exactly, not narrowed
 *  to each key's own value type) so a real `ParamContract.agents` value is structurally assignable
 *  at the call site without a cast (TASK-158 — the first caller to pass one in) — this function
 *  narrows with an explicit `as` per key internally, same as it already did. */
export type AgentDefaultsSpec = {
  model: { default?: unknown };
  effort: { default?: unknown };
  timeoutMs: { default?: unknown };
  appendPrompt?: { default?: unknown };
};

// v24 (DES-146, TASK-137): the ladder is now three rungs — override(agents.<label>.<key>) ›
// contract agents.<label>.<key>.default › engine. The two per-call dispatch rungs this type used
// to carry are gone: `agent()` may no longer pass tunable values inline (ARCH-096, scanAgentCalls
// refuses PARAM_IN_SCRIPT), which retires the per-call rung outright; and once every agent()
// label's `model.default` is REQUIRED at registration (DES-144), the server-side agent-type
// registry's model field can never win a resolution — that rung is unreachable, not merely unused.
export type Rung = 'override' | 'default' | 'engine';

/** ADMISSION snapshot — run-immutable. */
export interface RunParams {
  model?: string;
  effort?: Effort;
  timeoutMs?: number;
  appendPrompt?: string;
  // author-only pair (REQ-092 close; UserOverrides cannot spell them). `skills` is NOT a
  // RunParams field (B-3): skills are server-side assets, every stored skill is materialized
  // into every run workspace regardless of workflow, and HarnessDescriptor.skills is derived
  // from the filesystem (readSkillNames(assetRoot)) — unrelated to this snapshot. REQ-092's
  // lock on `skills` is satisfied because a caller naming it in overrides gets PARAM_LOCKED
  // (contract.ts), not because this type carries it.
  prompt?: string;
  tools?: string[];
  provenance: Record<'model' | 'effort' | 'timeoutMs' | 'appendPrompt', 'override' | 'default' | 'engine'>;
  /** v24 (DES-146, TASK-158): the pinned run snapshot's per-agent-label slice — one
   *  `resolveAgentParams` result per declared `agents.<label>`, so a caller's `overrides.agents.
   *  <label>` reaches admission for THAT label only and never broadcasts to a sibling (REQ-110
   *  close). The top-level `model`/`effort`/`timeoutMs`/`appendPrompt` fields above are unaffected
   *  by per-agent overrides now (`UserOverrides` no longer HAS flat fields to fold in) — they still
   *  carry the registered workflow-level `defaults` (`prompt`/`tools`/legacy `HarnessDefaults`), and
   *  `agents` is absent when the caller supplied no `contract` (e.g. no registered agents). */
  agents?: Record<string, EffectiveCallParams>;
}

export interface EffectiveCallParams extends Omit<RunParams, 'provenance'> {
  provenance: Record<'model' | 'effort' | 'timeoutMs' | 'appendPrompt', Rung>;
}

/** The ONLY no-overrides producer: a run registered with no `overrides` at admission time.
 *  F-1 widen (orchestrator adjudication #6): `effort`/`appendPrompt` are two of REQ-090's four
 *  tunable knobs and are read here off the same author-side snapshot as `model`/`timeoutMs` —
 *  `HarnessDefaults` itself now declares both fields (`harness-defaults.ts`, KNOWN_KEYS + shape
 *  validation), so the local intersection type and cast this function used while that half was
 *  in flight are gone (adjudication #7 item 4). */
/** v24 (TASK-158, adjudication A-7 [14][18]): `contract`/`engineDefaults`, when supplied, populate
 *  the per-label `.agents` slice via `resolveAgentParams` (one call per declared label, `{}`
 *  overrides — the no-overrides case). Optional so callers with no registered agent contract (an
 *  ad-hoc/legacy script) still get a valid snapshot with `agents` absent. */
export function defaultRunParams(
  defaults: HarnessDefaults | undefined,
  contract?: Record<string, AgentDefaultsSpec>,
  engineDefaults: { model?: string } = {},
): RunParams {
  const rp: RunParams = {
    model: defaults?.model,
    effort: defaults?.effort,
    timeoutMs: defaults?.timeoutMs,
    appendPrompt: defaults?.appendPrompt,
    prompt: defaults?.prompt,
    tools: defaults?.tools,
    provenance: {
      model: defaults?.model !== undefined ? 'default' : 'engine',
      effort: defaults?.effort !== undefined ? 'default' : 'engine',
      timeoutMs: defaults?.timeoutMs !== undefined ? 'default' : 'engine',
      appendPrompt: defaults?.appendPrompt !== undefined ? 'default' : 'engine',
    },
  };
  if (contract) {
    rp.agents = {};
    for (const label of Object.keys(contract)) rp.agents[label] = resolveAgentParams(label, contract, {}, engineDefaults);
  }
  return rp;
}

/** Admission-time fold of `overrides` over the registered `defaults` (ADR-002): one pass per
 *  tunable key, override wins when supplied, else the registered-default snapshot stands.
 *  v24 (DES-146, TASK-158): `UserOverrides` no longer carries flat tunable fields — every override
 *  is scoped to `overrides.agents.<label>` (DES-145) — so the fold that used to write the
 *  top-level `model`/`effort`/`timeoutMs`/`appendPrompt` fields from a flat override is GONE (the
 *  whole REQ-110 defect it caused: one caller-supplied value broadcasting to every agent). Per-
 *  agent overrides are resolved into `.agents` instead, each label independently via
 *  `resolveAgentParams` — a label's override can never leak into a sibling label's slice. */
export function mergeRunParams(
  defaults: HarnessDefaults | undefined,
  overrides: UserOverrides,
  contract?: Record<string, AgentDefaultsSpec>,
  engineDefaults: { model?: string } = {},
): RunParams {
  const rp = defaultRunParams(defaults);
  if (contract) {
    rp.agents = {};
    for (const label of Object.keys(contract)) rp.agents[label] = resolveAgentParams(label, contract, overrides.agents?.[label] ?? {}, engineDefaults);
  }
  return rp;
}

/** v24 (DES-146, ARCH-095, TASK-137): dispatch-time resolution of ONE script agent() label's
 *  effective params — three rungs, override(agents.<label>.<key>) › contract default › engine.
 *  `contract` is the registration's `ParamContract.agents` slice (label → AgentParamSpec, each of
 *  model/effort/timeoutMs REQUIRED with a `.default`); `overrides` is that same label's slice of
 *  the run's `UserOverrides.agents` (or `{}` when the run carried none for this label).
 *  `'engine'` is reachable ONLY for `appendPrompt` — model/effort/timeoutMs always have a
 *  registered default, so `engineDefaults.model` is a defensive fallback, never exercised by a
 *  contract admission already validated. A label absent from `contract` at dispatch is a
 *  PROGRAMMING error (admission already validated every script label has a contract entry) — it
 *  throws rather than silently falling back to engine defaults. */
export function resolveAgentParams(
  label: string,
  contract: Record<string, AgentDefaultsSpec>,
  overrides: Partial<{ model: string; effort: Effort; timeoutMs: number; appendPrompt: string }>,
  engineDefaults: { model?: string },
): EffectiveCallParams {
  const spec = contract[label];
  if (spec === undefined) {
    throw codedError('INTERNAL_ERROR', `INTERNAL_ERROR: agent label "${label}" has no contract entry at dispatch (admission should have refused this run before it reached here)`);
  }

  const model = overrides.model ?? (spec.model.default as string | undefined) ?? engineDefaults.model;
  const modelRung: Rung = overrides.model !== undefined ? 'override' : spec.model.default !== undefined ? 'default' : 'engine';

  const effort = overrides.effort ?? (spec.effort.default as Effort | undefined);
  const effortRung: Rung = overrides.effort !== undefined ? 'override' : spec.effort.default !== undefined ? 'default' : 'engine';

  const timeoutMs = overrides.timeoutMs ?? (spec.timeoutMs.default as number | undefined);
  const timeoutMsRung: Rung = overrides.timeoutMs !== undefined ? 'override' : spec.timeoutMs.default !== undefined ? 'default' : 'engine';

  const appendPrompt = overrides.appendPrompt ?? (spec.appendPrompt?.default as string | undefined);
  const appendPromptRung: Rung =
    overrides.appendPrompt !== undefined ? 'override' : spec.appendPrompt?.default !== undefined ? 'default' : 'engine';

  return {
    model,
    effort,
    timeoutMs,
    appendPrompt,
    provenance: { model: modelRung, effort: effortRung, timeoutMs: timeoutMsRung, appendPrompt: appendPromptRung },
  };
}

export const USER_INSTRUCTIONS_OPEN = '\n\n<user-instructions untrusted="true">\n';
export const USER_INSTRUCTIONS_CLOSE = '\n</user-instructions>';

/** Five-segment composition (REQ-094, DES-102): [agent-type systemPrompt] + [defaults.prompt] +
 *  [script prompt] + [framed appendPrompt]. The engine's protocol scaffolding is appended AFTER
 *  this by the executor as a non-author non-user fifth segment — not this function's concern.
 *  Byte-identical to today's `${systemPrompt}\n\n${prompt}` / bare `prompt` when authorPrompt and
 *  appendPrompt are both absent. */
export function composePrompt(
  systemPrompt: string | undefined,
  authorPrompt: string | undefined,
  scriptPrompt: string,
  appendPrompt?: string,
): string {
  const segments = [systemPrompt, authorPrompt, scriptPrompt].filter((s): s is string => s !== undefined);
  const body = segments.join('\n\n');
  return appendPrompt !== undefined
    ? `${body}${USER_INSTRUCTIONS_OPEN}${appendPrompt}${USER_INSTRUCTIONS_CLOSE}`
    : body;
}

/** `composePrompt`'s inverse (REQ-136, DES-195): strips the leading `sys + '\n\n'` segment a
 *  gateway echoed back verbatim on `descriptor.prompt`, so the systemPrompt text never reaches
 *  the persisted transcript. Total over six cases — fails CLOSED (never returns `composed`
 *  unstripped) when the expected prefix is absent, because that means the gateway did not echo
 *  what it was given and the safe assumption is that nothing here is verified. `sys` undefined or
 *  `''` both mean "no systemPrompt was applied" (same as `composePrompt`'s own undefined-segment
 *  filter), so neither is stripped. */
export function stripFirstSegment(composed: string, sys: string | undefined): { prompt: string; stripped: boolean } {
  if (sys === undefined || sys === '') return { prompt: composed, stripped: false };
  if (composed === sys) return { prompt: '', stripped: true };
  const prefix = `${sys}\n\n`;
  if (composed.startsWith(prefix)) return { prompt: composed.slice(prefix.length), stripped: true };
  return { prompt: '', stripped: false };
}
