// IT-148 (DES-182, ARCH-118/114, TASK-182, v26): inside a nested `workflow()` frame, `budget.spent()`
// must report the PARENT RUN's real USD spend — today it reads 0 forever, because
// `run-manager.ts:1011-1023`'s nested host is given neither `onBudgetSnapshot` nor `currentPhase`.
// Written test-first (Gate 5, RED): a nested frame's `budget.spent()` is always 0 regardless of what
// the parent run has spent.
// Implementer correction (TASK-182, post-red): `{tokens: 100}` — NOT a bare number — because TASK-181
// (ADR-037, already landed in this shared tree) refuses a bare wire `budget` ahead of ajv
// (`call-tool.ts`'s `parseBudget(a['budget'], {source:'wire'})`); a bare `100` here makes `run_start`
// itself return `{status:'failed', code:'INVALID_ARGUMENT'}` before the run is ever admitted, which is
// an admission-time refusal this item never claimed to prove, not the nested-wiring gap under test.
// `{tokens: 100}` still admits the run and genuinely reaches the nested frame — same intent, current
// wire shape. See TASK-182's report for the (separate, still-open) reason `spentInNested` cannot yet
// be proven `> 0` from this file alone.
// Mock policy (integration, real adjacent components): real createServer(), real MCP HTTP, real
// sandbox child processes for both frames; the gateway's provider network is faked (the one
// genuinely un-runnable third-party boundary) via an injected fake `GatewayClient` (the same
// `createServer({gateway})` seam `dag-masking-auth.test.ts` and IT-153 already use) that always
// resolves `ok:true` with nonzero tokens. Post-review correction (advisor, Gate 5): without this,
// `agent('a', {prompt:'p'})` genuinely FAILS in this sandbox (no ANTHROPIC_API_KEY/OLLAMA_BASE_URL
// configured), so `AgentExecutor.capture()`'s `if (result.ok)` guard never calls `guard.addTokens`
// and the parent's own real spend stays 0 regardless of the nested-wiring bug — making
// `spentInNested > 0` unreachable even AFTER the fix this item targets, not merely red today.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import type { GatewayClient } from '../../src/gateway/client.js';
import { registerPublishedVia, runScriptVia } from '../helpers/workflow-fixtures.js';

const FAKE_PRICED_GATEWAY: GatewayClient = {
  async invoke() {
    return { ok: true, provider: 'anthropic', model: 'm', tokens: { input: 10, output: 5 }, content: 'x' };
  },
} as GatewayClient;

let server: Server;
let baseUrl: string;

async function mcpCall(name: string, args: unknown): Promise<any> {
  const res = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Math.random(), method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = (await res.json()) as { result?: { content: Array<{ text: string }> } };
  return JSON.parse(body.result!.content[0].text);
}

async function pollUntil(runId: string, maxMs = 15000): Promise<any> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const s = await mcpCall('run_status', { runId });
    if (['completed', 'failed'].includes(s.status)) return s;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('Timed out');
}

beforeAll(async () => {
  server = await createServer({ port: 0, bind: '127.0.0.1', gateway: FAKE_PRICED_GATEWAY });
  baseUrl = `http://127.0.0.1:${server.port}`;
});
afterAll(async () => { await server?.close(); });

describe('a nested frame observes the PARENT run\'s real spend, not 0 (IT-148, DES-182)', () => {
  it('budget.spent() inside the nested frame is non-zero after the parent already dispatched an agent', async () => {
    await registerPublishedVia(mcpCall, 'it148-inner', `return { spentInNested: budget.spent() };`);
    const run = await runScriptVia(mcpCall, `
      await agent('a', { prompt: 'p' });
      const inner = await workflow('it148-inner', {});
      return inner;
    `, { name: 'it148-outer', budget: { tokens: 100 } });
    const status = await pollUntil(run.runId);
    expect(status.status).toBe('completed');
    const result = await mcpCall('run_result', { runId: run.runId });
    expect(result.result.spentInNested).toBeGreaterThan(0);
  }, 25000);
});
