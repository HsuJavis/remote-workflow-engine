// REQ-039/REQ-040: model-catalog federation, mapping, filtering, graceful degradation, secret-free.
// Unit tier: fake fetch transports — never a live network call.
import { describe, it, expect } from 'vitest';
import { buildCatalog, filterCatalog, type ModelEntry } from '../../src/models/model-catalog.js';

function jsonFetch(body: unknown, ok = true): typeof fetch {
  return (async () => ({ ok, status: ok ? 200 : 500, json: async () => body })) as unknown as typeof fetch;
}
function throwingFetch(): typeof fetch {
  return (async () => { throw new Error('network down'); }) as unknown as typeof fetch;
}

const OLLAMA_TAGS = {
  models: [
    { name: 'qwen2.5:7b', details: { family: 'qwen2', parameter_size: '7.6B' } },
    { name: 'llama3:8b', details: { family: 'llama', parameter_size: '8B' } },
  ],
};

const OPENROUTER_MODELS = {
  data: [
    {
      id: 'qwen/qwen-2.5-7b-instruct',
      name: 'Qwen 2.5 7B',
      description: 'A capable small model',
      context_length: 32768,
      pricing: { prompt: '0.0000002', completion: '0.0000006' },
      architecture: { input_modalities: ['text'], output_modalities: ['text'] },
      supported_parameters: ['tools', 'temperature'],
    },
    {
      id: 'meta-llama/llama-3.1-405b',
      description: 'A very large model',
      context_length: 131072,
      pricing: { prompt: '0.0000030', completion: '0.0000030' },
      architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
      supported_parameters: ['temperature'], // no tools
    },
    {
      id: 'free/experimental',
      description: 'A free model',
      context_length: 8192,
      pricing: { prompt: '0', completion: '0' },
      architecture: { input_modalities: ['text'], output_modalities: ['text'] },
      supported_parameters: ['tools'],
    },
  ],
};

