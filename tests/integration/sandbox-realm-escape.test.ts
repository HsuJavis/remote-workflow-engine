// Issue #157 B1 (CRITICAL): `<injected>.constructor.constructor` reaches the sandbox child's REAL
// process/fetch/env — not a neutered context copy. Reproduced end-to-end through the real
// SandboxHost (the actual fork() boundary), not just in-process against evaluateScript, because the
// evidence that mattered was that the forked child inherits the engine's full process.env (where
// provider API keys live, per main.ts) with no `env:` override on fork() — an in-process-only test
// cannot observe that at all.
//
// Root cause (confirmed by code inspection before this fix): guards.ts's `sandbox` object literal
// assigned host-realm-created functions/objects (`api.agent.bind(api)`, the Math/Date guards, etc.)
// directly as vm context globals. `vm.createContext()` does not re-realm an externally-created
// object's prototype chain, so `<injected>.constructor` resolves to the HOST Function constructor
// regardless of what the injected value's OWN logic does — `agent.constructor.constructor('return
// process')()` returns the live process object because `agent`'s prototype chain (via
// Function.prototype, set when `.bind()` ran in the embedding realm) was never severed from that
// realm. The control case (`Function('return process')()`, no injected object involved) correctly
// throws ReferenceError, proving the context's OWN realm has always been isolated — the leak was
// specifically through objects CREATED in the host realm and handed into the context as properties.
//
// RED before the fix: every "process leaks" / "fetch leaks" case below resolves with a live handle
// (a real pid, a callable fetch) instead of throwing/being unreachable.
//
// Mock policy (integration, DES-015): the REAL SandboxHost forks the REAL child process and runs
// the REAL vm guards — nothing about the sandbox is faked. `onAgentRequest` is stubbed (dry-run,
// DES-006's documented seam) since no agent dispatch is needed to exercise the escape — the escape
// fires at script evaluation, before any agent() call completes.
import { describe, it, expect } from 'vitest';
import { SandboxHost } from '../../src/sandbox/host.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const WORK_DIR = join(tmpdir(), 'rwe-157b1-realm-escape');
const SENTINEL = 'RWE_157_SENTINEL_SECRET';

function freshHost(): SandboxHost {
  return new SandboxHost({ workspaceRoot: WORK_DIR, onAgentRequest: async () => 'stub' });
}

function resultOf(r: unknown): unknown {
  if (!(r && typeof r === 'object' && 'result' in r)) {
    throw new Error(`script did not complete cleanly: ${JSON.stringify(r)}`);
  }
  return (r as { result: unknown }).result;
}

