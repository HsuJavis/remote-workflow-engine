// Issue #161 B2: encodeExplicitUndefined/decodeExplicitUndefined — the sentinel pair that lets an
// explicit own-key `undefined` survive Node's IPC 'json' serialization (which JSON.stringify would
// otherwise drop silently: `JSON.stringify({n: undefined})` === `'{}'`).
//
// Mock policy (unit): pure functions, no I/O, no subprocess — the real IPC round-trip is covered
// separately by run-args-resume.test.ts / an acceptance-level nested workflow() case.
import { describe, it, expect } from 'vitest';
import { encodeExplicitUndefined, decodeExplicitUndefined, IPC_EXPLICIT_UNDEFINED, findUnsendableArgValue, unsendableArgMessage } from '../../src/sandbox/ipc-sentinel.js';

describe('encodeExplicitUndefined / decodeExplicitUndefined (#161 B2)', () => {
  it('encode: an own key valued `undefined` becomes the sentinel string', () => {
    const encoded = encodeExplicitUndefined({ n: undefined, s: 'x' }) as Record<string, unknown>;
    expect(encoded['n']).toBe(IPC_EXPLICIT_UNDEFINED);
    expect(encoded['s']).toBe('x');
  });

  it('encode then JSON round-trip then decode restores the explicit `undefined` as an own key', () => {
    const encoded = encodeExplicitUndefined({ n: undefined, s: 'x' });
    const overWire = JSON.parse(JSON.stringify(encoded)) as Record<string, unknown>;
    const decoded = decodeExplicitUndefined(overWire) as Record<string, unknown>;
    expect(Object.hasOwn(decoded, 'n')).toBe(true);
    expect(decoded['n']).toBeUndefined();
    expect(decoded['s']).toBe('x');
  });

  it('a genuinely ABSENT key stays absent through the same round-trip (not resurrected as undefined)', () => {
    const encoded = encodeExplicitUndefined({ s: 'x' });
    const overWire = JSON.parse(JSON.stringify(encoded)) as Record<string, unknown>;
    const decoded = decodeExplicitUndefined(overWire) as Record<string, unknown>;
    expect(Object.hasOwn(decoded, 'n')).toBe(false);
  });

  it('encode is a no-op (same reference) when there is nothing to mark', () => {
    const value = { s: 'x', m: 3 };
    expect(encodeExplicitUndefined(value)).toBe(value);
  });

  it('decode is a no-op (same reference) when there is no sentinel present', () => {
    const value = { s: 'x' };
    expect(decodeExplicitUndefined(value)).toBe(value);
  });

  it('non-object values (array, string, number, null, undefined) pass through both functions unchanged', () => {
    for (const v of [['a'], 'x', 3, null, undefined]) {
      expect(encodeExplicitUndefined(v)).toBe(v);
      expect(decodeExplicitUndefined(v)).toBe(v);
    }
  });

  it('is pure — the input object is never mutated', () => {
    const input = { n: undefined };
    const encoded = encodeExplicitUndefined(input) as Record<string, unknown>;
    expect(encoded).not.toBe(input);
    expect(Object.hasOwn(input, 'n')).toBe(true); // original untouched
  });

  it('multiple explicit-undefined keys are all marked and all restored', () => {
    const encoded = encodeExplicitUndefined({ a: undefined, b: undefined, c: 1 });
    const overWire = JSON.parse(JSON.stringify(encoded)) as Record<string, unknown>;
    const decoded = decodeExplicitUndefined(overWire) as Record<string, unknown>;
    expect(Object.hasOwn(decoded, 'a')).toBe(true);
    expect(decoded['a']).toBeUndefined();
    expect(Object.hasOwn(decoded, 'b')).toBe(true);
    expect(decoded['b']).toBeUndefined();
    expect(decoded['c']).toBe(1);
  });
});

