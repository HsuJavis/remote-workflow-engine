// IT-154 (DES-189, ARCH-110/115/118/117, TASK-194/195, v26): the public-shapes pin — after a
// scripted run, `run_status.agents[]` carries every v26 key (`EXPECTED_AGENT_RECORD_KEYS`), and the
// agent() path never emits `PRICE_UNKNOWN`: an unpriced agent() call under a USD budget is ADMITTED
// with `unpriced:true` (ADR-038). v40 ruling R-18 (owner 2026-10-16 「分開處理」) replaced the old
// global grep: decide()/generateImage() DO refuse `PRICE_UNKNOWN` under a USD budget (ARCH-191,
// ADR-091) — that is the primitive path, pinned by VAL-283, not here. Written test-first (Gate 5, RED): today's
// `AgentRecord` carries `tokens: {input, output}` (two columns) and no `costUSD`/`unpriced`/
// `transport`/`proxyModel`/`phaseIndex` at all — the key-set comparison fails immediately.
// Mock policy (integration, real adjacent components): real createServer(), real MCP HTTP; a fake
// gateway stands in for the provider network.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { ClaudeAgentSdkGatewayClient } from '../../src/gateway/claude-agent-sdk-client.js';
import { buildCatalog } from '../../src/models/model-catalog.js';
import { registerPublishedVia, uniqueWorkflowName } from '../helpers/workflow-fixtures.js';
import { EXPECTED_AGENT_RECORD_KEYS } from '../fixtures/v26-public-shapes.js';

let server: Server;

async function mcpCallOn(srv: Server, name: string, args: unknown): Promise<any> {
  const res = await fetch(`http://127.0.0.1:${srv.port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = (await res.json()) as { result?: { content?: Array<{ text?: string }> } };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}');
}
const mcpCall = (name: string, args: unknown): Promise<any> => mcpCallOn(server, name, args);

beforeAll(async () => { server = await createServer({ port: 0, bind: '127.0.0.1' }); });
afterAll(async () => { await server?.close(); });

describe('the v26 public-shapes pin (IT-154, DES-189)', () => {
  it('run_status.agents[] carries every v26 key after a scripted run', async () => {
    await registerPublishedVia(mcpCall, 'it154-wf', `phase('collect'); await agent('a', { prompt: 'p' }); return 'done';`);
    const run = await mcpCall('run_start', { name: 'it154-wf' });
    let status: any;
    for (let i = 0; i < 60; i++) {
      status = await mcpCall('run_status', { runId: run.runId });
      if (['completed', 'failed'].includes(status.status)) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    const record = status.result?.agents?.[0];
    expect(record).toBeDefined();
    for (const key of EXPECTED_AGENT_RECORD_KEYS) {
      if (['label', 'reasonCode', 'detail', 'proxyModel', 'lastActivityAt'].includes(key)) continue; // optional fields
      expect(Object.hasOwn(record, key)).toBe(true);
    }
  }, 20000);
});

// R-18 (owner 2026-10-16 「分開處理」): the agent() half of the PRICE_UNKNOWN split. A LISTED
// openrouter passthrough model with no `pricing` cannot be priced at admission; with a `budget.usd`
// limit armed, agent() is still admitted and the call completes `unpriced:true` (ADR-038) — never a
// PRICE_UNKNOWN refusal, which belongs to decide()/generateImage() only (ARCH-191).
describe('IT-154: an unpriced agent() call under a USD budget is admitted, never PRICE_UNKNOWN (ADR-038, R-18)', () => {
  const UNPRICED = 'vendor/not-in-catalog';
  const notOk = (async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch;
  const openrouterFetch = (async () => ({ ok: true, json: async () => ({ data: [{ id: UNPRICED }] }) })) as unknown as typeof fetch;
  let pricingServer: Server;
  beforeAll(async () => {
    pricingServer = await createServer({
      port: 0,
      bind: '127.0.0.1',
      gateway: new ClaudeAgentSdkGatewayClient({
        baseUrl: 'http://127.0.0.1:1',
        queryImpl: (() => (async function* () {
          yield { type: 'result', subtype: 'success', is_error: false, result: 'ok', usage: { input_tokens: 10, output_tokens: 10 } };
        })()) as never,
      }),
      modelCatalog: () => buildCatalog({ ollamaFetch: notOk, openrouterFetch }),
    });
  }, 30000);
  afterAll(async () => { await pricingServer?.close(); });

  it('the run completes, the record is done + unpriced:true, and PRICE_UNKNOWN appears nowhere in status/result', async () => {
    const call = (n: string, a: unknown) => mcpCallOn(pricingServer, n, a);
    const name = uniqueWorkflowName('it154p');
    await registerPublishedVia(call, name, `await agent('a', { prompt: 'p' }); return 'ok';`, { model: `openrouter/${UNPRICED}` });
    const run = await call('run_start', { name, budget: { usd: 1 } });
    expect(run.runId, JSON.stringify(run)).toBeTruthy();
    let status: any;
    for (let i = 0; i < 100; i++) {
      status = await call('run_status', { runId: run.runId });
      if (['completed', 'failed', 'stopped'].includes(status.status)) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    const result = await call('run_result', { runId: run.runId });
    const NEEDLE = 'PRICE' + '_UNKNOWN';
    expect(JSON.stringify(status)).not.toContain(NEEDLE);
    expect(JSON.stringify(result)).not.toContain(NEEDLE);
    expect(status.status).toBe('completed');
    const rec = (status.result?.agents ?? []).find((a: any) => a.label === 'a');
    expect(rec?.state).toBe('done');
    expect(rec?.unpriced).toBe(true);
    expect(rec?.costUSD).toBe(0);
  }, 40000);
});
