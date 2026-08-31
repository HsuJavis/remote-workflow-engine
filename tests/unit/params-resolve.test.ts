// UT-099 (DES-102, ARCH-065, TASK-098, TASK-104): pure src/params/resolve.ts — two-moment merge,
// per-key provenance, five-segment composePrompt, mapEffort tri-state.
//
// Mock policy (unit): pure module, zero I/O.
//
// Red reason: src/params/resolve.ts does not exist yet → MODULE NOT FOUND (correct v21 red).
import { describe, it, expect } from 'vitest';
import {
  defaultRunParams,
  mergeRunParams,
  resolveCallParams,
  composePrompt,
  USER_INSTRUCTIONS_OPEN,
  USER_INSTRUCTIONS_CLOSE,
  mapEffort,
} from '../../src/params/resolve.js';
import type { RunParams, ProviderEffortProfile } from '../../src/params/resolve.js';
import type { HarnessDefaults } from '../../src/harness-defaults.js';
import type { UserOverrides } from '../../src/params/contract.js';
import type { AgentTypeDef } from '../../src/agent-executor.js';

describe('defaultRunParams() — the ONLY no-overrides producer', () => {
  it('with no registered defaults, every tunable key provenance is "engine"', () => {
    const rp = defaultRunParams(undefined);
    expect(rp.provenance.model).toBe('engine');
    expect(rp.provenance.effort).toBe('engine');
    expect(rp.provenance.timeoutMs).toBe('engine');
    expect(rp.provenance.appendPrompt).toBe('engine');
  });

  it('with registered defaults, model/timeoutMs provenance is "default"', () => {
    const rp = defaultRunParams({ model: 'sonnet', timeoutMs: 30_000 });
    expect(rp.model).toBe('sonnet');
    expect(rp.timeoutMs).toBe(30_000);
    expect(rp.provenance.model).toBe('default');
    expect(rp.provenance.timeoutMs).toBe('default');
  });
});

describe('mergeRunParams() — admission-time fold of overrides over registered defaults (ADR-002)', () => {
  const DEFAULTS: HarnessDefaults = { model: 'sonnet', timeoutMs: 30_000, prompt: 'author prompt', tools: ['Read'], skills: ['s1'] };

  it('no overrides → registered defaults win, provenance:"default" for model/timeoutMs', () => {
    const rp = mergeRunParams(DEFAULTS, {});
    expect(rp.model).toBe('sonnet');
    expect(rp.timeoutMs).toBe(30_000);
    expect(rp.provenance.model).toBe('default');
    expect(rp.provenance.timeoutMs).toBe('default');
  });

  it('override wins for the keys it supplies; provenance:"override"', () => {
    const overrides: UserOverrides = { model: 'haiku' };
    const rp = mergeRunParams(DEFAULTS, overrides);
    expect(rp.model).toBe('haiku');
    expect(rp.provenance.model).toBe('override');
    // untouched key falls back to the registered default
    expect(rp.timeoutMs).toBe(30_000);
    expect(rp.provenance.timeoutMs).toBe('default');
  });

  it('folds all 6 registered keys — the author-only pair (prompt/tools) rides the snapshot too (REQ-092 close); skills is NOT a RunParams field (B-3 — skills are global server-side assets, unrelated to this snapshot)', () => {
    const rp = mergeRunParams(DEFAULTS, {});
    expect(rp.prompt).toBe('author prompt');
    expect(rp.tools).toEqual(['Read']);
    expect((rp as unknown as { skills?: unknown }).skills).toBeUndefined();
  });

  it('a locked key can never appear via UserOverrides (ADR-001: closed type, ts-enforced) — the author-only pair is untouched by overrides regardless', () => {
    const rp = mergeRunParams(DEFAULTS, {} as UserOverrides);
    expect(rp.prompt).toBe('author prompt'); // never comes from overrides — no such field exists on UserOverrides
  });

  it('two rungs holding the SAME value are still distinguished by provenance (not inferred by comparison)', () => {
    // registered default happens to equal what the engine would have chosen anyway ("sonnet")
    const rpNoOverride = mergeRunParams({ model: 'sonnet' }, {});
    const rpOverride: RunParams = mergeRunParams(undefined, { model: 'sonnet' });
    expect(rpNoOverride.model).toBe(rpOverride.model); // same value...
    expect(rpNoOverride.provenance.model).toBe('default');   // ...but provenance differs
    expect(rpOverride.provenance.model).toBe('override');
  });

  it('appendPrompt: absent by default, "override" when the caller supplies it (no author-side default exists)', () => {
    const rp = mergeRunParams(DEFAULTS, { appendPrompt: 'extra instructions' });
    expect(rp.appendPrompt).toBe('extra instructions');
    expect(rp.provenance.appendPrompt).toBe('override');
  });
});