describe('buildCatalog federation + mapping (REQ-039)', () => {
  it('maps Ollama tags to local, free, text/text entries', async () => {
    const entries = await buildCatalog({ ollamaFetch: jsonFetch(OLLAMA_TAGS), openrouterFetch: jsonFetch({ data: [] }) });
    const ollama = entries.filter((e) => e.provider === 'ollama');
    expect(ollama.map((e) => e.model)).toEqual(['qwen2.5:7b', 'llama3:8b']);
    const qwen = ollama.find((e) => e.model === 'qwen2.5:7b')!;
    expect(qwen).toMatchObject({ price: 'free', location: 'local', contextWindow: null, toolUse: 'unknown', modalities: { in: ['text'], out: ['text'] } });
    expect(qwen.description).toContain('7.6B');
  });

  it('maps OpenRouter models incl. tool support, price formatting, modalities, context', async () => {
    const entries = await buildCatalog({ ollamaFetch: jsonFetch({ models: [] }), openrouterFetch: jsonFetch(OPENROUTER_MODELS) });
    const or = entries.filter((e) => e.provider === 'openrouter');
    const qwen = or.find((e) => e.model === 'qwen/qwen-2.5-7b-instruct')!;
    expect(qwen).toMatchObject({ location: 'remote', contextWindow: 32768, toolUse: true });
    expect(qwen.price).toEqual({ in: '$0.2/1M', out: '$0.6/1M' });
    const big = or.find((e) => e.model === 'meta-llama/llama-3.1-405b')!;
    expect(big.toolUse).toBe(false);
    expect(big.modalities.in).toContain('image');
    const free = or.find((e) => e.model === 'free/experimental')!;
    expect(free.price).toBe('free');
  });

  // v26 (REQ-123, DES-173, TASK-174, issue #66): the `openai` provider is RETIRED and its sibling
  // `STATIC_OPENAI` table is deleted — anthropic is the only static table left. The property this
  // case pins is unchanged (a catalog built with both live sources empty still serves the built-in
  // static rows); the retired half is asserted ABSENT, which is the v26 fact.
  it('includes the static anthropic table, and no retired openai rows', async () => {
    const entries = await buildCatalog({ ollamaFetch: jsonFetch({ models: [] }), openrouterFetch: jsonFetch({ data: [] }) });
    expect(entries.some((e) => e.provider === 'anthropic' && e.model === 'claude-opus-4-8')).toBe(true);
    expect(entries.some((e) => e.provider === 'openai')).toBe(false);
  });

  // 2026-09-26 (alias mechanism removed): the curated-alias overlay is GONE — every row's `ref` is
  // simply `${provider}/${model}` (see the "issue #28" describe below), so there is no more
  // "alias-only entry" to add and nothing to overlay onto a matching one.
  it('degrades gracefully: a source that throws contributes nothing, the static table still returns', async () => {
    const entries = await buildCatalog({ ollamaFetch: throwingFetch(), openrouterFetch: throwingFetch() });
    expect(entries.some((e) => e.provider === 'ollama')).toBe(false);
    expect(entries.some((e) => e.provider === 'openrouter')).toBe(false);
    expect(entries.find((e) => e.model === 'claude-opus-4-8')?.provider).toBe('anthropic');
  });

  it('a non-ok live response degrades to no entries for that source', async () => {
    const entries = await buildCatalog({ ollamaFetch: jsonFetch({}, false), openrouterFetch: jsonFetch(OPENROUTER_MODELS) });
    expect(entries.some((e) => e.provider === 'ollama')).toBe(false);
    expect(entries.some((e) => e.provider === 'openrouter')).toBe(true);
  });

  it('never leaks a secret into any entry (secret-free)', async () => {
    const SECRET = 'sk-or-super-secret-value';
    process.env['OPENROUTER_API_KEY'] = SECRET;
    process.env['ANTHROPIC_API_KEY'] = SECRET;
    try {
      const entries = await buildCatalog({ ollamaFetch: jsonFetch(OLLAMA_TAGS), openrouterFetch: jsonFetch(OPENROUTER_MODELS) });
      expect(JSON.stringify(entries)).not.toContain(SECRET);
    } finally {
      delete process.env['OPENROUTER_API_KEY'];
      delete process.env['ANTHROPIC_API_KEY'];
    }
  });
});

describe('issue #28: ref (agent-ready id) + besteffort annotation', () => {
  const OR_WITH_FREE = {
    data: [
      { id: 'google/gemma-3-27b-it:free', description: 'free variant', context_length: 8192, pricing: { prompt: '0', completion: '0' }, architecture: { input_modalities: ['text'], output_modalities: ['text'] }, supported_parameters: ['tools'] },
      { id: 'anthropic/claude-3.5-sonnet', description: 'paid', context_length: 200000, pricing: { prompt: '0.000003', completion: '0.000015' }, architecture: { input_modalities: ['text'], output_modalities: ['text'] }, supported_parameters: ['tools'] },
    ],
  };

  it('an OpenRouter :free entry is besteffort:true with an openrouter/ ref; a paid one is not besteffort', async () => {
    const entries = await buildCatalog({ ollamaFetch: jsonFetch({ models: [] }), openrouterFetch: jsonFetch(OR_WITH_FREE) });
    const free = entries.find((e) => e.model === 'google/gemma-3-27b-it:free')!;
    expect(free.besteffort).toBe(true);
    expect(free.ref).toBe('openrouter/google/gemma-3-27b-it:free'); // directly usable as agent({model})
    const paid = entries.find((e) => e.model === 'anthropic/claude-3.5-sonnet')!;
    expect(paid.besteffort).toBeUndefined(); // absent, not false
    expect(paid.ref).toBe('openrouter/anthropic/claude-3.5-sonnet');
  });

  // 2026-09-26 (alias mechanism removed, owner decision 9): every row's `ref` is ALWAYS
  // `${provider}/${model}` — no alias to resolve through, no more "non-aliased entry has no ref".
  it('every anthropic static-table entry gets a ref of exactly `${provider}/${model}`', async () => {
    const entries = await buildCatalog({ ollamaFetch: jsonFetch({ models: [] }), openrouterFetch: jsonFetch({ data: [] }) });
    const opus = entries.find((e) => e.provider === 'anthropic' && e.model === 'claude-opus-4-8')!;
    expect(opus.ref).toBe('anthropic/claude-opus-4-8');
    const sonnet = entries.find((e) => e.provider === 'anthropic' && e.model === 'claude-sonnet-5')!;
    expect(sonnet.ref).toBe('anthropic/claude-sonnet-5');
    expect(sonnet.besteffort).toBeUndefined();
  });

  it('the static Haiku entry uses the real dated API id, and its ref names it exactly', async () => {
    const entries = await buildCatalog({ ollamaFetch: jsonFetch({ models: [] }), openrouterFetch: jsonFetch({ data: [] }) });
    const haiku = entries.find((e) => e.provider === 'anthropic' && e.model === 'claude-haiku-4-5-20251001')!;
    expect(haiku).toBeDefined();
    expect(haiku.ref).toBe('anthropic/claude-haiku-4-5-20251001');
  });
});

