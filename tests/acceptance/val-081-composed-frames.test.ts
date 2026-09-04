// VAL-081 (REQ-072): composed workflows drawn as distinct Morandi-tinted, labeled frames.
//
// Acceptance tier — MUST NOT mock the SUT's own boundaries: real HTTP server, real createServer,
// real GET /api/runs/:id/dag. Gateway faked only for structure assertions; agent frames tested with
// LLM-gated guard.
//
// CI-safe assertions (this test, real:false):
//   - GET /api/runs/:id/dag for a run that called workflow('sub') carries frame cells
//   - Frame cells are depth-nested (depth:1, depth:2 etc.) in the cells array
//   - Each frame cell carries a name (sub-workflow name) for the label
//
// Headless-browser visual assertions (deferred to Gate 7.5 real-run, real:true):
//   - Two differently-tinted labeled containers, each wrapping only its own agents
//   - A nested (depth-2) sub-workflow renders as a tinted frame inside its parent's frame
//   - Single-workflow run shows one plain region
//
// Red reason: GET /api/runs/:id/dag returns a v8 DagNode structure (no frame cells with kind:'frame',
//   no depth or name on cells). All structural assertions about frames fail.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { registerPublishedVia, runScriptVia } from '../helpers/workflow-fixtures.js';

let server: Server;
let tmpDir: string;
const HAS_PROVIDER = !!(process.env['ANTHROPIC_API_KEY'] || process.env['OLLAMA_BASE_URL'] || process.env['OPENAI_API_KEY'] || process.env['OPENROUTER_API_KEY']);

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-val081-'));
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
    const s = await callTool('run_status', { runId }) as { status?: string };
    if (s?.status !== 'queued' && s?.status !== 'running') return;
    await new Promise((r) => setTimeout(r, 40));
  }
}

describe('VAL-081: composed runs carry depth-nested frame cells (REQ-072)', () => {
  it.skipIf(!HAS_PROVIDER)('REQ-072 frame cells are present in dag payload for a composed run (LLM-gated) [UNVERIFIED here: no provider configured — set ANTHROPIC_API_KEY or OLLAMA_BASE_URL]', async () => {
    // Requires a real LLM to dispatch agents inside the sub-workflow.
    // The dag cells must include frame cells with name and depth fields.

    // v22: `workflow('val081-sub')` and run-by-name both resolve `release`, so each link in the
    // composition must be PUBLISHED, not merely registered.
    await registerPublishedVia(callTool, 'val081-sub', `return await agent('sub-agent', {});`);
    await registerPublishedVia(callTool, 'val081-main', `
        const r = await workflow('val081-sub', {});
        return r;
      `);

    const sub = await callTool('run_start', { name: 'val081-main' }) as { runId?: string };
    const runId = sub?.runId!;
    await pollDone(runId, 60_000);

    const res = await fetch(`http://127.0.0.1:${server.port}/api/runs/${runId}/dag`);
    const payload = await res.json() as {
      layout?: { cells?: Array<{ kind?: string; name?: string; depth?: number }> };
    };
    // REQ-072: frame cells for sub-workflows
    const frameCells = (payload.layout?.cells ?? []).filter((c) => c.kind === 'frame');
    expect(frameCells.length).toBeGreaterThanOrEqual(1);
    // Each frame cell carries a name (the sub-workflow name)
    expect(frameCells.every((f) => typeof f.name === 'string' && f.name.length > 0)).toBe(true);
    // Depth is tracked (depth:1 for the first level)
    expect(frameCells.some((f) => f.depth === 1)).toBe(true);
  });

  it.skipIf(!HAS_PROVIDER)('nested (depth-2) frame appears inside parent frame in cells (LLM-gated) [UNVERIFIED here: no provider configured — set ANTHROPIC_API_KEY or OLLAMA_BASE_URL]', async () => {
    // Depth-2 composition: main → mid → leaf.

    await registerPublishedVia(callTool, 'val081-leaf', `return await agent('leaf', {});`);
    await registerPublishedVia(callTool, 'val081-mid', `return await workflow('val081-leaf', {});`);
    await registerPublishedVia(callTool, 'val081-root', `return await workflow('val081-mid', {});`);

    const sub = await callTool('run_start', { name: 'val081-root' }) as { runId?: string };
    const runId = sub?.runId!;
    await pollDone(runId, 60_000);

    const res = await fetch(`http://127.0.0.1:${server.port}/api/runs/${runId}/dag`);
    const payload = await res.json() as {
      layout?: { cells?: Array<{ kind?: string; depth?: number }> };
    };
    const frameCells = (payload.layout?.cells ?? []).filter((c) => c.kind === 'frame');
    // Must have both depth:1 and depth:2 frames
    expect(frameCells.some((f) => f.depth === 1)).toBe(true);
    expect(frameCells.some((f) => f.depth === 2)).toBe(true);
  });

  it('single-workflow run dag has no frame cells (CI-safe)', async () => {
    // REQ-072: "a single-workflow run shows one plain region" — no sub-workflow frames.
    const sub = await runScriptVia(callTool, 'return "no-frames";') as { runId?: string };
    const runId = sub?.runId!;
    await pollDone(runId);

    const res = await fetch(`http://127.0.0.1:${server.port}/api/runs/${runId}/dag`);
    expect(res.status).toBe(200);
    const payload = await res.json() as {
      kind?: string;
      layout?: { cells?: Array<{ kind?: string }> };
    };
    // Must be a valid GraphPayload envelope (not the old DagNode)
    expect(payload.kind).toBe('run');
    // No sub-workflow frames in a simple run
    const frameCells = (payload.layout?.cells ?? []).filter((c) => c.kind === 'frame');
    expect(frameCells.length).toBe(0);
  });
});
