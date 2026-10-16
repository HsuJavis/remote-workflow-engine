// UT-349 (DES-271, ARCH-188/189, TASK-268): `scanPrimitiveCalls` (src/workflow-meta.ts) — the
// `decide`/`generateImage` label scanner, mirroring `scanAgentCalls`'s own `(?<!\.)` alias defense
// but with the simpler DES-271 return shape: `{ decide: string[]; generateImage: string[]; errors: Err[] }`.
// Also: `validateScriptEntry`'s alias-refusal check (`checkSandboxApiAliasing`) must treat
// `decide`/`generateImage` the SAME as `agent` once they join `CALLABLE_API_NAMES`.
//
// Red reason: `scanPrimitiveCalls` is not an export of `workflow-meta.ts` yet (import resolves to
// undefined, every call throws TypeError); `decide`/`generateImage` aliasing is not yet refused by
// `validateScriptEntry` (CALLABLE_API_NAMES doesn't contain them, so `checkSandboxApiAliasing`
// never flags the alias).
import { describe, it, expect } from 'vitest';
import { scanPrimitiveCalls } from '../../src/workflow-meta.js';
import { validateScriptEntry } from '../../src/script-checks.js';

describe('UT-349: scanPrimitiveCalls (DES-271)', () => {
  it('finds a literal decide() call label', () => {
    const r = scanPrimitiveCalls(`await decide('gate', {state:{}, questions:{}});`);
    expect(r.decide).toContain('gate');
    expect(r.violations).toEqual([]);
  });

  it('finds a literal generateImage() call label', () => {
    const r = scanPrimitiveCalls(`await generateImage('hero', {prompt:'a dog'});`);
    expect(r.generateImage).toContain('hero');
  });

  it('does not match a member-expression access (x.decide(...))', () => {
    const r = scanPrimitiveCalls(`await x.decide('gate', {});`);
    expect(r.decide).not.toContain('gate');
  });

  it('does NOT find a call made through a renamed alias (const d = decide; d(...)) — same gap agent() has, by design', () => {
    const r = scanPrimitiveCalls(`const d = decide; await d('gate', {});`);
    expect(r.decide).toEqual([]);
  });

  it('decide and generateImage calls are tracked independently in the same script', () => {
    const r = scanPrimitiveCalls(`
      await decide('gate', {state:{}, questions:{}});
      await generateImage('hero', {prompt:'x'});
    `);
    expect(r.decide).toContain('gate');
    expect(r.generateImage).toContain('hero');
  });

  it('a script with neither call returns empty arrays and no errors', () => {
    const r = scanPrimitiveCalls(`await agent('a', {});`);
    expect(r.decide).toEqual([]);
    expect(r.generateImage).toEqual([]);
    expect(r.violations).toEqual([]);
  });
});

describe('UT-349: validateScriptEntry refuses decide/generateImage aliasing (CALLABLE_API_NAMES, DES-271)', () => {
  it('refuses `const d = decide; d(...)` the same way agent aliasing is refused', () => {
    const r = validateScriptEntry(`const d = decide; await d('gate', {});`);
    expect(r.ok).toBe(false);
  });

  it('refuses `const g = generateImage; g(...)`', () => {
    const r = validateScriptEntry(`const g = generateImage; await g('hero', {});`);
    expect(r.ok).toBe(false);
  });

  it('a direct, literal decide(...) call is accepted by the alias check (not itself an alias)', () => {
    const r = validateScriptEntry(`await decide('gate', {state:{}, questions:{}});`);
    expect(r.ok).toBe(true);
  });
});

// UT-360 (DES-271 v40 Gate 6 delta, ruling R-10 option (a), TASK-268): `scanPrimitiveCalls` mirrors
// the agent path EXACTLY — it returns `AgentCallViolation`-shaped `violations` (same codes, no new
// vocabulary), and `WorkflowCatalog.validateRegistration` throws the existing generic
// `SCAN_VIOLATION` for the first one (agent violations first, then primitive ones). The two
// `r.errors` assertions above were renamed to `r.violations` by this delta (the field is renamed;
// `errors` no longer exists on the return shape).
// Red reason: `scanOnePrimitive` silently skips a non-literal label/options and never reads the
// options keys, so `violations` is undefined today and registration of every case below succeeds.
import { WorkflowCatalog } from '../../src/workflow-catalog.js';
import { FixedClock } from '../../src/clock.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';

