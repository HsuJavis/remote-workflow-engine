// UT-185 (DES-178, ARCH-116, ADR-038, TASK-178, v26): `ModelBook` — a TTL'd, single-flight catalog
// snapshot answering price (four rates) and declared capability per (provider, model). Written
// test-first (Gate 5, RED): `src/models/model-book.ts` does not exist yet — whole-file import
// failure.
// Mock policy (unit): pure lookups + one loader class; inject a fake `source()` and a FakeClock.
import { describe, it, expect } from 'vitest';
import { ModelBook } from '../../src/models/model-book.js';
import { buildCatalog, STATIC_ANTHROPIC_RATES } from '../../src/models/model-catalog.js';
import { FixedClock } from '../../src/clock.js';

function fakeSource(entries: any[]) {
  let calls = 0;
  return { fn: async () => { calls += 1; return entries; }, calls: () => calls };
}

describe('ModelBook — TTL, single-flight, last-good/static (UT-185, DES-178)', () => {
  it('two snapshot() calls inside the TTL window invoke source() ONCE', async () => {
    const clock = new FixedClock(new Date('2026-09-08T00:00:00Z'));
    const src = fakeSource([]);
    const book = new ModelBook(src.fn, { ttlMs: 3_600_000, clock });
    await book.snapshot();
    await book.snapshot();
    expect(src.calls()).toBe(1);
  });

  it('past the TTL, a second snapshot() call invokes source() again', async () => {
    let now = new Date('2026-09-08T00:00:00Z').getTime();
    const clock = { now: () => now, isoNow: () => new Date(now).toISOString() };
    const src = fakeSource([]);
    const book = new ModelBook(src.fn, { ttlMs: 1000, clock: clock as any });
    await book.snapshot();
    now += 2000;
    await book.snapshot();
    expect(src.calls()).toBe(2);
  });

  it('24 concurrent snapshot() calls against a deferred source invoke it ONCE (single-flight)', async () => {
    const clock = new FixedClock(new Date('2026-09-08T00:00:00Z'));
    let calls = 0;
    let resolveFn: (v: any[]) => void;
    const deferred = new Promise<any[]>((r) => { resolveFn = r; });
    const source = async () => { calls += 1; return deferred; };
    const book = new ModelBook(source, { ttlMs: 3_600_000, clock });
    const promises = Array.from({ length: 24 }, () => book.snapshot());
    resolveFn!([]);
    await Promise.all(promises);
    expect(calls).toBe(1);
  });

  it('source() throwing after one good load falls back to "last-good"', async () => {
    let now = new Date('2026-09-08T00:00:00Z').getTime();
    const clock = { now: () => now, isoNow: () => new Date(now).toISOString() };
    let fail = false;
    const source = async () => { if (fail) throw new Error('down'); return [{ provider: 'openrouter', model: 'x', pricing: {} }]; };
    const book = new ModelBook(source, { ttlMs: 1000, clock: clock as any });
    await book.snapshot();
    now += 2000;
    fail = true;
    const snap = await book.snapshot();
    expect(snap.source).toBe('last-good');
  });

  it('source() throwing with no prior load falls back to "static" — anthropic still priced', async () => {
    const clock = new FixedClock(new Date('2026-09-08T00:00:00Z'));
    const source = async () => { throw new Error('down'); };
    const book = new ModelBook(source, { ttlMs: 3_600_000, clock });
    const snap = await book.snapshot();
    expect(snap.source).toBe('static');
    const entry = snap.lookup('anthropic', 'claude-haiku-4-5-20251001');
    expect(entry.price).not.toBeNull();
  });

  it('lookup: ollama is priced all-zero, never null', async () => {
    const clock = new FixedClock(new Date('2026-09-08T00:00:00Z'));
    const book = new ModelBook(async () => [], { ttlMs: 3_600_000, clock });
    const snap = await book.snapshot();
    const entry = snap.lookup('ollama', 'qwen2.5:7b');
    expect(entry.price).toEqual({ in: 0, out: 0, cacheRead: 0, cacheWrite: 0 });
  });

  it('lookup: an unlisted provider/model is priced null', async () => {
    const clock = new FixedClock(new Date('2026-09-08T00:00:00Z'));
    const book = new ModelBook(async () => [], { ttlMs: 3_600_000, clock });
    const snap = await book.snapshot();
    const entry = snap.lookup('openrouter', 'no-such-model');
    expect(entry.price).toBeNull();
  });

  it('lookup: openrouter full pricing including cache rates', async () => {
    const clock = new FixedClock(new Date('2026-09-08T00:00:00Z'));
    const source = async () => [{
      provider: 'openrouter', model: 'anthropic/claude-sonnet-5',
      pricing: { prompt: '0.000003', completion: '0.000015', input_cache_read: '0.0000003', input_cache_write: '0.00000375' },
      supported_parameters: ['reasoning', 'tools'],
    }];
    const book = new ModelBook(source, { ttlMs: 3_600_000, clock });
    const snap = await book.snapshot();
    const entry = snap.lookup('openrouter', 'anthropic/claude-sonnet-5');
    expect(entry.price).toEqual({ in: 0.000003, out: 0.000015, cacheRead: 0.0000003, cacheWrite: 0.00000375 });
    expect(entry.caps.reasoning).toBe(true);
  });

  it('lookup: openrouter missing cache rate prices at the prompt rate (upper bound)', async () => {
    const clock = new FixedClock(new Date('2026-09-08T00:00:00Z'));
    const source = async () => [{ provider: 'openrouter', model: 'm', pricing: { prompt: '0.000002', completion: '0.00001' } }];
    const book = new ModelBook(source, { ttlMs: 3_600_000, clock });
    const snap = await book.snapshot();
    const entry = snap.lookup('openrouter', 'm');
    expect(entry.price?.cacheRead).toBe(0.000002);
  });

  it('lookup: an openrouter parse failure yields price:null, never 0', async () => {
    const clock = new FixedClock(new Date('2026-09-08T00:00:00Z'));
    const source = async () => [{ provider: 'openrouter', model: 'm', pricing: { prompt: 'garbage', completion: 'garbage' } }];
    const book = new ModelBook(source, { ttlMs: 3_600_000, clock });
    const snap = await book.snapshot();
    expect(snap.lookup('openrouter', 'm').price).toBeNull();
  });
});

