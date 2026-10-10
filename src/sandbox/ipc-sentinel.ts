// Issue #161 B2 (2026-10-07 reverify): Node's IPC uses 'json' serialization by default (fork()'s
// default — see host.ts's own fork() call and child-entry.ts's send()/trySend() notes on this same
// choice) — `JSON.stringify({n: undefined})` is `'{}'`, so `process.send({args: {n: undefined}})`
// drops the `n` key entirely before the host-side 'message' handler ever sees it. A nested
// `workflow(name, {n: undefined})` call therefore reached `_handleWorkflowRequest` on the host side
// indistinguishable from `workflow(name, {})` — `materializeArgDefaults`'s own fix (Object.hasOwn,
// params/contract.ts) is a correctness fix for the FUNCTION, but a no-op end-to-end for this one
// caller unless the "own key, undefined value" shape survives the IPC hop in the first place.
//
// This is a narrow, bounded fix at exactly that one hop — NOT a change to the IPC channel's
// serialization mode (switching `fork()` to `serialization: 'advanced'` would touch every message
// type this channel carries and is out of scope for one caller's argument shape). The child marks
// an explicit `undefined` own value with a fixed sentinel string (which JSON preserves like any
// other string) before sending; the host decodes it back to a true `undefined` before the value
// ever reaches `materializeArgDefaults`/`validateDeclaredArgs`. Scoped to TOP-LEVEL own keys only —
// never walked into nested objects/arrays — to keep both the risk surface and the encode/decode
// cost minimal; nested workflow() args are a flat record by contract (ParamContract.args), so a
// top-level-only transform covers every real case.
export const IPC_EXPLICIT_UNDEFINED = '\u0000__rwe_explicit_undefined__\u0000';

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Child side: called on `wfArgs` just before it crosses `process.send()`. Returns `value`
 *  unchanged (same reference) when there is nothing to mark, so a non-object value or an object
 *  with no explicit-`undefined` own key costs nothing extra over the wire. */
export function encodeExplicitUndefined(value: unknown): unknown {
  if (!isPlainRecord(value)) return value;
  let out: Record<string, unknown> | undefined;
  for (const key of Object.keys(value)) {
    if (value[key] === undefined) {
      out ??= { ...value };
      out[key] = IPC_EXPLICIT_UNDEFINED;
    }
  }
  return out ?? value;
}

/** Host side: called on the received `args` before it reaches `materializeRunArgs`. Inverse of
 *  `encodeExplicitUndefined` — a key carrying the sentinel becomes a true own-key `undefined`
 *  again. Returns `value` unchanged (same reference) when nothing needs decoding. */
export function decodeExplicitUndefined(value: unknown): unknown {
  if (!isPlainRecord(value)) return value;
  let out: Record<string, unknown> | undefined;
  for (const key of Object.keys(value)) {
    if (value[key] === IPC_EXPLICIT_UNDEFINED) {
      out ??= { ...value };
      out[key] = undefined;
    }
  }
  return out ?? value;
}

/** Issue #161 B2 (2026-10-09 reverify, the NOT-FIXED half): a function or symbol value — at ANY
 *  depth, top-level or nested — and an `undefined` value NESTED inside a sub-object/array (the
 *  encode/decode pair above covers the one legitimate shape, a TOP-LEVEL own-key `undefined`,
 *  and deliberately goes no deeper — see that pair's own doc) all cross `process.send()`'s own
 *  JSON serialization with NO error at all: `JSON.stringify` silently OMITS a function/symbol-
 *  valued object key, turns a function/symbol/undefined ARRAY ELEMENT into `null`, and omits a
 *  nested `undefined` object key — every one of these reaches the far side looking exactly like
 *  a key the caller never wrote, so a declared default silently (and wrongly) fills in instead
 *  of the refusal the caller should see. */
export interface UnsendableArgValue {
  path: string;
  kind: 'function' | 'symbol' | 'undefined';
}

function walkUnsendable(value: unknown, path: string, topLevelUndefinedOk: boolean, seen: Set<unknown>): UnsendableArgValue | null {
  if (typeof value === 'function') return { path, kind: 'function' };
  if (typeof value === 'symbol') return { path, kind: 'symbol' };
  if (value === undefined) return topLevelUndefinedOk ? null : { path, kind: 'undefined' };
  if (value === null || typeof value !== 'object') return null;
  if (seen.has(value)) return null; // a cycle — the existing circular-value path (RESULT_NOT_SERIALIZABLE) owns this, not this scan
  seen.add(value);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const hit = walkUnsendable(value[i], `${path}[${i}]`, false, seen);
      if (hit !== null) return hit;
    }
    return null;
  }
  for (const key of Object.keys(value as Record<string, unknown>)) {
    const hit = walkUnsendable((value as Record<string, unknown>)[key], `${path}.${key}`, false, seen);
    if (hit !== null) return hit;
  }
  return null;
}

/** Scans an `args` value for the first unsendable value (depth-first, own-key insertion order),
 *  or `null` when there is none. Called on the CHILD side, before `encodeExplicitUndefined`/
 *  `trySend` — catching this here means the call is refused synchronously, before anything
 *  crosses the wire, rather than silently losing the value in transit. A non-record `args`
 *  (array, string, other primitive, `null`/`undefined`) is out of scope here — that is
 *  `validateDeclaredArgs`'s own top-level shape check's job ("args has the wrong type"), not
 *  this scan's. */
export function findUnsendableArgValue(args: unknown): UnsendableArgValue | null {
  if (!isPlainRecord(args)) return null;
  for (const key of Object.keys(args)) {
    const hit = walkUnsendable(args[key], key, true, new Set());
    if (hit !== null) return hit;
  }
  return null;
}

// Issue #161 (round-3): the caller (child-entry.ts's `workflow()`) used to hand-build this message
// inline with a hardcoded "a ${unsendable.kind}" — correct English for 'function'/'symbol' but
// "a undefined value" for the one `kind` that starts with a vowel sound. Pulled out as its own
// pure, directly-testable function (one canonical message, not re-typed at the one call site that
// builds it) rather than patched in place, so a future `kind` added to `UnsendableArgValue` gets
// the right article for free instead of needing the same fix applied again by hand.
const VOWEL_SOUND = /^[aeiou]/i;

/** The refusal message for an unsendable `workflow()` args value — grammatically correct for every
 *  current and future `UnsendableArgValue.kind` ('an undefined value', 'a function value', 'a
 *  symbol value'), not a single hardcoded article. */
export function unsendableArgMessage(unsendable: UnsendableArgValue): string {
  const article = VOWEL_SOUND.test(unsendable.kind) ? 'an' : 'a';
  return `workflow() args.${unsendable.path} is ${article} ${unsendable.kind} value, which cannot cross the sandbox IPC boundary — pass only plain JSON-shaped data (objects, arrays, strings, numbers, booleans, null, and a top-level explicit undefined)`;
}
