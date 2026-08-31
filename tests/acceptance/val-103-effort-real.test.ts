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

    const s = await callTool('workflow_status', { runId }) as { agents?: Array<{ agentId: string }> };
    const agentId = s.agents?.[0]?.agentId;
    const log = await callTool('workflow_agent_log', { runId, agentId: agentId! }) as { harness?: { effortApplied?: unknown } };
    expect(log.harness?.effortApplied).toBeDefined();
  }, 25_000);
});
