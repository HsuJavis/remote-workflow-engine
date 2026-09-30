// Issue #104: the models_list query surface — `fields` projection (compact default, '*' = all,
// `ref` always), cursor pagination + total, the selection filters, sortBy/order with nulls last,
// and a response-size bound (a max-size full-field page stays far below the ~198KB MCP limit).
//
// Mock policy (unit): pure — rows are built from the captured OpenRouter/Ollama fixtures through
// the real buildCatalog + enrichModelEntry; observed stats are literal ObservedForRef values.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildCatalog, enrichModelEntry, type EnrichedModelEntry } from '../../src/models/model-catalog.js';
import { queryModels, ModelsQueryError, COMPACT_FIELDS, MAX_LIMIT, PAGE_BYTE_BUDGET } from '../../src/models/models-query.js';
import type { CallStats, ObservedForRef } from '../../src/models/observed-stats.js';

const FIX = join(__dirname, '..', 'fixtures', 'models');
const OR = JSON.parse(readFileSync(join(FIX, 'openrouter-models-sample.json'), 'utf8')) as { data: Array<Record<string, unknown>> };
const OLLAMA = JSON.parse(readFileSync(join(FIX, 'ollama-live.json'), 'utf8')) as { tags: unknown };
const res = (body: unknown): Response => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

function stats(p: Partial<CallStats>): CallStats {
  return { calls: 10, successRate: 1, latencyMsP50: 1000, latencyMsP95: 2000, avgInputTokens: 1000, avgOutputTokens: 100, avgCacheReadTokens: 0, avgCacheWriteTokens: 0, avgCostUsdPerCall: 0.001, lastAt: '2026-09-29T00:00:00.000Z', ...p };
}
const OBS: Record<string, ObservedForRef> = {
  'ollama/qwen2.5:7b': { window: '30d', source: 'runs', prose: stats({ latencyMsP95: 9000 }), tools: stats({ successRate: 0.5, latencyMsP95: 20000, avgCostUsdPerCall: 0 }) },
  'anthropic/claude-haiku-4-5-20251001': { window: '30d', source: 'runs', prose: stats({ latencyMsP95: 3000 }), tools: stats({ successRate: 1, latencyMsP95: 8000, avgCostUsdPerCall: 0.0165 }) },
  'openrouter/anthropic/claude-haiku-4.5': { window: '30d', source: 'probe', prose: null, tools: null, probeLatencyMs: 4000 },
};

async function rows(): Promise<EnrichedModelEntry[]> {
  const entries = await buildCatalog({
    ollamaFetch: (async () => res(OLLAMA.tags)) as unknown as typeof fetch,
    openrouterFetch: (async () => res({ data: OR.data })) as unknown as typeof fetch,
  });
  return entries.map((e) => enrichModelEntry(e, '2026-09-30T00:00:00.000Z', undefined, OBS[e.ref!]));
}

describe('fields projection', () => {
  it('default is the compact set; ref always present; nested compact picks', async () => {
    const page = queryModels(await rows(), {});
    const haiku = page.models.find((m) => m['ref'] === 'anthropic/claude-haiku-4-5-20251001')!;
    expect(Object.keys(haiku).sort()).toEqual([...COMPACT_FIELDS].sort());
    expect(haiku['capabilities']).toEqual({ toolUse: true });
    expect(haiku['benchmarks']).toEqual({ artificialAnalysis: { intelligence: 16.9, coding: 43.9, agentic: 8 } });
    expect(haiku['observed']).toEqual({
      window: '30d', source: 'runs',
      prose: { calls: 10, successRate: 1, latencyMsP50: 1000, latencyMsP95: 3000, avgCostUsdPerCall: 0.001 },
      tools: { calls: 10, successRate: 1, latencyMsP50: 1000, latencyMsP95: 8000, avgCostUsdPerCall: 0.0165 },
    });
    const noBench = page.models.find((m) => m['ref'] === 'openrouter/openai/gpt-audio')!;
    expect(noBench['benchmarks']).toBeNull();
  });

  it("fields:['*'] returns the full row; an explicit list returns exactly those keys plus ref", async () => {
    const all = await rows();
    const full = queryModels(all, { fields: ['*'] });
    expect(full.models[0]).toEqual(all[0]);
    const some = queryModels(all, { fields: ['modelType', 'lifecycle'] });
    expect(Object.keys(some.models[0]!).sort()).toEqual(['lifecycle', 'modelType', 'ref']);
  });

  it('an unknown field name is refused, naming the valid ones', async () => {
    expect(() => queryModels([], { fields: ['nope'] })).toThrow(ModelsQueryError);
    expect(() => queryModels([], { fields: ['nope'] })).toThrow(/modelType/);
  });
});

describe('pagination', () => {
  it('limit + opaque cursor walk the whole filtered set exactly once; total is the filtered count', async () => {
    const all = await rows();
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = queryModels(all, { limit: 5, ...(cursor ? { cursor } : {}) });
      expect(page.total).toBe(all.length);
      seen.push(...page.models.map((m) => String(m['ref'])));
      cursor = page.nextCursor ?? undefined;
      pages++;
    } while (cursor);
    expect(pages).toBe(Math.ceil(all.length / 5));
    expect(seen).toEqual(all.map((r) => r.ref));
  });

  it('default limit 50, max 200 (a larger limit is clamped, not refused)', async () => {
    const all = await rows();
    const many = Array.from({ length: 260 }, (_, i) => ({ ...all[0]!, ref: `x/${i}`, model: String(i) }));
    expect(queryModels(many, {}).models).toHaveLength(50);
    expect(queryModels(many, { limit: 1000 }).models).toHaveLength(MAX_LIMIT);
    expect(MAX_LIMIT).toBe(200);
  });

  it('a malformed cursor is refused', () => {
    expect(() => queryModels([], { cursor: 'garbage!' })).toThrow(ModelsQueryError);
  });
});

