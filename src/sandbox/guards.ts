// Sandbox VM evaluation (DES-005 / TASK-007).
// evaluateScript runs a workflow script in a restricted VM context, enforcing the
// determinism/parse/size/nesting/item-cap guards from the compat spec (DES-005/DES-013).
import * as vm from 'node:vm';
import type { Budget } from '../types.js';

// ── `export const meta = {…}` locator (compat-spec §1) ──────────────────────────────────────────
// Defined HERE (not a separate module) on purpose: guards.ts is loaded by the sandbox CHILD
// (child-entry.ts, run under `node --experimental-transform-types`, which does NOT resolve `.js`→
// `.ts` for value imports the way the tsx main process does), yet guards.ts IS type-checked by tsc
// (child-entry.ts is the only file tsconfig excludes). A cross-file value import satisfies at most
// one of those two — inlining satisfies both. Exported for the submission validator + tests (main
// process) to reuse the SAME scanner, so submission-time and run-time meta handling never diverge.

export interface MetaCheck {
  /** true when an `export const meta =` declaration is present at all. */
  found: boolean;
  /** the full `export const meta = {…}[;]` text to strip from the executed body (when found+parsed). */
  span?: string;
  /** the `{…}` object literal text (when found+parsed). */
  objectText?: string;
  /** true only when meta is a pure object literal (no template literal / spread outside strings). */
  pureLiteral?: boolean;
}

const META_DECL_RE = /export\s+const\s+meta\s*=\s*/;

/** Locates `export const meta = {…}` with a STRING-AWARE brace scan (the object's string values
 *  routinely contain `;`, `{`, `}`), and flags a template literal / spread only when it appears
 *  OUTSIDE a string. Replaces a prior `/[^;]*;/` regex that truncated the object at the first
 *  in-string semicolon and wrongly rejected legitimate workflows (e.g. iso-agile-sdlc's sdlc-run.js
 *  whose description is full of semicolons). */
export function checkMeta(script: string): MetaCheck {
  const m = META_DECL_RE.exec(script);
  if (!m) return { found: false };
  const objStart = m.index + m[0].length;
  if (script[objStart] !== '{') return { found: true, pureLiteral: false }; // not an object literal
  let depth = 0;
  let str: string | null = null;
  let impure = false;
  let i = objStart;
  for (; i < script.length; i++) {
    const c = script[i];
    if (str !== null) {
      if (c === '\\') { i++; continue; }
      if (c === str) str = null;
      continue;
    }
    if (c === "'" || c === '"') { str = c; continue; }
    if (c === '`') { impure = true; str = '`'; continue; }
    if (c === '{') { depth++; continue; }
    if (c === '}') { depth--; if (depth === 0) { i++; break; } continue; }
    if (c === '.' && script[i + 1] === '.' && script[i + 2] === '.') impure = true;
  }
  if (depth !== 0) return { found: true, pureLiteral: false };
  const objectText = script.slice(objStart, i);
  let end = i;
  while (end < script.length && /\s/.test(script[end]!)) end++;
  if (script[end] === ';') end++;
  return { found: true, span: script.slice(m.index, end), objectText, pureLiteral: !impure };
}

export interface ScriptResult {
  kind: 'done' | 'error';
  value?: unknown;
  error?: { code: string; message: string; refusalRef?: number };
}

export interface SandboxApi {
  /** Called when the script calls agent() — marshalled to the parent via IPC. */
  agent(prompt: string, opts?: unknown): Promise<unknown>;
  /** args value injected by the parent init message. */
  args: unknown;
  /** Read-only budget view. */
  budget: Budget;
  /** Optional: run a named/ref'd workflow inline. Absent (or throwing) at nested levels → NESTING_ERROR. */
  workflow?(nameOrRef: unknown, args?: unknown): Promise<unknown>;
  /** Optional: forwards phase(title) calls to the parent for observability (DES-006/DES-008). */
  phase?(title: string): void;
}

const MAX_SCRIPT_BYTES = 512 * 1024;
const MAX_ITEMS = 4096;

// v26 (DES-187, ARCH-121, TASK-193, REQ-130/121/127/001): the sandbox's exposed globals, as DATA —
// the authoring guide (src/authoring-guide.ts) renders this list instead of re-typing one that can
// drift from the `sandbox` object literal `evaluateScript` actually constructs below. Exports only
// — no new value import enters this file, which the sandbox CHILD also loads (see the checkMeta
// note at the top: it does not resolve `.js`→`.ts` for value imports).
export const SANDBOX_GLOBALS = ['agent', 'parallel', 'pipeline', 'phase', 'log', 'args', 'budget', 'workflow', 'Date', 'Math', 'Intl'] as const;

/** One of the three calls `guardedDate`/`guardedMath` above refuse, plus the guide-facing reasoning
 *  DES-187 asks for: WHY it is refused (the resume-replay hazard both guards share) and INSTEAD
 *  (what an author writes to get the same value safely). */
export interface DeterminismGuard {
  /** a script fragment that trips the guard when evaluated. */
  call: string;
  why: string;
  instead: string;
}