// UT-223 (v26 Gate 7.5 round 3, defect D9): the index build itself. A curated alias table with TWO
// aliases on ONE model — the shape EVERY Anthropic model has on the real deployment
// (`haiku` and `claude-haiku-4-5` both -> anthropic/claude-haiku-4-5-20251001) — made
// `overlayAliases` append a second, `ratesPerM:null` row for that model, and the last writer of a
// key won: the priced static row was overwritten by the unpriced duplicate, `lookup()` answered
// `price:null` (its own static fallback is never reached — the key WAS found), so every real
// Anthropic call recorded `costUSD 0 / unpriced:true` and a USD budget could never bind.
// Mock policy (unit): the same injected `source()`/FakeClock as UT-185 above; `buildCatalog`'s two
// live fetchers are stubbed non-ok so only the static table + the alias overlay remain.
describe('ModelBook — a duplicate alias must not un-price a model (UT-223, D9, REQ-127)', () => {
  const notOk = (async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch;

  /** The production table verbatim in shape: five models, two aliases each. */
  const PRODUCTION_ALIASES = {
    local: { provider: 'ollama', model: 'qwen2.5:7b' },
    default: { provider: 'ollama', model: 'qwen2.5:7b' },
    sonnet: { provider: 'anthropic', model: 'claude-sonnet-5' },
    opus: { provider: 'anthropic', model: 'claude-opus-4-8' },
    haiku: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
    'claude-sonnet-4-6': { provider: 'anthropic', model: 'claude-sonnet-5' },
    'claude-opus-4-8': { provider: 'anthropic', model: 'claude-opus-4-8' },
    'claude-haiku-4-5': { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
  } as const;

  it('the PRODUCTION alias table (two aliases per model) still prices every anthropic model', async () => {
    const entries = await buildCatalog({ aliases: PRODUCTION_ALIASES as never, ollamaFetch: notOk, openrouterFetch: notOk });
    const clock = new FixedClock(new Date('2026-09-09T00:00:00Z'));
    const book = new ModelBook(async () => entries, { ttlMs: 3_600_000, clock });
    const snap = await book.snapshot();
    for (const model of Object.keys(STATIC_ANTHROPIC_RATES)) {
      expect(snap.lookup('anthropic', model).price).toEqual(STATIC_ANTHROPIC_RATES[model]);
    }
  });

  it('a ratesPerM:null row never displaces a priced row for the same key', async () => {
    const clock = new FixedClock(new Date('2026-09-09T00:00:00Z'));
    const rates = STATIC_ANTHROPIC_RATES['claude-haiku-4-5-20251001'];
    const priced = { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', ratesPerM: rates };
    const unpriced = { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', ratesPerM: null };
    for (const rows of [[priced, unpriced], [unpriced, priced]]) {
      const book = new ModelBook(async () => rows, { ttlMs: 3_600_000, clock });
      const snap = await book.snapshot();
      expect(snap.lookup('anthropic', 'claude-haiku-4-5-20251001').price).toEqual(rates);
    }
  });
});
