// UT-186 (DES-178, ARCH-116, TASK-178, v26): `maxPricePerMOf` is repointed to read the numeric
// `FourRates` shape directly (`max(in, out) × 1e6`) rather than regex-parsing the derived "$X/1M"
// display string — the display string becomes DERIVED from the rates, human-facing only. Written
// test-first (Gate 5, RED): today `maxPricePerMOf(price: ModelEntry['price'])` expects
// `{in:string,out:string}|'free'|'unknown'` and has no branch for a numeric FourRates object — it
// mis-parses one (its internal regex finds nothing to match) and returns null instead of a number.
// Mock policy (unit): pure function, no I/O.
import { describe, it, expect } from 'vitest';
import { maxPricePerMOf } from '../../src/models/model-catalog.js';

describe('maxPricePerMOf reads FourRates directly, ignoring the two cache rates (UT-186, DES-178)', () => {
  it('max(in, out) x 1e6 for a typical rate pair', () => {
    expect(maxPricePerMOf({ in: 0.000003, out: 0.000015, cacheRead: 0.0000003, cacheWrite: 0.00000375 } as any)).toBe(15);
  });

  it('ignores the two cache rates even when they exceed in/out', () => {
    expect(maxPricePerMOf({ in: 0.000001, out: 0.000001, cacheRead: 0.0001, cacheWrite: 0.0001 } as any)).toBe(1);
  });

  it('null rates yield null', () => {
    expect(maxPricePerMOf(null as any)).toBeNull();
  });

  it('all-zero (ollama) rates yield 0, not null', () => {
    expect(maxPricePerMOf({ in: 0, out: 0, cacheRead: 0, cacheWrite: 0 } as any)).toBe(0);
  });
});
