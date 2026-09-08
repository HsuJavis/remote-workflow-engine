// UT-194 (DES-181, ARCH-118, ADR-037, TASK-181, v26, REQ-127/REQ-120): a wire `budget: 200000` (the
// v25 bare-number shape) is refused AHEAD of ajv — same precedent as `run_start({script})` ->
// INLINE_SCRIPT_CLOSED (call-tool.ts) — naming the old token meaning in the message and carrying
// `detail.migration.tokens`. `run_start({budget:null})` stays ACCEPTED (unbounded); `{budget:{}}` is
// refused by the schema's `minProperties:1`. Written test-first (Gate 5, RED): today `budget` is
// `{type:['number','null']}` on the schema — a bare number is the only form ajv itself accepts, and
// `{}` is not refused (no shape validation exists for an object budget at all yet).
// Mock policy (unit — real facade, no mock of the tool-dispatch boundary): real createServer(), real
// MCP HTTP.
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

beforeAll(async () => { server = await createServer({ port: 0, bind: '127.0.0.1' }); });
afterAll(async () => { await server?.close(); });

describe('run_start budget migration (UT-194, DES-181)', () => {
  it('a bare-number budget is refused ahead of ajv, naming the token migration', async () => {
    const res = await runScriptVia(mcpCall, `agent('a', { prompt: 'p' });`, { name: uniqueWorkflowName('ut194'), budget: 200000 });
    const err = (res as any).error ?? res;
    expect(err.code).toBe('INVALID_ARGUMENT');
    expect(JSON.stringify(err).toLowerCase()).toContain('usd');
    expect(err.detail?.migration?.tokens).toBe(200000);
  });

  it('budget: null is ACCEPTED (unbounded)', async () => {
    const res = await runScriptVia(mcpCall, `agent('a', { prompt: 'p' });`, { name: uniqueWorkflowName('ut194-null'), budget: null });
    expect((res as any).error).toBeUndefined();
  });

  it('budget: {} is refused (minProperties:1)', async () => {
    const res = await runScriptVia(mcpCall, `agent('a', { prompt: 'p' });`, { name: uniqueWorkflowName('ut194-empty'), budget: {} });
    expect((res as any).error).toBeDefined();
  });
});
