// E2E-003: Named workflow register → invoke by name (REQ-014, REQ-013)
// Real entrypoint: running MCP HTTP server. No mock of catalog or sandbox.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

describe('E2E: named workflow registry + per-run workspace isolation (REQ-014, REQ-013)', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = await createServer({ port: 0, bind: '127.0.0.1' });
    baseUrl = `http://127.0.0.1:${server.port}`;
  });

  afterAll(async () => {
    await server?.close();
  });

  async function mcpCall(method: string, args: unknown) {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: Math.random(), method: 'tools/call', params: { name: method, arguments: args } }),
    });
    const body = await res.json() as { result?: { content: Array<{ text: string }> } };
    return JSON.parse(body.result!.content[0].text);
  }

  async function pollUntil(runId: string, maxMs = 15000) {
    const deadline = Date.now() + maxMs;
    while (Date.now() < deadline) {
      const s = await mcpCall('workflow_status', { runId });
      if (['completed', 'failed'].includes(s.status)) return s;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error('Timed out');
  }

  it('workflow_register saves a workflow and workflow_list shows it', async () => {
    await mcpCall('workflow_register', { name: 'greet', script: `return 'hello ' + args.who;` });
    const list = (await mcpCall('workflow_list', {})).result;
    const found = (list as Array<{ name: string }>).some((w) => w.name === 'greet');
    expect(found).toBe(true);
  });

  it('workflow_run with name invokes the registered script', async () => {
    await mcpCall('workflow_register', { name: 'calc', script: `return args.a + args.b;` });
    const run = await mcpCall('workflow_run', { name: 'calc', args: { a: 3, b: 4 } });
    const runId = run.runId;
    const status = await pollUntil(runId);
    expect(status.status).toBe('completed');

    const result = await mcpCall('workflow_result', { runId });
    expect(result.result).toBe(7);
  }, 20000);

  it('workflow(name) inside a script uses the registered version', async () => {
    await mcpCall('workflow_register', { name: 'inner', script: `return args.val * 2;` });
    await mcpCall('workflow_register', { name: 'outer', script: `return workflow('inner', {val: args.n});` });
    const run = await mcpCall('workflow_run', { name: 'outer', args: { n: 5 } });
    const status = await pollUntil(run.runId);
    expect(status.status).toBe('completed');
    const result = await mcpCall('workflow_result', { runId: run.runId });
    expect(result.result).toBe(10);
  }, 20000);

  it('workflow(unknownName) inside a script throws a catchable error', async () => {
    const run = await mcpCall('workflow_run', {
      script: `
        try { return await workflow('no-such-workflow'); }
        catch (e) { return 'caught:' + e.message; }
      `,
    });
    const status = await pollUntil(run.runId);
    const result = await mcpCall('workflow_result', { runId: run.runId });
    expect(String(result.result)).toMatch(/caught:/);
    expect(String(result.result)).toMatch(/no-such-workflow/);
  }, 20000);

  it('run-A and run-B from the same workflow keep independent per-run state (no cross-run leakage)', async () => {
    // The sandbox intentionally exposes no fs/require/process (DES-005, confirmed by
    // sandbox-guards.test.ts); real directory-level isolation is verified server-side against
    // the real filesystem in IT-007 (WorkflowCatalog.runWorkspace). Here we prove isolation
    // through the documented script API surface: two concurrent runs of the same registered
    // workflow must each resolve their own args, never the other run's.
    await mcpCall('workflow_register', {
      name: 'workspace-test',
      script: `return args.runId;`,
    });

    const runA = await mcpCall('workflow_run', { name: 'workspace-test', args: { runId: 'A' } });
    const runB = await mcpCall('workflow_run', { name: 'workspace-test', args: { runId: 'B' } });

    const [statusA, statusB] = await Promise.all([pollUntil(runA.runId), pollUntil(runB.runId)]);
    expect(statusA.status).toBe('completed');
    expect(statusB.status).toBe('completed');

    const resultA = await mcpCall('workflow_result', { runId: runA.runId });
    const resultB = await mcpCall('workflow_result', { runId: runB.runId });
    expect(resultA.result).toBe('A');
    expect(resultB.result).toBe('B');
  }, 25000);

  it('updating a registered workflow: new runs use new version, prior runs keep their version', async () => {
    await mcpCall('workflow_register', { name: 'versioned', script: `return 'v1';` });
    const runV1 = await mcpCall('workflow_run', { name: 'versioned' });
    await pollUntil(runV1.runId);

    await mcpCall('workflow_register', { name: 'versioned', script: `return 'v2';` });
    const runV2 = await mcpCall('workflow_run', { name: 'versioned' });
    await pollUntil(runV2.runId);

    const r1 = await mcpCall('workflow_result', { runId: runV1.runId });
    const r2 = await mcpCall('workflow_result', { runId: runV2.runId });
    expect(r1.result).toBe('v1');
    expect(r2.result).toBe('v2');
  }, 30000);
});