describe('filterCatalog (REQ-040)', () => {
  // v26 (DES-178): `maxPricePerM` filters on `ratesPerM`, the numeric source of truth, not on the
  // derived "$X/1M" display string — so every priced fixture states both, consistently.
  const entries: ModelEntry[] = [
    { provider: 'ollama', model: 'qwen2.5:7b', description: 'qwen local', modalities: { in: ['text'], out: ['text'] }, contextWindow: null, price: 'free', ratesPerM: { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 }, toolUse: 'unknown', location: 'local' },
    { provider: 'openrouter', model: 'qwen/qwen-2.5-7b-instruct', description: 'qwen remote', modalities: { in: ['text'], out: ['text'] }, contextWindow: 32768, price: { in: '$0.2/1M', out: '$0.6/1M' }, ratesPerM: { in: 0.2e-6, out: 0.6e-6, cacheRead: 0.2e-6, cacheWrite: 0.2e-6 }, toolUse: true, location: 'remote' },
    { provider: 'openrouter', model: 'big/model', description: 'expensive vision', modalities: { in: ['text', 'image'], out: ['text'] }, contextWindow: 200000, price: { in: '$5/1M', out: '$15/1M' }, ratesPerM: { in: 5e-6, out: 15e-6, cacheRead: 5e-6, cacheWrite: 5e-6 }, toolUse: true, location: 'remote' },
    { provider: 'anthropic', model: 'claude-opus-4-8', description: 'opus', modalities: { in: ['text', 'image'], out: ['text'] }, contextWindow: 1000000, price: { in: '$5/1M', out: '$25/1M' }, ratesPerM: { in: 5e-6, out: 25e-6, cacheRead: 5e-6, cacheWrite: 5e-6 }, toolUse: true, location: 'remote' },
  ];

  it('AND-filters: remote + toolUse + cheap + query', () => {
    // v26 (DES-179): the input filter is `toolUseDeclared`, renamed on BOTH sides in one commit with
    // no alias window (the standing v24 ruling) — same AND-filter property, current key name.
    const out = filterCatalog(entries, { location: 'remote', toolUseDeclared: true, maxPricePerM: 1, query: 'qwen' });
    expect(out.map((e) => e.model)).toEqual(['qwen/qwen-2.5-7b-instruct']);
  });

  it('provider filter', () => {
    expect(filterCatalog(entries, { provider: 'ollama' }).map((e) => e.model)).toEqual(['qwen2.5:7b']);
  });

  it('modalityIn filter selects vision-capable', () => {
    const out = filterCatalog(entries, { modalityIn: 'image' });
    expect(out.map((e) => e.model).sort()).toEqual(['big/model', 'claude-opus-4-8']);
  });

  it('minContext excludes null and smaller windows', () => {
    const out = filterCatalog(entries, { minContext: 100000 });
    expect(out.map((e) => e.model).sort()).toEqual(['big/model', 'claude-opus-4-8']);
  });

  it('maxPricePerM excludes unknown-priced and dearer models; free passes', () => {
    // v26 (REQ-123): the unknown-priced row is no longer an `openai` one — that provider is retired.
    // The property is about PRICE, not provider: an entry whose rates are unknown is excluded.
    const withUnknown: ModelEntry[] = [...entries, { provider: 'openrouter', model: 'unlisted/model', description: 'x', modalities: { in: ['text'], out: ['text'] }, contextWindow: 1000000, price: 'unknown', ratesPerM: null, toolUse: true, location: 'remote' }];
    const out = filterCatalog(withUnknown, { maxPricePerM: 1 });
    const models = out.map((e) => e.model);
    expect(models).toContain('qwen2.5:7b'); // free -> 0
    expect(models).toContain('qwen/qwen-2.5-7b-instruct'); // max(0.2,0.6)=0.6
    expect(models).not.toContain('big/model'); // 15 > 1
    expect(models).not.toContain('unlisted/model'); // unknown -> excluded
  });

  it('empty match returns [] (not an error)', () => {
    expect(filterCatalog(entries, { provider: 'nonexistent' })).toEqual([]);
  });

  it('caps by limit (default and hard cap)', () => {
    const many: ModelEntry[] = Array.from({ length: 600 }, (_, i) => ({ provider: 'openrouter', model: `m${i}`, description: '', modalities: { in: ['text'], out: ['text'] }, contextWindow: null, price: 'unknown', toolUse: 'unknown', location: 'remote' }));
    expect(filterCatalog(many, {}).length).toBe(100); // default
    expect(filterCatalog(many, { limit: 1000 }).length).toBe(500); // hard cap
    expect(filterCatalog(many, { limit: 5 }).length).toBe(5);
  });
});

