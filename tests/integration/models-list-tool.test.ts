// IT (REQ-039/040): models_list wired into the real MCP server, with injected fake live fetchers
// (no real Ollama/OpenRouter network). Exercises tools/list schema, an unfiltered list, a filtered
// narrow, and a source-down graceful-degradation case. No mock of the SUT boundary — real HTTP.
// v24 (batch B, then CLOSED by the integrator — GREEN now): the first case was — a PRODUCT defect. `models_list`'s
// advertised `inputSchema` is `{properties:{},required:[]}`, yet `filterCatalog` (model-catalog.ts)
// still implements every one of provider/query/modalityIn/modalityOut/maxPricePerM/minContext/
// toolUseDeclared/location/limit — proved by the three GREEN cases below, which filter over real MCP
// HTTP. v26 (DES-179): the capability filter is `toolUseDeclared` on BOTH sides (schema +
// filterCatalog), renamed in one commit with no alias window per the standing v24 ruling.
// The filters work and are undiscoverable (REQ-079/REQ-117).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import type { EnrichedModelEntry } from '../../src/models/model-catalog.js';
import type { ObservedStatsProvider, ObservedForRef } from '../../src/models/observed-stats-types.js';
import { COMPACT_FIELDS } from '../../src/models/models-query.js';

function jsonFetch(body: unknown, ok = true): typeof fetch {
  return (async () => ({ ok, status: ok ? 200 : 500, json: async () => body })) as unknown as typeof fetch;
}
function throwingFetch(): typeof fetch {
  return (async () => { throw new Error('ollama down'); }) as unknown as typeof fetch;
}

