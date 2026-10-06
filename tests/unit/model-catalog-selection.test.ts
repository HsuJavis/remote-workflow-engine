// Issue #104: models_list carries what model selection needs — per-row modelType, limits,
// capabilities, effortAppliedOnTransport, pricingDetail, local, lifecycle, benchmarks (with source +
// fetchedAt, null when absent), anthropic-direct borrowing via the canonical mapping + sameModelAs,
// observed (engine-measured; source:'none' when no ObservedStats provider), probeFailureReason.
//
// Fixtures are REAL captures, trimmed: `tests/fixtures/models/openrouter-models-sample.json` (the
// public OpenRouter /api/v1/models, 2026-09-30) and `tests/fixtures/models/ollama-live.json` (a live
// Ollama /api/tags + /api/show for qwen2.5:7b, qwen2.5vl:7b, bge-m3, 2026-09-30).
//
// Mock policy (unit): the two catalog transports are injected fakes serving the captured bodies.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildCatalog, enrichModelEntry, anthropicCanonicalKey, type ModelEntry } from '../../src/models/model-catalog.js';
import type { ObservedForRef } from '../../src/models/observed-stats.js';
import type { ProbeResult } from '../../src/models/model-probe.js';
import { checkModelRef, parseModelRef, type ModelCatalogSnapshot } from '../../src/providers.js';

const FIX = join(__dirname, '..', 'fixtures', 'models');
const OR = JSON.parse(readFileSync(join(FIX, 'openrouter-models-sample.json'), 'utf8')) as { data: Array<Record<string, unknown>> };
const OLLAMA = JSON.parse(readFileSync(join(FIX, 'ollama-live.json'), 'utf8')) as {
  tags: { models: Array<Record<string, unknown>> };
  show: Record<string, Record<string, unknown>>;
};

function jsonRes(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: async () => body } as unknown as Response;
}
const orFetch = (async () => jsonRes({ data: OR.data })) as unknown as typeof fetch;

/** Serves /api/tags and /api/show (POST {model}) from the live capture. `stripTags` removes the
 *  fields newer Ollama puts on /api/tags (capabilities, details.context_length) so the /api/show
 *  fallback path is exercised; `showCalls` records every /api/show hit. */
function ollamaFetch(opts: { stripTags?: boolean; showCalls?: string[] } = {}): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    if (String(url).endsWith('/api/tags')) {
      if (!opts.stripTags) return jsonRes(OLLAMA.tags);
      return jsonRes({
        models: OLLAMA.tags.models.map((m) => {
          const { capabilities: _c, details, ...rest } = m as { capabilities?: unknown; details: Record<string, unknown> };
          const { context_length: _cl, ...d } = details;
          return { ...rest, details: d };
        }),
      });
    }
    if (String(url).endsWith('/api/show')) {
      const name = (JSON.parse(String(init?.body ?? '{}')) as { model?: string }).model ?? '';
      opts.showCalls?.push(name);
      const body = OLLAMA.show[name];
      return body ? jsonRes(body) : jsonRes({ error: 'not found' }, false);
    }
    return jsonRes({}, false);
  }) as unknown as typeof fetch;
}

async function catalog(opts: { stripTags?: boolean; showCalls?: string[] } = {}): Promise<ModelEntry[]> {
  return buildCatalog({ ollamaFetch: ollamaFetch(opts), openrouterFetch: orFetch });
}
const FETCHED_AT = '2026-09-30T00:00:00.000Z';
const row = (entries: ModelEntry[], ref: string) => {
  const e = entries.find((x) => x.ref === ref);
  if (!e) throw new Error(`no row ${ref}`);
  return enrichModelEntry(e, FETCHED_AT);
};

