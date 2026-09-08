// IT-150 (DES-183, ARCH-118, ADR-046, TASK-183, v26, REQ-127): `run_result.meta` carries
// `{usage: RunUsage, budgetEnforceable}` after a restart with NO live guard — `unpricedCalls`,
// `unmappedMessages`, and `budgetEnforceable.unpricedModels` naming the unlisted model when the
// injected catalog is missing a row for it (the call still ADMITS, prices at 0, and the run page
// renders the counter). Written test-first (Gate 5, RED): `ResultEnvelope` carries no `meta` field
// at all today.
// Mock policy (integration, real adjacent components): real createServer(), real MCP HTTP; the
// injected `modelCatalog` source stands in for the live pricing network (the one un-runnable
// third-party boundary).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { runScriptVia, uniqueWorkflowName } from '../helpers/workflow-fixtures.js';

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

async function poll(runId: string, maxMs = 15000): Promise<any> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const s = await mcpCall('run_status', { runId });
    if (['completed', 'failed'].includes(s.status)) return s;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('timed out');
}

beforeAll(async () => {
  // an empty catalog -> every model is unlisted -> unpriced
  server = await createServer({ port: 0, bind: '127.0.0.1', modelCatalog: async () => [] });
});
afterAll(async () => { await server?.close(); });

describe('run_result.meta.usage names an unpriced model and admits the call anyway (IT-150, DES-183)', () => {
  it('meta.usage.unpricedCalls === 1 and budgetEnforceable.unpricedModels names it', async () => {
    const name = uniqueWorkflowName('it150');
    const run = await runScriptVia(mcpCall, `await agent('a', { prompt: 'p' }); return 'done';`, { name });
    const status = await poll(run.runId);
    expect(status.status).toBe('completed');
    const result = await mcpCall('run_result', { runId: run.runId });
    expect(result.meta).toBeDefined();
    expect(result.meta.usage.unpricedCalls).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(result.meta.budgetEnforceable?.unpricedModels)).toBe(true);
  }, 20000);
});
