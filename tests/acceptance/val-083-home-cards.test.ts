// VAL-083 (REQ-074): home cards grouped RUNNING/REGISTERED/OTHER with description
//
// Acceptance tier — MUST NOT mock SUT boundaries: real HTTP server, real createServer,
// real GET /api/home, real store. Gateway faked only for CI-safe (no-LLM) cases.
//
// CI-safe assertions (this test, real:false):
//   - GET /api/home returns HTTP 200 with the three-group HomeView shape
//   - a registered workflow's card carries its description and a metrics object
//   - an inline-script run (no name) produces a card in other[] (grouped as '(inline)' or similar)
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
    const s = await callTool('workflow_status', { runId }) as { status?: string };
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

  it('inline-script run (no name) appears in other[] (CI-safe)', async () => {
    // NOT MIGRATED (reported to the orchestrator): this case's SUBJECT is a nameless run landing in
    // other[]. dashboard.ts's other[] is "runs whose name is absent from the catalog", keyed
    // '(inline)' when the run has no name at all — and v22 (REQ-098) means every run now has a name
    // that IS in the catalog. Routing it through the fixture helper would give the run a registered
    // name, moving the card to registered[] and inverting the assertion. Left raw on purpose.
    // Run an inline script — it has no registered workflow name
    const sub = await callTool('workflow_run', { script: 'return "inline-for-val083";' }) as { runId?: string };
    await pollDone(sub?.runId!);

    const res = await fetch(`http://127.0.0.1:${server.port}/api/home`);
    const view = await res.json() as HomeView;
    // Inline runs should appear in other[], not running/registered
    // The card name is either undefined-stringified or '(inline)' per DES-070
    expect(view.other.length).toBeGreaterThan(0);
    // All other[] cards must have group:'other'
    for (const c of view.other) {
      expect(c.group).toBe('other');
    }
  });
});