// UT-220 (v26 Gate 7.5 round 1, defects D3 + D4): the static Anthropic price table is the ONE input
// to every `costUSD` and to any USD budget on an anthropic alias, so a wrong row is not cosmetic.
// D3: `claude-sonnet-5` was carried at $3/$15 (Sonnet 4.6's price) — the real rate is $2/$10.
// D4: cache read and cache write were both priced at the INPUT rate on the grounds that no per-TTL
// breakdown was published; the published multipliers are ~0.1x input for a READ and 1.25x (5m) /
// 2x (1h) for a WRITE, so a cache read was over-charged ~10x and a write under-charged.
// Source for every number here: the claude-api skill's cached model table (2026-06-24 cache), the
// same source VAL-187 cross-checked the haiku figure against.
// Mock policy (unit): pure data assertion, no I/O.
import { STATIC_ANTHROPIC_RATES, displayPrice } from '../../src/models/model-catalog.js';
import { priceCall } from '../../src/run-guard.js';
// v26 round 4 (D12): the fable row's consequence is a PIN, so the test walks the real chain —
// `buildCatalog` -> `ModelBook.lookup` — rather than asserting the table twice.
import { ModelBook } from '../../src/models/model-book.js';
import { FixedClock } from '../../src/clock.js';

describe('the static anthropic price table (UT-220, defects D3/D4)', () => {
  it('claude-sonnet-5 is $2/$10 per MTok, not $3/$15', () => {
    const rates = STATIC_ANTHROPIC_RATES['claude-sonnet-5']!;
    expect(rates.in).toBe(2e-6);
    expect(rates.out).toBe(10e-6);
    expect(displayPrice(rates)).toEqual({ in: '$2/1M', out: '$10/1M' });
  });

  it('the two rows that were already right are untouched', () => {
    expect(STATIC_ANTHROPIC_RATES['claude-opus-4-8']!.in).toBe(5e-6);
    expect(STATIC_ANTHROPIC_RATES['claude-opus-4-8']!.out).toBe(25e-6);
    expect(STATIC_ANTHROPIC_RATES['claude-haiku-4-5-20251001']!.in).toBe(1e-6);
    expect(STATIC_ANTHROPIC_RATES['claude-haiku-4-5-20251001']!.out).toBe(5e-6);
  });

  it('every row prices a cache READ at 0.1x input and a cache WRITE at 2x input (the 1h TTL)', () => {
    for (const [model, rates] of Object.entries(STATIC_ANTHROPIC_RATES)) {
      expect(rates.cacheRead, `${model} cacheRead`).toBeCloseTo(rates.in * 0.1, 12);
      expect(rates.cacheWrite, `${model} cacheWrite`).toBeCloseTo(rates.in * 2, 12);
    }
  });

  // VAL-187 / the Gate 6 journal recorded `costUSD 0.003011` for 2796 input + 43 output on
  // claude-haiku-4-5-20251001 against a REAL anthropic-direct call. Haiku's rates were not among
  // the wrong ones, so the number must survive this change — re-derived here rather than assumed.
  it('re-derives the recorded smoke number: 2796 in + 43 out on haiku is still $0.003011', () => {
    const cost = priceCall(
      { input: 2796, output: 43, cacheRead: 0, cacheWrite: 0 },
      STATIC_ANTHROPIC_RATES['claude-haiku-4-5-20251001']!,
    );
    expect(cost).toBeCloseTo(0.003011, 9);
  });
});