export const DETERMINISM_GUARDED: readonly DeterminismGuard[] = [
  {
    call: 'Date.now()', // det:allow — the guard TABLE names the API it blocks inside a script; this file calls none of them
    why: "resume replays agent() calls keyed by prompt+opts, so a wall-clock value baked into that key would change it on replay and re-dispatch an already-paid call.",
    instead: 'read a timestamp off run_status/run_result, or pass one in via args.',
  },
  {
    call: 'Math.random()', // det:allow — guard-table literal, not a call
    why: 'the same replay-key hazard as Date.now() — a random value baked into the key changes on every run.', // det:allow — guard-table literal, not a call
    instead: 'pass a seed in via args.',
  },
  {
    call: 'new Date()', // det:allow — guard-table literal, not a call
    why: 'called with no arguments this reads the wall clock, the same hazard as Date.now().',
    instead: "pass an argument — new Date('2026-01-01') is allowed.",
  },
  {
    // #157 B2: `new Intl.DateTimeFormat(...)` / `Intl.DateTimeFormat(...)` (no `new`) are both
    // refused — construction itself is blocked, so no instance (and therefore no `.format()`/
    // `.formatToParts()`/`.resolvedOptions()`) is ever reachable.
    call: 'new Intl.DateTimeFormat()', // det:allow — guard-table literal, not a call
    why: 'Intl.DateTimeFormat (and its format()/formatToParts()/resolvedOptions() methods) reads the wall clock the same way Date.now() does, the same replay-key hazard.',
    instead: 'format a timestamp off run_status/run_result or args yourself, or pass a pre-formatted string in via args.',
  },
];

// #157 B1 (CRITICAL, fixed here): `GuardError` used to be ONE module-level class, built with the
// EMBEDDING realm's own `Error` — an embedding-realm class is itself exactly the kind of object this
// fix removes from the sandbox (its `.constructor` chain reaches the embedding realm's `Function`).
// It is now built FRESH per `evaluateScript()` call by `createGuardError` below, extending THAT
// call's own vm context's native `Error` (fetched via `vm.runInContext`) — so every GuardError
// instance a script can catch is native to its own context, same as anything the script constructs
// itself. `instanceof` can no longer identify "one of our own typed refusals" across that per-call
// class boundary (a different context ⇒ a different `Error` constructor each time), so `GUARD_MARK`
// — a realm-agnostic symbol VALUE, not a class — marks a created GuardError instead; `evaluateScript`
// below reads it by reference.
//
// Known, accepted residual: a script that CATCHES a genuine guard/refusal error can read this symbol
// off it via `Object.getOwnPropertySymbols` and reuse it to mark an object of its own, controlling
// which `code`/`message` its OWN run's terminal failure reports. This is no different in kind from
// the pre-existing `ENGINE_REFUSAL_CODES` allowlist below (a script can already forge
// `BUDGET_EXCEEDED`/`PARAM_UNKNOWN` the same way, via a plain `.code`/`.name` field) — it grants no
// access to anything outside the script's own run outcome, and specifically does NOT let a script
// forge a `refusalRef` (that stays keyed off object IDENTITY in the `refusalRefs` WeakMap below,
// never off a readable field — see `markEngineRefusal`'s own doc).
const GUARD_MARK = Symbol('rwe-sandbox-guard-error');

/** Builds a GuardError NATIVE to `CtxError`'s own realm (that evaluateScript call's vm context),
 *  carrying `code` on both `.name` and `.code` (matching the pre-#157 GuardError's own shape) plus
 *  the `GUARD_MARK` tag `evaluateScript`'s outer catch reads instead of `instanceof`. */
function createGuardError(CtxError: ErrorConstructor, code: string, message: string): Error {
  const e = new CtxError(message);
  e.name = code;
  (e as Error & { code?: string }).code = code;
  Object.defineProperty(e, GUARD_MARK, { value: true, enumerable: false, configurable: false });
  return e;
}

/** #157 B1: sanitizes an EMBEDDING-realm error (an `agent()`/`workflow()` host rejection) into one
 *  native to `CtxError`'s realm before it becomes reachable to the script's own `catch` — otherwise
 *  the original host error's prototype chain is the exact escape vector this issue is about.
 *  Deliberately NOT `GUARD_MARK`ed (agent() errors were never `instanceof GuardError` pre-fix either
 *  — only `refusalCode()`'s small allowlist or the generic SCRIPT_ERROR path classified them; this
 *  preserves that exact classification, changing only which realm the thrown object belongs to).
 *  `.name`/`.code`/`.message` are copied verbatim (so `refusalCode()` and a script's own `e.code`
 *  checks keep working identically), and the `refusalRefs` WeakMap entry (if any — DES-248) is
 *  re-keyed onto the new object, since that is the object identity that now propagates further. */
function sanitizeThrownError(CtxError: ErrorConstructor, err: unknown): Error {
  const e = err as { name?: unknown; code?: unknown; message?: unknown } | null;
  const name = typeof e?.name === 'string' ? e.name : 'Error';
  const message = err instanceof Error ? err.message : typeof e?.message === 'string' ? e.message : String(err);
  const sanitized = new CtxError(message);
  sanitized.name = name;
  if (typeof e?.code === 'string') (sanitized as Error & { code?: string }).code = e.code;
  const ref = refusalRefs.get(err as object);
  if (ref !== undefined) refusalRefs.set(sanitized, ref);
  return sanitized;
}

/** #157 B1: rebuilds `value` using `CtxArray`/`CtxObject` (that evaluateScript call's OWN vm
 *  context's native Array/Object) instead of whatever realm it was created in — the same hazard as
 *  an injected function/object: an embedding-realm array/object's `.constructor` chain reaches the
 *  embedding realm's `Function`. Primitives (including `undefined` — preserved exactly, NOT coerced
 *  to `null`, unlike a JSON round-trip, which matters for `parallel()`/`pipeline()`'s documented
 *  null-for-a-throwing-thunk contract: a thunk that legitimately RESOLVES to `undefined` must stay
 *  distinguishable from one that threw) pass through untouched — primitives carry no realm. Cycle-
 *  safe via `seen`. Functions are left as-is (workflow data is JSON-shaped in practice — the actual
 *  IPC transport to this child is already JSON-serializing by default, so nothing JSON can't
 *  represent survives to this point anyway); this only re-realms what DOES cross, never invents
 *  capability that wasn't already reachable. */
