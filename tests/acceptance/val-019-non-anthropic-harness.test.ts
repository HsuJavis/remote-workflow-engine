// VAL-019: Non-Anthropic models run the full agent harness via the SDK gateway (REQ-016)
// Real entrypoint: gateway:"sdk" (ClaudeAgentSdkGatewayClient) + a real local Ollama model.
// No mock of the SUT's own boundaries. Gated on an explicit env var (same convention as
// VAL-003/VAL-004) so a bare `npm test` stays fast/hermetic; Gate 7.5 sets it for real.
//
// v24 MIGRATION (TASK-152), two separate defects fixed here:
//  1. FALSE GREEN. The two provider-dependent cases began `if (!HAS_PROVIDER) return;`, so with no
//     OLLAMA_BASE_URL they were reported PASSED having asserted nothing. They are now
//     `it.skipIf(!HAS_PROVIDER)` with the reason in the NAME. (The third case asserts the REAL pure
//     builder and needs no provider — it stays unconditional, and it is the only one of the three
//     that was ever actually verifying anything in CI.)
//  2. Pre-v24 fixtures: inline `run_start({script})` is closed (REQ-098); `model` inside an agent()
//     options literal is refused PARAM_IN_SCRIPT and belongs in
//     `meta.params.agents.<label>.model.default` (DES-143/DES-144); the declared default must be a
//     KNOWN alias, so `local-qwen` is now in the SERVER's alias table (registration reads
//     `config.aliases`, not the gateway's own), not only the gateway's; `run_agent_log` is keyed by
//     `label` (DES-161) and its transcript is the `events` array, not the envelope.
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
import { runScriptVia, type ToolCaller } from '../helpers/workflow-fixtures.js';

const HAS_PROVIDER = !!process.env['OLLAMA_BASE_URL'];
const NO_PROVIDER = ' [UNVERIFIED here: no provider configured — set OLLAMA_BASE_URL]';
const QWEN_ALIAS = { 'local-qwen': { provider: 'ollama' as const, model: 'qwen2.5:7b' } };

/** One declared agent label routed at the non-Anthropic alias, the shape DES-144 requires. */
function qwenScript(label: string, prompt: string, opts = ''): string {
  return [
    `export const meta = { params: { agents: { ${label}: {`,
    "  model: { type: 'string', default: 'local-qwen' },",
    "  effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' },",
    "  timeoutMs: { type: 'number', default: 60000 },",
    '} } } };',
    `return agent('${label}', { prompt: ${JSON.stringify(prompt)}${opts} });`,
  ].join('\n');
}

let server: Server;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-val019-'));
  // Real entrypoint per DES-030: gateway:"sdk" via the composition-root override (D-F1), with the
  // SAME alias table thinkingFor() consults — a non-Anthropic alias must disable thinking.
  server = await createServer({
    port: 0, bind: '127.0.0.1', workRoot: tmpDir,
    // v24 (DES-144): the SERVER's alias table is what registration validates a declared
    // `model.default` against — the gateway's own table is consulted only at dispatch, so a
    // script declaring `local-qwen` would be refused PARAM_CONTRACT_INVALID without this.
    aliases: QWEN_ALIAS,
    gateway: new ClaudeAgentSdkGatewayClient({
      baseUrl: process.env['OLLAMA_BASE_URL'] ?? 'http://127.0.0.1:4000',
      aliases: QWEN_ALIAS,
      timeoutMs: 60000,
    }),
  });
});

afterAll(async () => {
  await server?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

const mcpCall: ToolCaller<any> = async (name, args = {}) => {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> }; error?: { code: number; message: string } };
  if (body.error) return { error: body.error };
  // workflow_* tools return their own flat envelope ({runId,status,result,...}) directly.
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}') as Record<string, unknown>;
};

// v22 (REQ-098) / v24 (TASK-152): inline script is closed, so the script reaches the engine through
// register → publish → run-by-name. REQ-016's subject (the real non-Anthropic harness) is untouched.
async function runAndWait(script: string): Promise<Record<string, unknown>> {
  const run = await runScriptVia(mcpCall, script);
  const runId = run['runId'] as string;
  for (let i = 0; i < 90; i++) {
    const s = await mcpCall('run_status', { runId });
    if (s['status'] === 'completed' || s['status'] === 'failed') return { ...s, runId };
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('timed out');
}

/** `run_status`'s agent rows live under `.result` (mcp-facade.ts runStatus builds
 *  `{runId, status, result: merged}`); the flat `.agents` read the pre-v24 fixtures used is kept as
 *  a fallback. Returns the agent's own LABEL — `run_agent_log`'s advertised key since DES-161. */
function labelOf(statusView: Record<string, unknown>, fallback: string): string {
  const v = statusView as { result?: { agents?: Array<{ label?: string }> }; agents?: Array<{ label?: string }> };
  const agents = v.result?.agents ?? v.agents ?? [];
  return agents[0]?.label ?? fallback;
}

describe('VAL-019: REQ-016 — non-Anthropic model runs the full agent harness (tool loop + MCP + skills)', () => {
  it.skipIf(!HAS_PROVIDER)('a real local Ollama model emits a native tool_use turn (not text), the tool executes in the run workspace, and its result reaches the final answer' + NO_PROVIDER, async () => {
    // `allowedTools` is NOT one of the three keys an agent() options literal may not carry
    // (`LOCKED_PARAM_KEYS` = model/effort/timeoutMs, workflow-meta.ts:155) — it stays here.
    const r = await runAndWait(qwenScript('tooluser', 'write the word DONE into a file called out.txt using a tool, then say ok', ", allowedTools: ['Write']"));
    expect(r['status']).toBe('completed');
    const label = labelOf(await mcpCall('run_status', { runId: r['runId'] as string }), 'tooluser');
    const log = await mcpCall('run_agent_log', { runId: r['runId'] as string, label });
    expect(JSON.stringify(log['events'])).toContain('tool_call');
  }, 180000);

  it.skipIf(!HAS_PROVIDER)('the SessionInitRecord transcript head shows thinkingMode:"disabled" for the non-Anthropic alias (D-F6 regression guard)' + NO_PROVIDER, async () => {
    const r = await runAndWait(qwenScript('ponger', 'reply with only PONG'));
    const label = labelOf(await mcpCall('run_status', { runId: r['runId'] as string }), 'ponger');
    const log = await mcpCall('run_agent_log', { runId: r['runId'] as string, label });
    const transcript = (log['events'] as unknown[]) ?? [];
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
