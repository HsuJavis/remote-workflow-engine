// UT-304 (DES-248, ARCH-165, TASK-246, REQ-215/REQ-205): the PURE provenance policy in
// `src/sandbox/guards.ts` — a `WeakMap<object, number>` keyed on the Error OBJECT (never a field on
// it, so `e.refusalRef = 99` cannot forge one), `markEngineRefusal(err, callSeq)`, and
// `evaluateScript`'s `{kind:'error'}` result reading the ref FROM THE MAP, never off `err`. Also the
// forced-duplication drift guard between `guards.ts`'s `ENGINE_REFUSAL_CODES` and
// `run-manager.ts`'s exported `RECORDED_REFUSAL_CODES` (the sandbox child cannot value-import
// `.ts`, so this duplication can never be refactored away — the one condition under which a
// constant-watching test earns its keep).
//
// Scope note (corrected — read this before trusting the earlier claim in 05-tests.md's first
// draft): the RunEntry ledger lives on `RunManager`, not on anything this pure-policy file can
// reach (no `RunManager` is constructed here at all), so its 8-slot cap is not testable at this
// tier. IT-298 (`refusal-marker-real-child.test.ts`) covers that shape (9 refusals must not break
// the run's ordinary failure reporting) and the nested-frame negative case via the real fork it
// already pays for.
//
// The UNKNOWN-REF fallback ("a `refusalRef` this run's ledger does NOT contain falls back to
// today's flattened envelope") IS observable in principle — `resultError.code` would read today's
// code instead of the ledger entry's — but it is NOT reachable by any REAL script: the child mints
// every `refusalRef` it sends from the SAME `callSeq` the parent gave it for that call, so an
// "unknown" ref can only arise from a forged/stale child IPC message, which is exactly the mocked
// seam REQ-215 forbids constructing. No case exists for it in this file or in IT-298; left
// unbuilt for that reason (a design fact worth recording, not a coverage oversight to silently
// paper over) — see 05-tests.md's v36 exit-gate self-check list.
//
// Red reason: `markEngineRefusal` does not exist (`guards.ts` has no such export) — every case that
// calls it is a TypeError; `ENGINE_REFUSAL_CODES` (module-private, unreachable from a test) is
// probed only via the drift guard's source-text read, which fails because `run-manager.ts` exports
// no `RECORDED_REFUSAL_CODES` yet.
//
// Mock policy (unit): the injected `SandboxApi` — no `fork()`, no real IPC.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { evaluateScript, markEngineRefusal, type SandboxApi } from '../../src/sandbox/guards.js';

function fakeApi(agentImpl: (prompt: string, opts?: unknown) => Promise<unknown>): SandboxApi {
  return {
    agent: agentImpl,
    args: undefined,
    budget: { limits: { usd: null, tokens: null }, total: null, spent: () => 0, remaining: () => null, tokens: () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, sum: 0 }) } as any,
  };
}

describe('UT-304: sandbox refusal provenance — a WeakMap the vm cannot reach, an integer on the wire', () => {
  it('POSITIVE: a refusal marked 7, rethrown by the script, surfaces refusalRef:7', async () => {
    const err = Object.assign(new Error('budget gone'), { code: 'BUDGET_EXCEEDED', name: 'BUDGET_EXCEEDED' });
    markEngineRefusal(err, 7);
    const api = fakeApi(async () => { throw err; });
    const result = await evaluateScript(`
      try { await agent('x', {}); } catch (e) { throw e; }
    `, api);
    expect(result.kind).toBe('error');
    expect((result as any).error.refusalRef).toBe(7);
  });

  it('NEGATIVE: a script throwing a FRESH (unmarked) error carries no ref', async () => {
    const api = fakeApi(async () => { throw new Error('unrelated'); });
    const result = await evaluateScript(`
      try { await agent('x', {}); } catch (e) { throw new Error('a genuinely different error'); }
    `, api);
    expect(result.kind).toBe('error');
    expect((result as any).error.refusalRef).toBeUndefined();
  });

  it('FORGERY: a script writing e.refusalRef = 99 on the caught error does NOT override the map\'s 7', async () => {
    const err = Object.assign(new Error('budget gone'), { code: 'BUDGET_EXCEEDED', name: 'BUDGET_EXCEEDED' });
    markEngineRefusal(err, 7);
    const api = fakeApi(async () => { throw err; });
    const result = await evaluateScript(`
      try { await agent('x', {}); } catch (e) { e.refusalRef = 99; throw e; }
    `, api);
    expect((result as any).error.refusalRef).toBe(7);
  });

  it('PARALLEL() IDENTITY: the ref survives the re-throw through parallel()', async () => {
    const err = Object.assign(new Error('budget gone'), { code: 'BUDGET_EXCEEDED', name: 'BUDGET_EXCEEDED' });
    markEngineRefusal(err, 3);
    const api = fakeApi(async () => { throw err; });
    const result = await evaluateScript(`
      await parallel([() => agent('x', {})]);
    `, api);
    expect(result.kind).toBe('error');
    expect((result as any).error.refusalRef).toBe(3);
  });

  it('DRIFT GUARD: guards.ts ENGINE_REFUSAL_CODES equals run-manager.ts RECORDED_REFUSAL_CODES (forced duplication — the child cannot value-import .ts)', () => {
    const guardsSrc = readFileSync(join(__dirname, '..', '..', 'src', 'sandbox', 'guards.ts'), 'utf8');
    const runManagerSrc = readFileSync(join(__dirname, '..', '..', 'src', 'run-manager.ts'), 'utf8');
    const guardsMatch = guardsSrc.match(/ENGINE_REFUSAL_CODES\s*=\s*new Set\(\[([^\]]*)\]\)/);
    const rmMatch = runManagerSrc.match(/RECORDED_REFUSAL_CODES\s*=\s*new Set\(\[([^\]]*)\]\)/);
    expect(guardsMatch).not.toBeNull();
    expect(rmMatch).not.toBeNull();
    const parse = (s: string) => s.split(',').map((x) => x.trim().replace(/['"]/g, '')).filter(Boolean).sort();
    expect(parse(guardsMatch![1]!)).toEqual(parse(rmMatch![1]!));
  });

  it('FORGERY OF CODE (the v25 inheritance, not v36): a script that forges name:\'PARAM_UNKNOWN\' on a FRESH error gets the code and NO marker', async () => {
    // The *code* can always be forged (refusalCode() matches e.code OR e.name) — only the *ref* is
    // protected by the WeakMap's object identity. DES-248/DES-249's attestation-boundary sentence
    // exists precisely because this negative case is true and must stay true.
    const api = fakeApi(async () => { throw new Error('unrelated dispatch failure'); });
    const result = await evaluateScript(`
      try {
        await agent('x', {});
        return { caught: false };
      } catch (e) {
        throw Object.assign(new Error('forged'), { name: 'PARAM_UNKNOWN' });
      }
    `, api);
    expect(result.kind).toBe('error');
    expect((result as any).error.code).toBe('PARAM_UNKNOWN');
    expect((result as any).error.refusalRef).toBeUndefined();
  });
});
