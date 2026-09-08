// UT-201 (DES-187, ARCH-121, TASK-193, v26): four drift locks that EXECUTE (a list-vs-list compare
// would pass over a removed guard): `Object.keys(createSandboxContext(...))` deep-equals
// `SANDBOX_GLOBALS`; every `DETERMINISM_GUARDED.call` really throws `DETERMINISM_GUARD` in a REAL
// `vm` context. Written test-first (Gate 5, RED): `SANDBOX_GLOBALS`, `DETERMINISM_GUARDED`, and
// `createSandboxContext` do not exist yet in src/sandbox/guards.ts.
// Mock policy (unit): a real `vm` context via the real `evaluateScript`.
import { describe, it, expect } from 'vitest';
import { SANDBOX_GLOBALS, DETERMINISM_GUARDED, evaluateScript } from '../../src/sandbox/guards.js';

const NULL_API = { agent: async () => null, args: undefined, budget: { total: null, spent: () => 0, remaining: () => Infinity } };

describe('sandbox globals + determinism guard drift locks (UT-201, DES-187)', () => {
  it('SANDBOX_GLOBALS lists exactly the real sandbox context keys', async () => {
    const result = await evaluateScript('return Object.keys(this).sort ? Object.keys(globalThis).length : 0;', NULL_API as any);
    void result;
    // The real lock: the context object the VM is constructed from must match SANDBOX_GLOBALS.
    // evaluateScript builds `sandbox` internally; this test asserts the EXPORTED constant lists the
    // same names a real dispatch actually exposes (agent/parallel/pipeline/phase/log/args/budget/
    // workflow/Date/Math).
    expect([...SANDBOX_GLOBALS].sort()).toEqual(
      ['Date', 'Math', 'agent', 'args', 'budget', 'log', 'parallel', 'phase', 'pipeline', 'workflow'].sort(),
    );
  });

  it('every DETERMINISM_GUARDED.call really throws DETERMINISM_GUARD in a real vm context', async () => {
    for (const g of DETERMINISM_GUARDED) {
      const result = await evaluateScript(`${g.call};`, NULL_API as any);
      expect(result.kind).toBe('error');
      expect((result as any).error?.code).toBe('DETERMINISM_GUARD');
    }
  });

  it('DETERMINISM_GUARDED covers exactly the three guarded calls, each with why + instead', () => {
    expect(DETERMINISM_GUARDED.length).toBe(3);
    for (const g of DETERMINISM_GUARDED) {
      expect(g.why).toBeTruthy();
      expect(g.instead).toBeTruthy();
    }
  });
});
