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
    expect(r.errors).toEqual([]);
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
    expect(r.errors).toEqual([]);
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
