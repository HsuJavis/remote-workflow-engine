// UT-078: `classifyStability` pure function — paid/curated→stable, local→variable, free/besteffort→best-effort (DES-075, ARCH-050, TASK-075)
// UT-079: `computeCostLevel` pure function — free→0, unknown→null, price bands monotonic (DES-075, ARCH-050, TASK-075)
// UT-080: `enrichModelEntry` composition — all new fields present, capability capped at 200, empty fallback (DES-075, ARCH-050, TASK-075)
// UT-081: `costLevel` monotonicity property test — sorted by maxPricePerMOf → costLevel non-decreasing (DES-075, ARCH-050, TASK-075)
//
// Red reason: `enrichModelEntry`, `classifyStability`, `computeCostLevel`, `maxPricePerMOf` are not
//   exported from `src/models/model-catalog.ts` yet.
//   → "TypeError: enrichModelEntry is not a function" (or similar for the others) at test runtime.
//   Note: `maxPricePerMOf` is CURRENTLY an unexported internal function in model-catalog.ts (line 212).
//   DES-075 says it will be promoted to an export. All 4 named exports are absent today.
//
// Mock policy (unit): pure model-entry fixtures — no I/O, no network.

import { describe, it, expect } from 'vitest';
import {
  enrichModelEntry,
  classifyStability,
  computeCostLevel,
  maxPricePerMOf,
} from '../../src/models/model-catalog.js';
import type { ModelEntry } from '../../src/models/model-catalog.js';

// ---- fixture helpers ----

// v26 (DES-178, ARCH-116, TASK-178): `price` is now the DERIVED display string and `ratesPerM` is
// the numeric source of truth `maxPricePerMOf`/`computeCostLevel`/`ModelBook` all read. These UT-079
// /UT-081 fixtures were written when the display string WAS the source, so every one of them would
// otherwise describe an unpriced model and `computeCostLevel` would correctly answer `null`.
// Deriving the rates from the same `price` each case already declares keeps every case's intent —
// and its oracle — exactly as written; only where the fixture states its price has moved.
function ratesFor(price: ModelEntry['price']): ModelEntry['ratesPerM'] {
  if (price === 'unknown') return null;
  if (price === 'free') return { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 };
  const perToken = (s: string): number => Number(s.replace(/[^0-9.]/g, '')) / 1_000_000;
  const inRate = perToken(price.in);
  return { in: inRate, out: perToken(price.out), cacheRead: inRate, cacheWrite: inRate };
}

function makeEntry(overrides: Partial<ModelEntry> & { model?: string }): ModelEntry {
  const price = overrides.price ?? { in: '$1.00/1M', out: '$3.00/1M' };
  return {
    provider: 'anthropic',
    model: overrides.model ?? 'test-model',
    description: 'A test model',
    modalities: { in: ['text'], out: ['text'] },
    contextWindow: 200_000,
    price,
    toolUse: true,
    location: 'remote',
    ratesPerM: ratesFor(price),
    ...overrides,
  };
}

// ============================================================
// UT-078 — classifyStability
// ============================================================

describe('classifyStability (UT-078, DES-075)', () => {
  it('paid/curated anthropic → stable', () => {
    const e = makeEntry({ provider: 'anthropic', location: 'remote' });
    expect(classifyStability(e)).toBe('stable');
  });

  it('paid/curated openai → stable', () => {
    const e = makeEntry({ provider: 'openai', location: 'remote' });
    expect(classifyStability(e)).toBe('stable');
  });

  it('local Ollama model → variable', () => {
    const e = makeEntry({ provider: 'ollama', location: 'local', price: 'free' });
    expect(classifyStability(e)).toBe('variable');
  });

  it('openrouter :free model → best-effort', () => {
    const e = makeEntry({ provider: 'openrouter', model: 'meta/llama3:free', location: 'remote', price: 'free', besteffort: true });
    expect(classifyStability(e)).toBe('best-effort');
  });

  it('openrouter besteffort flag → best-effort', () => {
    const e = makeEntry({ provider: 'openrouter', model: 'some/model', location: 'remote', besteffort: true });
    expect(classifyStability(e)).toBe('best-effort');
  });

  it('openrouter paid (no :free, no besteffort) → stable', () => {
    const e = makeEntry({ provider: 'openrouter', model: 'anthropic/claude-3', location: 'remote', price: { in: '$1/1M', out: '$3/1M' } });
    expect(classifyStability(e)).toBe('stable');
  });
});

