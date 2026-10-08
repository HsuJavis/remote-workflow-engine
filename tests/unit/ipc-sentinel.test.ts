// Issue #161 B2: encodeExplicitUndefined/decodeExplicitUndefined — the sentinel pair that lets an
// explicit own-key `undefined` survive Node's IPC 'json' serialization (which JSON.stringify would
// otherwise drop silently: `JSON.stringify({n: undefined})` === `'{}'`).
//
// Mock policy (unit): pure functions, no I/O, no subprocess — the real IPC round-trip is covered
// separately by run-args-resume.test.ts / an acceptance-level nested workflow() case.
import { describe, it, expect } from 'vitest';
import { encodeExplicitUndefined, decodeExplicitUndefined, IPC_EXPLICIT_UNDEFINED } from '../../src/sandbox/ipc-sentinel.js';

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
