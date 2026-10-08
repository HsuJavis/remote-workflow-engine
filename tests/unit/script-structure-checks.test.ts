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

  // #157 DOC phase-alias (Gate 8 v2 re-review): `globalThis.phase`/`this.agent` ARE the sandbox
  // global under another name — the `x.agent` exemption above only holds for `x` that is NOT the
  // sandbox global itself. Confirmed through a real engine: `const P = globalThis.phase;
  // P('undeclared-lane');` registered clean and ran to completion with an undeclared phase lane.
  describe('#157 DOC phase-alias: globalThis.<api>/this.<api> is the sandbox global, not an unrelated property', () => {
    const CASES: Array<[string, string]> = [
      ['globalThis.phase aliased then called', "const P = globalThis.phase; P('p1'); return 1;"],
      ['globalThis.agent called directly (still invisible to the text scanners, which exclude anything preceded by `.`)', "return await globalThis.agent('a', {});"],
      ['this.agent aliased then called (top-level `this` is the sandbox global in a classic script)', "const A = this.agent; return await A('a', {});"],
      ['globalThis computed string-literal access', "const P = globalThis['phase']; P('p1'); return 1;"],
    ];
    for (const [label, script] of CASES) {
      it(`refuses: ${label}`, () => {
        const r = validateScriptEntry(script);
        expect(r.ok, `expected refusal for: ${script}`).toBe(false);
        if (!r.ok) expect(r.errors[0]!.code).toBe('SCRIPT_INVALID');
      });
    }

    it('an unrelated object\'s .agent property is still NOT flagged (globalThis/this only, no over-refusal)', () => {
      const script = "const x = { agent: 1 };\nreturn x.agent;";
      const r = validateScriptEntry(script);
      expect(r.ok).toBe(true);
    });
  });

  // #154 B2 (Gate 8 v2 re-review): a call form the registration-time TEXT scanners (`AGENT_CALL_RE`
  // et al., which require the literal substring `name(` with at most plain whitespace in between)
  // cannot see, even though the AST alias-check's OLD "direct callee" exemption let it straight
  // through. Confirmed through a real engine: `agent?.('a', {prompt, ...extra})` dispatched with a
  // spread-smuggled options object (`allowedTools`/`timeoutMs`/`retries`) that no static check — not
  // `AGENT_OPTS_SPREAD`, not the mermaid tool list, not the BASH_* checks — ever examined, because
  // none of them ever saw this call at all.
  describe('#154 B2: a call form hidden from registration-time text scanning is refused, not silently allowed', () => {
    const CASES: Array<[string, string]> = [
      ['optional chaining (`agent?.(`)', "return await agent?.('a', {});"],
      ['parenthesized callee (`(agent)(`)', "return await (agent)('a', {});"],
      ['a block comment between the name and the paren', "return await agent/* hide */('a', {});"],
    ];
    for (const [label, script] of CASES) {
      it(`refuses: ${label}`, () => {
        const r = validateScriptEntry(script);
        expect(r.ok, `expected refusal for: ${script}`).toBe(false);
        if (!r.ok) expect(r.errors[0]!.code).toBe('SCRIPT_INVALID');
      });
    }

    it('plain whitespace before the paren is NOT flagged (the text scanners already tolerate `\\s*`, no over-refusal)', () => {
      const script = "return await agent ('a', { prompt: 'OK' });";
      const r = validateScriptEntry(script);
      expect(r.ok).toBe(true);
    });
  });
});

// Issue #154 B1 (re-opened by a Gate 8 v2 re-review): `checkTopLevelFunctionWrapper` only refuses a
// top-level `function`/`async function` STATEMENT — an arrow assigned to a `const` and never called,
// or a `function` DECLARATION nested inside a block (not at the top level) and never called, both
// still registered clean through a real engine and ran to "completed" with zero agents dispatched.
//
// RED before this fix: every "refuses" case below registers clean (`validateScriptEntry` returns
// `{ok:true}`) despite the agent()/phase() call inside it never actually running.
describe('#154 B1 (re-opened): an agent()/phase() call inside a function that is never demonstrably invoked is refused', () => {
  const REFUSED: Array<[string, string]> = [
    ['an uncalled const-bound async arrow ("fnarrow", the exact real-engine repro)', "const main = async () => { phase('p1'); return await agent('a', {prompt: 'OK', allowedTools: []}) }; return 1;"],
    ['an uncalled function declaration nested in a block, not at the top level ("fnblock", the exact real-engine repro)', "{ async function main(){ phase('p1'); return await agent('a', {prompt: 'OK'}); } }\nreturn 1;"],
    ['an uncalled const-bound async FUNCTION EXPRESSION (not even an arrow)', "const main = async function(){ return await agent('a', {}); };\nreturn 1;"],
  ];
  for (const [label, script] of REFUSED) {
    it(`refuses: ${label}`, () => {
      const r = validateScriptEntry(script);
      expect(r.ok, `expected refusal for: ${script}`).toBe(false);
      if (!r.ok) expect(r.errors.map((e) => e.code)).toContain('SCRIPT_INVALID');
    });
  }

  const ACCEPTED: Array<[string, string]> = [
    ['a script with no function wrapper at all (no false positive)', "phase('p1');\nreturn await agent('a', { prompt: 'OK' });"],
    ['an arrow assigned to a const that IS called by name', "const main = async () => { phase('p1'); return await agent('a', {}); };\nreturn await main();"],
    ['an arrow assigned to a const used as a parallel() thunk (existing documented pattern)', "const thunk = () => agent('a', {});\nreturn await parallel([thunk]);"],
    ['inline arrow thunks passed directly to parallel() (existing documented pattern)', "return await parallel([() => agent('a', {}), () => agent('b', {})]);"],
    ['a const-bound arrow passed BY NAME as a pipeline() stage', "const stage = (prev, item) => agent('a', {});\nreturn await pipeline([1], stage);"],
    ['an immediately-invoked function expression', "return await (async () => { phase('p1'); return await agent('a', {}); })();"],
    ['a ternary routing between two direct agent() calls (existing documented pattern)', "return await (true ? agent('a', {}) : agent('b', {}));"],
  ];
  for (const [label, script] of ACCEPTED) {
    it(`does NOT refuse: ${label}`, () => {
      const r = validateScriptEntry(script);
      expect(r.ok, `expected acceptance for: ${script} (got ${r.ok ? '' : JSON.stringify(r.errors)})`).toBe(true);
    });
  }

  // issue #154 B4 follow-up (2026-10-09 re-verification, "NEW-2"/"dead-branch helper"): a name
  // referenced only from a branch that can never execute at run time still counts as "referenced"
  // under the plain NAME CENSUS this check deliberately uses (checkAgentCallReachability's own doc:
  // "dead code reached only via control flow ... is out of scope — it is not a function at all, so
  // there is no binding name to census"). This is NOT a gap introduced by this fix and NOT something
  // this fix changes — pinned here as a documented, intentional acceptance (own test, not folded
  // into ACCEPTED above) so a future change to the census rule notices it is touching this tradeoff.
  it('ACCEPTED BY DESIGN (known residual, not a defect): a name called only from an always-false branch still registers clean — no reachability analysis of control flow is performed', () => {
    const script = "const main = async () => { phase('p1'); return await agent('a', {prompt: 'OK', allowedTools: []}); };\nif (false) { await main(); }\nreturn 1;";
    const r = validateScriptEntry(script);
    expect(r.ok, `expected acceptance (by design) for: ${script} (got ${r.ok ? '' : JSON.stringify(r.errors)})`).toBe(true);
  });
});
