// IT-163 (H-4 send-back repair, ARCH-116): `models_list.catalogFetchedAt` used to be a hardcoded
// `null` (no caller ever set it), and `models_list`/`GET /api/models` called the raw catalog
// builder directly instead of `ModelBook` — escaping its TTL and single-flight, so a burst of
// `models_list` calls fired one full upstream catalog fetch each. This proves BOTH halves of the
// fix through the real MCP surface: two calls inside the TTL trigger ONE upstream fetch, and both
// report the SAME non-null `catalogFetchedAt`.
//
// Mock policy (integration, real adjacent components): real createServer() + real MCP HTTP; only
// the live Ollama/OpenRouter fetchers (the third-party network) are faked, with call counters.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

function countingJsonFetch(body: unknown): { fetchImpl: typeof fetch; calls: () => number } {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return { ok: true, status: 200, json: async () => body };
  }) as unknown as typeof fetch;
  return { fetchImpl, calls: () => calls };
}

const OLLAMA_TAGS = { models: [{ name: 'qwen2.5:7b', details: { family: 'qwen2', parameter_size: '7.6B' } }] };
const OPENROUTER_MODELS = {
  data: [
    { id: 'qwen/qwen-2.5-7b-instruct', description: 'Qwen 2.5 7B', context_length: 32768, pricing: { prompt: '0.0000002', completion: '0.0000006' }, architecture: { input_modalities: ['text'], output_modalities: ['text'] }, supported_parameters: ['tools'] },
  ],
};

let server: Server;
let tmpDir: string;
let ollama: { fetchImpl: typeof fetch; calls: () => number };
let openrouter: { fetchImpl: typeof fetch; calls: () => number };

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-it163-'));
  ollama = countingJsonFetch(OLLAMA_TAGS);
  openrouter = countingJsonFetch(OPENROUTER_MODELS);
  server = await createServer({
    port: 0, bind: '127.0.0.1', workRoot: tmpDir,
    modelCatalogFetchers: { ollamaFetch: ollama.fetchImpl, openrouterFetch: openrouter.fetchImpl },
  });
});
afterAll(async () => {
  await server?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

async function callModelsList(): Promise<{ result: Array<{ catalogFetchedAt: string | null }> }> {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'models_list', arguments: {} } }),
  });
  const body = (await res.json()) as { result?: { content?: Array<{ text?: string }> } };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}');
}

describe('models_list.catalogFetchedAt reads the SAME ModelBook snapshot (IT-163, H-4 repair)', () => {
  it('two models_list calls inside the TTL trigger ONE upstream fetch and both report the same non-null catalogFetchedAt', async () => {
    const first = await callModelsList();
    const second = await callModelsList();

    // Both halves of H-4: the TTL/single-flight bound (call count) and the provenance value.
    expect(ollama.calls()).toBe(1);
    expect(openrouter.calls()).toBe(1);

    expect(first.result.length).toBeGreaterThan(0);
    expect(second.result.length).toBeGreaterThan(0);
    for (const row of first.result) expect(row.catalogFetchedAt).not.toBeNull();
    expect(first.result[0]?.catalogFetchedAt).toBe(second.result[0]?.catalogFetchedAt);
  });

  it('GET /api/models reads the SAME snapshot as models_list — identical catalogFetchedAt, no extra fetch', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/api/models`);
    const entries = (await res.json()) as Array<{ catalogFetchedAt: string | null; model: string }>;
    const mcp = await callModelsList();

    expect(ollama.calls()).toBe(1); // still cached — no third upstream fetch
    expect(openrouter.calls()).toBe(1);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0]?.catalogFetchedAt).not.toBeNull();
    expect(entries[0]?.catalogFetchedAt).toBe(mcp.result[0]?.catalogFetchedAt);
  });
});
