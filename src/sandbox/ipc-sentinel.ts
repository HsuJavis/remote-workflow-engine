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