const Q = `{ ok: { type: 'bool', instructions: 'i', criteria: { true: 't', false: 'f' } } }`;

describe('UT-360: scanPrimitiveCalls violations mirror the agent path (R-10)', () => {
  it('positive control: literal label + literal options with runtime VALUES (shorthand) -> no violations', () => {
    const r = scanPrimitiveCalls(`const state = {a:1}; const questions = ${Q}; await decide('gate', { state, questions });`);
    expect(r.violations).toEqual([]);
    expect(r.decide).toEqual(['gate']);
  });

  it('non-literal decide label -> AGENT_LABEL_NOT_LITERAL with a decide-naming hint and a line', () => {
    const r = scanPrimitiveCalls(`const l = 'gate';\nawait decide(l, { state: {}, questions: ${Q} });`);
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0]).toMatchObject({ code: 'AGENT_LABEL_NOT_LITERAL', line: 2 });
    expect(r.violations[0]!.hint).toMatch(/decide/);
  });

  it('missing generateImage label -> AGENT_LABEL_REQUIRED', () => {
    const r = scanPrimitiveCalls(`await generateImage();`);
    expect(r.violations.map((v) => v.code)).toEqual(['AGENT_LABEL_REQUIRED']);
  });

  it('non-literal options object -> AGENT_OPTS_NOT_LITERAL', () => {
    const r = scanPrimitiveCalls(`const o = { prompt: 'x' };\nawait generateImage('hero', o);`);
    expect(r.violations.map((v) => v.code)).toEqual(['AGENT_OPTS_NOT_LITERAL']);
  });

  it.each(['model', 'timeoutMs', 'retries'])('tunable key %s inside the call options -> PARAM_IN_SCRIPT naming the key', (key) => {
    const r = scanPrimitiveCalls(`await decide('gate', { state: {}, questions: ${Q}, ${key}: 1 });`);
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0]).toMatchObject({ code: 'PARAM_IN_SCRIPT', key });
  });
});

describe('UT-360: registration answers the first primitive violation with the generic SCAN_VIOLATION (R-10)', () => {
  const dirs: string[] = [];
  afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
  const META = `export const meta = { phases: [{ title: 'Main' }], params: { decisions: { gate: { model: { type: 'string', default: 'openrouter/typesafe/jev-1.13' }, timeoutMs: { type: 'number', default: 5000 }, retries: { type: 'number', default: 0 } } } } };`;
  const MERMAID = 'graph LR\nsubgraph "Main"\nend';
  function catalog(): WorkflowCatalog {
    const d = mkdtempSync(join(tmpdir(), 'rwe-ut360-'));
    dirs.push(d);
    return new WorkflowCatalog(d, new FixedClock(new Date('2026-10-16T00:00:00Z')));
  }
  async function codeOf(script: string): Promise<{ code?: string; detail?: unknown } | undefined> {
    try { await catalog().register({ name: 'ut360', script, mermaid: MERMAID, principal: null }); return undefined; }
    catch (e) { return e as { code?: string; detail?: unknown }; }
  }

  it('perturbation guard: the literal script registers', async () => {
    expect(await codeOf(`${META}\nphase('Main');\nreturn await decide('gate', { state: {}, questions: ${Q} });`)).toBeUndefined();
  });

  it('a tunable key inside decide() options is refused SCAN_VIOLATION (violation PARAM_IN_SCRIPT), not a new code', async () => {
    const e = await codeOf(`${META}\nphase('Main');\nreturn await decide('gate', { state: {}, questions: ${Q}, retries: 3 });`);
    expect(e?.code).toBe('SCAN_VIOLATION');
    expect(e?.detail).toMatchObject({ violation: 'PARAM_IN_SCRIPT', key: 'retries' });
  });

  it('a non-literal decide label is refused SCAN_VIOLATION (violation AGENT_LABEL_NOT_LITERAL)', async () => {
    const e = await codeOf(`${META}\nphase('Main');\nconst l = 'gate';\nawait decide('gate', { state: {}, questions: ${Q} });\nreturn await decide(l, { state: {}, questions: ${Q} });`);
    expect(e?.code).toBe('SCAN_VIOLATION');
    expect(e?.detail).toMatchObject({ violation: 'AGENT_LABEL_NOT_LITERAL' });
  });
});