describe('resolveCallParams() — dispatch-time application of the two per-call rungs (ARCH-065)', () => {
  const RUN_PARAMS: RunParams = {
    model: 'sonnet', timeoutMs: 30_000,
    provenance: { model: 'default', effort: 'engine', timeoutMs: 'default', appendPrompt: 'engine' },
  };

  it('per-call agent() opts.model wins over everything (rung 1)', () => {
    const eff = resolveCallParams({ model: 'opus' }, undefined, RUN_PARAMS, { model: 'haiku' });
    expect(eff.model).toBe('opus');
    expect(eff.provenance.model).toBe('call');
  });

  it('agentType frontmatter model wins over the run snapshot when no per-call opts.model (rung 2, D12: author config beats a user blanket choice)', () => {
    const agentTypeDef: AgentTypeDef = { systemPrompt: 'you are an agent', model: 'opus' };
    const eff = resolveCallParams({}, agentTypeDef, RUN_PARAMS, { model: 'haiku' });
    expect(eff.model).toBe('opus');
    expect(eff.provenance.model).toBe('agentType');
  });

  it('falls back to the run snapshot (override/default rung) when neither call nor agentType supply a value', () => {
    const eff = resolveCallParams({}, undefined, RUN_PARAMS, { model: 'haiku' });
    expect(eff.model).toBe('sonnet');
    expect(eff.provenance.model).toBe('default'); // inherited from RUN_PARAMS.provenance.model
  });

  it('falls back to the engine default alias as the last rung when nothing else set a model', () => {
    const empty: RunParams = { provenance: { model: 'engine', effort: 'engine', timeoutMs: 'engine', appendPrompt: 'engine' } };
    const eff = resolveCallParams({}, undefined, empty, { model: 'haiku' });
    expect(eff.model).toBe('haiku');
    expect(eff.provenance.model).toBe('engine');
  });

  it('effort has no agentType rung: call > override(snapshot) > engine(absent)', () => {
    const withEffort: RunParams = { ...RUN_PARAMS, effort: 'high', provenance: { ...RUN_PARAMS.provenance, effort: 'override' } };
    const eff = resolveCallParams({ effort: 'low' }, { systemPrompt: 'x' }, withEffort, {});
    expect(eff.effort).toBe('low');
    expect(eff.provenance.effort).toBe('call');
  });

  it('timeoutMs falls back from call to the snapshot to engine, same 3-rung ladder as effort', () => {
    const eff = resolveCallParams({}, undefined, RUN_PARAMS, {});
    expect(eff.timeoutMs).toBe(30_000);
    expect(eff.provenance.timeoutMs).toBe('default');
  });
});

describe('composePrompt() — five-segment order + byte-identity pin (DES-102, REQ-094)', () => {
  it('BYTE-IDENTITY PIN: no appendPrompt, no author prompt → identical to today’s `${systemPrompt}\\n\\n${prompt}`', () => {
    expect(composePrompt('SYS', undefined, 'do the thing', undefined)).toBe('SYS\n\ndo the thing');
  });

  it('BYTE-IDENTITY PIN: no system prompt, no author prompt, no appendPrompt → bare script prompt', () => {
    expect(composePrompt(undefined, undefined, 'do the thing', undefined)).toBe('do the thing');
  });

  it('FIVE-SEGMENT ORDER PIN: [agentType systemPrompt] + [defaults.prompt] + [script prompt] + [framed appendPrompt]', () => {
    const result = composePrompt('SYS', 'AUTHOR', 'SCRIPT', 'USER TEXT');
    const sysIdx = result.indexOf('SYS');
    const authorIdx = result.indexOf('AUTHOR');
    const scriptIdx = result.indexOf('SCRIPT');
    const userIdx = result.indexOf('USER TEXT');
    expect(sysIdx).toBeGreaterThanOrEqual(0);
    expect(sysIdx).toBeLessThan(authorIdx);
    expect(authorIdx).toBeLessThan(scriptIdx);
    expect(scriptIdx).toBeLessThan(userIdx);
  });

  it('appendPrompt is wrapped in the fixed untrusted-instructions frame, last content segment', () => {
    const result = composePrompt('SYS', undefined, 'SCRIPT', 'USER TEXT');
    expect(result.endsWith(`${USER_INSTRUCTIONS_OPEN}USER TEXT${USER_INSTRUCTIONS_CLOSE}`)).toBe(true);
  });

  it('no appendPrompt → the frame constants never appear', () => {
    const result = composePrompt('SYS', 'AUTHOR', 'SCRIPT', undefined);
    expect(result).not.toContain(USER_INSTRUCTIONS_OPEN);
  });
});

describe('mapEffort() — pure, provider-keyed, tri-state (DES-102, ARCH-069)', () => {
  const ANTHROPIC_PROFILE: ProviderEffortProfile = {
    param: 'thinking_budget',
    values: { low: 1024, medium: 4096, high: 16384, xhigh: 32768, max: 65536 },
  };
  const NO_DIAL_PROFILE: ProviderEffortProfile = { noop: true, reason: 'no reasoning dial for this provider' };

  it('applied: a profile with a dial returns {applied:true, param, value}', () => {
    const r = mapEffort(ANTHROPIC_PROFILE, 'max');
    expect(r).toEqual({ applied: true, param: 'thinking_budget', value: 65536 });
  });

  it('not-applied-with-reason: an explicit no-dial profile degrades without failing', () => {
    const r = mapEffort(NO_DIAL_PROFILE, 'max');
    expect(r).toEqual({ applied: false, reason: 'no reasoning dial for this provider' });
  });

  it('absent (never requested): no effort supplied at all → undefined, distinguishable from "dropped"', () => {
    expect(mapEffort(ANTHROPIC_PROFILE, undefined)).toBeUndefined();
    expect(mapEffort(undefined, undefined)).toBeUndefined();
  });

  it('low vs max map to different wire values on the same profile', () => {
    const low = mapEffort(ANTHROPIC_PROFILE, 'low');
    const max = mapEffort(ANTHROPIC_PROFILE, 'max');
    expect(low).not.toEqual(max);
  });
});