const OLLAMA_TAGS = { models: [{ name: 'qwen2.5:7b', details: { family: 'qwen2', parameter_size: '7.6B' } }] };
const OPENROUTER_MODELS = {
  data: [
    { id: 'qwen/qwen-2.5-7b-instruct', description: 'Qwen 2.5 7B', context_length: 32768, pricing: { prompt: '0.0000002', completion: '0.0000006' }, architecture: { input_modalities: ['text'], output_modalities: ['text'] }, supported_parameters: ['tools'] },
    { id: 'big/expensive', description: 'A pricey model', context_length: 200000, pricing: { prompt: '0.000005', completion: '0.000015' }, architecture: { input_modalities: ['text'], output_modalities: ['text'] }, supported_parameters: ['tools'] },
  ],
};
let server: Server;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-it-models-'));
  server = await createServer({
    port: 0, bind: '127.0.0.1', workRoot: tmpDir,
    modelCatalogFetchers: { ollamaFetch: jsonFetch(OLLAMA_TAGS), openrouterFetch: jsonFetch(OPENROUTER_MODELS) },
  });
});
afterAll(async () => {
  await server?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

async function rpc(port: number, method: string, params?: unknown) {
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  return res.json() as Promise<{ result?: { content?: Array<{ text?: string }>; tools?: Array<{ name: string; inputSchema?: { properties?: Record<string, unknown> } }> }; error?: unknown }>;
}
// Issue #104: models_list answers `{ models, nextCursor, total }` (was a bare array).
type Page = { models: Array<Partial<EnrichedModelEntry> & { model: string; ref: string }>; nextCursor: string | null; total: number };
async function callTool(port: number, name: string, args: unknown): Promise<{ result: Page; error?: { code?: string; message?: string } }> {
  const body = await rpc(port, 'tools/call', { name, arguments: args });
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}');
}

describe('models_list wired into MCP (REQ-039/040)', () => {
  it('tools/list advertises models_list with real filter properties', async () => {
    const body = await rpc(server.port, 'tools/list');
    const tool = body.result?.tools?.find((t) => t.name === 'models_list');
    expect(tool).toBeDefined();
    const props = Object.keys(tool?.inputSchema?.properties ?? {});
    expect(props).toEqual(expect.arrayContaining(['provider', 'query', 'maxPricePerM', 'minContext', 'toolUseDeclared', 'location', 'limit']));
    // …and the retired name is gone from the advertised surface, not merely joined by the new one.
    expect(props).not.toContain('toolUse');
  });

  it('unfiltered list federates static + fake Ollama + fake OpenRouter, each row carrying its own full ref', async () => {
    const out = await callTool(server.port, 'models_list', {});
    const models = out.result.models.map((e) => e.model);
    expect(models).toContain('qwen2.5:7b'); // ollama
    expect(models).toContain('qwen/qwen-2.5-7b-instruct'); // openrouter
    expect(models).toContain('claude-opus-4-8'); // static anthropic
    // 2026-09-26 (alias mechanism removed, spec rule 9): no `aliases` field/overlay any more — `ref`
    // IS the exact `<provider>/<model-id>` string a caller pastes into `model.default`.
    expect(out.result.models.find((e) => e.model === 'claude-opus-4-8')?.ref).toBe('anthropic/claude-opus-4-8');
    expect(out.result.models.find((e) => e.model === 'qwen2.5:7b')?.ref).toBe('ollama/qwen2.5:7b');
    for (const e of out.result.models) expect(e).not.toHaveProperty('aliases');
  });

  it('filters narrow the catalog (remote + toolUseDeclared + cheap + query)', async () => {
    const out = await callTool(server.port, 'models_list', { location: 'remote', toolUseDeclared: true, maxPricePerM: 1, query: 'qwen' });
    expect(out.result.models.map((e) => e.model)).toEqual(['qwen/qwen-2.5-7b-instruct']);
  });

  it('empty match returns an empty page (not an error)', async () => {
    const out = await callTool(server.port, 'models_list', { provider: 'nonexistent-provider' });
    expect(out.result).toEqual({ models: [], nextCursor: null, total: 0 });
  });

  it('a source-down case degrades gracefully — the static table still returns', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-it-models-down-'));
    const downServer = await createServer({
      port: 0, bind: '127.0.0.1', workRoot: dir,
      modelCatalogFetchers: { ollamaFetch: throwingFetch(), openrouterFetch: throwingFetch() },
    });
    try {
      const out = await callTool(downServer.port, 'models_list', {});
      const models = out.result.models.map((e) => e.model);
      expect(models).not.toContain('qwen2.5:7b');
      expect(models).toContain('claude-opus-4-8'); // static survives
      expect(out.result.models.find((e) => e.model === 'claude-opus-4-8')?.ref).toBe('anthropic/claude-opus-4-8');
    } finally {
      await downServer.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // ---- Issue #104: the selection surface over real MCP HTTP ----
  it('tools/list advertises the #104 query inputs', async () => {
    const body = await rpc(server.port, 'tools/list');
    const props = Object.keys(body.result?.tools?.find((t) => t.name === 'models_list')?.inputSchema?.properties ?? {});
    expect(props).toEqual(expect.arrayContaining([
      'fields', 'cursor', 'sortBy', 'order', 'callKind', 'modelType', 'toolUseVerified', 'structuredOutput', 'reasoning',
      'minIntelligence', 'minCoding', 'minAgentic', 'maxLatencyMsP95', 'minSuccessRate', 'maxAvgCostUsdPerCall',
    ]));
  });

  it('default rows are compact; total counts the whole match; fields:["*"] returns full rows', async () => {
    const out = await callTool(server.port, 'models_list', { limit: 2 });
    expect(out.result.models).toHaveLength(2);
    expect(out.result.total).toBeGreaterThan(2);
    expect(typeof out.result.nextCursor).toBe('string');
    for (const m of out.result.models) expect(Object.keys(m).sort()).toEqual([...COMPACT_FIELDS].sort());
    const next = await callTool(server.port, 'models_list', { limit: 2, cursor: out.result.nextCursor });
    expect(next.result.models[0]!.ref).not.toBe(out.result.models[0]!.ref);
    const full = await callTool(server.port, 'models_list', { provider: 'ollama', fields: ['*'] });
    expect(full.result.models[0]).toMatchObject({ ref: 'ollama/qwen2.5:7b', modelType: 'unknown', effortAppliedOnTransport: false, observed: { source: 'none' } });
  });

  it('a bad cursor / unknown field is refused INVALID_ARGUMENT', async () => {
    expect((await callTool(server.port, 'models_list', { cursor: 'nope' })).error?.code).toBe('INVALID_ARGUMENT');
    expect((await callTool(server.port, 'models_list', { fields: ['bogus'] })).error?.code).toBe('INVALID_ARGUMENT');
  });

  it('an injected ObservedStats provider feeds `observed` and the observed filters', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-it-models-obs-'));
    const obs: ObservedForRef = {
      window: '30d', source: 'runs', prose: null,
      tools: { calls: 3, successRate: 1, latencyMsP50: 800, latencyMsP95: 1500, avgInputTokens: 3000, avgOutputTokens: 50, avgCacheReadTokens: 0, avgCacheWriteTokens: 0, avgCostUsdPerCall: 0, lastAt: '2026-09-29T00:00:00.000Z' },
    };
    const provider: ObservedStatsProvider = {
      get: (ref) => (ref === 'ollama/qwen2.5:7b' ? obs : { window: '30d', source: 'none', prose: null, tools: null }),
      getAll: () => new Map([['ollama/qwen2.5:7b', obs]]),
    };
    const obsServer = await createServer({
      port: 0, bind: '127.0.0.1', workRoot: dir, observedStats: provider,
      modelCatalogFetchers: { ollamaFetch: jsonFetch(OLLAMA_TAGS), openrouterFetch: jsonFetch(OPENROUTER_MODELS) },
    });
    try {
      const out = await callTool(obsServer.port, 'models_list', { minSuccessRate: 0.9 });
      expect(out.result.models.map((m) => m.ref)).toEqual(['ollama/qwen2.5:7b']);
      expect(out.result.models[0]!.observed).toMatchObject({ source: 'runs', tools: { calls: 3, latencyMsP95: 1500 } });
    } finally {
      await obsServer.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
