// issue #85: an `openrouter/<id>` passthrough model was never priced, so a USD budget silently did
// not bind on it. Reproduced: `openrouter/deepseek/deepseek-v4-flash-0731` recorded `costUSD 0,
// unpriced:true`, a `{usd:0.00001}` budget let both calls run, and `run_result.meta` claimed
// `budgetEnforceable:{usd:true, unpricedModels:[]}` beside `unpricedCalls:2` — while `models_list`
// priced that very id.
//
// Three seams, one cause (no single model-ref normalizer):
//   (1) the admission pin resolved models with `resolveAlias`, which knows nothing of passthrough ids
//       admission itself accepts by regex → the model was never in `price_book.pinned`;
//   (2) the SDK gateway stamped the RAW `openrouter/<id>` as the resolved model, so the capture
//       looked up `openrouter/openrouter/<id>` against a catalog keyed `openrouter/<id>`;
//   (3) `_resultMeta` judged `usd` enforceable from the pin alone, ignoring calls that went unpriced.
//
// Mock policy (integration): real createServer(), real MCP HTTP, real sandbox child, real admission
// pin, the REAL `ClaudeAgentSdkGatewayClient` (so the stamped model is production's) with only its
// `queryImpl` faked, and the REAL catalog builder with only the openrouter HTTP fetch stubbed.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import type { GatewayClient } from '../../src/gateway/client.js';
import { ClaudeAgentSdkGatewayClient } from '../../src/gateway/claude-agent-sdk-client.js';
import { buildCatalog } from '../../src/models/model-catalog.js';
import { registerPublished, registerPublishedVia, uniqueWorkflowName } from '../helpers/workflow-fixtures.js';
import { RunManager } from '../../src/run-manager.js';
import { InMemoryRunStore } from '../../src/run-store.js';
import { SystemClock } from '../../src/clock.js';
import { ModelBook } from '../../src/models/model-book.js';

const PRICED = 'deepseek/deepseek-v4-flash-0731';
const UNPRICED = 'vendor/not-in-catalog';
const RATE_IN = 0.000001;
const RATE_OUT = 0.000002;
const TOKENS = { input: 1000, output: 1000 };
const EXPECTED_USD = TOKENS.input * RATE_IN + TOKENS.output * RATE_OUT;

// 2026-09-26 (alias mechanism removed): every model is now addressed by its own full
// `<provider>/<model-id>` ref — no alias table to route through. `HAIKU_REF` is a static-table
// anthropic id (accepted with no catalog lookup); `GPT41MINI_REF` is the SAME openrouter model id
// the old `gpt41mini` alias pointed at, now spelled out directly — "alias-routed" is simply "the
// caller writes the full ref instead of a short name" from here on.
const HAIKU_REF = 'anthropic/claude-haiku-4-5-20251001';
const GPT41MINI_REF = 'openrouter/openai/gpt-4.1-mini';

const notOk = (async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch;
// 2026-09-26 (alias mechanism removed, owner decision 5/6): `UNPRICED` must now be LISTED (else
// registration itself refuses UNKNOWN_MODEL — a genuinely absent id on an available live listing is
// no longer silently admitted) but carry no `pricing` — `ratesFromOpenRouterPricing(undefined)` is
// `null`, so this row exists and dispatches, exactly what "a passthrough model has no price" means.
const openrouterFetch = (async () => ({
  ok: true,
  json: async () => ({
    data: [
      { id: PRICED, pricing: { prompt: String(RATE_IN), completion: String(RATE_OUT) } },
      { id: 'openai/gpt-4.1-mini', pricing: { prompt: String(RATE_IN), completion: String(RATE_OUT) } },
      { id: UNPRICED },
    ],
  }),
})) as unknown as typeof fetch;

function okSession(): AsyncGenerator<unknown> {
  return (async function* () {
    yield { type: 'result', subtype: 'success', is_error: false, result: 'ok', usage: { input_tokens: TOKENS.input, output_tokens: TOKENS.output } };
  })();
}

let server: Server;
async function mcpCall(name: string, args: unknown): Promise<any> {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = (await res.json()) as { result?: { content?: Array<{ text?: string }> } };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}');
}
async function poll(runId: string, maxMs = 20000): Promise<any> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const s = await mcpCall('run_status', { runId });
    if (['completed', 'failed'].includes(s.status)) return s;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('timed out');
}
async function runWith(model: string, script: string, budget?: unknown): Promise<{ runId: string; status: any }> {
  const name = uniqueWorkflowName('i85');
  await registerPublishedVia(mcpCall, name, script, { model });
  const run = await mcpCall('run_start', { name, ...(budget !== undefined ? { budget } : {}) });
  return { runId: run.runId, status: await poll(run.runId) };
}