// issue #161 B2 (2026-10-09 reverify): a function value (at ANY depth — top-level or nested) and
// a nested `undefined` (inside a sub-object or array — the top-level own-key case above is the
// ONE legitimate, encodable shape; this module's own sentinel pair is deliberately scoped to it)
// both cross `process.send()`'s own JSON serialization with NO error: `JSON.stringify` just
// silently OMITS a function-valued key / drops an array element to `null` / omits a nested
// undefined key — the receiving side (and, after `materializeArgDefaults`) sees a key that looks
// genuinely absent, and a declared default silently fills in instead. `findUnsendableArgValue`
// detects every such value BEFORE the IPC hop, so the caller gets a real refusal instead of a
// silently-wrong substitution.
describe('findUnsendableArgValue (#161 B2 NOT FIXED half: function values, nested undefined)', () => {
  it('a top-level function value is detected', () => {
    const hit = findUnsendableArgValue({ n: 3, f: () => 1 });
    expect(hit).toEqual({ path: 'f', kind: 'function' });
  });

  it('a function value nested inside an object is detected, with a dotted path', () => {
    const hit = findUnsendableArgValue({ zzz: { f: () => 1, k: 1 } });
    expect(hit).toEqual({ path: 'zzz.f', kind: 'function' });
  });

  it('the exact #161 reverify repro ({zzz:{a:undefined,f:fn,k:1}}) reports the FIRST offender in insertion order', () => {
    const hit = findUnsendableArgValue({ zzz: { a: undefined, f: () => 1, k: 1 } });
    expect(hit).toEqual({ path: 'zzz.a', kind: 'undefined' });
  });

  it('a function value nested inside an array is detected, with an indexed path', () => {
    const hit = findUnsendableArgValue({ list: [1, () => 2] });
    expect(hit).toEqual({ path: 'list[1]', kind: 'function' });
  });

  it('an explicit TOP-LEVEL own-key undefined is NOT flagged (the legitimate, encodable shape)', () => {
    expect(findUnsendableArgValue({ n: undefined, s: 'x' })).toBeNull();
  });

  it('an undefined value NESTED inside an object (not top-level) is detected', () => {
    const hit = findUnsendableArgValue({ zzz: { a: undefined, k: 1 } });
    expect(hit).toEqual({ path: 'zzz.a', kind: 'undefined' });
  });

  it('an undefined value nested inside an array is detected', () => {
    const hit = findUnsendableArgValue({ list: [1, undefined] });
    expect(hit).toEqual({ path: 'list[1]', kind: 'undefined' });
  });

  it('a symbol value anywhere is detected', () => {
    const hit = findUnsendableArgValue({ s: Symbol('x') });
    expect(hit).toEqual({ path: 's', kind: 'symbol' });
  });

  it('a clean plain-data args object (including a top-level explicit undefined) returns null', () => {
    expect(findUnsendableArgValue({ n: 3, s: 'x', n2: undefined, nested: { a: 1, b: [1, 2, 'x'] }, arr: [1, { c: 2 }] })).toBeNull();
  });

  it('a circular object does not infinite-loop or crash — returns null (the existing circular-value path, RESULT_NOT_SERIALIZABLE, still catches it)', () => {
    const obj: Record<string, unknown> = { a: 1 };
    obj['self'] = obj;
    expect(findUnsendableArgValue({ x: obj })).toBeNull();
  });

  it('a non-record args value (array, string, non-object) returns null — the existing top-level shape check (validateDeclaredArgs) owns that case', () => {
    for (const v of [['a'], 'x', 3, null, undefined]) {
      expect(findUnsendableArgValue(v)).toBeNull();
    }
  });
});

// Issue #161 (round-3 INFO): "a undefined value" is a grammar bug — 'undefined' starts with a
// vowel sound, so the message must read "an undefined value". 'function'/'symbol' both correctly
// take 'a' already; pinned here too so a future regression (or a new `kind` added with the wrong
// hardcoded article) is caught for every current value, not just the one that was wrong.
describe('unsendableArgMessage (#161 round-3: "a <kind> value" grammar)', () => {
  it('uses "an undefined value" (not "a undefined value")', () => {
    const msg = unsendableArgMessage({ path: 'zzz.a', kind: 'undefined' });
    expect(msg).toContain('args.zzz.a is an undefined value,');
    expect(msg).not.toContain('is a undefined value');
  });

  it('uses "a function value"', () => {
    const msg = unsendableArgMessage({ path: 'f', kind: 'function' });
    expect(msg).toContain('args.f is a function value,');
  });

  it('uses "a symbol value"', () => {
    const msg = unsendableArgMessage({ path: 's', kind: 'symbol' });
    expect(msg).toContain('args.s is a symbol value,');
  });
});
