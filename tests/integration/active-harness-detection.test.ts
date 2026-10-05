// Issue #138 review L-138-3: `server.ts` derived its "active harness" (the 'sdk'|'pi' distinction
// `harnessFilteredProbeLookup`/`harnessFilteredProbeStore`/`ModelProber.dueTargets` all gate on)
// from `config?.harnessProviders !== undefined` — an INDIRECT proxy (a provider allow-list set only
// by composeConfig() for a `gateway:"pi"` deployment), not the actual gateway choice. The review's
// own gap: `createServer({ gateway: new PiGatewayClient(...) })` WITHOUT `harnessProviders` (a
// hand-built server, exactly what a test or an embedding caller can do) would classify as 'sdk' and
// hide every real pi probe. `server.ts` now prefers a DIRECT signal — a `transport` property each
// real `GatewayClient` implementation carries on the instance itself (`PiGatewayClient.transport`,
// `ClaudeAgentSdkGatewayClient.transport`, `LiteLLMGatewayClient.transport`) — and falls back to the
// old `harnessProviders` proxy only when the gateway object carries no such signal (a plain test
// fake implementing the bare `GatewayClient` interface).
//
// This test pins all three real gateways' detection directly through OBSERVABLE behavior (never a
// reach into server.ts internals): seed the SAME workRoot's probe store with one row recorded under
// 'claude-agent-sdk' and one under 'pi' for two DIFFERENT refs, boot, and check which ref's
// models_list row stays live (stabilitySource:'probe') and which goes stale (stabilitySource:'rule',
// toolUseVerified:null) — that split is possible ONLY if the active-harness detection is correct.
//
// Mock policy (integration): real `createServer`, real HTTP. The pi/sdk gateway OBJECTS are
// constructed for real (their constructors are pure/side-effect-free — no child process, no HTTP
// call is made; `invoke()` is never called by this test, only `models_list`).
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from '../../src/server.js';
import { ModelProbeStore } from '../../src/models/model-probe.js';
import { PiGatewayClient } from '../../src/gateway/pi-gateway-client.js';
import { LiteLLMGatewayClient } from '../../src/gateway/client.js';
import { ClaudeAgentSdkGatewayClient } from '../../src/gateway/claude-agent-sdk-client.js';
import type { GatewayClient } from '../../src/gateway/client.js';

// models_list enriches real catalog rows with probe data — it never invents a row for a ref that
// isn't in the catalog. A fake-but-successful /api/tags reply (not `down`) gives both seeded refs a
// catalog row to enrich; the openrouter fetch is stubbed down since nothing here needs it.
const down = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
const OLLAMA_TAGS = { models: [{ name: 'sdk-ref', details: { family: 'x', parameter_size: '1B' } }, { name: 'pi-ref', details: { family: 'x', parameter_size: '1B' } }] };
function jsonFetch(body: unknown): typeof fetch {
  return (async () => ({ ok: true, status: 200, json: async () => body })) as unknown as typeof fetch;
}
const CATALOG_FETCHERS = { ollamaFetch: jsonFetch(OLLAMA_TAGS), openrouterFetch: down };

async function callToolRpc(server: Server, name: string, args: Record<string, unknown> = {}): Promise<any> {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = (await res.json()) as { result?: { content?: Array<{ text?: string }> } };
  const text = body.result?.content?.[0]?.text;
  return text ? JSON.parse(text) : body;
}

let workRoot: string;
let server: Server | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
  if (workRoot) rmSync(workRoot, { recursive: true, force: true });
});

/** Seeds `<workRoot>/store/index.db` with one row under each harness family, for two distinct
 *  ollama refs, BEFORE `createServer()` ever opens it — so boot's own migration/compat path runs
 *  against data that already has the `harness` column (no interference with the migration tests). */
function seedProbes(root: string): void {
  mkdirSync(join(root, 'store'), { recursive: true });
  const store = new ModelProbeStore(join(root, 'store', 'index.db'));
  store.put({
    provider: 'ollama', model: 'sdk-ref', proseVerified: true, toolUseVerified: true,
    probedAt: '2026-10-01T00:00:00.000Z', latencyMs: { prose: 10, tools: 10 }, detail: 'ok', harness: 'claude-agent-sdk',
  });
  store.put({
    provider: 'ollama', model: 'pi-ref', proseVerified: true, toolUseVerified: true,
    probedAt: '2026-10-01T00:00:00.000Z', latencyMs: { prose: 10, tools: 10 }, detail: 'ok', harness: 'pi',
  });
  store.close();
}