describe('#157 B1: .constructor.constructor cannot reach the real child process (real fork boundary)', () => {
  it('agent.constructor.constructor("return process")() does not yield a live process object', async () => {
    const script = `
      try {
        const proc = agent.constructor.constructor('return process')();
        return { escaped: true, hasPid: typeof proc === 'object' && proc !== null && typeof proc.pid === 'number' };
      } catch (e) {
        return { escaped: false, errorName: e.name };
      }
    `;
    const r = await freshHost().run('it157-agent-process', script, {}, null);
    const dump = resultOf(r) as { escaped: boolean; hasPid?: boolean; errorName?: string };
    expect(dump.escaped).toBe(false);
  });

  it('args.constructor.constructor("return process")() does not yield a live process object either — not limited to agent', async () => {
    const script = `
      try {
        const proc = args.constructor.constructor('return process')();
        return { escaped: true, hasPid: typeof proc === 'object' && proc !== null && typeof proc.pid === 'number' };
      } catch (e) {
        return { escaped: false, errorName: e.name };
      }
    `;
    const r = await freshHost().run('it157-args-process', script, { k: 1 }, null);
    const dump = resultOf(r) as { escaped: boolean };
    expect(dump.escaped).toBe(false);
  });

  it('budget.constructor.constructor("return process")() does not yield a live process object', async () => {
    const script = `
      try {
        const proc = budget.constructor.constructor('return process')();
        return { escaped: true };
      } catch (e) {
        return { escaped: false, errorName: e.name };
      }
    `;
    const r = await freshHost().run('it157-budget-process', script, {}, 500);
    const dump = resultOf(r) as { escaped: boolean };
    expect(dump.escaped).toBe(false);
  });

  it('agent.constructor.constructor("return fetch")() does not yield a callable fetch (no network reachable via the escape)', async () => {
    const script = `
      try {
        const f = agent.constructor.constructor('return fetch')();
        return { escaped: true, isFunction: typeof f === 'function' };
      } catch (e) {
        return { escaped: false, errorName: e.name };
      }
    `;
    const r = await freshHost().run('it157-agent-fetch', script, {}, null);
    const dump = resultOf(r) as { escaped: boolean };
    expect(dump.escaped).toBe(false);
  });

  it('even IF the escape fired, the sentinel set only in THIS test process must not be readable (defense in depth / env scrub)', async () => {
    process.env[SENTINEL] = 'leaked-if-you-can-read-this';
    try {
      const script = `
        try {
          const proc = agent.constructor.constructor('return process')();
          return { sawSentinel: !!(proc && proc.env && proc.env.${SENTINEL}) };
        } catch (e) {
          return { sawSentinel: false, blocked: true };
        }
      `;
      const r = await freshHost().run('it157-sentinel', script, {}, null);
      const dump = resultOf(r) as { sawSentinel: boolean };
      expect(dump.sawSentinel).toBe(false);
    } finally {
      delete process.env[SENTINEL];
    }
  });

  it('Math.constructor.constructor("return process")() does not yield a live process object (same root cause, not just agent/args)', async () => {
    const script = `
      try {
        const proc = Math.constructor.constructor('return process')();
        return { escaped: true };
      } catch (e) {
        return { escaped: false, errorName: e.name };
      }
    `;
    const r = await freshHost().run('it157-math-process', script, {}, null);
    const dump = resultOf(r) as { escaped: boolean };
    expect(dump.escaped).toBe(false);
  });

  it('control case: the bare Function global (no injected object) stays isolated, as before the fix', async () => {
    const script = `
      try {
        const proc = Function('return process')();
        return { escaped: true };
      } catch (e) {
        return { escaped: false, errorName: e.name };
      }
    `;
    const r = await freshHost().run('it157-control', script, {}, null);
    const dump = resultOf(r) as { escaped: boolean; errorName?: string };
    expect(dump.escaped).toBe(false);
    // #157 (final blocker): this used to be ReferenceError (the context-native Function successfully
    // generated the code and ran it, but `process` is simply absent from the context) — the context
    // is now created with `codeGeneration: { strings: false } }`, which denies calling `Function` with
    // a string body AT ALL, earlier in the pipeline than `process` ever gets referenced. The control
    // case's own point (no injected object needed to stay isolated) still holds; the specific error
    // class is a stronger-by-construction side effect of that unrelated, additional hardening.
    expect(dump.errorName).toBe('EvalError');
  });

  it('a normal script (no escape attempt) still runs and returns its value — the fix does not break ordinary scripts', async () => {
    const r = await freshHost().run('it157-sanity', 'return 1 + 1;', {}, null);
    expect(resultOf(r)).toBe(2);
  });

  // #157 B1 (Gate 8 v2 re-review, through the REAL fork boundary): this file above only probes the
  // literal injected VALUES (agent/args/budget/Math); a Promise RETURNED by calling one of the
  // function-valued ones is a separate object the first round of hardening never re-realmed, and it
  // reaches this same real child process's `process`/`fetch`.
  it('parallel([]).constructor.constructor("return process")() does not yield a live process (returned-Promise vector, real fork)', async () => {
    const script = `
      try {
        const p = parallel([]);
        const proc = p.constructor.constructor('return process')();
        return { escaped: typeof proc === 'object' && proc !== null && typeof proc.pid === 'number' };
      } catch (e) {
        return { escaped: false };
      }
    `;
    const r = await freshHost().run('it157-parallel-promise-process', script, {}, null);
    expect((resultOf(r) as { escaped: boolean }).escaped).toBe(false);
  });

  it('typeof process read off a Promise returned by parallel() is "undefined" through the real fork (not merely non-throwing)', async () => {
    const script = `
      const p = parallel([]);
      try {
        return { kind: typeof p.constructor.constructor('return typeof process')() };
      } catch (e) {
        return { kind: 'threw' };
      }
    `;
    const r = await freshHost().run('it157-parallel-promise-typeof', script, {}, null);
    expect((resultOf(r) as { kind: string }).kind).not.toBe('object');
  });
});