describe('openrouter passthrough models are priced and bind a USD budget (#85)', () => {
  beforeAll(async () => {
    const gateway: GatewayClient = new ClaudeAgentSdkGatewayClient({
      baseUrl: 'http://127.0.0.1:1',
      queryImpl: (() => okSession()) as never,
    });
    server = await createServer({
      port: 0,
      bind: '127.0.0.1',
      gateway,
      modelCatalog: () => buildCatalog({ ollamaFetch: notOk, openrouterFetch }),
    });
  }, 30000);
  afterAll(async () => { await server?.close(); });

  it('a passthrough call with a catalog price records costUSD > 0', async () => {
    const { runId, status } = await runWith(`openrouter/${PRICED}`, `await agent('a', { prompt: 'p' }); return 'ok';`);
    expect(status.status).toBe('completed');
    const rec = (status.result.agents ?? []).find((a: any) => a.label === 'a');
    expect(rec?.unpriced).toBe(false);
    expect(rec?.costUSD).toBeCloseTo(EXPECTED_USD, 10);
    const result = await mcpCall('run_result', { runId });
    expect(result.meta.budgetEnforceable).toEqual({ usd: true, tokens: true, unpricedModels: [] });
  }, 40000);

  it('an openrouter model addressed by its full ref still prices', async () => {
    const { status } = await runWith(GPT41MINI_REF, `await agent('a', { prompt: 'p' }); return 'ok';`);
    expect(status.status).toBe('completed');
    const rec = (status.result.agents ?? []).find((a: any) => a.label === 'a');
    expect(rec?.model).toBe('openai/gpt-4.1-mini');
    expect(rec?.costUSD).toBeCloseTo(EXPECTED_USD, 10);
  }, 40000);

  it('a tiny USD budget refuses the second passthrough call', async () => {
    const { status } = await runWith(
      `openrouter/${PRICED}`,
      `await agent('a', { prompt: 'p1' }); await agent('a', { prompt: 'p2' }); return 'ok';`,
      { usd: 0.00001 },
    );
    const states = (status.result.agents ?? []).map((a: any) => a.state);
    expect(states).toEqual(['done', 'refused']);
  }, 40000);

  it('budgetEnforceable is truthful when a passthrough model has no price', async () => {
    const { runId, status } = await runWith(`openrouter/${UNPRICED}`, `await agent('a', { prompt: 'p' }); return 'ok';`);
    expect(status.status).toBe('completed');
    const result = await mcpCall('run_result', { runId });
    expect(result.meta.usage.unpricedCalls).toBe(1);
    expect(result.meta.budgetEnforceable.usd).toBe(false);
    expect(result.meta.budgetEnforceable.unpricedModels).toContain(`openrouter/${UNPRICED}`);
  }, 40000);
});

describe('the admission pin covers passthrough models (#85 seam 1, INV-V26-4)', () => {
  it('the passthrough model is in the run\'s pinned price book, priced from the catalog', async () => {
    const clock = new SystemClock();
    const store = new InMemoryRunStore(clock);
    const mgr = new RunManager({
      gateway: { async invoke() { return { ok: true, provider: 'x', model: 'x', tokens: { input: 1, output: 1 }, content: 'x' }; } },
      store,
      clock,
      modelBook: new ModelBook(() => buildCatalog({ ollamaFetch: notOk, openrouterFetch }), { clock }),
    });
    const name = uniqueWorkflowName('i85pin');
    await registerPublished(mgr.catalog, name, `await agent('a', { prompt: 'p' }); return 'ok';`, { model: `openrouter/${PRICED}` });
    const runId = await mgr.start({ origin: 'local', name });
    const book = await store.getPriceBook(runId);
    expect(Object.keys(book!.pinned)).toContain(`openrouter/${PRICED}`);
    expect(book!.pinned[`openrouter/${PRICED}`]!.price).not.toBeNull();
  }, 20000);
});

describe('budgetEnforceable counts an unpriced call even when the pin claimed a price (#85 seam 3)', () => {
  // A gateway whose stamped model is not the one the pin priced — the pin says "every reachable
  // model is priced", the call itself went unpriced; the meta must believe the call.
  const drifting: GatewayClient = {
    async invoke() {
      return { ok: true, provider: 'openrouter', model: 'drifted/model', tokens: { input: 1, output: 1 }, content: 'x' };
    },
  } as GatewayClient;
  beforeAll(async () => {
    server = await createServer({
      port: 0,
      bind: '127.0.0.1',
      gateway: drifting,
      modelCatalog: () => buildCatalog({ ollamaFetch: notOk, openrouterFetch: notOk }),
    });
  }, 30000);
  afterAll(async () => { await server?.close(); });

  it('usd is false and the unpriced model is named', async () => {
    const { runId, status } = await runWith(HAIKU_REF, `await agent('a', { prompt: 'p' }); return 'ok';`);
    expect(status.status).toBe('completed');
    const result = await mcpCall('run_result', { runId });
    expect(result.meta.usage.unpricedCalls).toBe(1);
    expect(result.meta.budgetEnforceable.usd).toBe(false);
    expect(result.meta.budgetEnforceable.unpricedModels).toContain('openrouter/drifted/model');
  }, 40000);
});