async function stabilitySourceOf(s: Server, model: string): Promise<string> {
  const out = await callToolRpc(s, 'models_list', { provider: 'ollama', query: model, fields: ['stabilitySource'] });
  return out.result.models[0].stabilitySource;
}

describe('issue #138 review L-138-3 — active-harness detection pinned for sdk, direct-fetch and pi', () => {
  it('gateway: new PiGatewayClient(...), harnessProviders OMITTED — still detected as pi via the gateway instance itself', async () => {
    workRoot = mkdtempSync(join(tmpdir(), 'rwe-active-harness-pi-'));
    seedProbes(workRoot);
    // The review's exact gap scenario: a pi gateway object with NO `harnessProviders` set — the old
    // proxy-based detection would have classified this as 'sdk'.
    const gw: GatewayClient = new PiGatewayClient({});
    server = await createServer({ port: 0, bind: '127.0.0.1', workRoot, gateway: gw, modelCatalogFetchers: CATALOG_FETCHERS });
    expect(await stabilitySourceOf(server, 'pi-ref')).toBe('probe');
    expect(await stabilitySourceOf(server, 'sdk-ref')).toBe('rule');
  });

  it('gateway: new LiteLLMGatewayClient(...) (direct-fetch) — detected as the sdk family', async () => {
    workRoot = mkdtempSync(join(tmpdir(), 'rwe-active-harness-directfetch-'));
    seedProbes(workRoot);
    const gw: GatewayClient = new LiteLLMGatewayClient({ timeoutMs: 5000, retries: 1 });
    server = await createServer({ port: 0, bind: '127.0.0.1', workRoot, gateway: gw, modelCatalogFetchers: CATALOG_FETCHERS });
    expect(await stabilitySourceOf(server, 'sdk-ref')).toBe('probe');
    expect(await stabilitySourceOf(server, 'pi-ref')).toBe('rule');
  });

  it('gateway: new ClaudeAgentSdkGatewayClient(...) — detected as the sdk family', async () => {
    workRoot = mkdtempSync(join(tmpdir(), 'rwe-active-harness-sdk-'));
    seedProbes(workRoot);
    const gw: GatewayClient = new ClaudeAgentSdkGatewayClient({ baseUrl: 'http://127.0.0.1:1' });
    server = await createServer({ port: 0, bind: '127.0.0.1', workRoot, gateway: gw, modelCatalogFetchers: CATALOG_FETCHERS });
    expect(await stabilitySourceOf(server, 'sdk-ref')).toBe('probe');
    expect(await stabilitySourceOf(server, 'pi-ref')).toBe('rule');
  });

  it('no gateway configured at all (the zero-config test-server shape) — falls back to the harnessProviders proxy, sdk by default', async () => {
    workRoot = mkdtempSync(join(tmpdir(), 'rwe-active-harness-none-'));
    seedProbes(workRoot);
    server = await createServer({ port: 0, bind: '127.0.0.1', workRoot, modelCatalogFetchers: CATALOG_FETCHERS });
    expect(await stabilitySourceOf(server, 'sdk-ref')).toBe('probe');
    expect(await stabilitySourceOf(server, 'pi-ref')).toBe('rule');
  });

  it('a plain GatewayClient test fake with no transport signal at all still falls back correctly to the harnessProviders proxy (pi)', async () => {
    workRoot = mkdtempSync(join(tmpdir(), 'rwe-active-harness-fake-'));
    seedProbes(workRoot);
    const gw: GatewayClient = { async invoke() { return { ok: true as const, provider: 'ollama', model: 'm', tokens: { input: 0, output: 0 }, content: '' }; } };
    server = await createServer({ port: 0, bind: '127.0.0.1', workRoot, gateway: gw, harnessProviders: ['openrouter', 'ollama'], modelCatalogFetchers: CATALOG_FETCHERS });
    expect(await stabilitySourceOf(server, 'pi-ref')).toBe('probe');
    expect(await stabilitySourceOf(server, 'sdk-ref')).toBe('rule');
  });
});
