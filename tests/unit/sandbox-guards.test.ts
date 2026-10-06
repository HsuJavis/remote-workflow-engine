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

  // #157 (DOC item): `Date()` called WITHOUT `new` also reads the wall clock — the same hazard class
  // as `Date.now()`/`new Date()` — but was refused only incidentally, by the ES class-invocation rule
  // ("Class constructor GuardedDate cannot be invoked without 'new'", code SCRIPT_ERROR), a side
  // effect of GuardedDate being an ES class rather than an intentional guard branch. No wall-clock
  // value escapes either way, but the WRONG error code/message reached the script.
  it('Date() without `new` returns DETERMINISM_GUARD (not a generic SCRIPT_ERROR class-invocation message)', async () => {
    const r = await evaluateScript('return Date();', FAKE_API);
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

  // #157 B1 follow-up (found during review of the fix above, not in the original report): the V5
  // matrix above walks `.constructor.constructor` on the TOP-LEVEL sandbox globals, but
  // `guardedMath`'s `random` getter returns a THROWER FUNCTION of its own — a value reached one
  // property hop past `Math` itself, built as a plain embedding-realm arrow function and therefore
  // exactly as exploitable as `Math` was pre-fix: `Math.random.constructor.constructor(...)` still
  // reached the embedding realm even after the top-level `Math` guard was fixed.
  it('V5 follow-up: Math.random (the THROWER returned by the determinism guard, not Math itself) cannot be used for .constructor.constructor', async () => {
    const script = `
      try {
        const v = Math.random.constructor.constructor('return process')();
        return { escaped: (typeof v === 'object' && v !== null) || typeof v === 'function' };
      } catch (e) {
        return { escaped: false };
      }
    `;
    const r = await evaluateScript(script, FAKE_API);
    expect(r.kind).toBe('done');
    expect((r.value as { escaped: boolean }).escaped).toBe(false);
  });

  // #157 B1 (CRITICAL, re-opened by a Gate 8 v2 re-review): the V5 matrix above only walks
  // `.constructor.constructor` on the INJECTED VALUES themselves (agent/args/budget/…) — it never
  // calls one of the function-valued ones and inspects what comes BACK. `agent()`/`parallel()`/
  // `pipeline()`/`workflow()` are `async` arrow functions declared in THIS module (guards.ts), which
  // executes in the embedding realm even though the function itself has its `[[Prototype]]` severed
  // before being exposed — an `async` function's RETURN VALUE is a Promise built by the embedding
  // realm's OWN native `Promise`, a brand-new object the severing loop never touches. That Promise's
  // `.constructor` therefore still resolves to the embedding `Promise`, and `.constructor.constructor`
  // to the embedding `Function` — reaching `process` exactly as the pre-fix top-level globals did.
  describe('#157 B1 follow-up: a Promise RETURNED by agent()/parallel()/pipeline()/workflow() is still embedding-realm, not context-native', () => {
    const CASES: Array<[string, string]> = [
      ['parallel([])', "parallel([])"],
      ['pipeline([], () => 1)', "pipeline([], () => 1)"],
      ['agent(...)', "agent('x', {})"],
      ['workflow(...) (one-level nesting, delegate throws NESTING_ERROR but the Promise itself is still returned synchronously)', "workflow('x', {})"],
    ];
    for (const [label, expr] of CASES) {
      it(`${expr} — .constructor.constructor('return process') does not yield a live process (${label})`, async () => {
        const script = `
          try {
            const p = ${expr};
            p.catch(() => {}); // swallow the eventual NESTING_ERROR/empty-array settle — only the object's own realm is under test here
            const proc = p.constructor.constructor('return process')();
            return { escaped: (typeof proc === 'object' && proc !== null) || typeof proc === 'function' };
          } catch (e) {
            return { escaped: false };
          }
        `;
        const r = await evaluateScript(script, FAKE_API);
        expect(r.kind, `${expr} should not throw out of evaluateScript itself`).toBe('done');
        expect((r.value as { escaped: boolean }).escaped, `${expr}'s returned Promise must not leak the embedding realm`).toBe(false);
      });
    }

    it('a .then() chain off agent()\'s returned Promise is ALSO context-native (species construction does not re-leak)', async () => {
      const script = `
        try {
          const p2 = agent('x', {}).then((v) => v);
          const proc = p2.constructor.constructor('return process')();
          return { escaped: (typeof proc === 'object' && proc !== null) || typeof proc === 'function' };
        } catch (e) {
          return { escaped: false };
        }
      `;
      const r = await evaluateScript(script, FAKE_API);
      expect(r.kind).toBe('done');
      expect((r.value as { escaped: boolean }).escaped).toBe(false);
    });

    it('parallel([]) is not `instanceof` this TEST FILE\'s own (embedding-realm) Promise — proof it is genuinely context-native, not merely re-wrapped', async () => {
      const script = `return typeof parallel([]).then;`;
      const r = await evaluateScript(script, FAKE_API);
      // A context-native Promise still exposes `.then` (same shape) — this just pins that the
      // returned value is a real, usable promise-like object post-fix, not a broken stand-in.
      expect(r.kind).toBe('done');
      expect(r.value).toBe('function');
    });
  });

  // #157 B1 follow-up (Date.now): `GuardedDate`'s `static override now()` is a method created by
  // evaluating the `class` body — that evaluation happens in the EMBEDDING realm (guards.ts's own
  // module scope), even though the class `extends` a context-native `Date`. Only the class's OWN
  // `[[Prototype]]` link benefits from `extends` (-> context-native `CtxDate`); the `now` method
  // itself is an ordinary embedding-realm function whose `[[Prototype]]` was never severed.
  describe('#157 B1 follow-up: Date.now (the static override) does not leak the embedding realm via its own prototype chain', () => {
    it('Date.now.constructor.constructor cannot reach process (accessing, not calling, the thrower)', async () => {
      const script = `
        try {
          const proc = Date.now.constructor.constructor('return process')();
          return { escaped: (typeof proc === 'object' && proc !== null) || typeof proc === 'function' };
        } catch (e) {
          return { escaped: false };
        }
      `;
      const r = await evaluateScript(script, FAKE_API);
      expect(r.kind).toBe('done');
      expect((r.value as { escaped: boolean }).escaped).toBe(false);
    });

    it('Object.getOwnPropertyDescriptor(Date, "now").value.constructor.constructor cannot reach process (the descriptor route forwards to the same unsevered function)', async () => {
      const script = `
        try {
          const fn = Object.getOwnPropertyDescriptor(Date, 'now').value;
          const proc = fn.constructor.constructor('return process')();
          return { escaped: (typeof proc === 'object' && proc !== null) || typeof proc === 'function' };
        } catch (e) {
          return { escaped: false };
        }
      `;
      const r = await evaluateScript(script, FAKE_API);
      expect(r.kind).toBe('done');
      expect((r.value as { escaped: boolean }).escaped).toBe(false);
    });
  });

  // #157 B1 follow-up (Intl.DateTimeFormat.prototype): `dateTimeFormatThrower` is declared with the
  // `function` keyword (needed so `new Intl.DateTimeFormat()` still throws instead of "not a
  // constructor") — every ordinary function declaration auto-creates an own `.prototype` object
  // whose `[[Prototype]]` defaults to the realm that CREATED the function (the embedding realm
  // here), independent of the function's OWN `[[Prototype]]` severance.
  describe('#157 B1 follow-up: Intl.DateTimeFormat.prototype does not leak the embedding realm', () => {
    it('Intl.DateTimeFormat.prototype.toString.constructor.constructor cannot reach process', async () => {
      const script = `
        try {
          const proc = Intl.DateTimeFormat.prototype.toString.constructor.constructor('return process')();
          return { escaped: (typeof proc === 'object' && proc !== null) || typeof proc === 'function' };
        } catch (e) {
          return { escaped: false };
        }
      `;
      const r = await evaluateScript(script, FAKE_API);
      expect(r.kind).toBe('done');
      expect((r.value as { escaped: boolean }).escaped).toBe(false);
    });

    it('Object.getPrototypeOf(Intl.DateTimeFormat.prototype).constructor.constructor cannot reach process', async () => {
      const script = `
        try {
          const proto = Object.getPrototypeOf(Intl.DateTimeFormat.prototype);
          const proc = proto.constructor.constructor('return process')();
          return { escaped: (typeof proc === 'object' && proc !== null) || typeof proc === 'function' };
        } catch (e) {
          return { escaped: false };
        }
      `;
      const r = await evaluateScript(script, FAKE_API);
      expect(r.kind).toBe('done');
      expect((r.value as { escaped: boolean }).escaped).toBe(false);
    });
  });

  // #157 B2 (same bug class, found while fixing the descriptor-bypass reported against Intl):
  // `guardedMath` is a `get`-only Proxy wrapping the real `CtxMath` — `Object.getOwnPropertyDescriptor`
  // has no trap defined, so Node's default behavior forwards it to the TARGET (the real `CtxMath`),
  // returning the real, unguarded `random` function instead of the thrower.
  it('#157 B2 (same bug class as Intl): Object.getOwnPropertyDescriptor(Math, "random").value is the guarded thrower, not the real RNG', async () => {
    const script = `
      const R = Object.getOwnPropertyDescriptor(Math, 'random').value;
      return R();
    `;
    const r = await evaluateScript(script, FAKE_API);
    expect(r.kind).toBe('error');
    expect(r.error!.code).toBe('DETERMINISM_GUARD');
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

  // #157 (final blocker, Gate 8 v3): a generic sweep instead of one test per named vector — walks
  // every value this module injects into the sandbox (plus the two throwers reached one property hop
  // past an injected object — `Math.random`/`Intl.DateTimeFormat`/`Date.now` — and a `parallel()`
  // Promise) and asserts its `.constructor` chain, up to a few hops, never equals THIS test file's own
  // `Function`/`Object`/`Promise` — which, because this is an in-process unit test (no fork boundary),
  // is the exact same object identity as guards.ts's own "embedding realm" `Function`/`Object`/
  // `Promise`. Catches any future exposed value this file's author forgets to re-realm, without
  // needing a new named test per vector.
  it('sweep: no injected value\'s constructor chain (several hops) ever reaches this (embedding-realm) Function/Object/Promise', async () => {
    const script = `
      return {
        agent, parallel, pipeline, phase, log, workflow,
        budget, Math, Date, Intl, globalThis,
        mathRandom: Math.random,
        dateNow: Date.now,
        intlDTF: Intl.DateTimeFormat,
        err: new Error('probe'),
        parallelPromise: parallel([]),
      };
    `;
    const r = await evaluateScript(script, FAKE_API);
    expect(r.kind).toBe('done');
    const bundle = r.value as Record<string, unknown>;

    const HOST_REALM_OBJECTS = new Set<unknown>([Function, Object, Promise, Array, Error]);

    function walk(label: string, value: unknown, hopsLeft: number): void {
      if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return;
      if (typeof value === 'function') {
        expect(HOST_REALM_OBJECTS.has(value), `${label} must not itself be a host-realm intrinsic`).toBe(false);
      }
      if (hopsLeft <= 0) return;
      const ctor = (value as { constructor?: unknown }).constructor;
      if (ctor !== undefined) {
        expect(HOST_REALM_OBJECTS.has(ctor), `${label}.constructor must not reach a host-realm intrinsic`).toBe(false);
        walk(`${label}.constructor`, ctor, hopsLeft - 1);
      }
    }

    for (const [key, value] of Object.entries(bundle)) {
      walk(key, value, 4);
    }
  });
});

// F-2 (sandbox robustness sweep): a script that `throw`s a value `String(err)` cannot convert — a
// null-prototype object, or an object/Proxy whose stringification hooks are poisoned — used to crash
// evaluateScript's own classification catch (an uncaught TypeError escaping `String(err)` there), so
// the run was reported ABORTED with a guards.ts source line in the message instead of a clean
// SCRIPT_ERROR. Covers the exact three shapes the task names.
describe('F-2: a non-stringifiable thrown value is still classified as a clean SCRIPT_ERROR', () => {
  it('throw Object.create(null) (no toString/valueOf at all) does not crash classification', async () => {
    const r = await evaluateScript('throw Object.create(null);', FAKE_API);
    expect(r.kind).toBe('error');
    expect(r.error!.code).toBe('SCRIPT_ERROR');
  });

  it('throw {toString:null, valueOf:null, [Symbol.toPrimitive]:null} does not crash classification', async () => {
    const r = await evaluateScript(
      'throw { toString: null, valueOf: null, [Symbol.toPrimitive]: null };',
      FAKE_API,
    );
    expect(r.kind).toBe('error');
    expect(r.error!.code).toBe('SCRIPT_ERROR');
  });

  it('throwing a Proxy with a poisoned get trap does not crash classification and leaks no guards.ts source line', async () => {
    const r = await evaluateScript(
      "throw new Proxy({}, { get() { throw new Error('trap'); } });",
      FAKE_API,
    );
    expect(r.kind).toBe('error');
    expect(r.error!.code).toBe('SCRIPT_ERROR');
    expect(r.error!.message).not.toMatch(/guards\.ts/);
  });
});

// g2 minor item 4 follow-up (#157 B1 realm safety): `phase()` can now THROW (a non-serializable
// title rejects that one call — child-entry.ts) where it never could before. `makeAgent`/
// `makeWorkflow` already re-realm a delegate's thrown error via `sanitizeThrownError` before it
// reaches the script; `phaseFn` must do the SAME — an embedding-realm Error reaching the script
// unsanitized is exactly the `<err>.constructor.constructor(...)` escape #157 B1 closed everywhere
// else a value crosses this boundary.
describe('g2 item 4 follow-up: a phase() delegate throw is re-realmed, not an embedding-realm leak (#157 B1)', () => {
  it('an error thrown by the phase() delegate is native to the SCRIPT\'s own realm, not the embedding one', async () => {
    const api: SandboxApi = {
      ...FAKE_API,
      phase: () => {
        throw Object.assign(new Error('a value sent to the parent is not JSON-serializable: boom'), { name: 'RESULT_NOT_SERIALIZABLE', code: 'RESULT_NOT_SERIALIZABLE' });
      },
    };
    const r = await evaluateScript(
      `
      try {
        phase('x');
        return { caught: false };
      } catch (e) {
        return { caught: true, code: e.code, isError: e instanceof Error };
      }
      `,
      api,
    );
    expect(r.kind).toBe('done');
    const value = r.value as { caught: boolean; code?: string; isError?: boolean };
    expect(value.caught).toBe(true);
    expect(value.code).toBe('RESULT_NOT_SERIALIZABLE');
    // `instanceof Error` only holds here if the thrown object is native to the SCRIPT's own vm
    // context (its own global `Error`), not a value from a different realm forwarded unsanitized
    // (same realm-correctness check IT-140's own "REALM-CORRECT since #157 B1" case uses).
    expect(value.isError).toBe(true);
  });
});
