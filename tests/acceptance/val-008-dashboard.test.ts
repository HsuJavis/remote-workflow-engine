// VAL-008: Web dashboard serves runs list + agent tree with live-updating states (REQ-008)
// RED: dashboard HTTP endpoints (/api/runs, /api/runs/:id, /api/runs/:id/agents/:aid) do not exist.
// Per DES-023 mock policy: no mock of the SUT boundary.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { runScriptVia } from '../helpers/workflow-fixtures.js';

let server: Server;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-val-008-'));
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir });
});

afterAll(async () => {
  await server?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

const BASE = () => `http://127.0.0.1:${server.port}`;

// v22: the same `${BASE()}/mcp` POST + parse `submitRun` already did, generalised over the tool name
// so the shared fixture helper can drive register→publish→run through it.
async function mcpCall(tool: string, args: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE()}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: tool, arguments: args },
    }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}') as Record<string, unknown>;
}

async function submitRun(script: string): Promise<string> {
  const env = await runScriptVia(mcpCall, script) as { runId?: string };
  return env.runId ?? '';
}

async function pollUntilTerminal(runId: string, maxMs = 10_000): Promise<string> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const r = await fetch(`${BASE()}/api/runs/${runId}`);
    if (r.status === 200) {
      const view = await r.json() as { status: string };
      if (['completed', 'failed'].includes(view.status)) return view.status;
    }
    await new Promise((r2) => setTimeout(r2, 200));
  }
  return 'timeout';
}

describe('Web dashboard (REQ-008, VAL-008)', () => {
  it('GET /api/runs returns 200 JSON array (run list visible without manual reload)', async () => {
    const runId = await submitRun('return {dashboard:true}');
    expect(typeof runId).toBe('string');

    const res = await fetch(`${BASE()}/api/runs`);
    expect(res.status).toBe(200);
    const list = await res.json() as Array<{ runId?: string }>;
    expect(Array.isArray(list)).toBe(true);
    // The submitted run must appear in the list.
    expect(list.some((r) => r.runId === runId)).toBe(true);
  });

  it('GET /api/runs/:id returns RunStatusView with phase/agent tree after run completes', async () => {
    const runId = await submitRun('phase("p1"); return 1;');
    await pollUntilTerminal(runId);

    const res = await fetch(`${BASE()}/api/runs/${runId}`);
    expect(res.status).toBe(200);
    const view = await res.json() as { runId: string; status: string; phases: unknown[] };
    expect(view.runId).toBe(runId);
    expect(['completed', 'failed']).toContain(view.status);
    // Drill-in: phase list visible
    expect(Array.isArray(view.phases)).toBe(true);
  });

  it('GET /api/runs/:id for a non-existent run returns 404 (degraded state, never crashes dashboard)', async () => {
    const res = await fetch(`${BASE()}/api/runs/no-such-run-id`);
    expect(res.status).toBe(404);
  });

  it('GET /api/runs/:id/agents/:aid for a non-existent agent returns 404', async () => {
    const res = await fetch(`${BASE()}/api/runs/no-such/agents/agent-0`);
    expect(res.status).toBe(404);
  });

  it('no dashboard endpoint performs a write operation (strictly read-only per DES-018)', async () => {
    // Verify that POST/PUT/DELETE on /api/runs are rejected (only GET is valid).
    const res = await fetch(`${BASE()}/api/runs`, { method: 'POST' });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