function makeReRealm(CtxArray: ArrayConstructor, CtxObject: ObjectConstructor): (value: unknown) => unknown {
  function go(value: unknown, seen: WeakMap<object, unknown>): unknown {
    if (value === null || typeof value !== 'object') return value;
    const cached = seen.get(value);
    if (cached !== undefined) return cached;
    if (Array.isArray(value)) {
      const arr = new CtxArray(value.length) as unknown[];
      seen.set(value, arr);
      value.forEach((item, i) => {
        arr[i] = go(item, seen);
      });
      return arr;
    }
    const out = new CtxObject() as Record<string, unknown>;
    seen.set(value, out);
    for (const key of Object.keys(value as Record<string, unknown>)) {
      out[key] = go((value as Record<string, unknown>)[key], seen);
    }
    return out;
  }
  return (value: unknown) => go(value, new WeakMap());
}

// V5 (Gate 8 v2 review, adversarial finding) — HISTORY, corrected by #157 B1: this comment used to
// claim the Function-constructor realm escape could reach only "realm INTRINSICS, never the absent
// host capabilities" and that process/require/fs were "simply absent from the context, not merely
// shadowed". That was FALSE as implemented: `<injected-object>.constructor.constructor(...)` reached
// the embedding realm (the sandbox CHILD process's own top-level scope — ARCH-003's process
// boundary, still a real OS process with its own `process`/`fetch`, and — since `host.ts`'s
// `fork()` call passed no `env:` override — the FULL parent env, including provider API keys per
// `main.ts`), because `guardedDate`/`guardedMath` and every other `sandbox` property below were
// objects CREATED in that embedding scope, not the vm context's own realm. `vm.createContext` does
// not re-realm an externally-created object's prototype chain, so `.constructor` on any of them
// resolved to the embedding `Function` regardless. The actual fix (this file, #157 B1): `Date`/
// `Math` (and `agent`/`parallel`/`pipeline`/`phase`/`workflow`/`args`/`budget` below) are now either
// built FROM the context's own fetched intrinsics (`CtxDate`/`CtxMath`/`CtxError`/`CtxArray`/
// `CtxObject`, via `vm.runInContext`) or have their own `[[Prototype]]` severed (`Object.
// setPrototypeOf(fn, null)`) before being exposed, so `<injected>.constructor.constructor` behaves
// exactly like the always-safe control case (`Function('return process')()`, which throws
// ReferenceError — proven by `tests/integration/sandbox-realm-escape.test.ts`'s control case).
// `host.ts`'s `fork()` still inherits the parent env as a SEPARATE defense-in-depth concern (not yet
// scrubbed — tracked as residual risk in this fix's report, since this file cannot change host.ts's
// caller contract unilaterally within this issue's scope).
function guardedDate(CtxDate: DateConstructor, CtxError: ErrorConstructor, wrap: Wrap): DateConstructor {
  class GuardedDate extends CtxDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) {
        throw createGuardError(CtxError, 'DETERMINISM_GUARD', 'new Date() without arguments is not allowed inside a workflow script'); // det:allow — refusal message naming the blocked API, not a call
      }
      // @ts-expect-error — variadic forwarding to whichever Date overload matches at runtime
      super(...args);
    }
  }
  // #157 B1 follow-up, #157 (final blocker) rebuild: a `static override now` METHOD is a value
  // created by evaluating this `class` body, which happens in the EMBEDDING realm (this whole
  // module's own scope) even though `GuardedDate` itself `extends CtxDate` (that `extends` link only
  // re-realms the CLASS's own `[[Prototype]]`, not a property added by the subclass). Declaring it as
  // a class method would give `Date.now.constructor.constructor(...)` (never actually CALLING `now`,
  // just reading it as a value) a live path to the embedding `Function` — so it is never declared in
  // the class body at all; `wrap()` builds it fresh, NATIVE to the vm context (see `wrap`'s own doc),
  // and it is assigned here instead.
  Object.defineProperty(GuardedDate, 'now', {
    value: wrap(() => {
      throw createGuardError(CtxError, 'DETERMINISM_GUARD', 'Date.now() is not allowed inside a workflow script'); // det:allow — refusal message naming the blocked API, not a call
    }),
    writable: true,
    configurable: true,
  });
  // #157 (DOC item): `Date()` called WITHOUT `new` reads the wall clock too — the same hazard as
  // `Date.now()` — but was refused only incidentally, by the ES class-invocation rule ("Class
  // constructor ... cannot be invoked without 'new'", a generic TypeError/SCRIPT_ERROR), since
  // GuardedDate happens to be implemented as a class. The `apply` trap intercepts the no-`new` call
  // form explicitly with the SAME GuardError the other two calls use; `construct` is left
  // untouched (not overridden in this trap set), so `new` still forwards to GuardedDate normally.
  return new Proxy(GuardedDate, {
    apply(): never {
      throw createGuardError(CtxError, 'DETERMINISM_GUARD', 'Date() is not allowed inside a workflow script'); // det:allow — refusal message naming the blocked API, not a call
    },
  }) as unknown as DateConstructor;
}

/** #157 B2 (same bug class as `guardedIntl` below, fixed the same way): the pre-fix version of this
 *  function wrapped `CtxMath` in a `get`-only Proxy. `Object.getOwnPropertyDescriptor(Math,'random')`
 *  has no trap defined on a `get`-only Proxy, so Node's default behavior FORWARDS it to the
 *  TARGET — the real, un-guarded `CtxMath` — handing a script the genuine `random` function instead
 *  of the thrower. Mutating `CtxMath` itself (the context's OWN global `Math`, fetched via
 *  `vm.runInContext('Math', context)`, not a copy) closes every access path at once (`get`,
 *  `getOwnPropertyDescriptor`, `in`, `Object.keys`, …) because there is no longer a second,
 *  un-guarded object anywhere for any of those paths to reach. */
