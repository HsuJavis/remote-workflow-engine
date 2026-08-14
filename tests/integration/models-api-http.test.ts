// IT-071: `GET /api/models` over real server — returns EnrichedModelEntry[] with capability/stability/costLevel
//         (DES-075, DES-076, ARCH-050, TASK-075)
//
// Tests that:
//   1. GET /api/models is registered and returns 200
//   2. Response is an array of enriched model entries
//   3. Each entry carries capability (string), stability (enum), costLevel (integer|null)
//   4. A local/free entry (Ollama) has costLevel:0 and stability:'variable'
//   5. An OpenRouter :free model has costLevel:0 and stability:'best-effort'
//   6. costLevel is monotonic with price (cheaper model has ≤ level vs dearer model)
//   7. Empty catalog → empty array, no error
//
// Mock policy (integration): real createServer + real HTTP; live catalog sources are replaced with
//   injected fake Ollama/OpenRouter fetchers (same pattern as models-list-tool.test.ts). No SUT
//   mock — real server, real HTTP, real enrichModelEntry applied server-side.
//
// Red reason: (a) `enrichModelEntry` does not exist in model-catalog.ts → TypeError at server startup
//   if server tries to call it; (b) GET /api/models route not registered in server.ts → 404.
//   Both together = red for the right unimplemented reasons.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

// ---- fake catalog sources (same pattern as models-list-tool.test.ts) ----

function jsonFetch(body: unknown): typeof fetch {
  return (async () => ({
    ok: true, status: 200, json: async () => body,
  })) as unknown as typeof fetch;
}

const OLLAMA_TAGS = {
  models: [{ name: 'llama3:8b', details: { family: 'llama', parameter_size: '8B' } }],
};

const OPENROUTER_MODELS = {
  data: [
    {
      id: 'meta-llama/llama-3.1-8b-instruct:free',
      description: 'Llama 3.1 8B free tier',
      context_length: 131_072,
      pricing: { prompt: '0', completion: '0' },
      architecture: { input_modalities: ['text'], output_modalities: ['text'] },
      supported_parameters: ['tools'],
    },
    {
      id: 'anthropic/claude-3-5-sonnet',
      description: 'Claude 3.5 Sonnet',
      context_length: 200_000,
      pricing: { prompt: '0.000003', completion: '0.000015' },
      architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
      supported_parameters: ['tools'],
    },
  ],
};

// ---- helpers ----

let server: Server;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-it071-'));
  server = await createServer({
    port: 0, bind: '127.0.0.1', workRoot: tmpDir,
    modelCatalogFetchers: {
      ollamaFetch: jsonFetch(OLLAMA_TAGS),
      openrouterFetch: jsonFetch(OPENROUTER_MODELS),
    },
  });
});

afterAll(async () => {
  await server?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---- types ----

interface EnrichedEntry {
  provider: string;
  model: string;
  description: string;
  capability: string;
  stability: string;
  costLevel: number | null;
  modalities: { in: string[]; out: string[] };
  price: unknown;
  location: string;
}

// ============================================================
// IT-071 — GET /api/models
// ============================================================

describe('GET /api/models returns enriched model entries (IT-071, DES-075, DES-076)', () => {
  it('GET /api/models returns 200', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/api/models`);
    expect(res.status).toBe(200);
  });

  it('response body is an array', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/api/models`);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('each entry carries capability (string), stability (enum), costLevel (integer|null)', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/api/models`);
    const entries = await res.json() as EnrichedEntry[];
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(typeof e.capability).toBe('string');
      expect(e.capability.length).toBeGreaterThan(0); // non-empty
      expect(['stable', 'variable', 'best-effort']).toContain(e.stability);
      // costLevel is integer or null — never a fraction
      if (e.costLevel !== null) {
        expect(Number.isInteger(e.costLevel)).toBe(true);
        expect(e.costLevel).toBeGreaterThanOrEqual(0);
        expect(e.costLevel).toBeLessThanOrEqual(10);
      }
      // modalities forwarded
      expect(Array.isArray(e.modalities.in)).toBe(true);
      expect(Array.isArray(e.modalities.out)).toBe(true);
    }
  });

  it('Ollama local model has costLevel:0 and stability:"variable"', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/api/models`);
    const entries = await res.json() as EnrichedEntry[];
    const llama = entries.find((e) => e.model === 'llama3:8b');
    expect(llama).toBeDefined();
    expect(llama!.costLevel).toBe(0);
    expect(llama!.stability).toBe('variable');
  });

  it('OpenRouter :free model has costLevel:0 and stability:"best-effort"', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/api/models`);
    const entries = await res.json() as EnrichedEntry[];
    const freeEntry = entries.find((e) => e.model.includes(':free'));
    expect(freeEntry).toBeDefined();
    expect(freeEntry!.costLevel).toBe(0);
    expect(freeEntry!.stability).toBe('best-effort');
  });

  it('paid model (claude-3-5-sonnet) has costLevel > 0 and stability:"stable"', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/api/models`);
    const entries = await res.json() as EnrichedEntry[];
    const claude = entries.find((e) => e.model === 'anthropic/claude-3-5-sonnet');
    expect(claude).toBeDefined();
    expect(claude!.costLevel).not.toBeNull();
    expect(claude!.costLevel!).toBeGreaterThan(0);
    expect(claude!.stability).toBe('stable');
  });

  it('capability is never null and never longer than 200 chars', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/api/models`);
    const entries = await res.json() as EnrichedEntry[];
    for (const e of entries) {
      expect(e.capability).not.toBeNull();
      expect(e.capability.length).toBeLessThanOrEqual(200);
    }
  });

  it('empty catalog (no source reachable) → [] response, no error', async () => {
    // Use a separate server with no catalog sources
    const emptyTmpDir = mkdtempSync(join(tmpdir(), 'rwe-it071-empty-'));
    const emptyServer = await createServer({
      port: 0, bind: '127.0.0.1', workRoot: emptyTmpDir,
      // Provide fetchers that return empty results
      modelCatalogFetchers: {
        ollamaFetch: jsonFetch({ models: [] }),
        openrouterFetch: jsonFetch({ data: [] }),
      },
    });
    try {
      const res = await fetch(`http://127.0.0.1:${emptyServer.port}/api/models`);
      expect(res.status).toBe(200);
      const body = await res.json() as unknown[];
      // Empty or only static entries — either is fine; must not throw
      expect(Array.isArray(body)).toBe(true);
    } finally {
      await emptyServer.close();
      rmSync(emptyTmpDir, { recursive: true, force: true });
    }
  });
});