describe('filters', () => {
  it('modelType, structuredOutput, reasoning, benchmark minimums (null never passes)', async () => {
    const all = await rows();
    const refs = (a: Parameters<typeof queryModels>[1]) => queryModels(all, { ...a, limit: 200 }).models.map((m) => m['ref']);
    expect(refs({ modelType: 'embedding' })).toEqual(['ollama/bge-m3:latest']);
    expect(refs({ structuredOutput: true })).not.toContain('ollama/qwen2.5:7b');
    expect(refs({ reasoning: true })).toContain('openrouter/anthropic/claude-sonnet-5.5');
    expect(refs({ reasoning: true })).not.toContain('openrouter/openai/gpt-audio');
    const smart = refs({ minIntelligence: 16 });
    expect(smart).toContain('anthropic/claude-haiku-4-5-20251001'); // borrowed benchmark counts
    expect(smart).not.toContain('ollama/qwen2.5:7b'); // null never passes a minimum
  });

  it('observed filters read the callKind bucket (default tools); null never passes', async () => {
    const all = await rows();
    const refs = (a: Parameters<typeof queryModels>[1]) => queryModels(all, { ...a, limit: 200 }).models.map((m) => m['ref']);
    expect(refs({ minSuccessRate: 0.9 })).toEqual(['anthropic/claude-haiku-4-5-20251001']);
    expect(refs({ maxLatencyMsP95: 10000, callKind: 'prose' })).toEqual(['anthropic/claude-haiku-4-5-20251001', 'ollama/qwen2.5:7b', 'openrouter/anthropic/claude-haiku-4.5']);
    expect(refs({ maxLatencyMsP95: 10000 })).toEqual(['anthropic/claude-haiku-4-5-20251001', 'openrouter/anthropic/claude-haiku-4.5']); // probe latency is the fallback
    expect(refs({ maxAvgCostUsdPerCall: 0.001 })).toEqual(['ollama/qwen2.5:7b']);
  });

  it('toolUseVerified filter matches only rows with that probe outcome (null never matches)', async () => {
    const all = await rows();
    expect(queryModels(all, { toolUseVerified: true }).total).toBe(0);
  });
});

describe('sorting', () => {
  it('intelligence desc by default, nulls last', async () => {
    const page = queryModels(await rows(), { sortBy: 'intelligence', limit: 200, fields: ['benchmarks'] });
    const vals = page.models.map((m) => (m['benchmarks'] as { artificialAnalysis?: { intelligence: number | null } } | null)?.artificialAnalysis?.intelligence ?? null);
    const firstNull = vals.indexOf(null);
    expect(firstNull).toBeGreaterThan(0);
    expect(vals.slice(firstNull).every((v) => v === null)).toBe(true);
    const nums = vals.slice(0, firstNull) as number[];
    expect(nums).toEqual([...nums].sort((a, b) => b - a));
  });

  it('price asc keeps nulls last even with order desc', async () => {
    const all = await rows();
    const withUnpriced = [{ ...all[0]!, ref: 'x/unpriced', ratesPerM: null, price: 'unknown' as const }, ...all];
    const asc = queryModels(withUnpriced, { sortBy: 'price', limit: 200 }).models.map((m) => m['ref']);
    const desc = queryModels(withUnpriced, { sortBy: 'price', order: 'desc', limit: 200 }).models.map((m) => m['ref']);
    expect(asc.at(-1)).toBe('x/unpriced');
    expect(desc.at(-1)).toBe('x/unpriced');
    expect(asc[0]).toMatch(/^ollama\//); // free first
  });

  it('latency sort uses the callKind bucket, with probe latency as the fallback', async () => {
    const page = queryModels(await rows(), { sortBy: 'latency', limit: 3 });
    expect(page.models.map((m) => m['ref'])).toEqual(['openrouter/anthropic/claude-haiku-4.5', 'anthropic/claude-haiku-4-5-20251001', 'ollama/qwen2.5:7b']);
  });
});

describe('response size', () => {
  it(`a max-size page of full-field realistic rows stays under 150KB (byte budget ${PAGE_BYTE_BUDGET})`, async () => {
    const all = await rows();
    // The heaviest real row (most design_arena entries + a long description), 400 times over.
    const heaviest = [...all].sort((a, b) => JSON.stringify(b).length - JSON.stringify(a).length)[0]!;
    const many = Array.from({ length: 400 }, (_, i) => ({ ...heaviest, ref: `${heaviest.ref}-${i}`, model: `${heaviest.model}-${i}`, description: 'x'.repeat(336) }));
    const page = queryModels(many, { fields: ['*'], limit: MAX_LIMIT });
    const bytes = Buffer.byteLength(JSON.stringify({ result: page }));
    expect(bytes).toBeLessThan(150_000);
    expect(page.nextCursor).not.toBeNull(); // the rest is one cursor away, never silently dropped
    // …and the budget did not cut the page short when the rows are small (compact default).
    expect(queryModels(many, { limit: MAX_LIMIT }).models).toHaveLength(MAX_LIMIT);
    expect(Buffer.byteLength(JSON.stringify(queryModels(many, { limit: MAX_LIMIT })))).toBeLessThan(150_000);
  });
});
