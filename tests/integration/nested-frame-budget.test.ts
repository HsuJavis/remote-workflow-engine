// IT-148 (DES-182, ARCH-118/114, TASK-182, v26): inside a nested `workflow()` frame, `budget.spent()`
// must report the PARENT RUN's real USD spend — today it reads 0 forever, because
// `run-manager.ts:1011-1023`'s nested host is given neither `onBudgetSnapshot` nor `currentPhase`.
// Written test-first (Gate 5, RED): a nested frame's `budget.spent()` is always 0 regardless of what
// the parent run has spent.
// Mock policy (integration, real adjacent components): real createServer(), real MCP HTTP, real
// sandbox child processes for both frames; the gateway's provider network is faked (the one
// genuinely un-runnable third-party boundary).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { registerPublishedVia, runScriptVia } from '../helpers/workflow-fixtures.js';

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
  server = await createServer({ port: 0, bind: '127.0.0.1' });
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
    `, { name: 'it148-outer', budget: { usd: 100, tokens: null } });
    const status = await pollUntil(run.runId);
    expect(status.status).toBe('completed');
    const result = await mcpCall('run_result', { runId: run.runId });
    expect(result.result.spentInNested).toBeGreaterThan(0);
  }, 25000);
});