describe('OpenRouter rows carry selection data straight from /api/v1/models (issue #104)', () => {
  it('haiku 4.5: modelType chat, limits, capabilities, pricingDetail, lifecycle, benchmarks with source+fetchedAt', async () => {
    const r = row(await catalog(), 'openrouter/anthropic/claude-haiku-4.5');
    expect(r.modelType).toBe('chat');
    expect(r.modelTypeSource).toBe('openrouter-modalities');
    expect(r.limits).toEqual({ contextWindow: 200000, maxOutputTokens: 64000 });
    expect(r.contextWindow).toBe(200000); // kept top-level for compatibility
    expect(r.capabilities).toEqual({
      toolUse: true, toolChoice: true, structuredOutput: true, promptCaching: true, vision: true,
      reasoning: { supported: true, efforts: null, defaultEffort: null, mandatory: false },
    });
    expect(r.pricingDetail).toEqual({ webSearch: 0.01, cacheRead: 0.1, cacheWrite: 1.25, cacheWrite1h: 2 });
    expect(r.lifecycle).toEqual({ releasedAt: new Date(1760547638 * 1000).toISOString(), knowledgeCutoff: null, expiresAt: null });
    expect(r.benchmarks?.source).toBe('openrouter:artificial_analysis+design_arena');
    expect(r.benchmarks?.fetchedAt).toBe(FETCHED_AT);
    expect(r.benchmarks?.artificialAnalysis).toEqual({ intelligence: 16.9, coding: 43.9, agentic: 8 });
    expect(r.benchmarks?.designArena[0]).toEqual({ arena: 'models', category: '3d', elo: 1090, winRate: 41.1, rank: 90 });
    expect(r.benchmarks).not.toHaveProperty('borrowedFrom');
    expect(r.local).toBeNull();
    expect(r.sameModelAs).toContain('anthropic/claude-haiku-4-5-20251001');
  });

  it('reasoning efforts/default/mandatory come from the reasoning block', async () => {
    const r = row(await catalog(), 'openrouter/anthropic/claude-sonnet-5.5');
    expect(r.capabilities.reasoning).toEqual({ supported: true, efforts: ['max', 'xhigh', 'high', 'medium', 'low'], defaultEffort: 'high', mandatory: true });
  });

  it('a row with no benchmarks has benchmarks:null — never invented', async () => {
    const entries = await catalog();
    const noBench = OR.data.find((m) => !m['benchmarks'])!;
    expect(row(entries, `openrouter/${String(noBench['id'])}`).benchmarks).toBeNull();
  });

  it('knowledge_cutoff / expiration_date carry through to lifecycle', async () => {
    const entries = await catalog();
    expect(row(entries, 'openrouter/sakana/fugu-ultra-v2').lifecycle.knowledgeCutoff).toBe('2026-08-28');
    expect(row(entries, 'openrouter/bytedance-seed/seed-2.0-code').lifecycle.expiresAt).toBe('2026-11-11');
  });

  it('modelType: audio/image output rows that also emit text are chat; modalities still say what else comes out', async () => {
    const entries = await catalog();
    const audio = row(entries, 'openrouter/openai/gpt-audio');
    expect(audio.modelType).toBe('chat');
    expect(audio.modalities.out).toContain('audio');
  });

  it('effortAppliedOnTransport is false on openrouter (the dispatch path drops it) even where effortDeclared is true', async () => {
    const r = row(await catalog(), 'openrouter/anthropic/claude-haiku-4.5');
    expect(r.effortDeclared).toBe(true);
    expect(r.effortAppliedOnTransport).toBe(false);
  });

  // issue #150: `effortAppliedOnTransport` is now harness-aware — the sdk-gateway fact above (`false`
  // for every openrouter row, VAL-186) only holds when the caller passes no `harnessProviders` at
  // all. Under the pi harness (`harnessProviders` set — the same signal models_list's own
  // anthropic-row filter gates on), `reasoning.effort` DOES reach the wire, but only for a model
  // whose catalog row actually declares reasoning support.
  it('effortAppliedOnTransport is harness-aware: true under pi for a reasoning-capable openrouter model, false for one the catalog says has none', async () => {
    const entries = await catalog();
    const e = entries.find((x) => x.ref === 'openrouter/anthropic/claude-haiku-4.5')!;
    const piRow = enrichModelEntry(e, FETCHED_AT, undefined, undefined, ['openrouter', 'ollama']);
    expect(piRow.capabilities.reasoning.supported).toBe(true);
    expect(piRow.effortAppliedOnTransport).toBe(true);

    const noReasoning = entries.find((x) => x.ref === 'openrouter/openai/gpt-audio')!;
    const piRowNoReasoning = enrichModelEntry(noReasoning, FETCHED_AT, undefined, undefined, ['openrouter', 'ollama']);
    expect(piRowNoReasoning.capabilities.reasoning.supported).toBe(false);
    expect(piRowNoReasoning.effortAppliedOnTransport).toBe(false);
  });

  it('effortAppliedOnTransport under pi is false for ollama (no reasoning dial, same as the sdk gateway)', async () => {
    const entries = await catalog();
    const qwen = entries.find((x) => x.ref === 'ollama/qwen2.5:7b')!;
    const piRow = enrichModelEntry(qwen, FETCHED_AT, undefined, undefined, ['openrouter', 'ollama']);
    expect(piRow.effortAppliedOnTransport).toBe(false);
  });

  it('pricing (price / ratesPerM) is unchanged by the enrichment', async () => {
    const r = row(await catalog(), 'openrouter/anthropic/claude-haiku-4.5');
    expect(r.price).toEqual({ in: '$1/1M', out: '$5/1M' });
    expect(r.ratesPerM).toEqual({ in: 0.000001, out: 0.000005, cacheRead: 0.0000001, cacheWrite: 0.00000125 });
  });
});

