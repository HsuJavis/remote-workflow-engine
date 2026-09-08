// UT-192 (DES-181, ARCH-118, ADR-037, TASK-181, v26, REQ-127/REQ-120): `parseBudget(v, {source}) →
// {usd, tokens}` — the ONE door. `'wire'`: null/undefined → unbounded; an object → validated; a
// NUMBER → INVALID_ARGUMENT (the v26 breaking change). `'store'`: a number → `{usd:null, tokens:n}`
// (its true v25 meaning, a lossless rehydration for an in-flight pre-v26 run). Written test-first
// (Gate 5, RED): `parseBudget` does not exist yet — whole-file import failure.
// Mock policy (unit): pure function, no I/O.
import { describe, it, expect } from 'vitest';
import { parseBudget } from '../../src/run-guard.js';

describe('parseBudget — one door, two sources, a bare number means different things (UT-192, DES-181)', () => {
  it.each([
    ['wire', null, { usd: null, tokens: null }],
    ['wire', undefined, { usd: null, tokens: null }],
    ['wire', { usd: 5 }, { usd: 5, tokens: null }],
    ['wire', { tokens: 5000 }, { usd: null, tokens: 5000 }],
    ['wire', { usd: 5, tokens: 5000 }, { usd: 5, tokens: 5000 }],
  ] as const)('%s %o -> %o', (source, value, expected) => {
    expect(parseBudget(value as unknown, { source })).toEqual(expected);
  });

  it('wire: a bare number is refused (INVALID_ARGUMENT)', () => {
    expect(() => parseBudget(200000, { source: 'wire' })).toThrow(/INVALID_ARGUMENT/);
  });

  it('wire: {} (no keys at all) is refused', () => {
    expect(() => parseBudget({}, { source: 'wire' })).toThrow();
  });

  it('wire: a negative usd is refused', () => {
    expect(() => parseBudget({ usd: -1 }, { source: 'wire' })).toThrow();
  });

  it('store: a persisted legacy NUMBER rehydrates as {usd:null, tokens:n} — its true v25 meaning', () => {
    expect(parseBudget(200000, { source: 'store' })).toEqual({ usd: null, tokens: 200000 });
  });

  it('store: null/undefined still means unbounded', () => {
    expect(parseBudget(null, { source: 'store' })).toEqual({ usd: null, tokens: null });
  });

  it('the wire refusal message names the USD/tokens migration', () => {
    try {
      parseBudget(200000, { source: 'wire' });
      throw new Error('did not throw');
    } catch (err) {
      expect(String(err)).toMatch(/usd/i);
      expect((err as any).detail?.migration?.tokens).toBe(200000);
    }
  });
});

// UT-205 (DES-181, TASK-181, v26): the two refusal arms `parseBudget`'s own coverage showed no test
// reached — a non-object/array `budget` (line 80) and an unknown key (line 85). Both are the shapes
// a hand-rolled MCP client actually sends, and both must refuse with a code the caller can act on,
// not fall through to `parseField` and read `undefined` as "not set".
// Mock policy (unit): pure function, no I/O.
describe('parseBudget — the two refusals with no reader (UT-205, DES-181)', () => {
  it.each([
    ['a string', '200000'],
    ['an array', [200000]],
    ['a boolean', true],
  ] as const)('wire: %s is refused as neither null, a number, nor {usd?,tokens?}', (_label, value) => {
    expect(() => parseBudget(value as unknown, { source: 'wire' })).toThrow(/must be null, a number .* or \{usd\?, tokens\?\}/);
  });

  it('store: the same non-object refusal applies on the store side too (a corrupt row is not silently unbounded)', () => {
    expect(() => parseBudget('200000' as unknown, { source: 'store' })).toThrow(/must be null, a number/);
  });

  it('an unknown key is refused BY NAME, on either source', () => {
    for (const source of ['wire', 'store'] as const) {
      expect(() => parseBudget({ usd: 5, credits: 10 } as unknown, { source })).toThrow(/unknown key 'credits'/);
    }
  });

  it('the unknown-key refusal fires BEFORE the empty-object refusal, so `{typo: 1}` names the typo', () => {
    try {
      parseBudget({ tokenz: 5000 } as unknown, { source: 'wire' });
      throw new Error('did not throw');
    } catch (err) {
      expect(String(err)).toMatch(/unknown key 'tokenz'/);
      expect(String(err)).not.toMatch(/at least one of/);
    }
  });
});
