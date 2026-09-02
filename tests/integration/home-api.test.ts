// IT-068: GET /api/home + terminalAt in RunSummary (DES-070, DES-071, ARCH-046, ARCH-047)
//
// Tests that:
//   1. GET /api/home is registered and returns a HomeView shape {running:[], registered:[], other:[]}
//   2. a registered workflow (no active run) appears under `registered`
//   3. RunSummary.terminalAt is populated by listRuns() (via /api/runs) for terminal runs
//      (both stores must populate it — this test uses SqliteRunStore via createServer)
//   4. GET /api/home includes metrics (successRate, terminalCount) populated by computeWorkflowMetrics
//
// Mock policy (integration): real createServer + real SqliteRunStore + real HTTP; gateway is the
//   default no-LLM (pure-return scripts). No mock of the store or the fold.
//
// Red reason: GET /api/home is not registered in server.ts → the top-level predicate does not
//   match '/api/home' → falls through to the MCP handler → returns JSON-RPC -32601 method-not-found
//   (or a 404/405). All 4 cases fail.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { registerPublishedVia, runScriptVia } from '../helpers/workflow-fixtures.js';

let server: Server;
let tmpDir: string;

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
  return JSON.parse(body.result?.content?.[0]?.text ?? 'null');
}

async function pollDone(runId: string, maxMs = 8000): Promise<unknown> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const s = await callTool('workflow_status', { runId }) as { status?: string };
    if (s?.status !== 'queued' && s?.status !== 'running') return s;
    await new Promise((r) => setTimeout(r, 40));
  }
  return callTool('workflow_status', { runId });
}

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-it068-'));
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir });
});

afterAll(async () => {
  await server?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('GET /api/home + terminalAt in RunSummary (IT-068, DES-070, DES-071)', () => {
  it('GET /api/home returns a HomeView with running/registered/other arrays', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/api/home`);
    expect(res.status).toBe(200);
    const body = await res.json() as { running?: unknown; registered?: unknown; other?: unknown };
    expect(Array.isArray(body.running)).toBe(true);
    expect(Array.isArray(body.registered)).toBe(true);
    expect(Array.isArray(body.other)).toBe(true);
  });

  it('a registered workflow (no active run) appears under registered[]', async () => {
    await callTool('workflow_register', {
      name: 'it068-idle',
      script: `export const meta = { name: 'it068-idle', description: 'idle workflow for IT-068' };
               return "idle";`,
    });
    const res = await fetch(`http://127.0.0.1:${server.port}/api/home`);
    expect(res.status).toBe(200);
    const view = await res.json() as {
      running: Array<{ name: string }>;
      registered: Array<{ name: string }>;
      other: Array<{ name: string }>;
    };
    const reg = view.registered.find((c) => c.name === 'it068-idle');
    expect(reg).toBeDefined();
    expect(view.running.find((c) => c.name === 'it068-idle')).toBeUndefined();
  });

  it('RunSummary.terminalAt is populated by listRuns() for a completed run', async () => {
    const sub = await runScriptVia(callTool, 'return "done-for-terminalAt";') as { runId?: string };
    const runId = sub?.runId!;
    await pollDone(runId);
    // listRuns is exposed via GET /api/runs
    const res = await fetch(`http://127.0.0.1:${server.port}/api/runs`);
    expect(res.status).toBe(200);
    const runs = await res.json() as Array<{ runId: string; status?: string; terminalAt?: string }>;
    const entry = runs.find((r) => r.runId === runId);
    expect(entry).toBeDefined();
    expect(entry?.status).toBe('completed');
    // DES-071: terminalAt must be populated by listRuns() for terminal runs
    expect(entry?.terminalAt).toBeDefined();
    expect(() => new Date(entry!.terminalAt!).toISOString()).not.toThrow();
  });

  it('GET /api/home includes metrics with successRate and terminalCount after a run completes', async () => {
    // Register a named workflow and run it once (will complete)
    const wfName = 'it068-metrics';
    await registerPublishedVia(callTool, wfName, `export const meta = { name: '${wfName}', description: 'metrics test' };
               return "ok";`);
    const sub = await callTool('workflow_run', { name: wfName }) as { runId?: string };
    await pollDone(sub?.runId!);

    const res = await fetch(`http://127.0.0.1:${server.port}/api/home`);
    const view = await res.json() as {
      registered: Array<{ name: string; metrics?: { successRate: number | null; terminalCount: number; avgDurationMs: number | null } }>;
    };
    const card = view.registered.find((c) => c.name === wfName);
    expect(card).toBeDefined();
    expect(card?.metrics).toBeDefined();
    // 1 completed run → successRate 1.0, terminalCount 1, avgDurationMs non-null
    expect(card?.metrics?.successRate).toBeCloseTo(1.0);
    expect(card?.metrics?.terminalCount).toBe(1);
    expect(card?.metrics?.avgDurationMs).not.toBeNull();
    expect(Number.isFinite(card?.metrics?.avgDurationMs)).toBe(true);
    expect(Number.isNaN(card?.metrics?.avgDurationMs)).toBe(false);
  });
});
