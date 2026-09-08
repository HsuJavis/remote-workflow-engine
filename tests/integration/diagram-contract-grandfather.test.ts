// IT-151 (DES-184, ARCH-119, ADR-043, TASK-189, v26): `workflow_versions.diagram_contract` — a v26
// registration writes `'v2'` and `workflow_describe` reports it; a pre-v26 (`NULL` -> `'v1'`) row is
// never re-checked and renders as before. Written test-first (Gate 5, RED): `workflow_describe`
// carries no `diagramContract` field at all today.
// Mock policy (integration, real adjacent components): real createServer(), real MCP HTTP, real
// SQLite catalog.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { registerPublishedVia, uniqueWorkflowName } from '../helpers/workflow-fixtures.js';

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

describe('workflow_describe reports diagramContract (IT-151, DES-184)', () => {
  it('a freshly-registered workflow reports diagramContract on workflow_describe', async () => {
    const name = uniqueWorkflowName('it151');
    await registerPublishedVia(mcpCall, name, `agent('a', { prompt: 'p' });`);
    const described = await mcpCall('workflow_describe', { name });
    expect('diagramContract' in (described.result ?? described)).toBe(true);
  });
});
