// UT-350 (DES-272, ARCH-186, TASK-269): `decide`/`generateImage` join `SANDBOX_GLOBALS` and
// `evaluateScript`'s sandbox object, built from the `makeAgent` template (wrap -> toCtxPromise ->
// reRealm -> sanitizeThrownError) — same mock policy as UT-304 (the injected `SandboxApi`, no
// `fork()`, no real IPC; the real-fork callSeq-ordering case is IT-308).
//
// Red reason: `SandboxApi.decide`/`.generateImage` are not read by `evaluateScript`'s
// `Object.assign(sandbox, {...})` call yet — a script calling either global hits a ReferenceError
// (not defined on the vm context), regardless of whether the fakeApi below provides them.
import { describe, it, expect } from 'vitest';
import { evaluateScript, SANDBOX_GLOBALS, type SandboxApi } from '../../src/sandbox/guards.js';

function fakeApi(overrides: Partial<SandboxApi>): SandboxApi {
  return {
    agent: async () => 'agent-result',
    args: undefined,
    budget: { limits: { usd: null, tokens: null }, total: null, spent: () => 0, remaining: () => null, tokens: () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, sum: 0 }) } as never,
    ...overrides,
  };
}

describe('UT-350: SANDBOX_GLOBALS includes decide/generateImage (DES-272)', () => {
  it('SANDBOX_GLOBALS contains both new primitives', () => {
    expect(SANDBOX_GLOBALS).toContain('decide');
    expect(SANDBOX_GLOBALS).toContain('generateImage');
  });
});

describe('UT-350: evaluateScript wires decide()/generateImage() (DES-272)', () => {
  it('a script calling decide() resolves with the handler\'s return value', async () => {
    const api = fakeApi({ decide: async () => ({ answers: { ok: { type: 'bool', probability: 0.9 } } }) } as never);
    const r = await evaluateScript(`return await decide('gate', {state:{}, questions:{}});`, api);
    expect(r.kind).toBe('done');
    expect((r.value as { answers: unknown }).answers).toBeDefined();
  });

  it('a script calling generateImage() resolves with the handler\'s return value', async () => {
    const api = fakeApi({ generateImage: async () => ({ files: [{ path: 'generated/hero-1-0.png' }] }) } as never);
    const r = await evaluateScript(`return await generateImage('hero', {prompt:'x'});`, api);
    expect(r.kind).toBe('done');
    expect((r.value as { files: unknown[] }).files).toHaveLength(1);
  });

  it('a decide() rejection surfaces as a sanitized error, same shape as an agent() rejection', async () => {
    const api = fakeApi({ decide: async () => { throw Object.assign(new Error('boom'), { code: 'PRIMITIVE_FAILED' }); } } as never);
    const r = await evaluateScript(`try { await decide('gate', {}); } catch (e) { throw e; }`, api);
    expect(r.kind).toBe('error');
    expect((r as { error: { code: string } }).error.code).toBe('PRIMITIVE_FAILED');
  });

  it('absent SandboxApi.decide (no handler wired) still lets the script run — agent() alone is unaffected', async () => {
    const api = fakeApi({});
    const r = await evaluateScript(`return await agent('x', {});`, api);
    expect(r.kind).toBe('done');
  });
});