// UT-226 (v26 Gate 7.5 round 4, defect D12, REQ-127): `claude-fable-5` had no row in
// `STATIC_ANTHROPIC_RATES`, so every run through this deployment's own `fable` alias recorded
// `unpriced:true` and `budgetEnforceable.usd:false` — REQ-127's COST budget cannot bind on a model
// the catalogue does not price. Rates from the SAME source UT-220 used (the claude-api skill's
// cached model table): Claude Fable 5 is $10/1M in, $50/1M out; the cache columns follow the table's
// own multipliers (0.1x input for a READ, 2x for a WRITE at the 1h TTL), not a new rule.
// Mock policy (unit): pure data + a stubbed-fetch catalog build (both live sources non-ok, so only
// the static table returns). 2026-09-26 (alias mechanism removed): no alias table to name it twice
// under any more — a model is always exactly one row, addressed by its own `${provider}/${model}` ref.
describe('claude-fable-5 is priced (UT-226, D12, REQ-127)', () => {
  const FABLE_RATES = { in: 10e-6, out: 50e-6, cacheRead: 1e-6, cacheWrite: 20e-6 };
  const notOk = (): typeof fetch => jsonFetch({}, false);

  it('the static table prices it $10/$50 per MTok, on the cache multipliers every row uses', () => {
    const rates = STATIC_ANTHROPIC_RATES['claude-fable-5'];
    expect(rates).toEqual(FABLE_RATES);
    expect(displayPrice(rates!)).toEqual({ in: '$10/1M', out: '$50/1M' });
  });

  it('the catalog serves it as ONE priced row with the full ref as its `ref` field', async () => {
    const entries = await buildCatalog({ ollamaFetch: notOk(), openrouterFetch: notOk() });
    const rows = entries.filter((e) => e.provider === 'anthropic' && e.model === 'claude-fable-5');
    expect(rows.length).toBe(1);
    expect(rows[0]!.ratesPerM).toEqual(FABLE_RATES);
    expect(rows[0]!.price).toEqual({ in: '$10/1M', out: '$50/1M' });
    expect(rows[0]!.ref).toBe('anthropic/claude-fable-5');
  });

  it('a run through the full ref can be priced: ModelBook answers a rate, never null', async () => {
    const entries = await buildCatalog({ ollamaFetch: notOk(), openrouterFetch: notOk() });
    const book = new ModelBook(async () => entries, { ttlMs: 3_600_000, clock: new FixedClock(new Date('2026-09-09T00:00:00Z')) });
    const snap = await book.snapshot();
    expect(snap.lookup('anthropic', 'claude-fable-5').price).toEqual(FABLE_RATES);
  });
});
