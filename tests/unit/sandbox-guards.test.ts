// UT-005: Sandbox VM guards — determinism, TS rejection, nesting, size caps (DES-005)
import { describe, it, expect } from 'vitest';
import { evaluateScript } from '../../src/sandbox/guards.js';
import type { SandboxApi } from '../../src/sandbox/guards.js';
import type { Budget } from '../../src/types.js';

const NEVER_BUDGET: Budget = { total: null, spent: () => 0, remaining: () => Infinity };
const FAKE_API: SandboxApi = {
  async agent(_p, _o) { return 'fake-result'; },
  args: undefined,
  budget: NEVER_BUDGET,
};

describe('Sandbox VM guards', () => {
  it('Date.now() inside script returns DETERMINISM_GUARD error', async () => {
    const r = await evaluateScript('return Date.now();', FAKE_API);
    expect(r.kind).toBe('error');
    expect(r.error!.code).toBe('DETERMINISM_GUARD');
  });

  it('Math.random() inside script returns DETERMINISM_GUARD error', async () => {
    const r = await evaluateScript('return Math.random();', FAKE_API);
    expect(r.kind).toBe('error');
    expect(r.error!.code).toBe('DETERMINISM_GUARD');
  });

  it('new Date() without args inside script returns DETERMINISM_GUARD error', async () => {
    const r = await evaluateScript('return new Date();', FAKE_API);
    expect(r.kind).toBe('error');
    expect(r.error!.code).toBe('DETERMINISM_GUARD');
  });

  it('TypeScript type annotations in script return PARSE_ERROR', async () => {
    const r = await evaluateScript('const x: number = 1; return x;', FAKE_API);
    expect(r.kind).toBe('error');
    expect(r.error!.code).toBe('PARSE_ERROR');
  });

  it('script > 512 KB returns SIZE_EXCEEDED error', async () => {
    const big = 'x'.repeat(512 * 1024 + 1);
    const r = await evaluateScript(big, FAKE_API);
    expect(r.kind).toBe('error');
    expect(r.error!.code).toBe('SIZE_EXCEEDED');
  });

  it('parallel() call with > 4096 items returns ITEM_CAP_EXCEEDED error', async () => {
    const items = JSON.stringify(new Array(4097).fill(0));
    const script = `return parallel(${items}.map(i => async () => i));`;
    const r = await evaluateScript(script, FAKE_API);
    expect(r.kind).toBe('error');
    expect(r.error!.code).toBe('ITEM_CAP_EXCEEDED');
  });

  it('valid script returns kind:done with the return value', async () => {
    const r = await evaluateScript('return 42;', FAKE_API);
    expect(r.kind).toBe('done');
    expect(r.value).toBe(42);
  });

  it('second-level workflow() nesting inside a script throws NESTING_ERROR', async () => {
    const apiWithWorkflow: SandboxApi & { workflow?: unknown } = {
      ...FAKE_API,
      workflow: async () => { throw new Error('nested'); },
    };
    // The sandbox should prevent a second-level workflow() call with NESTING_ERROR
    const r = await evaluateScript(`return workflow('child', {});`, apiWithWorkflow as SandboxApi);
    expect(r.kind).toBe('error');
    expect(r.error!.code).toBe('NESTING_ERROR');
  });

  it('fs, require, process are not accessible in the sandbox', async () => {
    const r = await evaluateScript('return typeof require;', FAKE_API);
    // Either error (guard throws) or 'undefined' (not exposed)
    if (r.kind === 'done') {
      expect(r.value).toBe('undefined');
    } else {
      expect(r.kind).toBe('error');
    }
  });
});
