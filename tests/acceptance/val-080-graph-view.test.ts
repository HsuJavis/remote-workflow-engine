// VAL-080 (REQ-071): n8n-style graph view — trigger source node → agent boxes → edges, Morandi theme.
//
// Acceptance tier — MUST NOT mock the SUT's own boundaries: real HTTP server, real createServer,
// real GET /api/runs/:id/dag, real dashboard page. Gateway faked only for CI-safe non-LLM assertions.
//
// CI-safe assertions (this test, real:false):
//   - GET /api/runs/:id/dag returns a GraphPayload with kind:'run', cells[], edges[], startedBy
//   - A no-agent run has a trigger node only; a workflow with agents has agent cells + edges
//   - The dashboard page for the run ID serves HTML (not a 404); the page body never scrolls horizontally
//     (verified by checking the HTML contains a graph container with overflow-x handling)
//
// Headless-browser DAG render (deferred to Gate 7.5 real-run, real:true):
//   - Customer-service run: trigger node → "Draft" group (2 parallel agents) → "Verify" agent
//   - Schedule-triggered run shows a `schedule` source node
//   - Webhook-triggered run shows a `webhook` source node
//
// Red reason: GET /api/runs/:id/dag returns the v8 DagNode structure (not GraphPayload); the endpoint
//   does not return kind:'run', cells[], or startedBy. Dashboard page does not render an SVG graph.
//   All CI-safe assertions below fail.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

let server: Server;
let tmpDir: string;
const HAS_PROVIDER = !!(process.env['ANTHROPIC_API_KEY'] || process.env['OLLAMA_BASE_URL'] || process.env['OPENAI_API_KEY'] || process.env['OPENROUTER_API_KEY']);

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-val080-'));
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

describe('VAL-080: graph view returns GraphPayload (REQ-071)', () => {
  it('GET /api/runs/:id/dag returns kind:"run" envelope with cells, edges, and startedBy (CI-safe)', async () => {
    // A no-agent workflow: trigger node + return.
    const sub = await callTool('workflow_run', { script: 'return "val080";' }) as { runId?: string };
    const runId = sub?.runId!;
    await pollDone(runId);

    const res = await fetch(`http://127.0.0.1:${server.port}/api/runs/${runId}/dag`);
    expect(res.status).toBe(200);
    const payload = await res.json() as {
      kind?: string;
      cells?: Array<{ kind?: string; id?: string }>;
      edges?: unknown[];
      startedBy?: { type?: string };
      warnings?: string[];
    };
    // REQ-071: GraphPayload flat envelope (DES-064 — cells/edges at top level)
    expect(payload.kind).toBe('run');
    expect(Array.isArray(payload.cells)).toBe(true);
    expect(Array.isArray(payload.edges)).toBe(true);
    // Trigger node labeled by startedBy.type — must be present
    const triggerCell = payload.cells?.find((c) => c.kind === 'trigger');
    expect(triggerCell).toBeDefined();
    // startedBy at envelope level (via MCP facade call site)
    expect(payload.startedBy?.type).toBe('client');
  });

  it('dashboard page for run ID serves HTML (not 404) — graph container exists in page body', async () => {
    const sub = await callTool('workflow_run', { script: 'return "html-check";' }) as { runId?: string };
    const runId = sub?.runId!;
    await pollDone(runId);

    const res = await fetch(`http://127.0.0.1:${server.port}/dashboard/${runId}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toMatch(/<html/i);
    // Page must include a graph container element (the n8n-style SVG graph lives here)
    // and must NOT force horizontal scroll on the body.
    expect(html).toMatch(/graph|svg|canvas/i);
    expect(html).not.toMatch(/body[^}]*overflow-x\s*:\s*scroll/i);
  });

  it('REQ-071 agent+edge render (LLM-gated — deferred to Gate 7.5 real-run)', async () => {
    // This case requires a real LLM to dispatch agents, producing agent cells + edges in the graph.
    // Skipped in CI; the headless-browser assertion (trigger → Draft parallel → Verify) is at Gate 7.5.
    if (!HAS_PROVIDER) return;
    await callTool('workflow_register', {
      name: 'val080-cs',
      script: `export const meta = {
        name: 'val080-cs',
        phases: [{ title: 'Draft' }, { title: 'Verify' }],
      };
      const drafts = await parallel([
        () => agent('draft 1'),
        () => agent('draft 2'),
      ]);
      return await agent('verify');`,
    });
    const sub = await callTool('workflow_run', { name: 'val080-cs' }) as { runId?: string };
    const runId = sub?.runId!;
    await pollDone(runId, 60_000);

    const res = await fetch(`http://127.0.0.1:${server.port}/api/runs/${runId}/dag`);
    const payload = await res.json() as {
      layout?: { cells?: Array<{ kind?: string; parallel?: number }>; edges?: unknown[] };
    };
    const agentCells = (payload.layout?.cells ?? []).filter((c) => c.kind === 'agent');
    expect(agentCells.length).toBeGreaterThanOrEqual(3); // trigger + 2 Draft + 1 Verify
    expect((payload.layout?.edges ?? []).length).toBeGreaterThan(0);
    // Two agents share a parallel group (Draft)
    const parallelGroup = agentCells.filter((c) => c.parallel !== undefined);
    expect(parallelGroup.length).toBeGreaterThanOrEqual(2);
  });
});