describe('anthropic-direct rows borrow from the matching OpenRouter entry (canonical mapping)', () => {
  it('canonical key: date stripped, version dashes to dots, family kept; :batch/-date variants collapse', () => {
    expect(anthropicCanonicalKey('claude-haiku-4-5-20251001')).toBe('haiku-4.5');
    expect(anthropicCanonicalKey('anthropic/claude-haiku-4.5')).toBe('haiku-4.5');
    expect(anthropicCanonicalKey('anthropic/claude-haiku-4.5:batch')).toBe('haiku-4.5');
    expect(anthropicCanonicalKey('anthropic/claude-4.5-haiku-20251001')).toBe('haiku-4.5');
    expect(anthropicCanonicalKey('claude-sonnet-5')).toBe('sonnet-5');
    expect(anthropicCanonicalKey('anthropic/claude-sonnet-5.5')).toBe('sonnet-5.5');
    expect(anthropicCanonicalKey('claude-opus-4-8')).toBe('opus-4.8');
    expect(anthropicCanonicalKey('anthropic/claude-5-fable-20260609')).toBe('fable-5');
    expect(anthropicCanonicalKey('openai/gpt-6.1-sol')).toBeNull();
  });

  it('anthropic/claude-haiku-4-5-20251001 borrows benchmarks, knowledgeCutoff, reasoning, maxOutputTokens — marked borrowedFrom', async () => {
    const r = row(await catalog(), 'anthropic/claude-haiku-4-5-20251001');
    expect(r.modelType).toBe('chat');
    expect(r.modelTypeSource).toBe('static');
    // F3 (verify-H, issue #104): the SAME fact, spelled the SAME way at both levels — the full
    // `<provider>/<model-id>` ref, matching `r.borrowedFrom` below (was the bare OpenRouter id here).
    expect(r.benchmarks?.borrowedFrom).toBe('openrouter/anthropic/claude-haiku-4.5');
    expect(r.benchmarks?.artificialAnalysis).toEqual({ intelligence: 16.9, coding: 43.9, agentic: 8 });
    expect(r.capabilities.reasoning).toEqual({ supported: true, efforts: null, defaultEffort: null, mandatory: false });
    expect(r.limits).toEqual({ contextWindow: 200000, maxOutputTokens: 64000 });
    expect(r.borrowedFrom).toBe('openrouter/anthropic/claude-haiku-4.5');
    expect(r.sameModelAs).toEqual(expect.arrayContaining(['openrouter/anthropic/claude-haiku-4.5', 'openrouter/anthropic/claude-haiku-4.5:batch']));
    expect(r.effortAppliedOnTransport).toBe(true);
    // Its OWN price stays the static table's — never borrowed.
    expect(r.price).toEqual({ in: '$1/1M', out: '$5/1M' });
  });

  it('claude-sonnet-5 maps to sonnet-5, never to sonnet-5.5', async () => {
    const r = row(await catalog(), 'anthropic/claude-sonnet-5');
    expect(r.borrowedFrom).toBe('openrouter/anthropic/claude-sonnet-5');
    expect(r.sameModelAs).not.toContain('openrouter/anthropic/claude-sonnet-5.5');
  });

  it('with OpenRouter down, anthropic rows still return — nothing borrowed, benchmarks null, reasoning unknown', async () => {
    const entries = await buildCatalog({ ollamaFetch: ollamaFetch(), openrouterFetch: (async () => { throw new Error('down'); }) as unknown as typeof fetch });
    const r = enrichModelEntry(entries.find((e) => e.ref === 'anthropic/claude-haiku-4-5-20251001')!, FETCHED_AT);
    expect(r.benchmarks).toBeNull();
    expect(r.borrowedFrom).toBeNull();
    expect(r.sameModelAs).toEqual([]);
    expect(r.capabilities.reasoning).toEqual({ supported: null, efforts: null, defaultEffort: null, mandatory: null });
    expect(r.capabilities.toolUse).toBe(true);
    expect(r.capabilities.promptCaching).toBe(true);
  });
});

