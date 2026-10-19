// UT-351 (DES-273, ARCH-191/192, ADR-091/094, TASK-270): `primitivePriceKnowable`/
// `pricePrimitiveCall` (src/run-guard.ts, pure, beside `priceCall`). reported > estimated > absent;
// absent is NEVER 0 (the v31 "unmeasured usage is absence" rule — see also REQ-225).
//
// Red reason: neither function is exported by `run-guard.ts` yet — module import resolves both
// names to `undefined`, every call throws TypeError.
import { describe, it, expect } from 'vitest';
import { primitivePriceKnowable, pricePrimitiveCall, foldPrimitiveSpend } from '../../src/run-guard.js';
import type { BookEntry } from '../../src/types.js';

const DECIDE_ENTRY: BookEntry = { price: { in: 0.0000005, out: 0.000001, cacheRead: 0, cacheWrite: 0 }, caps: {} as never };
// v40 Gate 6 delta (DES-279, ruling R-4): `imageOutPerM` lives INSIDE `price` (FourRates) — the
// original fixture put it beside `price`, where nothing reads it, so this case was red for the wrong
// reason. Unit: USD per 1M image-output tokens (= OpenRouter `image_output` × 1e6).
const IMAGE_ENTRY_WITH_IMAGE_OUT: BookEntry = { price: { in: 0.0000003, out: 0, cacheRead: 0, cacheWrite: 0, imageOutPerM: 30 }, caps: {} as never };
const IMAGE_ENTRY_NO_IMAGE_OUT_BUT_PRICED: BookEntry = { price: { in: 0.0000003, out: 0.0000025, cacheRead: 0, cacheWrite: 0 }, caps: {} as never };
const UNPRICED_ENTRY: BookEntry = { price: null, caps: {} as never };

describe('UT-351: primitivePriceKnowable (DES-273)', () => {
  it('decide: knowable when the entry has finite in AND out rates', () => {
    expect(primitivePriceKnowable(DECIDE_ENTRY, 'decide')).toBe(true);
  });

  it('decide: not knowable when the entry is unpriced', () => {
    expect(primitivePriceKnowable(UNPRICED_ENTRY, 'decide')).toBe(false);
  });

  it('decide: not knowable when the entry is undefined', () => {
    expect(primitivePriceKnowable(undefined, 'decide')).toBe(false);
  });

  it('image: knowable when imageOutPerM is set (even if "out" is 0)', () => {
    expect(primitivePriceKnowable(IMAGE_ENTRY_WITH_IMAGE_OUT, 'image')).toBe(true);
  });

  it('image: knowable when imageOutPerM is absent but "out" is itself finite (falls back to out)', () => {
    expect(primitivePriceKnowable(IMAGE_ENTRY_NO_IMAGE_OUT_BUT_PRICED, 'image')).toBe(true);
  });

  it('image: not knowable when neither imageOutPerM nor out is finite', () => {
    expect(primitivePriceKnowable(UNPRICED_ENTRY, 'image')).toBe(false);
  });
});

describe('UT-351: pricePrimitiveCall (DES-273): reported > estimated > absent', () => {
  it('reported: wireCostUSD !== null always wins, regardless of tokens', () => {
    const r = pricePrimitiveCall({ wireCostUSD: 0.0042, kind: 'decide', entry: DECIDE_ENTRY });
    expect(r).toEqual({ costUSD: 0.0042, source: 'reported' });
  });

  it('estimated: decide — no wire cost, tokens present, entry priced -> priceCall(tokens, rates)', () => {
    const tokens = { input: 100, output: 50, cacheRead: 0, cacheWrite: 0 };
    const r = pricePrimitiveCall({ wireCostUSD: null, tokens, kind: 'decide', entry: DECIDE_ENTRY });
    expect(r).toEqual({ costUSD: 100 * 0.0000005 + 50 * 0.000001, source: 'estimated' });
  });

  it('estimated: image — tokens.input×in + tokens.output×(imageOutPerM/1e6 ?? out)', () => {
    const tokens = { input: 20, output: 1290, cacheRead: 0, cacheWrite: 0 };
    const r = pricePrimitiveCall({ wireCostUSD: null, tokens, kind: 'image', entry: IMAGE_ENTRY_WITH_IMAGE_OUT });
    expect(r).toMatchObject({ source: 'estimated' });
    expect((r as { costUSD: number }).costUSD).toBeCloseTo(20 * 0.0000003 + 1290 * 30 / 1e6, 12);
  });

  it('absent: no wire cost, no tokens -> {absent:true}, NEVER {costUSD:0}', () => {
    const r = pricePrimitiveCall({ wireCostUSD: null, kind: 'decide', entry: DECIDE_ENTRY });
    expect(r).toEqual({ absent: true });
  });

  it('absent: no wire cost, tokens present, but entry unpriced -> absent', () => {
    const tokens = { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 };
    const r = pricePrimitiveCall({ wireCostUSD: null, tokens, kind: 'decide', entry: UNPRICED_ENTRY });
    expect(r).toEqual({ absent: true });
  });
});

