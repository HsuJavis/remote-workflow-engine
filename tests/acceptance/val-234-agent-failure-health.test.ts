// VAL-234 (REQ-207): a real run whose every `agent()` fails must let a caller see "everything
// inside collapsed" without reading `agents[]` themselves — `run_status.failedAgentCount ===
// agentCount` for a terminal run, `run_list` agrees, `workflow_describe` advertises the computed
// `attempts`/`worstCaseMs`, and `workflow_authoring_guide` states the sequential-null rule.
// Written test-first (Gate 5, RED) — none of `failedAgentCount`/`attempts`/`worstCaseMs` exist
// today, and the guide only documents `parallel()`'s null semantics.
//
// The real dependency here is the GATEWAY (third-party network) — a genuinely unreachable address
// is the honest real-tier failure per DES-234's own real-tier path table, not a mock of the SUT.
//
// Mock policy (acceptance): real createServer(), real MCP HTTP; the ONLY "fake" is an `ollama/...`
// model ref pointed (via OLLAMA_BASE_URL deletion) at an address nothing listens on, per
// ADR-precedent (real dependency, real network attempt, real timeout/refusal — not a stubbed
// GatewayClient). 2026-09-26 (alias mechanism removed): the script below declares the full ref
// directly — no alias to route through any more; `modelCatalogFetchers` is stubbed down so
// registration's existence check is deterministic regardless of what this host's own Ollama
// installation (if any) happens to list.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { registerPublishedVia, type ToolCaller } from '../helpers/workflow-fixtures.js';

const down = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;

let server: Server;
let baseUrl: string;

function call(): ToolCaller {
  return async (name, args) => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
    const body = (await res.json()) as { result?: { content: Array<{ text: string }> } };
    return JSON.parse(body.result!.content[0]!.text);
  };
}

beforeAll(async () => {
  // 'ollama' resolves to `OLLAMA_BASE_URL ?? http://localhost:11434` (gateway/client.ts:354) — a
  // REAL network attempt against a port nothing in this test environment listens on, giving a
  // genuine (fast) connection-refused failure. Never a stubbed GatewayClient.
  delete (process.env as Record<string, string | undefined>)['OLLAMA_BASE_URL'];
  server = await createServer({
    port: 0, bind: '127.0.0.1', useLiteLLMProxy: false, timeoutMs: 2000, retries: 0,
    modelCatalogFetchers: { ollamaFetch: down, openrouterFetch: down },
  });
  baseUrl = `http://127.0.0.1:${server.port}`;
});
afterAll(async () => { await server?.close(); });

describe('VAL-234 — every agent() fails: run-level health is visible without reading agents[] (REQ-207)', () => {
  it('failedAgentCount agrees between run_status and run_list for the terminal run', async () => {
    const c = call();
    const script =
      "export const meta = { params: { agents: { worker: { model: { type: 'string', default: 'ollama/unreachable-model' }, " +
      "effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 1000 } } } } };\n" +
      "phase('main');\nreturn await agent('worker', {});";
    await registerPublishedVia(c, 'val234-all-fail', script);
    const started = (await c('run_start', { name: 'val234-all-fail' })) as { runId: string };
    let status = 'queued';
    for (let i = 0; i < 150 && status !== 'failed' && status !== 'completed'; i++) {
      await new Promise((r) => setTimeout(r, 100));
      status = ((await c('run_status', { runId: started.runId })) as { status: string }).status;
    }
    const statusView = (await c('run_status', { runId: started.runId })) as { result?: { failedAgentCount?: number } };
    const rows = (await c('run_list', {})) as { result?: Array<{ runId: string; failedAgentCount?: number }> };
    const listRow = rows.result?.find((r) => r.runId === started.runId);
    expect(statusView.result?.failedAgentCount).toBe(1);
    expect(listRow?.failedAgentCount).toBe(1);
  }, 30000);

  it('workflow_describe advertises attempts/worstCaseMs for the declared timeoutMs', async () => {
    const c = call();
    const described = (await c('workflow_describe', { name: 'val234-all-fail' })) as {
      result?: { params?: { agents?: Record<string, { timeoutMs?: { attempts?: number; worstCaseMs?: number } }> } };
    };
    const timeoutMs = described.result?.params?.agents?.['worker']?.timeoutMs;
    expect(timeoutMs?.attempts).toBeGreaterThanOrEqual(1);
    expect(timeoutMs?.worstCaseMs).toBeDefined();
  });

  it('workflow_authoring_guide states a failed SEQUENTIAL await agent() returns null and does not throw', async () => {
    const c = call();
    const guide = (await c('workflow_authoring_guide', {})) as { result?: { text?: string } };
    const text = guide.result?.text ?? '';
    expect(text).toMatch(/await agent\([^)]*\)[^.]*\bnull\b/is);
    expect(text).toMatch(/does not throw|never throws|no exception/i);
  });
});
