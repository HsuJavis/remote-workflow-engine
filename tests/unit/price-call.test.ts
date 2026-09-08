// UT-189 (DES-180, ARCH-118, TASK-180, v26): `priceCall(tokens, rates) → number|null` — pure,
// `Σ tokens[k] × rates[k]`, `null` only when rates are `null`; `sumTokens(t) → number`. Written
// test-first (Gate 5, RED): neither function exists yet in src/types.ts / the capture site —
// whole-file import failure.
// Mock policy (unit): pure functions, no I/O.
import { describe, it, expect } from 'vitest';
import { priceCall, sumTokens, ZERO_TOKENS } from '../../src/run-guard.js';

describe('priceCall — four-column price, null survives exactly one hop (UT-189, DES-180)', () => {
  it('sums four non-zero columns against four non-zero rates', () => {
    const tokens = { input: 1000, output: 500, cacheRead: 2000, cacheWrite: 300 };
    const rates = { in: 0.000003, out: 0.000015, cacheRead: 0.0000003, cacheWrite: 0.00000375 };
    const expected = 1000 * 0.000003 + 500 * 0.000015 + 2000 * 0.0000003 + 300 * 0.00000375;
    expect(priceCall(tokens, rates)).toBeCloseTo(expected, 10);
  });

  it('zero tokens against real rates prices to 0', () => {
    expect(priceCall(ZERO_TOKENS, { in: 1, out: 1, cacheRead: 1, cacheWrite: 1 })).toBe(0);
  });

  it('rates: null yields null (never 0)', () => {
    expect(priceCall({ input: 10, output: 10, cacheRead: 0, cacheWrite: 0 }, null)).toBeNull();
  });

  it('an all-zero rate (ollama) yields 0, not null', () => {
    expect(priceCall({ input: 1000, output: 1000, cacheRead: 0, cacheWrite: 0 }, { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 })).toBe(0);
  });

  it('sumTokens sums all four columns', () => {
    expect(sumTokens({ input: 1, output: 2, cacheRead: 3, cacheWrite: 4 })).toBe(10);
  });

  it('1000 calls of ~1e-3 USD sum correct to 2 decimal places', () => {
    const rates = { in: 0.000003, out: 0.000015, cacheRead: 0, cacheWrite: 0 };
    let total = 0;
    for (let i = 0; i < 1000; i++) {
      total += priceCall({ input: 100, output: 50, cacheRead: 0, cacheWrite: 0 }, rates) ?? 0;
    }
    expect(Number(total.toFixed(2))).toBeCloseTo(1.05, 2);
  });
});
