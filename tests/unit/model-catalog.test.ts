// REQ-039/REQ-040: model-catalog federation, mapping, filtering, graceful degradation, secret-free.
// Unit tier: fake fetch transports — never a live network call.
import { describe, it, expect } from 'vitest';
import { buildCatalog, filterCatalog, type ModelEntry } from '../../src/models/model-catalog.js';
import type { AliasMap } from '../../src/gateway/client.js';

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

  it('includes the static openai/anthropic table', async () => {
    const entries = await buildCatalog({ ollamaFetch: jsonFetch({ models: [] }), openrouterFetch: jsonFetch({ data: [] }) });
    expect(entries.some((e) => e.provider === 'anthropic' && e.model === 'claude-opus-4-8')).toBe(true);
    expect(entries.some((e) => e.provider === 'openai' && e.model === 'gpt-4.1')).toBe(true);
  });

  it('overlays curated aliases onto matching entries and adds alias-only entries', async () => {
    const aliases: AliasMap = {
      opus: { provider: 'anthropic', model: 'claude-opus-4-8' },
      custom: { provider: 'openrouter', model: 'some/unlisted-model' },
    };
    const entries = await buildCatalog({ ollamaFetch: jsonFetch({ models: [] }), openrouterFetch: jsonFetch({ data: [] }), aliases });
    const opus = entries.find((e) => e.model === 'claude-opus-4-8')!;
    expect(opus.alias).toBe('opus');
    const custom = entries.find((e) => e.alias === 'custom')!;
    expect(custom).toMatchObject({ provider: 'openrouter', model: 'some/unlisted-model', location: 'remote' });
  });

  it('degrades gracefully: a source that throws contributes nothing, static/curated still return', async () => {
    const aliases: AliasMap = { opus: { provider: 'anthropic', model: 'claude-opus-4-8' } };
    const entries = await buildCatalog({ ollamaFetch: throwingFetch(), openrouterFetch: throwingFetch(), aliases });
    expect(entries.some((e) => e.provider === 'ollama')).toBe(false);
    expect(entries.some((e) => e.provider === 'openrouter')).toBe(false);
    expect(entries.find((e) => e.model === 'claude-opus-4-8')?.alias).toBe('opus');
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

  it('a curated alias becomes the ref; a non-aliased static entry has NO ref (needs an alias to resolve)', async () => {
    const aliases: AliasMap = { opus: { provider: 'anthropic', model: 'claude-opus-4-8' } };
    const entries = await buildCatalog({ ollamaFetch: jsonFetch({ models: [] }), openrouterFetch: jsonFetch({ data: [] }), aliases });
    const opus = entries.find((e) => e.provider === 'anthropic' && e.model === 'claude-opus-4-8')!;
    expect(opus.ref).toBe('opus'); // alias wins
    const sonnet = entries.find((e) => e.provider === 'anthropic' && e.model === 'claude-sonnet-5')!;
    expect(sonnet.alias).toBeUndefined();
    expect(sonnet.ref).toBeUndefined(); // non-aliased anthropic: no hand-joined provider/model ref
    expect(sonnet.besteffort).toBeUndefined();
  });

  it('the static Haiku entry uses the real dated API id (so its alias attaches → gets a ref)', async () => {
    const aliases: AliasMap = { haiku: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' } };
    const entries = await buildCatalog({ ollamaFetch: jsonFetch({ models: [] }), openrouterFetch: jsonFetch({ data: [] }), aliases });
    const haiku = entries.find((e) => e.provider === 'anthropic' && e.model === 'claude-haiku-4-5-20251001')!;
    expect(haiku).toBeDefined();
    expect(haiku.ref).toBe('haiku');
  });
});

describe('filterCatalog (REQ-040)', () => {
  const entries: ModelEntry[] = [
    { provider: 'ollama', model: 'qwen2.5:7b', description: 'qwen local', modalities: { in: ['text'], out: ['text'] }, contextWindow: null, price: 'free', toolUse: 'unknown', location: 'local' },
    { provider: 'openrouter', model: 'qwen/qwen-2.5-7b-instruct', description: 'qwen remote', modalities: { in: ['text'], out: ['text'] }, contextWindow: 32768, price: { in: '$0.2/1M', out: '$0.6/1M' }, toolUse: true, location: 'remote' },
    { provider: 'openrouter', model: 'big/model', description: 'expensive vision', modalities: { in: ['text', 'image'], out: ['text'] }, contextWindow: 200000, price: { in: '$5/1M', out: '$15/1M' }, toolUse: true, location: 'remote' },
    { provider: 'anthropic', model: 'claude-opus-4-8', description: 'opus', modalities: { in: ['text', 'image'], out: ['text'] }, contextWindow: 1000000, price: { in: '$5/1M', out: '$25/1M' }, toolUse: true, location: 'remote' },
  ];

  it('AND-filters: remote + toolUse + cheap + query', () => {
    const out = filterCatalog(entries, { location: 'remote', toolUse: true, maxPricePerM: 1, query: 'qwen' });
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
    const withUnknown: ModelEntry[] = [...entries, { provider: 'openai', model: 'gpt-4.1', description: 'x', modalities: { in: ['text'], out: ['text'] }, contextWindow: 1000000, price: 'unknown', toolUse: true, location: 'remote' }];
    const out = filterCatalog(withUnknown, { maxPricePerM: 1 });
    const models = out.map((e) => e.model);
    expect(models).toContain('qwen2.5:7b'); // free -> 0
    expect(models).toContain('qwen/qwen-2.5-7b-instruct'); // max(0.2,0.6)=0.6
    expect(models).not.toContain('big/model'); // 15 > 1
    expect(models).not.toContain('gpt-4.1'); // unknown -> excluded
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
