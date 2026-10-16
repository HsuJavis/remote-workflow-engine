// UT-357 (DES-279, ARCH-190/191, ruling R-4, REQ-225, TASK-275): the per-image-output rate survives
// a token price of 0 — end to end through the REAL pricing path: OpenRouter row → `buildCatalog` →
// `ModelBook` pin (`BookEntry.price`) → `primitivePriceKnowable`/`pricePrimitiveCall`. A row with
// `prompt:'0', completion:'0', image_output>0` must never price a generateImage() call at $0.
//
// Unit (DES-279): `imageOutPerM` = USD per 1M image-output tokens = `Number(pricing.image_output) ×
// 1e6` (OpenRouter's `image_output` is per image-output token). It lives on the catalog row as a
// top-level `ModelEntry.imageOutPerM` (never inside the display `price` object) and on the pin's
// `FourRates.imageOutPerM`; the estimate divides it back by 1e6.
//
// Mock policy (unit): an inline OpenRouter `/models` body through a fake fetch (no network), the
// real parser, the real ModelBook, the real pricing functions.
//
// Red reason: `displayPrice` collapses 0/0 rates to the string 'free' and `imageOutPerM` was only
// ever attached to an OBJECT price, so it is dropped on exactly this row; and `ratesPerM` (the pin's
// source) never carries `imageOutPerM` at all — the pin prices the image output at `out = 0`, i.e.
// a known, priced call recorded as $0 (`source:'estimated'`, `costUSD:0`).
import { describe, it, expect } from 'vitest';
import { buildCatalog } from '../../src/models/model-catalog.js';
import { ModelBook } from '../../src/models/model-book.js';
import { primitivePriceKnowable, pricePrimitiveCall } from '../../src/run-guard.js';
import { FixedClock } from '../../src/clock.js';

const PIXEL = {
  id: 'acme/pixel-1',
  name: 'Pixel 1',
  description: 'image-only model priced per image-output token',
  context_length: 4096,
  architecture: { input_modalities: ['text'], output_modalities: ['image'] },
  pricing: { prompt: '0', completion: '0', image_output: '0.00004' },
  supported_parameters: [],
};

async function catalogRows() {
  const fixture = { data: [PIXEL] };
  return buildCatalog({
    includeStatic: false,
    openrouterFetch: (async () => new Response(JSON.stringify(fixture), { status: 200 })) as typeof fetch,
    ollamaFetch: (async () => { throw new Error('no ollama'); }) as typeof fetch,
  });
}

describe('UT-357: per-image rate survives a 0/0 token price (R-4, DES-279)', () => {
  it('the catalog row carries imageOutPerM = image_output × 1e6 independently of the token price string', async () => {
    const rows = await catalogRows();
    const row = rows.find((r) => r.model === 'acme/pixel-1') as unknown as { imageOutPerM?: number; modelType: string };
    expect(row).toBeDefined();
    expect(row.modelType).toBe('image-gen');
    expect(row.imageOutPerM).toBe(40);
  });

  it('the ModelBook pin for that row carries price.imageOutPerM', async () => {
    const book = new ModelBook(catalogRows, { clock: new FixedClock(new Date('2026-10-16T00:00:00Z')) });
    const entry = (await book.snapshot()).lookup('openrouter', 'acme/pixel-1');
    expect(entry.price?.imageOutPerM).toBe(40);
  });

  it('a generateImage() call with reported tokens is estimated at the image rate, never $0', async () => {
    const book = new ModelBook(catalogRows, { clock: new FixedClock(new Date('2026-10-16T00:00:00Z')) });
    const entry = (await book.snapshot()).lookup('openrouter', 'acme/pixel-1');
    expect(primitivePriceKnowable(entry, 'image')).toBe(true);
    const tokens = { input: 10, output: 1290, cacheRead: 0, cacheWrite: 0 };
    const r = pricePrimitiveCall({ wireCostUSD: null, tokens, entry, kind: 'image' });
    expect(r).toMatchObject({ source: 'estimated' });
    expect((r as { costUSD: number }).costUSD).toBeCloseTo(1290 * 40 / 1e6, 10);
    expect((r as { costUSD: number }).costUSD).toBeGreaterThan(0);
  });
});