// UT-377 (ARCH-187 v41b, Gate 8 r1 V41-A1, INV-V40-5 realization): `foldPrimitiveSpend` — the ONE
// pure fold a settling decide()/generateImage() call runs through, win or fail: prices EACH
// dispatched attempt via the SAME `pricePrimitiveCall` precedence, sums the priced ones, and ORs
// `unpriced` over every attempt (never a known $0 just because the FINAL attempt happened to price).
//
// Red reason: `foldPrimitiveSpend` is not exported by `run-guard.ts` yet.
describe('UT-377: foldPrimitiveSpend (ARCH-187 v41b) — per-attempt pricing, summed/ORed over the call', () => {
  it('a single reported attempt behaves exactly like pricePrimitiveCall did before (no regression)', () => {
    const r = foldPrimitiveSpend([{ wireCostUSD: 0.5 }], DECIDE_ENTRY, 'decide');
    expect(r).toEqual({ costUSD: 0.5, unpriced: false, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, costSource: 'reported' });
  });

  it('an absent attempt (429, no readable cost) then a reported success -> unpriced:true, costUSD is the priced sum (the absent attempt contributes nothing)', () => {
    const r = foldPrimitiveSpend([{ wireCostUSD: null }, { wireCostUSD: 0.5 }], DECIDE_ENTRY, 'decide');
    expect(r.unpriced).toBe(true);
    expect(r.costUSD).toBeCloseTo(0.5, 12);
    expect(r.costSource).toBe('reported');
  });

  it('a reported attempt then an estimated attempt -> costSource prefers reported (the tier any attempt reached), costUSD sums both', () => {
    const tokens = { input: 100, output: 50, cacheRead: 0, cacheWrite: 0 };
    const r = foldPrimitiveSpend([{ wireCostUSD: 0.1 }, { wireCostUSD: null, tokens }], DECIDE_ENTRY, 'decide');
    expect(r.unpriced).toBe(false);
    expect(r.costUSD).toBeCloseTo(0.1 + (100 * 0.0000005 + 50 * 0.000001), 12);
    expect(r.costSource).toBe('reported');
  });

  it('tokens sum across every attempt, not just the priced ones', () => {
    const t1 = { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 };
    const t2 = { input: 20, output: 7, cacheRead: 1, cacheWrite: 2 };
    const r = foldPrimitiveSpend([{ wireCostUSD: null, tokens: t1 }, { wireCostUSD: 0.2, tokens: t2 }], DECIDE_ENTRY, 'decide');
    expect(r.tokens).toEqual({ input: 30, output: 12, cacheRead: 1, cacheWrite: 2 });
  });

  it('three absent attempts (429, 429, 429 — never dispatched to a success) -> unpriced:true, costUSD:0, costSource:absent, NEVER a known $0', () => {
    const r = foldPrimitiveSpend([{ wireCostUSD: null }, { wireCostUSD: null }, { wireCostUSD: null }], DECIDE_ENTRY, 'decide');
    expect(r).toEqual({ costUSD: 0, unpriced: true, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, costSource: 'absent' });
  });

  it('an empty/missing attempt list (an uncoded throw with no detail.spends at all) -> exactly one absent attempt, never a known $0', () => {
    expect(foldPrimitiveSpend([], DECIDE_ENTRY, 'decide')).toEqual({ costUSD: 0, unpriced: true, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, costSource: 'absent' });
    expect(foldPrimitiveSpend(undefined, DECIDE_ENTRY, 'decide')).toEqual({ costUSD: 0, unpriced: true, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, costSource: 'absent' });
  });
});