// ============================================================
// UT-079 — computeCostLevel
// ============================================================

describe('computeCostLevel (UT-079, DES-075)', () => {
  it("'free' price → costLevel 0", () => {
    const e = makeEntry({ price: 'free' });
    expect(computeCostLevel(e)).toBe(0);
  });

  it("'unknown' price → costLevel null (never guessed)", () => {
    const e = makeEntry({ price: 'unknown' });
    expect(computeCostLevel(e)).toBeNull();
  });

  it('local Ollama (free) → costLevel 0', () => {
    const e = makeEntry({ provider: 'ollama', location: 'local', price: 'free' });
    expect(computeCostLevel(e)).toBe(0);
  });

  it('a cheap model has a lower costLevel than an expensive one', () => {
    const cheap = makeEntry({ price: { in: '$0.10/1M', out: '$0.20/1M' } });
    const expensive = makeEntry({ price: { in: '$10.00/1M', out: '$30.00/1M' } });
    const cheapLevel = computeCostLevel(cheap);
    const expensiveLevel = computeCostLevel(expensive);
    expect(cheapLevel).not.toBeNull();
    expect(expensiveLevel).not.toBeNull();
    expect(cheapLevel!).toBeLessThanOrEqual(expensiveLevel!);
  });

  it('costLevel is an integer (never a fractional)', () => {
    const e = makeEntry({ price: { in: '$1.00/1M', out: '$3.00/1M' } });
    const level = computeCostLevel(e);
    if (level !== null) {
      expect(Number.isInteger(level)).toBe(true);
    }
  });

  it('costLevel is in range 0–10', () => {
    const prices = [
      'free' as const,
      { in: '$0.01/1M', out: '$0.02/1M' },
      { in: '$1.00/1M', out: '$3.00/1M' },
      { in: '$5.00/1M', out: '$15.00/1M' },
      { in: '$15.00/1M', out: '$75.00/1M' },
    ];
    for (const price of prices) {
      const level = computeCostLevel(makeEntry({ price }));
      if (level !== null) {
        expect(level).toBeGreaterThanOrEqual(0);
        expect(level).toBeLessThanOrEqual(10);
      }
    }
  });

  it('the most expensive tier clamps to 10, never above', () => {
    const veryExpensive = makeEntry({ price: { in: '$999.00/1M', out: '$999.00/1M' } });
    expect(computeCostLevel(veryExpensive)).toBe(10);
  });
});

// ============================================================
// UT-080 — enrichModelEntry composition
// ============================================================

