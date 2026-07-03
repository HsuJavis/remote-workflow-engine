// UT-015: workflow-script meta-literal validation (compat-spec §1, DES-005/DES-013)
// `export const meta = {...}` must be a pure object literal — variables, calls, spreads,
// and template interpolation are rejected; the valid literal form is accepted.
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

describe('Meta literal validation (compat-spec §1)', () => {
  it('accepts a pure object literal meta', async () => {
    const script = `export const meta = { name: 'demo', description: 'a demo workflow' };\nreturn 1;`;
    const r = await evaluateScript(script, FAKE_API);
    expect(r.kind).toBe('done');
    expect(r.value).toBe(1);
  });

  it('rejects meta assigned from a variable', async () => {
    const script = `const shared = { name: 'demo', description: 'x' };\nexport const meta = shared;\nreturn 1;`;
    const r = await evaluateScript(script, FAKE_API);
    expect(r.kind).toBe('error');
    expect(r.error!.code).toBe('INVALID_META');
  });

  it('rejects meta built from a function call', async () => {
    const script = `export const meta = Object.assign({}, { name: 'demo', description: 'x' });\nreturn 1;`;
    const r = await evaluateScript(script, FAKE_API);
    expect(r.kind).toBe('error');
    expect(r.error!.code).toBe('INVALID_META');
  });

  it('rejects meta using a spread', async () => {
    const script = `const base = { name: 'demo' };\nexport const meta = { ...base, description: 'x' };\nreturn 1;`;
    const r = await evaluateScript(script, FAKE_API);
    expect(r.kind).toBe('error');
    expect(r.error!.code).toBe('INVALID_META');
  });

  it('rejects meta using template interpolation', async () => {
    const script = "const n = 'demo';\nexport const meta = { name: `${n}`, description: 'x' };\nreturn 1;";
    const r = await evaluateScript(script, FAKE_API);
    expect(r.kind).toBe('error');
    expect(r.error!.code).toBe('INVALID_META');
  });
});