function guardedMath(CtxMath: typeof Math, CtxError: ErrorConstructor, wrap: Wrap): typeof Math {
  // #157 B1 follow-up: this thrower is a value reached one property hop PAST `Math` itself
  // (`Math.random`, not `Math`) — the top-level `Math` guard above does not protect it. #157 (final
  // blocker): built via `wrap()` — NATIVE to the vm context — rather than an embedding-realm arrow
  // function with its own `[[Prototype]]` merely severed to null (the pre-existing defense, which
  // only closes `.constructor` access on THIS value; `wrap` additionally means its own realm was
  // never the embedding one in the first place — see `wrap`'s own doc for why that matters).
  const randomThrower = wrap(() => {
    throw createGuardError(CtxError, 'DETERMINISM_GUARD', 'Math.random() is not allowed inside a workflow script'); // det:allow — refusal message naming the blocked API, not a call
  });
  Object.defineProperty(CtxMath, 'random', { value: randomThrower, writable: true, enumerable: true, configurable: true });
  return CtxMath;
}

/** #157 B2 (blocker, fixed here): `Intl.DateTimeFormat` (and its instance methods — `.format()`,
 *  `.formatToParts()`, `.resolvedOptions()`) read the wall clock the same way `Date.now()`/
 *  `new Date()` do, defeating the same resume-replay-key hazard — but `Intl` is a standard
 *  vm-context-default global (present in any context regardless of what `sandbox` declares, same as
 *  `console`, issue #157 B3) that was never added to `sandbox` nor shadowed, so it was reachable
 *  unguarded. Refuses CONSTRUCTING a `DateTimeFormat` at all (a plain function, not an arrow — throws
 *  identically called with or without `new`, so no instance, and therefore no instance method, is
 *  ever reachable) rather than guarding individual methods; other `Intl` constructors
 *  (`NumberFormat`, `Collator`, …) carry no wall-clock hazard and are left untouched.
 *
 *  Pre-fix this wrapped `CtxIntl` in a `get`-only Proxy — `Object.getOwnPropertyDescriptor(Intl,
 *  'DateTimeFormat')` has no trap defined on a `get`-only Proxy, so Node's default behavior FORWARDS
 *  it to the TARGET (the real, un-guarded `CtxIntl`), handing a script the genuine constructor
 *  (`new D().format()` then reads the real wall clock — not a realm leak, an actual guard bypass).
 *  Mutating `CtxIntl` itself (this call's own vm context's native `Intl`, fetched via
 *  `vm.runInContext('Intl', context)`, not a copy) closes every access path at once, the same fix
 *  `guardedMath` applies to `Math.random` above, for the identical reason.
 *
 *  `dateTimeFormatThrower` is declared with the `function` keyword, not an arrow — an arrow function
 *  cannot be invoked with `new` at all (`TypeError: ... is not a constructor`, which would reach the
 *  script BEFORE the thrower's own body runs, surfacing as `SCRIPT_ERROR` instead of
 *  `DETERMINISM_GUARD` for `new Intl.DateTimeFormat()`, a regression this fix must not introduce).
 *  That means it auto-gets an own `.prototype` object (every ordinary function declaration does),
 *  whose `[[Prototype]]` defaults to the realm that CREATED it — the embedding realm here — giving
 *  `Intl.DateTimeFormat.prototype.toString.constructor` (and `Object.getPrototypeOf(Intl.
 *  DateTimeFormat.prototype).constructor`) a live path back to the embedding `Function`, the #157 B1
 *  vector, through a property the function's own severed `[[Prototype]]` does not reach (that only
 *  cuts `dateTimeFormatThrower.__proto__`, a completely different slot from `dateTimeFormatThrower.
 *  prototype`). Reassigning `.prototype` to a null-proto object closes it: the thrower always throws
 *  before `new` can ever materialize an instance off that object, so nothing depends on its shape. */
function guardedIntl(CtxIntl: typeof Intl, CtxError: ErrorConstructor, wrap: Wrap): typeof Intl {
  // #157 (final blocker): built via `wrap()` instead of a `function` declaration with its own
  // `.prototype` manually reassigned to a null-proto object (the pre-existing defense against the
  // vector this doc block used to describe in detail — `wrap`'s own, context-native function already
  // has a context-native `.prototype` nobody ever reaches, since `impl.apply(...)` always throws
  // before `new` can materialize an instance off it, exactly as before).
  const dateTimeFormatThrower = wrap(() => {
    throw createGuardError(CtxError, 'DETERMINISM_GUARD', 'Intl.DateTimeFormat is not allowed inside a workflow script'); // det:allow — refusal message naming the blocked API, not a call
  });
  Object.defineProperty(CtxIntl, 'DateTimeFormat', { value: dateTimeFormatThrower, writable: true, enumerable: true, configurable: true });
  return CtxIntl;
}

// v25 (DES-167, REQ-120, issue #61): codes the ENGINE raises when it REFUSED to dispatch a call at
// all. They are NOT failures of the author's own code, and `parallel()`/`pipeline()` must not fold
// them into their documented null-for-a-throwing-thunk contract — doing so is what made the owner's
// lost third researcher invisible (no code, no log, no event; the only trace was a callSeq gap).
// The set is deliberately tiny: a call that reached a gateway and FAILED there (timeout, provider
// error) is still a thunk that threw, and still nulls.
// Inlined rather than imported from ../errors.js on purpose — this module is loaded by the sandbox
// CHILD, which does not resolve `.js`→`.ts` for value imports (see the checkMeta note at the top).
const ENGINE_REFUSAL_CODES = new Set(['BUDGET_EXCEEDED', 'PARAM_UNKNOWN']);

