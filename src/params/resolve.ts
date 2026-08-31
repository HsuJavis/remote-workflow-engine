// src/params/resolve.ts (DES-102, ARCH-065, TASK-098): pure two-moment merge of the tunable
// parameter contract — admission-time snapshot (RunParams) and dispatch-time per-call resolution
// (EffectiveCallParams) — plus five-segment prompt composition and provider effort mapping.
//
// Pure throughout: no I/O, no clock, no VM, no randomness. Provenance is emitted by the function
// that computes the value (one pass, {value, rung} per key) — never inferred afterwards by
// comparing values, which lies whenever two rungs happen to hold the same value.

import type { Effort, UserOverrides } from './contract.js';
import type { HarnessDefaults } from '../harness-defaults.js';
import type { AgentTypeDef } from '../agent-executor.js';
import type { AgentOpts } from '../types.js';

export type Rung = 'call' | 'agentType' | 'override' | 'default' | 'engine';

/** ADMISSION snapshot — run-immutable. */
export interface RunParams {
  model?: string;
  effort?: Effort;
  timeoutMs?: number;
  appendPrompt?: string;
  // author-only trio (REQ-092 close; UserOverrides cannot spell them)
  prompt?: string;
  tools?: string[];
  skills?: string[];
  provenance: Record<'model' | 'effort' | 'timeoutMs' | 'appendPrompt', 'override' | 'default' | 'engine'>;
}

export interface EffectiveCallParams extends Omit<RunParams, 'provenance'> {
  provenance: Record<'model' | 'effort' | 'timeoutMs' | 'appendPrompt', Rung>;
}

/** The ONLY no-overrides producer: a run registered with no `overrides` at admission time. */
export function defaultRunParams(defaults: HarnessDefaults | undefined): RunParams {
  return {
    model: defaults?.model,
    timeoutMs: defaults?.timeoutMs,
    prompt: defaults?.prompt,
    tools: defaults?.tools,
    skills: defaults?.skills,
    provenance: {
      model: defaults?.model !== undefined ? 'default' : 'engine',
      effort: 'engine', // HarnessDefaults carries no author-side effort
      timeoutMs: defaults?.timeoutMs !== undefined ? 'default' : 'engine',
      appendPrompt: 'engine', // no author-side appendPrompt exists
    },
  };
}

/** Admission-time fold of `overrides` over the registered `defaults` (ADR-002): one pass per
 *  tunable key, override wins when supplied, else the registered-default snapshot stands. */
export function mergeRunParams(defaults: HarnessDefaults | undefined, overrides: UserOverrides): RunParams {
  const base = defaultRunParams(defaults);
  const rp: RunParams = { ...base, provenance: { ...base.provenance } };
  if (overrides.model !== undefined) { rp.model = overrides.model; rp.provenance.model = 'override'; }
  if (overrides.effort !== undefined) { rp.effort = overrides.effort; rp.provenance.effort = 'override'; }
  if (overrides.timeoutMs !== undefined) { rp.timeoutMs = overrides.timeoutMs; rp.provenance.timeoutMs = 'override'; }
  if (overrides.appendPrompt !== undefined) { rp.appendPrompt = overrides.appendPrompt; rp.provenance.appendPrompt = 'override'; }
  return rp;
}

/** Dispatch-time application of the two per-call rungs on top of the run snapshot (ARCH-065):
 *  per-call `agent()` opts › agentType frontmatter › per-run snapshot (override/default) › engine
 *  default. `effort`/`timeoutMs` have no agentType rung: call › snapshot › engine. */
export function resolveCallParams(
  opts: AgentOpts,
  agentTypeDef: AgentTypeDef | undefined,
  runParams: RunParams,
  engineDefaults: { model?: string },
): EffectiveCallParams {
  // model: call > agentType > snapshot (its own provenance) > engine
  let model = runParams.model;
  let modelRung: Rung = runParams.provenance.model;
  if (model === undefined) {
    model = engineDefaults.model;
    modelRung = 'engine';
  }
  if (agentTypeDef?.model !== undefined) {
    model = agentTypeDef.model;
    modelRung = 'agentType';
  }
  if (opts.model !== undefined) {
    model = opts.model;
    modelRung = 'call';
  }

  // effort: call > snapshot (own provenance) > engine — no agentType rung
  let effort = runParams.effort;
  let effortRung: Rung = runParams.provenance.effort;
  if (effort === undefined) effortRung = 'engine';
  if (opts.effort !== undefined) {
    effort = opts.effort;
    effortRung = 'call';
  }

  // timeoutMs: call > snapshot (own provenance) > engine — no agentType rung
  let timeoutMs = runParams.timeoutMs;
  let timeoutMsRung: Rung = runParams.provenance.timeoutMs;
  if (timeoutMs === undefined) timeoutMsRung = 'engine';
  if (opts.timeoutMs !== undefined) {
    timeoutMs = opts.timeoutMs;
    timeoutMsRung = 'call';
  }

  // appendPrompt: no per-call rung exists — snapshot (own provenance) > engine
  const appendPrompt = runParams.appendPrompt;
  const appendPromptRung: Rung = appendPrompt === undefined ? 'engine' : runParams.provenance.appendPrompt;

  return {
    model,
    effort,
    timeoutMs,
    appendPrompt,
    prompt: runParams.prompt,
    tools: runParams.tools,
    skills: runParams.skills,
    provenance: { model: modelRung, effort: effortRung, timeoutMs: timeoutMsRung, appendPrompt: appendPromptRung },
  };
}

export const USER_INSTRUCTIONS_OPEN = '\n\n<user-instructions untrusted="true">\n';
export const USER_INSTRUCTIONS_CLOSE = '\n</user-instructions>';

/** Five-segment composition (REQ-094, DES-102): [agentType systemPrompt] + [defaults.prompt] +
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

/** NEW type in src/params/, deliberately distinct from the fenced ProviderProfile.effortMapping
 *  (session-options-builder.ts:18, ADR-006). A provider with no dial gets an explicit
 *  {noop:true, reason} entry — adding a provider is a config row, not executor code. */
export type ProviderEffortProfile = { param: string; values: Record<Effort, unknown> } | { noop: true; reason: string };

/** Pure, provider-keyed, tri-state: applied / not-applied-with-reason / never-asked (undefined). */
export function mapEffort(
  profile: ProviderEffortProfile | undefined,
  effort?: Effort,
): { applied: true; param: string; value: unknown } | { applied: false; reason: string } | undefined {
  if (effort === undefined || profile === undefined) return undefined;
  if ('noop' in profile) return { applied: false, reason: profile.reason };
  return { applied: true, param: profile.param, value: profile.values[effort] };
}
