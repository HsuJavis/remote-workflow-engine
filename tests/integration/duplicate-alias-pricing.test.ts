// IT-157 (v26 Gate 7.5 round 3, defect D9, REQ-127/DES-178/DES-183): the live consequence of the
// index defect UT-223 pins, measured where REQ-127's clause actually lives — a run's admission-time
// price-book pin and `run_result.meta`.
//
// VAL-187 round 3 booted TWO real engines that differed in ONE thing, the alias table: with the
// production table (five models, TWO aliases each) a real Haiku call recorded `costUSD 0 /
// unpriced:true` and `budgetEnforceable {usd:false, unpricedModels:["anthropic/claude-haiku-4-5-
// 20251001"]}`; with one alias per model the SAME workflow recorded `costUSD 0.0023872`. This test
// runs the production-shaped (duplicate-alias) table and asserts the priced outcome, so the shape
// that broke the real deployment is the shape the suite now exercises.
//
// Mock policy (integration, real adjacent components): real `createServer()`, real MCP HTTP, real
// sandbox child, real run admission, real price-book pin, real `foldUsage`. The provider network is
// the one genuinely un-runnable boundary and is faked through the SAME `createServer({gateway})`
// seam IT-148 / IT-150 use — the fake returns the provider/model pair `agent-executor.ts` keys the
// pin lookup by, and the cost is computed by the real pricing path from the real static table.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import type { GatewayClient, AliasMap } from '../../src/gateway/client.js';
import { buildCatalog, STATIC_ANTHROPIC_RATES } from '../../src/models/model-catalog.js';
import { registerPublishedVia, uniqueWorkflowName } from '../helpers/workflow-fixtures.js';

const HAIKU = 'claude-haiku-4-5-20251001';

/** This deployment's own table, verbatim in shape: every anthropic model carries TWO aliases. */
const PRODUCTION_ALIASES: AliasMap = {
  local: { provider: 'ollama', model: 'qwen2.5:7b' },
  default: { provider: 'ollama', model: 'qwen2.5:7b' },
  sonnet: { provider: 'anthropic', model: 'claude-sonnet-5' },
  opus: { provider: 'anthropic', model: 'claude-opus-4-8' },
  haiku: { provider: 'anthropic', model: HAIKU },
  'claude-sonnet-4-6': { provider: 'anthropic', model: 'claude-sonnet-5' },
  'claude-opus-4-8': { provider: 'anthropic', model: 'claude-opus-4-8' },
  'claude-haiku-4-5': { provider: 'anthropic', model: HAIKU },
};

/** The four columns VAL-187 measured on the real Haiku call, rounded to keep the arithmetic legible:
 *  10 in, 170 out, 15272 cacheRead ⇒ 10e-6 + 170·5e-6 + 15272·1e-7 = 0.0023872 exactly. */
const TOKENS = { input: 10, output: 170, cacheRead: 15272, cacheWrite: 0 };
const EXPECTED_USD =
  TOKENS.input * STATIC_ANTHROPIC_RATES[HAIKU]!.in +
  TOKENS.output * STATIC_ANTHROPIC_RATES[HAIKU]!.out +
  TOKENS.cacheRead * STATIC_ANTHROPIC_RATES[HAIKU]!.cacheRead;

const FAKE_ANTHROPIC_GATEWAY: GatewayClient = {
  async invoke() {
    return { ok: true, provider: 'anthropic', model: HAIKU, tokens: { ...TOKENS }, content: 'x' };
  },
} as GatewayClient;

const notOk = (async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch;

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

beforeAll(async () => {
  server = await createServer({
    port: 0,
    bind: '127.0.0.1',
    gateway: FAKE_ANTHROPIC_GATEWAY,
    aliases: PRODUCTION_ALIASES,
    // The REAL catalog builder the composition root uses, over the SAME duplicate-alias table; only
    // its two live fetchers are stubbed non-ok, so the static anthropic table and the alias overlay
    // are exactly what a real boot produces.
    modelCatalog: () => buildCatalog({ aliases: PRODUCTION_ALIASES, ollamaFetch: notOk, openrouterFetch: notOk }),
  });
}, 30000);
afterAll(async () => { await server?.close(); });

describe('a duplicate-alias table still prices a real call (IT-157, D9, REQ-127)', () => {
  it('costUSD is the static table\'s arithmetic and a USD budget stays enforceable', async () => {
    const name = uniqueWorkflowName('it157');
    await registerPublishedVia(mcpCall, name, `await agent('cloudone', { prompt: 'p' }); return 'ok';`, { model: 'haiku' });
    const run = await mcpCall('run_start', { name });
    const status = await poll(run.runId);
    expect(status.status).toBe('completed');

    // `run_status` answers `{runId, status, result: <view>}` — the per-agent records live on the view.
    const agentRec = (status.result.agents ?? []).find((a: any) => a.label === 'cloudone');
    expect(agentRec?.model).toBe(HAIKU);
    expect(agentRec?.costUSD).toBeCloseTo(EXPECTED_USD, 10);
    expect(agentRec?.unpriced).toBe(false);

    const result = await mcpCall('run_result', { runId: run.runId });
    expect(result.meta.budgetEnforceable.unpricedModels).toEqual([]);
    expect(result.meta.budgetEnforceable.usd).toBe(true);
    expect(result.meta.usage.unpricedCalls).toBe(0);
    expect(result.meta.usage.costUSD).toBeCloseTo(EXPECTED_USD, 10);
  }, 40000);
});