describe('Ollama rows: type, context, local details from the live Ollama API', () => {
  it('bge-m3 is an embedding model (not text->text chat); qwen2.5:7b chat with tools; qwen2.5vl vision', async () => {
    const entries = await catalog();
    const bge = row(entries, 'ollama/bge-m3:latest');
    expect(bge.modelType).toBe('embedding');
    expect(bge.modelTypeSource).toBe('ollama-capabilities');
    expect(bge.modalities.out).toEqual(['embedding']);
    expect(bge.limits.contextWindow).toBe(8192);
    const qwen = row(entries, 'ollama/qwen2.5:7b');
    expect(qwen.modelType).toBe('chat');
    expect(qwen.capabilities.toolUse).toBe(true);
    expect(qwen.toolUseDeclared).toBe(true);
    expect(qwen.contextWindow).toBe(32768);
    expect(qwen.limits).toEqual({ contextWindow: 32768, maxOutputTokens: null });
    expect(qwen.local).toEqual({ family: 'qwen2', parameterSize: '7.6B', quantization: 'Q4_K_M' });
    expect(qwen.pricingDetail).toBeNull();
    expect(qwen.effortAppliedOnTransport).toBe(false);
    const vl = row(entries, 'ollama/qwen2.5vl:7b');
    expect(vl.capabilities.vision).toBe(true);
    expect(vl.capabilities.toolUse).toBe(false);
    expect(vl.modalities.in).toEqual(['text', 'image']);
  });

  it('an older Ollama whose /api/tags lacks capabilities/context_length falls back to /api/show per model', async () => {
    const showCalls: string[] = [];
    const entries = await catalog({ stripTags: true, showCalls });
    expect(showCalls.sort()).toEqual(['bge-m3:latest', 'qwen2.5:7b', 'qwen2.5vl:7b']);
    expect(row(entries, 'ollama/bge-m3:latest').modelType).toBe('embedding');
    expect(row(entries, 'ollama/qwen2.5vl:7b').limits.contextWindow).toBe(128000);
  });

  it('a current Ollama (/api/tags already carries both) needs no /api/show call at all', async () => {
    const showCalls: string[] = [];
    await catalog({ showCalls });
    expect(showCalls).toEqual([]);
  });

  it('a transport that answers every URL with the tags body (legacy fakes) degrades to nulls, never throws', async () => {
    const tagsOnly = (async () => jsonRes({ models: [{ name: 'mystery:1b', details: { family: 'x', parameter_size: '1B' } }] })) as unknown as typeof fetch;
    const entries = await buildCatalog({ ollamaFetch: tagsOnly, openrouterFetch: orFetch });
    const r = enrichModelEntry(entries.find((e) => e.ref === 'ollama/mystery:1b')!, FETCHED_AT);
    expect(r.modelType).toBe('unknown');
    expect(r.contextWindow).toBeNull();
    expect(r.capabilities.toolUse).toBeNull();
    expect(r.local).toEqual({ family: 'x', parameterSize: '1B', quantization: null });
  });
});

