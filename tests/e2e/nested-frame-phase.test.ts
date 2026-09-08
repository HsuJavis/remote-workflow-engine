// E2E-010 (DES-175, ARCH-114, TASK-186, v26, REQ-124): a nested `workflow()` frame that calls its
// OWN `phase()` records it on that sub-workflow's card (`WorkflowNodeView.phases`), NOT the parent
// run's timeline — the parent's lanes and `/api/runs/:id/dag` warnings stay unaffected. Written
// test-first (Gate 5, RED): `WorkflowNodeView` has no `phases` field today, and the nested sandbox
// host (`run-manager.ts`'s `runManager.ts:1011`) is given neither `currentPhase` nor a phase-aware
// `onPhase` — a nested frame's phase() call is silently dropped.
// Mock policy (e2e/acceptance — no mock of the SUT boundary): real booted createServer(), real MCP
// HTTP, real sandbox child processes for both the outer and nested workflow.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { registerPublishedVia, runScriptVia } from '../helpers/workflow-fixtures.js';

describe('E2E: a nested workflow() phase() lands on its own sub-card, not the parent timeline (E2E-010, DES-175)', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = await createServer({ port: 0, bind: '127.0.0.1' });
    baseUrl = `http://127.0.0.1:${server.port}`;
  });

  afterAll(async () => {
    await server?.close();
  });

  async function mcpCall(method: string, args: unknown): Promise<any> {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: Math.random(), method: 'tools/call', params: { name: method, arguments: args } }),
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

  it('the parent phase timeline never gains the nested frame\'s own phase title, and the dag has zero warnings', async () => {
    await registerPublishedVia(mcpCall, 'e2e010-inner', `phase('inner-only'); return 1;`);
    const run = await runScriptVia(mcpCall, `phase('outer-A'); await workflow('e2e010-inner', {}); phase('outer-B'); return 'done';`, { name: 'e2e010-outer' });
    const status = await pollUntil(run.runId);
    expect(status.status).toBe('completed');

    const titles = (status.result.phases as Array<{ title: string }>).map((p) => p.title);
    expect(titles).toEqual(['outer-A', 'outer-B']);
    expect(titles).not.toContain('inner-only');

    const node = (status.result.workflowNodes as Array<{ name: string; phases?: string[] }>).find((n) => n.name === 'e2e010-inner');
    expect(node?.phases).toEqual(['inner-only']);

    const dagRes = await fetch(`${baseUrl}/api/runs/${run.runId}/dag`);
    const dag = (await dagRes.json()) as { warnings: string[] };
    expect(dag.warnings).toEqual([]);
  }, 25000);
});
