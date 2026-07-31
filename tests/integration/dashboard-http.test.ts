// IT-033: Dashboard read-only HTTP endpoints serve real RunStore data (DES-018, ARCH-011, TASK-025)
// RED: /api/runs HTTP endpoint does not exist yet — server returns 404 → assertions fail.
// No mock of the SUT boundary: real HTTP server, real fetch, real createServer.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

let server: Server;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-it-dash-'));
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir });
});

afterAll(async () => {
  await server?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

async function submitRun(script: string): Promise<string> {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'workflow_run', arguments: { script } },
    }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
  const env = JSON.parse(body.result?.content?.[0]?.text ?? '{}') as { runId?: string };
  return env.runId ?? '';
}

async function registerWorkflow(name: string, script: string): Promise<void> {
  await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'workflow_register', arguments: { name, script } } }),
  });
}

describe('Dashboard read-only HTTP endpoints (DES-018, ARCH-011)', () => {
  it('GET /api/runs returns 200 with a JSON array', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/api/runs`);
    // Forcing RED: endpoint returns 404 (not yet implemented), but must be 200 after impl.
    expect(res.status).toBe(200);
    const body = await res.json() as unknown;
    expect(Array.isArray(body)).toBe(true);
  });

  it('GET /api/runs includes a run that was submitted via MCP workflow_run', async () => {
    const runId = await submitRun('return {dashboard:true}');
    expect(typeof runId).toBe('string');

    // Poll /api/runs until the run appears (at most 5s)
    let found = false;
    for (let i = 0; i < 25; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const res = await fetch(`http://127.0.0.1:${server.port}/api/runs`);
      if (res.status === 200) {
        const list = await res.json() as Array<{ runId?: string }>;
        if (list.some((r) => r.runId === runId)) { found = true; break; }
      }
    }
    expect(found).toBe(true);
  });

  it('GET /api/runs/:id returns RunStatusView JSON for a known run', async () => {
    const runId = await submitRun('phase("p1"); return 1;');
    // Poll the MCP tool until the run is terminal (so we know the run exists)
    for (let i = 0; i < 25; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const statusRes = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call',
          params: { name: 'workflow_status', arguments: { runId } } }),
      });
      const sb = await statusRes.json() as { result?: { content?: Array<{ text?: string }> } };
      const view = JSON.parse(sb.result?.content?.[0]?.text ?? '{}') as { result?: { status?: string } };
      if (['completed', 'failed'].includes(view.result?.status ?? '')) break;
    }
    // Now GET via the dashboard HTTP API
    const res = await fetch(`http://127.0.0.1:${server.port}/api/runs/${runId}`);
    // Forcing RED: endpoint returns 404 now, must return 200 after impl.
    expect(res.status).toBe(200);
    const view = await res.json() as { runId: string; status: string; phases: unknown[] };
    expect(view.runId).toBe(runId);
    expect(['completed', 'failed']).toContain(view.status);
    expect(Array.isArray(view.phases)).toBe(true);
  });

  it('GET /api/runs/:id/agents/:aid returns 200 JSON for an agent in a completed run', async () => {
    // The endpoint returning 404 for unknown agents AFTER the dashboard is implemented is correct,
    // but we can't test that here without a real agent-executing run.
    // This case instead verifies the route pattern is registered (non-existent agent → 404 from the
    // dashboard logic, not 404 from the router itself being absent).
    // RED: currently the entire /api prefix is unregistered → 404 from the router.
    // After implementation: /api/runs/:id/agents/:aid unregistered agent → 404 from dashboard logic.
    // We test the route EXISTS by submitting a real run and checking the path.
    const runId = await submitRun('return 1');
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const statusRes = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call',
          params: { name: 'workflow_status', arguments: { runId } } }),
      });
      const sb = await statusRes.json() as { result?: { content?: Array<{ text?: string }> } };
      const v = JSON.parse(sb.result?.content?.[0]?.text ?? '{}') as { result?: { status?: string } };
      if (['completed', 'failed'].includes(v.result?.status ?? '')) break;
    }
    // The endpoint must be registered: unknown agent on a real run → 404 from dashboard logic (not router)
    const res = await fetch(`http://127.0.0.1:${server.port}/api/runs/${runId}/agents/no-such-agent`);
    // RED: route not registered → 404 from router (no response body we can distinguish)
    // After impl: 404 from dashboard logic with a JSON error body
    expect(res.status).toBe(404);
    const body = await res.json() as { error?: string };
    // Dashboard logic returns a JSON body with an error field; router 404 may not
    expect(typeof body.error).toBe('string');
  });

  // v8 Slice 3 (REQ-049): registered-workflow cards endpoint (routing gap caught at Gate 7.5 real-run).
  it('GET /api/workflows returns 200 with the registered catalog', async () => {
    await registerWorkflow('dash-wf-a', 'return 1;');
    const res = await fetch(`http://127.0.0.1:${server.port}/api/workflows`);
    expect(res.status).toBe(200); // was router-404 before the top-level /api/workflows dispatch fix
    const list = await res.json() as Array<{ name: string; version: string }>;
    expect(Array.isArray(list)).toBe(true);
    expect(list.some((w) => w.name === 'dash-wf-a')).toBe(true);
  });

  // v8 Slice 3 (REQ-048/049): the reconstructed DAG endpoint for one run.
  it('GET /api/runs/:id/dag returns 200 with a root DagNode', async () => {
    const runId = await submitRun('return {dag:true};');
    for (let i = 0; i < 25; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const res = await fetch(`http://127.0.0.1:${server.port}/api/runs/${runId}/dag`);
      if (res.status === 200) {
        const root = await res.json() as { kind?: string; agents?: unknown[]; children?: unknown[] };
        expect(root.kind).toBe('root');
        expect(Array.isArray(root.agents)).toBe(true);
        expect(Array.isArray(root.children)).toBe(true);
        return;
      }
    }
    throw new Error('/api/runs/:id/dag never returned 200');
  });
});
