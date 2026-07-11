// E2E-006: Provision an MCP with a secret handle → a workflow references it by name → the SDK
// gateway's real tool_use round trip resolves it, with the secret NEVER appearing in any transcript
// (REQ-016, REQ-017, REQ-018 cross-cutting journey).
// RED: mcp_provision doesn't exist on the real server yet ("Unknown tool" always, regardless of
// provider availability) — the always-executed assertion below fails independent of HAS_PROVIDER.
// No mock of the SUT's own boundaries: real server, real MCP HTTP calls, real local Ollama when
// HAS_PROVIDER is set (same convention as VAL-003/VAL-004 — gated by an explicit env var, not a
// runtime probe, so a bare `npm test` run stays fast/hermetic; Gate 7.5 sets the env var for real).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

const HAS_PROVIDER = !!(process.env['ANTHROPIC_API_KEY'] || process.env['OLLAMA_BASE_URL']);

let server: Server;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-e2e-mcpsecret-'));
  process.env['RWE_SECRET_ITTEST_TOKEN'] = 'sh-real-super-secret-e2e-token';
  server = await createServer({
    port: 0, bind: '127.0.0.1', workRoot: tmpDir,
    aliases: { 'local-qwen': { provider: 'ollama', model: 'qwen2.5:7b' } },
  });
});

afterAll(async () => {
  await server?.close();
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env['RWE_SECRET_ITTEST_TOKEN'];
});

async function mcpCall(name: string, args: Record<string, unknown> = {}) {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> }; error?: { code: number; message: string } };
  // A JSON-RPC-LEVEL error (e.g. "Unknown tool: mcp_provision" — today's real "not implemented"
  // shape for a tool that doesn't exist yet) never reaches `result.content` at all; surface it as
  // `error` so callers checking `out.error` see it instead of silently unwrapping to `{}`.
  if (body.error) return { error: { code: String(body.error.code), message: body.error.message } };
  // NOTE: workflow_* tools already return their own flat envelope ({runId,status,result,...}) as
  // the parsed JSON — do NOT dig into `.result` here (it may be a primitive/array payload, not a
  // wrapper). Only asset_push/asset_list/mcp_provision-style tools wrap their payload under
  // `.result` — callers of THOSE tools dereference `.result` themselves at the call site.
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}') as Record<string, unknown>;
}

async function runAndWait(script: string): Promise<Record<string, unknown>> {
  const run = await mcpCall('workflow_run', { script });
  const runId = run['runId'] as string;
  for (let i = 0; i < 90; i++) {
    const s = await mcpCall('workflow_status', { runId });
    if (s['status'] === 'completed' || s['status'] === 'failed') return { ...s, runId };
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('timed out');
}

describe('E2E-006: provision → reference-by-name → real tool_use round trip, secret never leaked', () => {
  it('mcp_provision is a real wired admin tool (ALWAYS asserted — not gated on provider availability)', async () => {
    const out = await mcpCall('mcp_provision', {
      name: 'itest-secret-mcp', kind: 'http',
      config: { url: 'https://example.com/mcp', headers: { Authorization: 'Bearer ${secret:ITTEST_TOKEN}' } },
    });
    expect((out as { error?: { code: string } }).error).toBeUndefined();
  });

  it('a workflow referencing the provisioned MCP by name gets a real native tool_use round trip; the raw secret value never appears in the transcript', async () => {
    if (!HAS_PROVIDER) return;
    const r = await runAndWait(`return agent('call the itest-secret-mcp tool once', { mcp: ['itest-secret-mcp'] });`);
    expect(r['status']).toBe('completed');
    const statusView = await mcpCall('workflow_status', { runId: r['runId'] as string });
    const agents = (statusView['agents'] as Array<{ agentId: string }>) ?? [];
    expect(agents.length).toBeGreaterThan(0);
    const transcript = await mcpCall('workflow_agent_log', { runId: r['runId'] as string, agentId: agents[0]!.agentId });
    expect(JSON.stringify(transcript)).not.toContain('sh-real-super-secret-e2e-token');
    // REQ-016 clause 1: a real native tool_use turn, not text-only degradation.
    expect(JSON.stringify(transcript)).toContain('tool_call');
  }, 180000);
});