// v36 (DES-248, ARCH-165/166, TASK-246, REQ-215): a WeakMap keyed on the Error OBJECT, never a
// field on it — the object handed to script land is an ordinary mutable Error, so a script writing
// `e.refusalRef = 99` changes nothing (that field is never read; only this map is). Module scope,
// unreachable from the vm context `evaluateScript` builds below.
const refusalRefs = new WeakMap<object, number>();

/** Marks `err` as an engine refusal originating from IPC call `callSeq` — called at the
 *  `child-entry.ts` `agentThrow` reject site, BEFORE the promise rejects, so the ref rides on the
 *  same object identity the script catches and (possibly) rethrows. */
export function markEngineRefusal(err: object, callSeq: number): void {
  refusalRefs.set(err, callSeq);
}

/** The refusal code carried by `err`, or null when `err` is anything else. `code` is the live field
 *  for both sources since v25 (DES-169, issue #63): child-entry rejects an `agentThrow` with the IPC
 *  code on `code` AND `name`, and an in-process GuardError carries `code` as an own property. The
 *  `name` fallback is kept deliberately — it costs nothing and covers any error that reaches here
 *  carrying only the older shape. */
function refusalCode(err: unknown): string | null {
  const e = err as { code?: unknown; name?: unknown } | null | undefined;
  const code = (typeof e?.code === 'string' && e.code) || (typeof e?.name === 'string' && e.name) || '';
  return ENGINE_REFUSAL_CODES.has(code) ? code : null;
}

type Thunk = () => Promise<unknown>;
type Stage = (prev: unknown, item: unknown, index: number) => Promise<unknown>;

// #157 (final blocker, Gate 8 v3 re-review): a factory, built ONCE per `evaluateScript` call via
// `vm.runInContext` (so the factory ITSELF, and therefore every function it returns, is a value whose
// `[[Prototype]]` chain was NEVER the embedding realm's `Function.prototype` in the first place — not
// merely severed to null after the fact, this file's pre-existing defense for `agent`/`parallel`/…
// and the `Math.random`/`Intl.DateTimeFormat`/`Date.now` throwers). `Object.setPrototypeOf(fn, null)`
// closes `<fn>.constructor` specifically; it does nothing for some OTHER property a future change
// might add without remembering to sever it (a method on a returned object, a getter, …) — building
// the wrapper function natively in the context realm means that future addition's "no explicit
// hardening yet" default is already safe (context Function, inert under this file's `codeGeneration:
// {strings:false}` context option), not merely unverified. `impl` itself stays an ordinary embedding-
// realm closure (closing over `api`/`CtxError`/etc.) — only the OUTER function identity the script
// touches is context-native; calling it forwards synchronously via `.apply`, so sync throws, async
// rejections, and `new`-construction (the thrower case) all behave exactly as if `impl` were called
// directly.
// Generic over `T` (rather than a fixed `(...args: unknown[]) => unknown`) purely so TS accepts
// wrapping this file's actual, specifically-typed closures (`(prompt: string, opts?: unknown) =>
// …`, `(thunks: Thunk[]) => …`, …) without a variance complaint — the runtime behavior underneath
// (a generic `...callArgs` forwarder, built once via `vm.runInContext`) is identical regardless of
// `T`; the cast below asserts that shape back onto the specific type callers pass in.
type Wrap = <T extends (...args: never[]) => unknown>(impl: T) => T;

function makeWrap(context: vm.Context): Wrap {
  const factory = vm.runInContext(
    '(function (impl) { return function (...callArgs) { return impl.apply(undefined, callArgs); }; })',
    context,
  ) as (impl: (...args: never[]) => unknown) => (...args: never[]) => unknown;
  return (<T extends (...args: never[]) => unknown>(impl: T): T => factory(impl) as T) as Wrap;
}

/** #157 B1 follow-up: `agent()`/`parallel()`/`pipeline()`/`workflow()` are all `async` functions
 *  declared in THIS module — the embedding realm — so the Promise each one RETURNS when called is
 *  built by the embedding realm's own native `Promise`, a brand-new object each call creates fresh;
 *  severing the wrapper FUNCTION's own `[[Prototype]]` (done once, below, for all of them) does
 *  nothing to that separate, later-created return value. `<call>().constructor.constructor(...)`
 *  therefore still reached the embedding `Function` even after every other #157 B1 hardening.
 *  Wraps the embedding-realm promise in a BRAND NEW instance of `CtxPromise` (this call's own vm
 *  context's native `Promise`, fetched the same way `CtxDate`/`CtxMath`/… are) — the executor runs
 *  synchronously (settling `settle`/`fail` only once the real work resolves/rejects), so the object a
 *  script sees is context-native from the instant it is created, and stays so through `.then()`
 *  chains (`Promise.prototype.then`'s species construction resolves against `CtxPromise`, never the
 *  embedding one, because the promise IT is called on already is `CtxPromise`-native). */
function toCtxPromise<T>(CtxPromise: PromiseConstructor, hostPromise: Promise<T>): Promise<T> {
  return new CtxPromise((resolve, reject) => {
    hostPromise.then(resolve as (value: unknown) => void, reject);
  }) as Promise<T>;
}

