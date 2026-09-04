// VAL-083 (REQ-074): home cards grouped RUNNING/REGISTERED/OTHER with description
//
// Acceptance tier — MUST NOT mock SUT boundaries: real HTTP server, real createServer,
// real GET /api/home, real store. Gateway faked only for CI-safe (no-LLM) cases.
//
// CI-safe assertions (this test, real:false):
//   - GET /api/home returns HTTP 200 with the three-group HomeView shape
//   - a registered workflow's card carries its description and a metrics object
//   - a run whose workflow was DEREGISTERED produces a card in other[] (v22, adjudication #3 M-4:
//     was "an inline-script run (no name)" until REQ-098 closed that entry point)
//   - card objects have the required WorkflowCard fields (name, description, group, metrics)
//
// Headless-browser mini-SVG preview and full-graph click (deferred to Gate 7.5 real-run):
//   - the home dashboard page renders three group headers in HTML
//   - a "2-parallel → verify" workflow's card shows a mini skeleton SVG preview
//   - clicking a card opens the full graph view
//
// Red reason: GET /api/home is not registered — falls through to MCP handler → non-HomeView response.
//   All CI-safe cases below fail.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { registerPublishedVia } from '../helpers/workflow-fixtures.js';

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

async function pollDone(runId: string, maxMs = 8000): Promise<void> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const s = await callTool('run_status', { runId }) as { status?: string };
    if (s?.status !== 'queued' && s?.status !== 'running') return;
    await new Promise((r) => setTimeout(r, 40));
  }
}

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-val083-'));
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir });
});

afterAll(async () => {
  await server?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

type WorkflowCard = {
  name: string;
  description: string;
  group: 'running' | 'registered' | 'other';
  metrics: { successRate: number | null; avgDurationMs: number | null; terminalCount: number };
  activeRunId?: string;
  latestRunId?: string;
};

type HomeView = { running: WorkflowCard[]; registered: WorkflowCard[]; other: WorkflowCard[] };

describe('VAL-083: GET /api/home — grouping + description (REQ-074)', () => {
  it('GET /api/home returns HTTP 200 with the three-group HomeView shape (CI-safe)', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/api/home`);
    expect(res.status).toBe(200);
    const body = await res.json() as HomeView;
    // All three group arrays must exist (even if empty)
    expect(Array.isArray(body.running)).toBe(true);
    expect(Array.isArray(body.registered)).toBe(true);
    expect(Array.isArray(body.other)).toBe(true);
  });

  it('a registered workflow card has name, description, group, and metrics (CI-safe)', async () => {
    const wfName = 'val083-cs';
    await callTool('workflow_register', {
      name: wfName,
      script: `export const meta = {
        name: '${wfName}',
        description: 'customer-service: 2-parallel → verify',
        phases: [{ title: 'Draft' }, { title: 'Verify' }],
      };
      return "skeleton-only";`,
      mermaid: 'graph TD;',
    });

    const res = await fetch(`http://127.0.0.1:${server.port}/api/home`);
    const view = await res.json() as HomeView;
    const card = [...view.running, ...view.registered, ...view.other].find((c) => c.name === wfName);

    expect(card).toBeDefined();
    expect(card?.name).toBe(wfName);
    expect(card?.description).toBe('customer-service: 2-parallel → verify');
    // group must be one of the three valid values
    expect(['running', 'registered', 'other']).toContain(card?.group);
    // metrics object must be present
    expect(card?.metrics).toBeDefined();
    expect('successRate' in (card?.metrics ?? {})).toBe(true);
    expect('avgDurationMs' in (card?.metrics ?? {})).toBe(true);
    expect('terminalCount' in (card?.metrics ?? {})).toBe(true);
  });

  it("a DEREGISTERED workflow's run appears in other[] (CI-safe)", async () => {
    // v22 adjudication #3 (M-4): this case's subject used to be a nameless inline-script run. v22
    // (REQ-098) closed inline script, so every run now carries a catalog name and that entry point
    // into other[] is unreachable — but the BUCKET still means something. dashboard.ts's other[] is
    // "runs whose name is absent from the catalog" (buildHomeView's own comment: "inline or
    // deregistered"), and deregistration is now the only way in: run a registered workflow to
    // completion, then deregister it, and its run's card must fall out of registered[] into
    // other[]. Rewritten to that subject rather than retired.
    const wfName = 'val083-dereg';
    await registerPublishedVia(callTool, wfName, 'return "deregistered-for-val083";');
    const sub = await callTool('run_start', { name: wfName }) as { runId?: string };
    await pollDone(sub?.runId!);

    const dereg = await callTool('workflow_deregister', { name: wfName }) as { removed?: boolean; result?: { removed?: boolean } };
    expect(dereg.removed ?? dereg.result?.removed).toBe(true);

    const res = await fetch(`http://127.0.0.1:${server.port}/api/home`);
    const view = await res.json() as HomeView;
    // The card is keyed by the run's own name (not '(inline)') and must now be in other[] alone.
    expect(view.other.map((c) => c.name)).toContain(wfName);
    expect(view.registered.map((c) => c.name)).not.toContain(wfName);
    expect(view.running.map((c) => c.name)).not.toContain(wfName);
    // All other[] cards must have group:'other'
    for (const c of view.other) {
      expect(c.group).toBe('other');
    }
  });
});
