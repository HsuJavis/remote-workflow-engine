// IT-158 (v26 Gate 7.5 round 4, defects D11 + D12, REQ-127): what a CALLER actually receives from
// `models_list` / `GET /api/models` on this deployment's own alias table — the surface VAL-195(d)
// measured as 8 anthropic rows for 4 models, four of them advertising `price:"unknown",
// ratesPerM:null` for a model the other four price, plus both `claude-fable-5` rows unpriced
// because the static table had no row for it at all. UT-225/UT-226 pin the builder; this pins the
// two SERVED surfaces, through a real `createServer()` and real MCP HTTP, because `filterCatalog`
// and `enrichModelEntry` sit between the builder and the caller and neither dedupes.
//
// Mock policy (integration, real adjacent components): real server, real MCP HTTP, real
// `/api/models` route, real catalog builder; only the two live catalog fetchers are stubbed non-ok
// (Ollama/OpenRouter are the un-runnable boundary here), so the static table + the alias overlay
// are what is served — the same isolation IT-157 uses.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import type { AliasMap } from '../../src/gateway/client.js';
import type { EnrichedModelEntry } from '../../src/models/model-catalog.js';

const HAIKU = 'claude-haiku-4-5-20251001';

/** This deployment's own table, verbatim in shape: every anthropic model carries TWO aliases, and
 *  one of them (`fable`) names a model no other source lists. */
const PRODUCTION_ALIASES: AliasMap = {
  local: { provider: 'ollama', model: 'qwen2.5:7b' },
  default: { provider: 'ollama', model: 'qwen2.5:7b' },
  sonnet: { provider: 'anthropic', model: 'claude-sonnet-5' },
  opus: { provider: 'anthropic', model: 'claude-opus-4-8' },
  haiku: { provider: 'anthropic', model: HAIKU },
  fable: { provider: 'anthropic', model: 'claude-fable-5' },
  'claude-opus-4-8': { provider: 'anthropic', model: 'claude-opus-4-8' },
  'claude-sonnet-4-6': { provider: 'anthropic', model: 'claude-sonnet-5' },
  'claude-haiku-4-5': { provider: 'anthropic', model: HAIKU },
  'claude-fable-5': { provider: 'anthropic', model: 'claude-fable-5' },
};

const notOk = (): typeof fetch =>
  (async () => ({ ok: false, status: 500, json: async () => ({}) })) as unknown as typeof fetch;

let server: Server;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-it-models-dup-'));
  server = await createServer({
    port: 0, bind: '127.0.0.1', workRoot: tmpDir, aliases: PRODUCTION_ALIASES,
    modelCatalogFetchers: { ollamaFetch: notOk(), openrouterFetch: notOk() },
  });
});
afterAll(async () => {
  await server?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

async function modelsListTool(provider: string): Promise<EnrichedModelEntry[]> {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'models_list', arguments: { provider } } }),
  });
  const body = (await res.json()) as { result?: { content?: Array<{ text?: string }> } };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}').result as EnrichedModelEntry[];
}

describe('the served catalog is one priced row per model (IT-158, D11/D12, REQ-127)', () => {
  it('models_list serves ONE anthropic row per model, and none of them says "unknown"', async () => {
    const rows = await modelsListTool('anthropic');
    expect(new Set(rows.map((r) => r.model)).size).toBe(rows.length);
    expect(rows.filter((r) => r.price === 'unknown').map((r) => r.model)).toEqual([]);
    expect(rows.filter((r) => r.ratesPerM === null || r.ratesPerM === undefined).map((r) => r.model)).toEqual([]);
    expect(rows.filter((r) => r.costLevel === null).map((r) => r.model)).toEqual([]);
  });

  it('a caller can still discover BOTH alias names that resolve to one model', async () => {
    const rows = await modelsListTool('anthropic');
    const haiku = rows.find((r) => r.model === HAIKU)!;
    expect(haiku.aliases).toEqual(['haiku', 'claude-haiku-4-5']);
    expect(haiku.price).toEqual({ in: '$1/1M', out: '$5/1M' });
    const fable = rows.find((r) => r.model === 'claude-fable-5')!;
    expect(fable.aliases).toEqual(['fable', 'claude-fable-5']);
    expect(fable.price).toEqual({ in: '$10/1M', out: '$50/1M' });
  });

  it('GET /api/models — the dashboard surface — answers the same rows', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/api/models`);
    const rows = (await res.json()) as EnrichedModelEntry[];
    const anthropic = rows.filter((r) => r.provider === 'anthropic');
    expect(new Set(anthropic.map((r) => r.model)).size).toBe(anthropic.length);
    expect(anthropic.filter((r) => r.price === 'unknown')).toEqual([]);
    expect(anthropic.find((r) => r.model === 'claude-fable-5')?.aliases).toEqual(['fable', 'claude-fable-5']);
  });
});