// #157 B1: `CtxError`/`reRealm`/`CtxPromise` are per-evaluateScript-call (that call's own vm
// context's native Error/Array/Object/Promise) — see `createGuardError`/`makeReRealm`/
// `toCtxPromise`'s own docs for why. The returned wrapper functions have their OWN `[[Prototype]]`
// severed (`Object.setPrototypeOf(fn, null)`, applied once by `evaluateScript` where these are
// assembled) so `<fn>.constructor` cannot reach the embedding realm either; `reRealm` on the
// RETURNED ARRAY closes the same hole for the container `Promise.all` builds (an embedding-realm
// array), which the function's own nulled prototype alone does not reach; `toCtxPromise` closes it
// for the Promise object itself (see that function's own doc).
function makeParallel(CtxError: ErrorConstructor, reRealm: (value: unknown) => unknown, CtxPromise: PromiseConstructor) {
  return (thunks: Thunk[]): Promise<Array<unknown | null>> =>
    toCtxPromise(
      CtxPromise,
      (async () => {
        if (!Array.isArray(thunks)) {
          throw createGuardError(CtxError, 'ITEM_CAP_EXCEEDED', 'parallel() requires an array of thunks');
        }
        if (thunks.length > MAX_ITEMS) {
          throw createGuardError(CtxError, 'ITEM_CAP_EXCEEDED', `parallel() exceeds the ${MAX_ITEMS}-item cap (${thunks.length})`);
        }
        const result = await Promise.all(
          thunks.map(async (thunk) => {
            try {
              return await thunk();
            } catch (err) {
              // An engine REFUSAL is not the author's thunk failing — propagate it with its code so the
              // caller (and the run's terminal error) says why. Everything else keeps the documented
              // null-for-a-throwing-thunk contract. `err` here is already sanitized (agent()/workflow()
              // sanitize their own rejections before the thunk's own `await` can see them), so re-
              // throwing it here carries that same safety forward unchanged.
              if (refusalCode(err) !== null) throw err;
              return null;
            }
          }),
        );
        return reRealm(result) as Array<unknown | null>;
      })(),
    );
}

function makePipeline(CtxError: ErrorConstructor, reRealm: (value: unknown) => unknown, CtxPromise: PromiseConstructor) {
  return (items: unknown[], ...stages: Stage[]): Promise<Array<unknown | null>> =>
    toCtxPromise(
      CtxPromise,
      (async () => {
        if (!Array.isArray(items)) {
          throw createGuardError(CtxError, 'ITEM_CAP_EXCEEDED', 'pipeline() requires an array of items');
        }
        if (items.length > MAX_ITEMS) {
          throw createGuardError(CtxError, 'ITEM_CAP_EXCEEDED', `pipeline() exceeds the ${MAX_ITEMS}-item cap (${items.length})`);
        }
        const result = await Promise.all(
          items.map(async (item, index) => {
            let prev: unknown = item;
            for (const stage of stages) {
              try {
                prev = await stage(prev, item, index);
              } catch (err) {
                if (refusalCode(err) !== null) throw err; // same rule as parallel() above
                return null;
              }
            }
            return prev;
          }),
        );
        return reRealm(result) as Array<unknown | null>;
      })(),
    );
}

function makeWorkflow(api: SandboxApi, CtxError: ErrorConstructor, reRealm: (value: unknown) => unknown, CtxPromise: PromiseConstructor) {
  const delegate = api.workflow;
  return (nameOrRef: unknown, args?: unknown): Promise<unknown> =>
    toCtxPromise(
      CtxPromise,
      (async () => {
        if (!delegate) {
          throw createGuardError(CtxError, 'NESTING_ERROR', 'workflow() nesting is limited to one level');
        }
        try {
          const raw = await delegate(nameOrRef, args);
          return reRealm(raw);
        } catch (err) {
          // C-2: a delegate failure is not itself a nesting violation (the true one-level limit is the
          // !delegate branch above → NESTING_ERROR). Preserve the delegate error's own code (child-entry
          // sets it as .name on the rejection) so a caller can branch on CatalogNotFoundError etc. Inline
          // (no import) — this module is loaded by the sandbox child, which doesn't resolve .js→.ts value imports.
          const e = err as { code?: unknown; name?: unknown } | null;
          const code =
            (e && typeof e.code === 'string' && e.code) ? e.code :
            (e && typeof e.name === 'string' && e.name && e.name !== 'Error') ? e.name :
            'WORKFLOW_ERROR';
          throw createGuardError(CtxError, code, err instanceof Error ? err.message : String(err));
        }
      })(),
    );
}

// `export const meta = {...}` (compat-spec §1) must be a pure object literal — variables, calls,
// spreads, and template interpolation are rejected. Matched separately (before wrapping the script
// in an async function, since a bare `export` is not legal inside a function body) and stripped out
// of the executed body once validated. Uses the string-aware `checkMeta` scanner above — a prior
// `/[^;]*;/` regex truncated the object at the first semicolon inside a string VALUE and wrongly
// rejected legitimate workflows whose description contained a `;` (e.g. sdlc-run.js).
function checkMetaLiteral(script: string): { cleaned: string; error?: { code: string; message: string } } {
  const meta = checkMeta(script);
  if (!meta.found) return { cleaned: script };
  if (!meta.pureLiteral || meta.span === undefined) {
    return {
      cleaned: script,
      error: { code: 'INVALID_META', message: 'workflow meta must be a pure object literal — variables, calls, spreads, and template interpolation are rejected' },
    };
  }
  return { cleaned: script.replace(meta.span, '') };
}

/** #157 B1: replaces the pre-fix `api.agent.bind(api)` (an embedding-realm function exposed
 *  directly — the exact vector `agent.constructor.constructor(...)` exploited). Resolves with
 *  `reRealm`'d data; rejects with a `sanitizeThrownError`'d one. The wrapper itself has its OWN
 *  `[[Prototype]]` severed by `evaluateScript` below, where it is assigned onto `sandbox`. */
function makeAgent(api: SandboxApi, CtxError: ErrorConstructor, reRealm: (value: unknown) => unknown, CtxPromise: PromiseConstructor) {
  return (prompt: string, opts?: unknown): Promise<unknown> =>
    toCtxPromise(
      CtxPromise,
      (async () => {
        try {
          const raw = await api.agent(prompt, opts);
          return reRealm(raw);
        } catch (err) {
          throw sanitizeThrownError(CtxError, err);
        }
      })(),
    );
}

