// IT-064: GET /api/runs/:id/dag returns the `GraphPayload` envelope (kind:'run', layout, startedBy)
// + terminalAt? on completed runs (DES-064, ARCH-042, TASK-067)
//
// Mock policy (integration): real createServer + real SqliteRunStore + fake GatewayClient
// (fixed-response); the `layoutGraph` call and GraphPayload wrapping are part of the real server.
//
// Red reason: GET /api/runs/:id/dag currently returns a bare DagNode (the v8 Slice 3 model).
//   It does NOT return a GraphPayload envelope with kind:'run', layout cells, startedBy, or terminalAt.
//   All cases fail with wrong-shape assertions.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

let server: Server;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-it064-'));
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir });
});

afterAll(async () => {
  await server?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
  return JSON.parse(body.result?.content?.[0]?.text ?? 'null');
}

async function pollDone(runId: string, maxMs = 8000): Promise<void> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const s = await callTool('workflow_status', { runId }) as { status?: string };
    if (s?.status !== 'queued' && s?.status !== 'running') return;
    await new Promise((r) => setTimeout(r, 40));
  }
}

describe('GET /api/runs/:id/dag — GraphPayload envelope (IT-064, DES-064)', () => {
  it('returns kind:"run" envelope with a layout containing cells and edges', async () => {
    const sub = await callTool('workflow_run', { script: 'return "ok";' }) as { runId?: string };
    const runId = sub?.runId!;
    await pollDone(runId);

    const res = await fetch(`http://127.0.0.1:${server.port}/api/runs/${runId}/dag`);
    expect(res.status).toBe(200);
    const payload = await res.json() as {
      kind?: string;
      cells?: unknown[];
      edges?: unknown[];
      startedBy?: { type?: string };
      warnings?: string[];
    };
    // ARCH-042: the endpoint returns a flat GraphPayload envelope (DES-064), not a bare DagNode
    expect(payload.kind).toBe('run');
    expect(Array.isArray(payload.cells)).toBe(true);
    expect(Array.isArray(payload.edges)).toBe(true);
    // At minimum: the trigger node is always present
    expect((payload.cells?.length ?? 0)).toBeGreaterThan(0);
  });

  it('payload carries startedBy from the run record', async () => {
    const sub = await callTool('workflow_run', { script: 'return 1;' }) as { runId?: string };
    const runId = sub?.runId!;
    await pollDone(runId);

    const res = await fetch(`http://127.0.0.1:${server.port}/api/runs/${runId}/dag`);
    const payload = await res.json() as { startedBy?: { type?: string } };
    // startedBy.type from the run record is threaded into the graph envelope (ARCH-042)
    expect(payload.startedBy?.type).toBe('client');
  });

  it('terminalAt is present on a completed run', async () => {
    const sub = await callTool('workflow_run', { script: 'return "done";' }) as { runId?: string };
    const runId = sub?.runId!;
    await pollDone(runId);

    const res = await fetch(`http://127.0.0.1:${server.port}/api/runs/${runId}/dag`);
    const payload = await res.json() as { terminalAt?: string };
    // ARCH-042: terminalAt? on RunStatusView / GraphPayload — lets pollers stop on completed runs
    expect(payload.terminalAt).toBeTruthy();
    // Must be a valid ISO timestamp
    expect(new Date(payload.terminalAt!).getTime()).toBeGreaterThan(0);
  });

  it('layout cells carry logical grid coords (col, row, laneSpan) — no raw pixels', async () => {
    const sub = await callTool('workflow_run', { script: 'return "ok";' }) as { runId?: string };
    const runId = sub?.runId!;
    await pollDone(runId);

    const res = await fetch(`http://127.0.0.1:${server.port}/api/runs/${runId}/dag`);
    const payload = await res.json() as { cells?: Array<Record<string, unknown>> };
    const cells = payload.cells ?? [];
    expect(cells.length).toBeGreaterThan(0);
    const cell = cells[0]!;
    // Every cell must have logical grid coordinates
    expect(typeof cell['col']).toBe('number');
    expect(typeof cell['row']).toBe('number');
    expect(typeof cell['laneSpan']).toBe('number');
    // Must NOT have raw pixel coordinates (old DagNode model used x/y/width/height)
    expect(cell['x']).toBeUndefined();
    expect(cell['y']).toBeUndefined();
  });
});