describe('observed + probe failure reason on the enriched row', () => {
  const base = (): ModelEntry => ({
    provider: 'ollama', model: 'qwen2.5:7b', ref: 'ollama/qwen2.5:7b', description: 'q', modalities: { in: ['text'], out: ['text'] },
    contextWindow: null, price: 'free', toolUse: 'unknown', location: 'local',
  });

  it('no ObservedStats provider -> observed.source none, both buckets null', () => {
    const r = enrichModelEntry(base(), FETCHED_AT);
    expect(r.observed).toEqual({ window: '30d', source: 'none', prose: null, tools: null });
  });

  it('observed is passed through from the provider verbatim', () => {
    const obs: ObservedForRef = {
      window: '30d', source: 'runs', prose: null,
      tools: { calls: 4, successRate: 0.75, latencyMsP50: 1000, latencyMsP95: 3000, avgInputTokens: 3000, avgOutputTokens: 100, avgCacheReadTokens: 0, avgCacheWriteTokens: 0, avgCostUsdPerCall: 0, lastAt: '2026-09-29T00:00:00.000Z' },
    };
    expect(enrichModelEntry(base(), FETCHED_AT, undefined, obs).observed).toEqual(obs);
  });

  it('a failed/timed-out probe carries a structured reason; a passing or absent probe carries null', () => {
    const probe: ProbeResult = {
      provider: 'ollama', model: 'qwen2.5:7b', proseVerified: false, toolUseVerified: false, probedAt: FETCHED_AT,
      latencyMs: { prose: 60000, tools: 60000 }, detail: 'prose: timeout (no reply within 60000ms); tools: timeout',
    };
    const r = enrichModelEntry(base(), FETCHED_AT, probe);
    expect(r.probeFailureReason?.leg).toBe('prose');
    expect(r.probeFailureReason?.kind).toBe('timeout');
    expect(r.probeFailureReason?.hint).toMatch(/load|cold|ollama ps/i);
    expect(enrichModelEntry(base(), FETCHED_AT).probeFailureReason).toBeNull();
    expect(enrichModelEntry(base(), FETCHED_AT, { ...probe, proseVerified: true, toolUseVerified: true, detail: 'prose: ok; tools: ok' }).probeFailureReason).toBeNull();
  });

  it('a tools-leg miss (no Read tool_use) is kind no-tool-use on leg tools', () => {
    const probe: ProbeResult = {
      provider: 'ollama', model: 'qwen2.5:7b', proseVerified: true, toolUseVerified: false, probedAt: FETCHED_AT,
      latencyMs: { prose: 900, tools: 1200 }, detail: 'prose: ok; tools: no Read tool_use in the reply — replied: {"name":"Read"}',
    };
    const r = enrichModelEntry(base(), FETCHED_AT, probe);
    expect(r.probeFailureReason).toMatchObject({ leg: 'tools', kind: 'no-tool-use' });
  });
});

// Issue #136: the PROVIDER_UNSUPPORTED_BY_HARNESS hint (providers.ts's checkModelRef) suggests a
// specific OpenRouter ref drawn from THIS catalog's own sameModelAs linking (issue #104's
// anthropic<->openrouter mapping) rather than a hard-coded example — a fixture/catalog-shape change
// here must not be able to silently reintroduce a hint that names a ref this catalog can't produce.
describe('issue #136 — every PROVIDER_UNSUPPORTED_BY_HARNESS suggestion names a ref present in the catalog it was computed from', () => {
  it('for every anthropic row in the real (fixture-backed) catalog, a named suggestion resolves in that same catalog', async () => {
    const entries = await catalog();
    const anthropicRows = entries.filter((e) => e.provider === 'anthropic');
    expect(anthropicRows.length).toBeGreaterThan(0);
    const snapshot: ModelCatalogSnapshot = { source: 'live', harnessProviders: ['openrouter', 'ollama'], entries };

    let sawASuggestion = false;
    for (const row of anthropicRows) {
      const v = checkModelRef(`anthropic/${row.model}`, snapshot);
      expect(v.ok).toBe(false);
      if (v.ok) continue;
      const m = v.message.match(/use "([^"]+)" instead/);
      if (!m) continue;
      sawASuggestion = true;
      const parsed = parseModelRef(m[1]);
      expect(parsed).toBeDefined();
      expect(entries.some((e) => e.provider === parsed!.provider && e.model === parsed!.model)).toBe(true);
    }
    // The fixture includes a linked haiku pair (see the sameModelAs tests above) — at least one row
    // must actually exercise the "found a peer" branch, or this test would pass vacuously.
    expect(sawASuggestion).toBe(true);
  });
});