describe('enrichModelEntry (UT-080, DES-075)', () => {
  it('returns all new fields: capability, stability, costLevel', () => {
    const e = makeEntry({ provider: 'anthropic', price: { in: '$3.00/1M', out: '$15.00/1M' } });
    const enriched = enrichModelEntry(e);
    expect(typeof enriched.capability).toBe('string');
    expect(['stable', 'variable', 'best-effort']).toContain(enriched.stability);
    expect(enriched.costLevel === null || typeof enriched.costLevel === 'number').toBe(true);
  });

  it('capability is capped at 200 chars', () => {
    const longDesc = 'A'.repeat(300);
    const e = makeEntry({ description: longDesc });
    const enriched = enrichModelEntry(e);
    expect(enriched.capability.length).toBeLessThanOrEqual(200);
  });

  it('capability capped at 200 ends with ellipsis when truncated', () => {
    const longDesc = 'B'.repeat(300);
    const e = makeEntry({ description: longDesc });
    const enriched = enrichModelEntry(e);
    if (enriched.capability.length === 200) {
      expect(enriched.capability.endsWith('…')).toBe(true);
    }
  });

  it('empty/null description → capability is a non-empty fallback string, never null', () => {
    const e = makeEntry({ description: '', provider: 'anthropic' });
    const enriched = enrichModelEntry(e);
    expect(enriched.capability).toBeTruthy();
    expect(enriched.capability).not.toBeNull();
    expect(typeof enriched.capability).toBe('string');
  });

  it('modalities.in and modalities.out are present (surfaced from ModelEntry)', () => {
    const e = makeEntry({ modalities: { in: ['text', 'image'], out: ['text'] } });
    const enriched = enrichModelEntry(e);
    expect(enriched.modalities.in).toEqual(['text', 'image']);
    expect(enriched.modalities.out).toEqual(['text']);
  });

  it('all original ModelEntry fields are preserved in enriched entry', () => {
    const e = makeEntry({ provider: 'openai', model: 'gpt-4o', aliases: ['gpt4'] }); // v26/D11 rename
    const enriched = enrichModelEntry(e);
    expect(enriched.provider).toBe('openai');
    expect(enriched.model).toBe('gpt-4o');
    expect(enriched.aliases).toEqual(['gpt4']);
  });

  it('does NOT add cmd/argv/cmdline fields (clean enrichment only)', () => {
    const e = makeEntry({});
    const enriched = enrichModelEntry(e) as unknown as Record<string, unknown>;
    expect('cmd' in enriched).toBe(false);
    expect('argv' in enriched).toBe(false);
    expect('cmdline' in enriched).toBe(false);
  });
});

// ============================================================
// UT-081 — costLevel monotonicity property test (DES-075, ARCH-050)
//
// The property: for a list of entries sorted by maxPricePerMOf(price) ascending,
// their computeCostLevel must be non-decreasing.
// This test uses the SAME maxPricePerMOf scalar (as per ARCH-050's decision) to avoid
// spurious failures when in/out prices cross.
// ============================================================

describe('costLevel monotonicity w.r.t. maxPricePerMOf (UT-081, DES-075)', () => {
  function entryWithPrice(priceStr: string): ModelEntry {
    // "0.01" → { in: '$0.01/1M', out: '$0.01/1M' }
    return makeEntry({ price: { in: `$${priceStr}/1M`, out: `$${priceStr}/1M` } });
  }

  it('costLevel is non-decreasing when entries are sorted by maxPricePerMOf ascending', () => {
    const pricedEntries: ModelEntry[] = [
      makeEntry({ price: 'free' }),
      entryWithPrice('0.10'),
      entryWithPrice('0.50'),
      entryWithPrice('1.00'),
      entryWithPrice('3.00'),
      entryWithPrice('10.00'),
      entryWithPrice('30.00'),
    ];

    // Sort by maxPricePerMOf ascending (free=0, unknown=null goes to end but we have no unknown here)
    const sorted = [...pricedEntries].sort((a, b) => {
      const pa = maxPricePerMOf(a.ratesPerM ?? null) ?? Infinity;
      const pb = maxPricePerMOf(b.ratesPerM ?? null) ?? Infinity;
      return pa - pb;
    });

    let prevLevel: number | null = null;
    for (const entry of sorted) {
      const level = computeCostLevel(entry);
      if (level !== null && prevLevel !== null) {
        expect(level).toBeGreaterThanOrEqual(prevLevel);
      }
      if (level !== null) prevLevel = level;
    }
  });

  it('a cheaper model never has a higher costLevel than a dearer one', () => {
    const cheap = entryWithPrice('0.20');
    const expensive = entryWithPrice('20.00');
    const cheapLevel = computeCostLevel(cheap)!;
    const expensiveLevel = computeCostLevel(expensive)!;
    expect(cheapLevel).toBeLessThanOrEqual(expensiveLevel);
  });

  it('free (local Ollama) has costLevel 0 — the minimum', () => {
    const local = makeEntry({ provider: 'ollama', location: 'local', price: 'free' });
    expect(computeCostLevel(local)).toBe(0);
  });
});