/** #157 B1: rebuilds the script-visible `budget` object natively in `CtxObject`'s realm. `spent`/
 *  `remaining`/`tokens` stay LIVE closures over the real `api.budget` (so mid-script accounting
 *  updates are still observed exactly as before — this is NOT a one-time snapshot), each with its
 *  own `[[Prototype]]` severed; `limits`/`total` are copied through `reRealm`. `SandboxApi.budget`
 *  only guarantees `Budget`'s three fields (`total`/`spent`/`remaining`) — `limits`/`tokens` are the
 *  real `SandboxBudget` superset child-entry.ts actually passes, read here defensively since this
 *  function also runs against the narrower `Budget`-only fakes several unit tests construct. */
function makeBudget(budget: Budget, CtxObject: ObjectConstructor, reRealm: (value: unknown) => unknown, wrap: Wrap): Budget {
  const wide = budget as Partial<{ limits: unknown; tokens: () => unknown }>;
  const out = new CtxObject() as Record<string, unknown>;
  out.total = budget.total;
  out.spent = wrap(() => budget.spent());
  out.remaining = wrap(() => budget.remaining());
  if ('limits' in budget) {
    out.limits = reRealm(wide.limits);
    // #157 (DOC item): SandboxApi.budget's own doc comment promises "Read-only budget view" — the
    // pre-fix object was a plain mutable object, so `budget.limits.usd = 1` stuck within the
    // script's own subsequent reads (a contract-integrity bug, not a budget-bypass: the engine's
    // real enforcement never reads this object). `limits` is the one nested object in this shape
    // that needs its OWN freeze — `out` itself is frozen below, which does not reach inside it.
    if (out.limits !== null && typeof out.limits === 'object') Object.freeze(out.limits);
  }
  if (typeof wide.tokens === 'function') {
    out.tokens = wrap(() => reRealm(wide.tokens!()));
  }
  return Object.freeze(out) as unknown as Budget;
}

/**
 * Evaluate a workflow script string in a restricted VM context.
 * Guards: Date.now(), Math.random(), new Date() (no args) throw inside the script. det:allow — a doc comment naming the blocked APIs, not a call
 * TS syntax, >512KB scripts, and >4096-item parallel()/pipeline() calls are rejected.
 *
 * #157 B1 / #157 (final blocker, Gate 8 v3): every value exposed into the sandbox is NATIVE to this
 * call's own vm context — either fetched directly via `vm.runInContext` (`Date`/`Math`/`Intl`/`Error`/
 * `Array`/`Object`/`Promise`, used to build re-realmed data and errors), or built BY a context-native
 * factory (`wrap`, see its own doc) rather than merely having its `[[Prototype]]` severed after the
 * fact. The vm context's own GLOBAL OBJECT gets the same treatment: `sandbox` starts `[[Prototype]]`-
 * less (`Object.create(null)`) and is reparented to the context's OWN `Object.prototype` once the
 * context exists, so `globalThis`/the script's top-level `this` resolve `.constructor` inside the
 * context realm too — the one surface every per-property fix above left open, since `vm.createContext`
 * never re-realms the global object it's handed. The context is additionally created with
 * `codeGeneration: { strings: false }`, so even the context's own (otherwise harmless) `Function`/
 * `eval` cannot generate code from a string; the script body itself is compiled as a STRICT-mode
 * function and invoked with no receiver (`this === undefined` on a bare call, by spec, in strict
 * mode — never coerced to the global object the way a sloppy function's would be), closing the bare
 * `this.constructor...` vector without relying on the global reparenting alone. `Error.
 * prepareStackTrace` is locked to always-`undefined` (non-writable, non-configurable) so a script
 * cannot install a custom stack formatter and walk `CallSite.getFunction()`/`getThis()` for a live
 * function handle — the same class of escape classic `vm`-sandbox libraries were broken by.
 *
 * Before this fix, `<injected>.constructor.constructor(...)` reached the embedding (sandbox child
 * process) realm's `Function`, `process`, and `fetch`; after B1 closed every injected PROPERTY, the
 * script's own top-level `this`/`globalThis` still did — see
 * `tests/integration/sandbox-realm-escape.test.ts` for the real-fork-boundary repro of both rounds.
 *
 * This is layer 1 of three independent defenses (issue #157's own triage: "layer 1 alone is NOT
 * enough") — layer 2 (`host.ts`'s `SANDBOX_CHILD_ENV`) ensures the forked child carries no secrets
 * even if this layer is ever defeated by a future escape nobody has found yet; layer 3 (`host.ts`'s
 * `SANDBOX_CHILD_EXEC_ARGV`, Node's `--permission` model) ensures that even a live `process` handle
 * cannot read arbitrary files or spawn a shell. Treat this layer as hygiene, not a boundary — `node:vm`
 * itself documents that it does not provide one.
 */
