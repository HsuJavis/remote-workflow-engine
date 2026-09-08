// VAL-084 (REQ-075): each card shows avg success rate + avg execution time
//
// Acceptance tier — MUST NOT mock SUT boundaries: real HTTP server, real createServer,
// real GET /api/home, real store. Gateway faked only for CI-safe (no-LLM) cases.
//
// CI-safe assertions: 4 completed + 1 failed terminal runs (seeded via real engine, no LLM) →
//   GET /api/home card for that workflow shows successRate: 0.8 and a finite avgDurationMs.
//   A never-run registered workflow shows {successRate:null, avgDurationMs:null, terminalCount:0}.
//
// Headless-browser "80% / 3.2 s" card text (deferred to Gate 7.5 real-run):
//   - the dashboard SPA renders the two metric values visibly on each card
//   - a never-run workflow renders "— / —" (not NaN, not undefined)
//
// Red reason: GET /api/home is not registered — falls through → non-HomeView response; all fail.
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
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-val084-'));
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir });
});

afterAll(async () => {
  await server?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

type WorkflowMetrics = { successRate: number | null; avgDurationMs: number | null; terminalCount: number };
type WorkflowCard = { name: string; group: string; metrics: WorkflowMetrics };
type HomeView = { running: WorkflowCard[]; registered: WorkflowCard[]; other: WorkflowCard[] };

describe('VAL-084: home card metrics — avg success rate + avg execution time (REQ-075)', () => {
  it('4 completed + 1 failed terminal runs → successRate 0.8, finite avgDurationMs, no NaN (CI-safe)', async () => {
    const wfName = 'val084-metrics-wf';
    // v22: `run_start({name})` resolves the `release` channel, so each registered version must
    // be published for the run to reach it (a bare register → CHANNEL_UNPUBLISHED).
    await registerPublishedVia(callTool, wfName, `export const meta = { name: '${wfName}', description: 'metrics under test' };
               return "ok";`);
    // Seed 4 completed runs
    for (let i = 0; i < 4; i++) {
      const sub = await callTool('run_start', { name: wfName }) as { runId?: string };
      await pollDone(sub?.runId!);
    }
    // Seed 1 failed run (throw causes failed status)
    // Publishing v2 onto `release` is what makes the 5th run pick up the throwing script.
    await registerPublishedVia(callTool, wfName, `export const meta = { name: '${wfName}', description: 'metrics under test' };
               throw new Error("intentional failure for val-084");`);
    const sub5 = await callTool('run_start', { name: wfName }) as { runId?: string };
    await pollDone(sub5?.runId!);

    const res = await fetch(`http://127.0.0.1:${server.port}/api/home`);
    expect(res.status).toBe(200);
    const view = await res.json() as HomeView;
    const allCards = [...view.running, ...view.registered, ...view.other];
    const card = allCards.find((c) => c.name === wfName);

    expect(card).toBeDefined();
    expect(card?.metrics.terminalCount).toBe(5);
    // 4 completed / 5 total terminal = 0.8
    expect(card?.metrics.successRate).toBeCloseTo(0.8);
    // avgDurationMs must be a finite non-NaN number ≥ 0
    expect(card?.metrics.avgDurationMs).not.toBeNull();
    expect(Number.isFinite(card?.metrics.avgDurationMs)).toBe(true);
    expect(Number.isNaN(card?.metrics.avgDurationMs)).toBe(false);
    expect((card?.metrics.avgDurationMs ?? -1)).toBeGreaterThanOrEqual(0);
  });

  it('never-run registered workflow → metrics {successRate:null, avgDurationMs:null, terminalCount:0} (CI-safe)', async () => {
    const wfName = 'val084-never-run';
    await callTool('workflow_register', {
      name: wfName,
      script: `export const meta = { name: '${wfName}', description: 'never run' };
               return "unreachable";`,
      mermaid: 'graph LR',
    });

    const res = await fetch(`http://127.0.0.1:${server.port}/api/home`);
    const view = await res.json() as HomeView;
    const card = [...view.running, ...view.registered, ...view.other].find((c) => c.name === wfName);

    expect(card).toBeDefined();
    expect(card?.metrics.terminalCount).toBe(0);
    // REQ-075: zero runs → null (never NaN, never divide-by-zero)
    expect(card?.metrics.successRate).toBeNull();
    expect(card?.metrics.avgDurationMs).toBeNull();
  });
});
