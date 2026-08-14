// VAL-087: REQ-078 — models_list + GET /api/models each return enriched entries with capability,
//          stability, costLevel, modalities; costLevel monotonic with price; dashboard Models
//          section columns present (headless DOM deferred to Gate 7.5)
//          (REQ-078, DES-075, DES-076, DES-078)
//
// Mock policy (acceptance — MUST NOT mock SUT boundaries): real createServer, real HTTP.
//   enrichModelEntry / classifyStability / computeCostLevel are NOT mocked.
//   Live catalog network calls are gated behind HAS_OLLAMA / HAS_OPENROUTER env checks
//   (same pattern as HAS_PROVIDER in existing acceptance tests) — catalog degrades to static
//   Anthropic/OpenAI entries on CI, which is real behavior the test must tolerate.
//   injected fake fetchers are used for deterministic assertions (Ollama costLevel:0, etc.)
//   to allow CI to verify the enrichment logic without a live Ollama host.
//
// Red reason: (a) enrichModelEntry not in model-catalog.ts → TypeError when server calls it; (b)
//   GET /api/models route not registered in server.ts → 404. Red for right reasons.
//
// Note: real:false — set to true by Gate 7.5 validator after a real verified run.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

// ---- fake fetchers for deterministic enrichment assertions ----

function jsonFetch(body: unknown): typeof fetch {
  return (async () => ({ ok: true, status: 200, json: async () => body })) as unknown as typeof fetch;
}

const FAKE_OLLAMA = {
  models: [{ name: 'llama3:8b', details: { family: 'llama', parameter_size: '8B' } }],
};

const FAKE_OPENROUTER = {
  data: [
    {
      id: 'meta-llama/llama-3.1-8b-instruct:free',
      description: 'Llama 3.1 8B free',
      context_length: 131_072,
      pricing: { prompt: '0', completion: '0' },
      architecture: { input_modalities: ['text'], output_modalities: ['text'] },
      supported_parameters: ['tools'],
    },
    {
      id: 'anthropic/claude-3-5-sonnet',
      description: 'Claude 3.5 Sonnet via OpenRouter',
      context_length: 200_000,
      pricing: { prompt: '0.000003', completion: '0.000015' },
      architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
      supported_parameters: ['tools'],
    },
    {
      id: 'openai/gpt-4o',
      description: 'GPT-4o via OpenRouter',
      context_length: 128_000,
      pricing: { prompt: '0.000005', completion: '0.000015' },
      architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
      supported_parameters: ['tools'],
    },
  ],
};

// ---- types ----

interface EnrichedEntry {
  provider: string;
  model: string;
  capability: string;
  stability: 'stable' | 'variable' | 'best-effort';
  costLevel: number | null;
  modalities: { in: string[]; out: string[] };
  price: unknown;
  location: string;
  besteffort?: boolean;
}

// ---- fixture ----

let server: Server;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-val087-'));
  server = await createServer({
    port: 0, bind: '127.0.0.1', workRoot: tmpDir,
    // Injected fake fetchers for deterministic assertions — real enrichModelEntry applied
    modelCatalogFetchers: {
      ollamaFetch: jsonFetch(FAKE_OLLAMA),
      openrouterFetch: jsonFetch(FAKE_OPENROUTER),
    },
  });
});

afterAll(async () => {
  await server?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

async function callModelsList(args: Record<string, unknown> = {}): Promise<{ result: EnrichedEntry[] }> {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'models_list', arguments: args },
    }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
  const text = body.result?.content?.[0]?.text;
  return text ? JSON.parse(text) : { result: [] };
}

// ============================================================
// VAL-087 — models_list enriched fields
// ============================================================

