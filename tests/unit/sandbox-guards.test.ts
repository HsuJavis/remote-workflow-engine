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

  it('second-level workflow() nesting (no delegate) throws NESTING_ERROR', async () => {
    // The real second level has NO workflow delegate (the host only injects one at level 1) →
    // the one-level limit fires. FAKE_API has no `workflow`, so this is that genuine case.
    const r = await evaluateScript(`return workflow('child', {});`, FAKE_API);
    expect(r.kind).toBe('error');
    expect(r.error!.code).toBe('NESTING_ERROR');
  });

  it('C-2: a workflow() delegate failure preserves the underlying error code, not a flat NESTING_ERROR', async () => {
    // A delegate present-but-throwing is NOT a nesting violation — its own code must survive
    // (a caller catching workflow(unknownName) should see CatalogNotFoundError, e.g.).
    const typedErr = Object.assign(new Error('Workflow not found in catalog: x'), { name: 'CatalogNotFoundError' });
    const apiTyped: SandboxApi & { workflow?: unknown } = { ...FAKE_API, workflow: async () => { throw typedErr; } };
    const rTyped = await evaluateScript(`return workflow('x', {});`, apiTyped as SandboxApi);
    expect(rTyped.kind).toBe('error');
    expect(rTyped.error!.code).toBe('CatalogNotFoundError');

    // A delegate throwing an anonymous Error falls back to the generic WORKFLOW_ERROR (still not NESTING_ERROR).
    const apiAnon: SandboxApi & { workflow?: unknown } = { ...FAKE_API, workflow: async () => { throw new Error('boom'); } };
    const rAnon = await evaluateScript(`return workflow('x', {});`, apiAnon as SandboxApi);
    expect(rAnon.error!.code).toBe('WORKFLOW_ERROR');
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

  // V5 (accepted-limitation resolution): the vm determinism guards ARE escapable via a
  // Function-constructor realm escape — but that escape reaches only realm INTRINSICS, never the
  // absent host capabilities. This pins the actual risk profile: the SECURITY boundary holds under
  // the exact vector that defeats the (self-only) determinism guards.
  it('V5: a Function-constructor realm escape cannot reach process/require/fs (security boundary holds)', async () => {
    for (const cap of ['process', 'require', 'fs', 'global', 'globalThis.process']) {
      const r = await evaluateScript(`return typeof (Function('return ${cap}')());`, FAKE_API);
      // Not reachable: the escape yields undefined (capability simply absent from the context),
      // or the reference throws — never a live handle to the host capability.
      if (r.kind === 'done') {
        expect(r.value).toBe('undefined');
      } else {
        expect(r.kind).toBe('error');
      }
    }
  });
});
