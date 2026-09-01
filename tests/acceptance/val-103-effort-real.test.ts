// VAL-103 (REQ-093): `effort` is a real end-to-end parameter, not a documented no-op.
//
// Mock policy (acceptance, DES-108): evidence plan pre-committed (Ollama has no reasoning dial —
// the wire assertion is not observable on the default local stack). Real-tier green =
//   (a) a real Ollama-backed run at effort:'max' completes with effortApplied recorded and no 400
//       (gated behind HAS_PROVIDER — needs an actual reachable backend);
//   (b) an UNGATED submission-time check: an out-of-enum effort value is refused before any
//       durable work, and the harness descriptor's `effortApplied` field exists in the schema
//       shape once a run's harness is read back (checked via the no-provider PARAM_OUT_OF_RANGE
//       path, which requires no live backend at all).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

const HAS_PROVIDER = !!process.env['OLLAMA_BASE_URL'];

let server: Server;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-val103-'));
  server = await createServer({
    port: 0, bind: '127.0.0.1', workRoot: tmpDir,
    aliases: { local: { provider: 'ollama', model: 'qwen2.5:7b' }, default: { provider: 'ollama', model: 'qwen2.5:7b' } },
  });
});
afterAll(async () => { await server?.close(); rmSync(tmpDir, { recursive: true, force: true }); });

async function callTool(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}') as Record<string, unknown>;
}

describe('REQ-093: effort is real end-to-end, not a documented no-op (VAL-103)', () => {
  // UNGATED — requires no live backend at all (submission-time validation, admission rung).
  it('an out-of-enum effort override (outside low|medium|high|xhigh|max) is refused at submission, before any durable work', async () => {
    await callTool('workflow_register', { name: 'val103-bad-effort', script: 'return 1;' });
    const r = await callTool('workflow_run', { name: 'val103-bad-effort', overrides: { effort: 'super-max' } });
    expect(r.code ?? (r.error as { code?: string } | undefined)?.code).toBe('PARAM_OUT_OF_RANGE');
  });

  it('a real Ollama-backed run at effort:"max" completes with effortApplied recorded (no 400, honest no-op) [requires OLLAMA_BASE_URL]', async () => {
    if (!HAS_PROVIDER) return;
    await callTool('workflow_register', { name: 'val103-real-effort', script: 'return await agent("say hi", {effort:"max"});' });
    const run = await callTool('workflow_run', { name: 'val103-real-effort' });
    const runId = run.runId as string;

    const deadline = Date.now() + 20_000;
    let status: { status?: string } = {};
    while (Date.now() < deadline) {
      status = await callTool('workflow_status', { runId }) as { status?: string };
      if (status.status === 'completed' || status.status === 'failed') break;
      await new Promise((r) => setTimeout(r, 300));
    }
    expect(status.status).toBe('completed');

    // A script with exactly one top-level agent() call always gets agentId 'agent-1' — same fixed
    // naming convention VAL-102/VAL-104 rely on. `workflow_status` nests agents under `.result.agents`,
    // not top-level `.agents` — polling/reading top-level `.agents` never resolves (test defect fixed
    // at Gate 7.5 v21: the prior version read `s.agents?.[0]?.agentId`, always undefined).
    const log = await callTool('workflow_agent_log', { runId, agentId: 'agent-1' }) as { harness?: { effortApplied?: unknown } };
    expect(log.harness?.effortApplied).toBeDefined();
  }, 25_000);

  // v21 GATE 7.5 ROUND 2 (2026-09-01, post adjudication #6/#7 F-1+G-1 closeout): the two prior
  // cases above exercise a PER-CALL effort override (the script itself passes {effort:...}) — they
  // never covered a workflow_register-time `defaults.effort`, which is exactly the P-A3
  // dispatch-inertness defect (fixed in IMPL-141) and the G-1 ceiling-bypass defect (also fixed in
  // IMPL-141). Both are asserted here for real over live MCP HTTP, matching REQ-092's own
  // registered-defaults-take-effect clause but for the `effort` knob specifically (VAL-102 only
  // ever exercised `model`).
  it('UNGATED (G-1): registering a defaults.effort ABOVE the server ceiling with NO params.knobs block is refused at registration, not silently stored above the ceiling', async () => {
    const { createServer: createLowCeilingServer } = await import('../../src/server.js');
    const { mkdtempSync: mkdtemp2, rmSync: rm2 } = await import('node:fs');
    const { tmpdir: tmpdir2 } = await import('node:os');
    const { join: join2 } = await import('node:path');
    const lowTmp = mkdtemp2(join2(tmpdir2(), 'rwe-val103-ceiling-'));
    const lowServer = await createLowCeilingServer({ port: 0, bind: '127.0.0.1', workRoot: lowTmp, maxEffort: 'low' });
    try {
      const call = async (name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> => {
        const res = await fetch(`http://127.0.0.1:${lowServer.port}/mcp`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
        });
        const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
        return JSON.parse(body.result?.content?.[0]?.text ?? '{}') as Record<string, unknown>;
      };
      // No `params.knobs` block at all — the G-1 hole: a bare caller-supplied `defaults.effort`
      // with no declared knob used to bypass the ceiling entirely.
      const r = await call('workflow_register', { name: 'val103-g1-ceiling', script: 'return 1;', defaults: { effort: 'high' } });
      expect((r.error as { code?: string } | undefined)?.code ?? r.code).toBe('HARNESS_DEFAULTS_INVALID');
      const got = await call('workflow_get', { name: 'val103-g1-ceiling' });
      expect(got.code).toBe('WORKFLOW_NOT_FOUND'); // fail-closed: nothing stored above the ceiling
    } finally {
      await lowServer.close();
      rm2(lowTmp, { recursive: true, force: true });
    }
  });

  it('a workflow registered with defaults.effort:"high" and NO override/no per-call effort dispatches with the declared default, provenance "default" [requires OLLAMA_BASE_URL]', async () => {
    if (!HAS_PROVIDER) return;
    await callTool('workflow_register', { name: 'val103-registered-effort-default', script: 'return await agent("say hi");', defaults: { effort: 'high' } });
    const run = await callTool('workflow_run', { name: 'val103-registered-effort-default' });
    const runId = run.runId as string;

    const deadline = Date.now() + 20_000;
    let status: { status?: string } = {};
    while (Date.now() < deadline) {
      status = await callTool('workflow_status', { runId }) as { status?: string };
      if (status.status === 'completed' || status.status === 'failed') break;
      await new Promise((r) => setTimeout(r, 300));
    }
    expect(status.status).toBe('completed');

    const log = await callTool('workflow_agent_log', { runId, agentId: 'agent-1' }) as { harness?: { effort?: unknown; provenance?: Record<string, string> } };
    expect(log.harness?.effort).toBe('high');
    expect(log.harness?.provenance?.['effort']).toBe('default');
  }, 25_000);
});