describe('VAL-087: models_list enriched (REQ-078)', () => {
  it('models_list returns entries each carrying capability/stability/costLevel/modalities', async () => {
    const out = await callModelsList();
    expect(out.result.length).toBeGreaterThan(0);
    for (const e of out.result) {
      expect(typeof e.capability).toBe('string');
      expect(e.capability.length).toBeGreaterThan(0);
      expect(['stable', 'variable', 'best-effort']).toContain(e.stability);
      expect(e.costLevel === null || typeof e.costLevel === 'number').toBe(true);
      if (e.costLevel !== null) {
        expect(Number.isInteger(e.costLevel)).toBe(true);
        expect(e.costLevel).toBeGreaterThanOrEqual(0);
        expect(e.costLevel).toBeLessThanOrEqual(10);
      }
      expect(Array.isArray(e.modalities.in)).toBe(true);
      expect(Array.isArray(e.modalities.out)).toBe(true);
    }
  });

  it('Ollama local model has costLevel:0 and stability:"variable"', async () => {
    const out = await callModelsList();
    const llama = out.result.find((e) => e.model === 'llama3:8b');
    expect(llama).toBeDefined();
    expect(llama!.costLevel).toBe(0);
    expect(llama!.stability).toBe('variable');
  });

  it('OpenRouter :free model has costLevel:0 and stability:"best-effort"', async () => {
    const out = await callModelsList();
    const freeEntry = out.result.find((e) => e.model.includes(':free'));
    expect(freeEntry).toBeDefined();
    expect(freeEntry!.costLevel).toBe(0);
    expect(freeEntry!.stability).toBe('best-effort');
  });

  it('paid anthropic/claude-3-5-sonnet has costLevel > 0 and stability:"stable"', async () => {
    const out = await callModelsList();
    const claude = out.result.find((e) => e.model === 'anthropic/claude-3-5-sonnet');
    expect(claude).toBeDefined();
    expect(claude!.costLevel).not.toBeNull();
    expect(claude!.costLevel!).toBeGreaterThan(0);
    expect(claude!.stability).toBe('stable');
  });

  it('costLevel monotonic with price: cheaper model never has higher level than dearer one', async () => {
    const out = await callModelsList();
    // :free has costLevel 0, claude-3-5-sonnet has higher costLevel
    const free = out.result.find((e) => e.model.includes(':free'));
    const claude = out.result.find((e) => e.model === 'anthropic/claude-3-5-sonnet');
    if (free && claude && free.costLevel !== null && claude.costLevel !== null) {
      expect(free.costLevel).toBeLessThanOrEqual(claude.costLevel);
    }
  });

  it('capability never null, never longer than 200 chars', async () => {
    const out = await callModelsList();
    for (const e of out.result) {
      expect(e.capability).not.toBeNull();
      expect(e.capability.length).toBeLessThanOrEqual(200);
    }
  });
});

// ============================================================
// VAL-087b — GET /api/models equivalent enrichment
// ============================================================

describe('VAL-087: GET /api/models enriched (REQ-078, DES-076)', () => {
  it('GET /api/models returns 200 with an array of enriched entries', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/api/models`);
    expect(res.status).toBe(200);
    const body = await res.json() as EnrichedEntry[];
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  });

  it('GET /api/models entries match models_list enrichment (same catalog, same enrichment)', async () => {
    const httpRes = await fetch(`http://127.0.0.1:${server.port}/api/models`);
    const httpEntries = await httpRes.json() as EnrichedEntry[];

    const toolOut = await callModelsList();
    const toolEntries = toolOut.result;

    // Both routes should return the same models (may differ in order or limit but same set)
    const httpModels = new Set(httpEntries.map((e) => e.model));
    const toolModels = new Set(toolEntries.map((e) => e.model));
    // At least the fake models should appear in both
    for (const m of toolModels) {
      expect(httpModels.has(m)).toBe(true);
    }
  });

  it('GET /api/models entries each have capability/stability/costLevel', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/api/models`);
    const entries = await res.json() as EnrichedEntry[];
    for (const e of entries) {
      expect(typeof e.capability).toBe('string');
      expect(['stable', 'variable', 'best-effort']).toContain(e.stability);
      expect(e.costLevel === null || typeof e.costLevel === 'number').toBe(true);
    }
  });
});