export async function evaluateScript(script: string, api: SandboxApi): Promise<ScriptResult> {
  if (Buffer.byteLength(script, 'utf8') > MAX_SCRIPT_BYTES) {
    return { kind: 'error', error: { code: 'SIZE_EXCEEDED', message: `script exceeds the ${MAX_SCRIPT_BYTES}-byte cap` } };
  }

  const meta = checkMetaLiteral(script);
  if (meta.error) {
    return { kind: 'error', error: meta.error };
  }
  const body = meta.cleaned;

  // #157 (final blocker): `sandbox` starts with NO prototype at all (not the embedding realm's
  // `Object.prototype`, which a bare `{}` literal would carry) — reparented below, once the context's
  // own native `Object` is reachable, to that context's `Object.prototype`. `codeGeneration.strings:
  // false` is layer 1's other context-wide setting — see this function's own doc above.
  const sandbox: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  const context = vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false } });

  // Fetch THIS call's own vm context's native intrinsics — building Date/Math/errors/data from
  // these (rather than the embedding realm's own Date/Math/Error/Array/Object) is the whole fix;
  // see vm.runInContext's own semantics note above `createGuardError`.
  const CtxDate = vm.runInContext('Date', context) as DateConstructor;
  const CtxMath = vm.runInContext('Math', context) as typeof Math;
  const CtxIntl = vm.runInContext('Intl', context) as typeof Intl;
  const CtxError = vm.runInContext('Error', context) as ErrorConstructor;
  const CtxArray = vm.runInContext('Array', context) as ArrayConstructor;
  const CtxObject = vm.runInContext('Object', context) as ObjectConstructor;
  const CtxPromise = vm.runInContext('Promise', context) as PromiseConstructor;
  const reRealm = makeReRealm(CtxArray, CtxObject);
  const wrap = makeWrap(context);

  // #157 (final blocker): reparent the global object itself — see this function's own doc for why
  // the per-property fixes above never reached `this`/`globalThis`.
  Object.setPrototypeOf(sandbox, CtxObject.prototype);

  // #157 (final blocker): `Error.prepareStackTrace` is the classic `vm`-sandbox escape (a script sets
  // a custom stack formatter, then reads `CallSite.getFunction()`/`getThis()` off any error's `.stack`
  // for a live function/receiver reference from the current call stack — which can include embedding-
  // realm frames). Locked to always-`undefined`, non-writable/non-configurable, on THIS call's own
  // native `Error` — `Error.captureStackTrace`/`.stackTraceLimit` are left alone (no hazard by
  // themselves; default stack formatting carries no function references, only strings).
  Object.defineProperty(CtxError, 'prepareStackTrace', { value: undefined, writable: false, configurable: false, enumerable: false });

  const agentFn = makeAgent(api, CtxError, reRealm, CtxPromise);
  const parallelFn = makeParallel(CtxError, reRealm, CtxPromise);
  const pipelineFn = makePipeline(CtxError, reRealm, CtxPromise);
  const workflowFn = makeWorkflow(api, CtxError, reRealm, CtxPromise);
  const phaseFn = (title: string): void => {
    api.phase?.(title);
  };
  const logFn = (): void => {};

  Object.assign(sandbox, {
    agent: wrap(agentFn),
    parallel: wrap(parallelFn),
    pipeline: wrap(pipelineFn),
    phase: wrap(phaseFn),
    log: wrap(logFn),
    args: reRealm(api.args),
    budget: makeBudget(api.budget, CtxObject, reRealm, wrap),
    workflow: wrap(workflowFn),
    Date: guardedDate(CtxDate, CtxError, wrap),
    Math: guardedMath(CtxMath, CtxError, wrap),
    Intl: guardedIntl(CtxIntl, CtxError, wrap),
  });

  let compiled: vm.Script;
  try {
    // #157 (final blocker): a STRICT-mode function body — a bare call (`runScript()` below, no
    // receiver) gives `this === undefined` inside, by spec, in strict mode (a sloppy function would
    // coerce it to the global object — the bare `this.constructor...` vector). Strict mode also
    // incidentally closes `arguments.callee`/`arguments.caller` (poisoned accessors that throw on
    // mere access in strict code) and direct `eval`'s inherited `this`, for the same reason.
    compiled = new vm.Script(`(async function () {\n'use strict';\n${body}\n})`, { filename: 'workflow-script.js' });
  } catch (err) {
    return { kind: 'error', error: { code: 'PARSE_ERROR', message: err instanceof Error ? err.message : String(err) } };
  }

  try {
    const runScript = compiled.runInContext(context) as () => Promise<unknown>;
    const value = await runScript();
    return { kind: 'done', value };
  } catch (err) {
    // v36 (DES-248): read the ref FROM THE MAP, never off `err` itself — a script that set
    // `e.refusalRef = 99` on the caught error changes nothing here.
    const refusalRef = refusalRefs.get(err as object);
    const refField = refusalRef !== undefined ? { refusalRef } : {};
    // #157 B1: replaces `err instanceof GuardError` (no longer meaningful — GuardError is built
    // per-call, native to THIS call's own context, so `instanceof` against anything embedding-side
    // would always be false). `GUARD_MARK` is the realm-agnostic replacement; see its own doc.
    const isGuardError = err !== null && typeof err === 'object' && (err as Record<symbol, unknown>)[GUARD_MARK] === true;
    if (isGuardError) {
      const e = err as { code?: unknown };
      return { kind: 'error', error: { code: typeof e.code === 'string' ? e.code : 'SCRIPT_ERROR', message: err instanceof Error ? err.message : String(err), ...refField } };
    }
    // v25 (DES-167, REQ-120): an uncaught engine REFUSAL keeps its own code instead of flattening to
    // SCRIPT_ERROR (which run-manager's toErrorCode would then map to INTERNAL_ERROR). This is what
    // makes `run_result.error.code === 'BUDGET_EXCEEDED'` true for the caller — the owner's ask:
    // 「如果是 budget 問題 應該 fail 時 client 知道」. Covers both the sequential `await agent()` and
    // the refusal parallel()/pipeline() re-threw above.
    const refusal = refusalCode(err);
    if (refusal !== null) {
      return { kind: 'error', error: { code: refusal, message: err instanceof Error ? err.message : String(err), ...refField } };
    }
    return { kind: 'error', error: { code: 'SCRIPT_ERROR', message: err instanceof Error ? err.message : String(err), ...refField } };
  }
}