// Issue #157 — final blocker (Gate 8 v3 re-review): every value injected directly into `sandbox`
// (agent/args/budget/parallel/Math, the file above) was re-realmed, but the vm context's own GLOBAL
// OBJECT — `const sandbox = {}` in guards.ts, created in the EMBEDDING realm before being handed to
// `vm.createContext()` — kept the embedding realm's own `Object.prototype` on its `[[Prototype]]`
// slot. `vm.createContext()` does not rewrite an externally-created object's existing prototype link,
// so the script's own top-level `this` (and `globalThis`, the same object) resolved `.constructor` to
// the embedding (sandbox child process) `Object`, whose own `.constructor` is the embedding `Function`
// — closing every injected PROPERTY's own escape route left the GLOBAL OBJECT ITSELF open. Fixed by
// (1) compiling the script body as a strict-mode function (bare-call `this` is `undefined`, not
// coerced to the global object) and (2) reparenting `sandbox`'s own `[[Prototype]]` to the context's
// OWN native `Object.prototype` (fetched via `vm.runInContext`) so even `globalThis.constructor` now
// resolves inside the context realm, where `codeGeneration: { strings: false }` additionally blocks
// calling the (context-native, otherwise harmless) `Function`/`eval` with a string body at all.
//
// RED before the fix: every case in this block resolves with a live host-process/Function handle
// instead of throwing/being blocked.
describe('#157 (final blocker): the script\'s own top-level `this`/`globalThis` no longer reaches the embedding realm', () => {
  it('bare `this.constructor.constructor("return process")()` does not yield a live process object', async () => {
    const script = `
      try {
        const F = this.constructor.constructor;
        const p = F('return process')();
        return { escaped: true, hasPid: typeof p === 'object' && p !== null && typeof p.pid === 'number' };
      } catch (e) {
        return { escaped: false, errorName: e.name };
      }
    `;
    const r = await freshHost().run('it157-bare-this', script, {}, null);
    const dump = resultOf(r) as { escaped: boolean };
    expect(dump.escaped).toBe(false);
  });

  it('eval("this.constructor.constructor(\'return process\')()") does not yield a live process object', async () => {
    const script = `
      try {
        const p = eval("this.constructor.constructor('return process')()");
        return { escaped: true };
      } catch (e) {
        return { escaped: false, errorName: e.name };
      }
    `;
    const r = await freshHost().run('it157-eval-string', script, {}, null);
    const dump = resultOf(r) as { escaped: boolean; errorName?: string };
    expect(dump.escaped).toBe(false);
    // codeGeneration:{strings:false} on the context must be WHY this throws, not an incidental
    // ReferenceError on `process` inside a context-native eval — EvalError is the specific signal.
    expect(dump.errorName).toBe('EvalError');
  });

  it('globalThis.constructor.constructor("return process")() does not yield a live process object', async () => {
    const script = `
      try {
        const F = globalThis.constructor.constructor;
        const p = F('return process')();
        return { escaped: true };
      } catch (e) {
        return { escaped: false, errorName: e.name };
      }
    `;
    const r = await freshHost().run('it157-globalthis-ctor', script, {}, null);
    const dump = resultOf(r) as { escaped: boolean };
    expect(dump.escaped).toBe(false);
  });

  it('globalThis.constructor.constructor is a FUNCTION (the context\'s own, harmless Function) but calling it with a string body throws', async () => {
    // Distinguishes "globalThis's prototype chain is now context-native" (expected, harmless) from
    // "globalThis's prototype chain still reaches the host" (the bug) — the context's own Function
    // exists and is reachable, it is just inert against string code generation.
    const script = `
      const F = globalThis.constructor.constructor;
      return { isFunction: typeof F === 'function' };
    `;
    const r = await freshHost().run('it157-globalthis-ctor-identity', script, {}, null);
    expect((resultOf(r) as { isFunction: boolean }).isFunction).toBe(true);
  });

  for (const name of ['phase', 'workflow', 'Date', 'Intl']) {
    it(`${name}.constructor.constructor("return process")() does not yield a live process object`, async () => {
      const script = `
        try {
          const proc = ${name}.constructor.constructor('return process')();
          return { escaped: true };
        } catch (e) {
          return { escaped: false, errorName: e.name };
        }
      `;
      const r = await freshHost().run(`it157-${name}-process`, script, {}, null);
      const dump = resultOf(r) as { escaped: boolean };
      expect(dump.escaped).toBe(false);
    });
  }

  it('import() of a core module is refused, not silently granted', async () => {
    const script = `
      try {
        const m = await import('node:fs');
        return { escaped: true, hasModule: !!m };
      } catch (e) {
        return { escaped: false, errorName: e.name };
      }
    `;
    const r = await freshHost().run('it157-dynamic-import', script, {}, null);
    const dump = resultOf(r) as { escaped: boolean };
    expect(dump.escaped).toBe(false);
  });

  it('Error.prepareStackTrace cannot be reassigned by script (the classic CallSite/getFunction() stack-walking escape)', async () => {
    const script = `
      try {
        Error.prepareStackTrace = () => 'hacked';
        return { blocked: false };
      } catch (e) {
        return { blocked: true, errorName: e.name };
      }
    `;
    const r = await freshHost().run('it157-prepare-stack-trace', script, {}, null);
    const dump = resultOf(r) as { blocked: boolean; errorName?: string };
    expect(dump.blocked).toBe(true);
    expect(dump.errorName).toBe('TypeError');
  });

  it('Error.captureStackTrace still works normally (not removed) but exposes no live function handle', async () => {
    const script = `
      try {
        const o = {};
        Error.captureStackTrace(o);
        return { ok: typeof o.stack === 'string', leaked: typeof o.stack === 'object' };
      } catch (e) {
        return { ok: false, errorName: e.name };
      }
    `;
    const r = await freshHost().run('it157-capture-stack-trace', script, {}, null);
    const dump = resultOf(r) as { ok: boolean; leaked?: boolean };
    expect(dump.ok).toBe(true);
    expect(dump.leaked).toBe(false);
  });

  it('arguments.callee.caller throws (strict mode) instead of handing back a live caller function', async () => {
    const script = `
      function probe() {
        return arguments.callee.caller;
      }
      try {
        const c = probe();
        return { escaped: true, type: typeof c };
      } catch (e) {
        return { escaped: false, errorName: e.name };
      }
    `;
    const r = await freshHost().run('it157-arguments-callee', script, {}, null);
    const dump = resultOf(r) as { escaped: boolean; errorName?: string };
    expect(dump.escaped).toBe(false);
    expect(dump.errorName).toBe('TypeError');
  });

  it('a Proxy trap wrapped around an injected object (agent) gains no new capability', async () => {
    const script = `
      try {
        const p = new Proxy(agent, {
          get(target, prop) {
            return Reflect.get(target, prop);
          },
        });
        const F = p.constructor.constructor;
        const proc = F('return process')();
        return { escaped: true };
      } catch (e) {
        return { escaped: false, errorName: e.name };
      }
    `;
    const r = await freshHost().run('it157-proxy-trap', script, {}, null);
    const dump = resultOf(r) as { escaped: boolean };
    expect(dump.escaped).toBe(false);
  });

  it('Symbol.for(...).constructor.constructor("return process")() does not yield a live process object', async () => {
    const script = `
      try {
        const s = Symbol.for('rwe-157-probe');
        const F = s.constructor.constructor;
        const proc = F('return process')();
        return { escaped: true };
      } catch (e) {
        return { escaped: false, errorName: e.name };
      }
    `;
    const r = await freshHost().run('it157-symbol-for', script, {}, null);
    const dump = resultOf(r) as { escaped: boolean };
    expect(dump.escaped).toBe(false);
  });

  it('a normal script (no escape attempt) still runs to completion after the global-object fix', async () => {
    const r = await freshHost().run('it157-final-sanity', 'return 1 + 1;', {}, null);
    expect(resultOf(r)).toBe(2);
  });
});
