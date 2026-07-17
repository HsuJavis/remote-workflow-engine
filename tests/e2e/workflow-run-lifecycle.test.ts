// E2E-001: Full workflow lifecycle — submit→poll status→fetch result over MCP HTTP (REQ-001, REQ-005, REQ-007)
// Real entrypoint: running MCP HTTP server. No mock of server, sandbox, or store.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

// A minimal workflow JS that returns args.x + 1, using no agent() (pure deterministic path).
const SIMPLE_SCRIPT = `return args.x + 1;`;

describe('E2E: full workflow run lifecycle (REQ-001, REQ-005, REQ-007)', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = await createServer({ port: 0, bind: '127.0.0.1' });
    baseUrl = `http://127.0.0.1:${server.port}`;
  });

  afterAll(async () => {
    await server?.close();
  });

  async function mcpCall(method: string, params: unknown) {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: Math.random(), method, params }),
    });
    const body = await res.json() as { result?: { content: Array<{ text: string }> } };
    const text = body.result!.content[0].text;
    return JSON.parse(text);
  }

  it('workflow_run returns a runId immediately', async () => {
    const result = await mcpCall('tools/call', { name: 'workflow_run', arguments: { script: SIMPLE_SCRIPT, args: { x: 5 } } });
    expect(result.runId).toBeTruthy();
    expect(typeof result.runId).toBe('string');
  });

  it('workflow_result eventually returns the script return value', async () => {
    const runResult = await mcpCall('tools/call', { name: 'workflow_run', arguments: { script: SIMPLE_SCRIPT, args: { x: 10 } } });
    const runId = runResult.runId;

    // Poll until completed
    let finalResult: unknown;
    for (let i = 0; i < 30; i++) {
      const status = await mcpCall('tools/call', { name: 'workflow_status', arguments: { runId } });
      if (status.status === 'completed') {
        const res = await mcpCall('tools/call', { name: 'workflow_result', arguments: { runId } });
        finalResult = res.result;
        break;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(finalResult).toBe(11);  // args.x + 1 = 10 + 1
  }, 30000);

  it('workflow_status shows phase list', async () => {
    const runResult = await mcpCall('tools/call', { name: 'workflow_run', arguments: { script: `phase('step-1'); return 42;`, args: {} } });
    const runId = runResult.runId;

    // Wait a moment for it to start
    await new Promise((r) => setTimeout(r, 500));
    const status = await mcpCall('tools/call', { name: 'workflow_status', arguments: { runId } });
    // After completion, phases should include step-1
    expect(Array.isArray(status.result.phases)).toBe(true);
  }, 15000);

  it('workflow_list includes the submitted run', async () => {
    const runResult = await mcpCall('tools/call', { name: 'workflow_run', arguments: { script: 'return "listed";', args: {} } });
    const runId = runResult.runId;

    const list = (await mcpCall('tools/call', { name: 'workflow_list', arguments: {} })).result;
    expect(Array.isArray(list)).toBe(true);
    const found = (list as Array<{ runId: string }>).some((r) => r.runId === runId);
    expect(found).toBe(true);
  }, 10000);
});
