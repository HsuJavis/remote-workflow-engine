// Issue #154 B1 (CRITICAL): two static-scanner blind spots that make `scanAgentCalls`'s
// (`workflow-meta.ts`) "every agent()/phase() call is reachable" guarantee false.
//
// B1a: a `function`-wrapped agent()/phase() call is never invoked at runtime (the wrapper function
// is declared but never called) but was scanned and accepted as if it were live top-level code,
// producing a silent 0-agent "completed" run — directly contradicting the authoring guide's explicit
// promise that a `function` wrapper of any kind is refused `PARSE_ERROR`. `OFFENDING_CONSTRUCTS`'s
// `function` entry (script-checks.ts) was only ever consulted as a friendly-message LOOKUP inside
// `parseErrorFor`, which runs ONLY when `vm.Script` already threw a genuine SyntaxError — a plain
// `function main(){...}` statement is syntactically legal, so it compiles fine and the "function
// wrapper refused" promise was never actually enforced for a plain function declaration.
//
// B1 (phase-alias duplicate, #157's own note): `phase`/`agent`/`parallel`/`workflow` reachable
// through an aliased reference (`const P = phase; P('x')`) is the SAME root cause (the registration
// scanner is a call-site-text match with no scope/alias awareness) — fixed here, not separately, per
// that issue's own instruction to the #154 B1 fixer.
//
// RED before the fix: every case below is accepted (`validateScriptEntry` returns `{ok:true}`) when
// it must be refused.
//
// Mock policy (unit): pure function, no I/O.
import { describe, it, expect } from 'vitest';
import { validateScriptEntry } from '../../src/script-checks.js';

describe('#154 B1a: a top-level function/async-function declaration is refused, not silently accepted', () => {
  it('a never-called async function wrapping an agent()/phase() call is refused', () => {
    const script = "async function main(){ phase('p1'); return await agent('a',{prompt:'OK',allowedTools:[]}) }";
    const r = validateScriptEntry(script);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]!.code).toBe('PARSE_ERROR');
  });

  it('a plain (non-async) top-level function declaration is refused the same way', () => {
    const script = "function main(){ return 1; }\nreturn main();";
    const r = validateScriptEntry(script);
    expect(r.ok).toBe(false);
  });

  it('a script with NO function wrapper at all still registers clean (no false positive)', () => {
    const script = "phase('p1');\nreturn await agent('a', { prompt: 'OK' });";
    const r = validateScriptEntry(script);
    expect(r.ok).toBe(true);
  });

  it('an arrow function assigned to a const (used as a thunk, e.g. for parallel()) is NOT refused — only a `function` DECLARATION is', () => {
    const script = "const thunk = () => agent('a', {});\nreturn await parallel([thunk]);";
    const r = validateScriptEntry(script);
    expect(r.ok).toBe(true);
  });
});

describe('#154 B1 (phase-alias dup): a non-call reference to agent/phase/parallel/workflow is refused', () => {
  const CASES: Array<[string, string]> = [
    ['phase aliased then called', "const P = phase; P('p1'); return 1;"],
    ['agent aliased then called', "const A = agent; return await A('a', {});"],
    ['parallel aliased then called', "const P = parallel; return await P([]);"],
    ['workflow aliased then called', "const W = workflow; return await W('x', {});"],
    ['agent.call smuggling the call through Function.prototype', "return await agent.call(null, 'a', {});"],
    ['agent passed as a bare value (not called at all)', "function take(x){ return x; } const a = take(agent); return 1;"],
  ];

  for (const [label, script] of CASES) {
    it(`refuses: ${label}`, () => {
      const r = validateScriptEntry(script);
      expect(r.ok, `expected refusal for: ${script}`).toBe(false);
    });
  }

  it('a normal direct call is NOT flagged (no false positive)', () => {
    const script = "phase('p1');\nreturn await agent('a', { prompt: 'OK' });";
    const r = validateScriptEntry(script);
    expect(r.ok).toBe(true);
  });

  it('a ternary routing between two direct agent() calls is NOT flagged (existing documented pattern)', () => {
    const script = "return await (true ? agent('a', {}) : agent('b', {}));";
    const r = validateScriptEntry(script);
    expect(r.ok).toBe(true);
  });

  it('parallel([() => agent(...), ...]) thunks are NOT flagged (existing documented pattern)', () => {
    const script = "return await parallel([() => agent('a', {}), () => agent('b', {})]);";
    const r = validateScriptEntry(script);
    expect(r.ok).toBe(true);
  });

  it('an unrelated object property literally named "agent" is NOT flagged (key position, not a value reference)', () => {
    const script = "const x = { agent: 1 };\nreturn x.agent;";
    const r = validateScriptEntry(script);
    expect(r.ok).toBe(true);
  });

  it('a function PARAMETER named "phase" (shadowing) is NOT flagged — it is a binding, not a reference', () => {
    const script = "function f(phase){ return phase; }\nreturn f(1);";
    // This script still trips the B1a function-declaration check (a top-level `function`), so it
    // is refused for THAT reason — but confirm the refusal names PARSE_ERROR, not a spurious
    // SANDBOX_API_ALIASED firing on the parameter binding itself (which would be a different bug).
    const r = validateScriptEntry(script);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]!.code).toBe('PARSE_ERROR');
  });
});
