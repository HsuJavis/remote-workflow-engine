// VAL-019: Non-Anthropic models run the full agent harness via the SDK gateway (REQ-016)
// Real entrypoint: gateway:"sdk" (ClaudeAgentSdkGatewayClient) + a real local Ollama model.
// No mock of the SUT's own boundaries. Gated on an explicit env var (same convention as
// VAL-003/VAL-004) so a bare `npm test` stays fast/hermetic; Gate 7.5 sets it for real.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { ClaudeAgentSdkGatewayClient } from '../../src/gateway/claude-agent-sdk-client.js';
// Value import of the REAL pure builder REQ-016 clause 2/3 is built on (DES-026) — module-not-found
// at load time when absent, so this VAL file is RED regardless of HAS_PROVIDER gating below.
import { buildSessionOptions, type ProviderProfile } from '../../src/session-options-builder.js';

const HAS_PROVIDER = !!process.env['OLLAMA_BASE_URL'];

let server: Server;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-val019-'));
  // Real entrypoint per DES-030: gateway:"sdk" via the composition-root override (D-F1), with the
  // SAME alias table thinkingFor() consults — a non-Anthropic alias must disable thinking.
  server = await createServer({
    port: 0, bind: '127.0.0.1', workRoot: tmpDir,
    gateway: new ClaudeAgentSdkGatewayClient({
      baseUrl: process.env['OLLAMA_BASE_URL'] ?? 'http://127.0.0.1:4000',
      aliases: { 'local-qwen': { provider: 'ollama', model: 'qwen2.5:7b' } },
      timeoutMs: 60000,
    }),
  });
});

afterAll(async () => {
  await server?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

async function mcpCall(name: string, args: Record<string, unknown> = {}) {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> }; error?: { code: number; message: string } };
  if (body.error) return { error: body.error };
  // workflow_* tools return their own flat envelope ({runId,status,result,...}) directly.
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

describe('VAL-019: REQ-016 — non-Anthropic model runs the full agent harness (tool loop + MCP + skills)', () => {
  it('a real local Ollama model emits a native tool_use turn (not text), the tool executes in the run workspace, and its result reaches the final answer', async () => {
    if (!HAS_PROVIDER) return;
    const r = await runAndWait(`return agent('write the word DONE into a file called out.txt using a tool, then say ok', { model: 'local-qwen', allowedTools: ['Write'] });`);
    expect(r['status']).toBe('completed');
    const statusView = await mcpCall('workflow_status', { runId: r['runId'] as string });
    const agents = (statusView['agents'] as Array<{ agentId: string }>) ?? [];
    const log = await mcpCall('workflow_agent_log', { runId: r['runId'] as string, agentId: agents[0]!.agentId });
    expect(JSON.stringify(log['result'])).toContain('tool_call');
  }, 180000);

  it('the SessionInitRecord transcript head shows thinkingMode:"disabled" for the non-Anthropic alias (D-F6 regression guard)', async () => {
    if (!HAS_PROVIDER) return;
    const r = await runAndWait(`return agent('reply with only PONG', { model: 'local-qwen' });`);
    const statusView = await mcpCall('workflow_status', { runId: r['runId'] as string });
    const agents = (statusView['agents'] as Array<{ agentId: string }>) ?? [];
    const log = await mcpCall('workflow_agent_log', { runId: r['runId'] as string, agentId: agents[0]!.agentId });
    const transcript = (log['result'] as unknown[]) ?? [];
    const head = transcript[0] as { data?: { thinkingMode?: string } } | undefined;
    expect(head?.data?.thinkingMode).toBe('disabled');
  }, 120000);

  it('thinking is disabled for a non-Anthropic alias via the REAL SessionOptionsBuilder — ALWAYS asserted, independent of provider availability (REQ-016 clause 2)', () => {
    const nonAnthropicProfile: ProviderProfile = { providerClass: 'non-anthropic', supportsExtendedThinking: false, timeoutMs: 30000, retries: 1 };
    const out = buildSessionOptions('local-qwen', nonAnthropicProfile, { modelId: 'qwen2.5:7b', cwd: tmpDir }, {}, [], ['Read']);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.sessionInit.thinkingMode).toBe('disabled');
  });
});
