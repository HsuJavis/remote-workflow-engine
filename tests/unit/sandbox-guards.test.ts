// UT-005: Sandbox VM guards — determinism, TS rejection, nesting, size caps (DES-005)
import { describe, it, expect } from 'vitest';
import { evaluateScript, SANDBOX_GLOBALS } from '../../src/sandbox/guards.js';
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

  // V5, REWRITTEN for issue #157 B1: the ORIGINAL version of this test only probed the bare
  // `Function` global (`Function('return process')()`), which was ALWAYS isolated — that vector
  // defeats the Date/Math determinism guards (a `node:vm` context is not a sandbox against ITS OWN
  // realm) but never reached a host capability, because `Function` as a bare identifier resolves to
  // the vm context's OWN native Function, not the embedding realm's. That gave false assurance: the
  // REAL vector #157 B1 reported was `<injected-object>.constructor.constructor(...)` — walking the
  // prototype chain of one of THIS file's own injected sandbox globals (agent/args/budget/Date/
  // Math/…), each of which, pre-fix, was an object CREATED in the embedding realm and handed into
  // the context as a property, so its `.constructor` resolved to the EMBEDDING Function regardless
  // of the bare-`Function` isolation above. This case now walks that vector on every one of
  // `SANDBOX_GLOBALS`, matching the exact reported exploit — not just its control case. See
  // `tests/integration/sandbox-realm-escape.test.ts` for the same vector proven through the REAL
  // forked child process (where the escaped realm would actually hold inherited secrets).
  it('V5: .constructor.constructor on every injected sandbox global cannot reach process/require/fs (security boundary holds)', async () => {
    for (const name of SANDBOX_GLOBALS) {
      for (const cap of ['process', 'require', 'fs', 'global', 'globalThis.process']) {
        const script = `
          try {
            const v = (${name}).constructor.constructor('return ${cap}')();
            // A LIVE capability, not merely "the reference didn't throw" — e.g. ${name}.constructor.
            // constructor('return globalThis.process')() legitimately resolves without throwing
            // (the generated function's OWN globalThis exists — it's the vm context's) and correctly
            // yields undefined, since 'process' is not a property of THAT globalThis; that is the
            // safe outcome, not an escape, so only a genuinely live object/function counts here.
            const live = (typeof v === 'object' && v !== null) || typeof v === 'function';
            return { escaped: live };
          } catch (e) {
            return { escaped: false };
          }
        `;
        const r = await evaluateScript(script, FAKE_API);
        expect(r.kind, `${name}.constructor.constructor('return ${cap}') should not throw out of evaluateScript`).toBe('done');
        const dump = r.value as { escaped: boolean };
        expect(dump.escaped, `${name}.constructor.constructor('return ${cap}') must not escape`).toBe(false);
      }
    }
  });

  // Bare `Function` (no injected object involved) was always isolated — kept as the control case
  // the rewritten V5 test above now contrasts against, proving the fix targeted the real vector
  // without disturbing the one that was already safe.
  it('control: a bare Function-constructor realm escape (no injected object) still cannot reach process/require/fs', async () => {
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
