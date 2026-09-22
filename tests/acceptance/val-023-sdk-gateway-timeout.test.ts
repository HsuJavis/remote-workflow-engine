// VAL-023: SDK gateway path bounds a hung agent LLM call — timeout + retries (REQ-020)
// Real entrypoint: real spawned `claude` CLI via ClaudeAgentSdkGatewayClient, pointed at a REAL
// (fault-injected, never-responding) local HTTP endpoint — a real hung provider, not a mock of
// anything this product owns (same technique as IT-015's stub server / E2E-007).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { ClaudeAgentSdkGatewayClient } from '../../src/gateway/claude-agent-sdk-client.js';
import { runScriptVia } from '../helpers/workflow-fixtures.js';

const HUNG_PORT = 38201;

let server: Server;
let tmpDir: string;
let hungStub: HttpServer;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-val023-'));
  hungStub = createHttpServer(() => { /* never responds — a real fault-injected hung provider */ });
  await new Promise<void>((resolve) => hungStub.listen(HUNG_PORT, '127.0.0.1', resolve));
  server = await createServer({
    port: 0, bind: '127.0.0.1', workRoot: tmpDir,
    gateway: new ClaudeAgentSdkGatewayClient({ baseUrl: `http://127.0.0.1:${HUNG_PORT}`, timeoutMs: 5000, retries: 0 }),
  });
});

afterAll(async () => {
  await server?.close();
  // The stub is DELIBERATELY hung: it never ends a response, so every request it received is still
  // an open socket, and `close()` waits for all of them — it does not return, and this hook times
  // out (10s) even though all assertions passed. Drop those sockets first: the connections exist
  // only because the fixture chose never to answer them (Gate 6.5+7 verifier, 2026-09-03).
  hungStub.closeAllConnections();
  await new Promise<void>((resolve) => hungStub.close(() => resolve()));
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

describe('VAL-023: REQ-020 clause 1 — a hung provider call is bounded, agent() resolves null, the run continues (never hangs)', () => {
  it('a real run against the hung provider completes within the configured bound, agent() resolving null', async () => {
    // v24 (DES-143/DES-144, TASK-152): `agent()` takes a literal LABEL first and the prompt as
    // `options.prompt`, and every label needs a `meta.params.agents.<label>` declaration with a
    // `.default` for model/effort/timeoutMs (AGENT_UNDECLARED otherwise). The declared
    // `timeoutMs.default` is DELIBERATELY the same 5000ms this file's `beforeAll` configures on the
    // gateway: a per-call `opts.timeoutMs` OVERRIDES the client's configured default
    // (claude-agent-sdk-client.ts:443/457), so the bound under test has to be declared here or the
    // fixture would silently be measuring a different one. `model:'default'` resolves through
    // DEFAULT_ALIASES to the same dial the hung stub intercepts via `baseUrl`.
    const run = await runScriptVia(mcpCall, [
      "export const meta = { params: { agents: { hang: {",
      "  model: { type: 'string', default: 'default' },",
      "  effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' },",
      "  timeoutMs: { type: 'number', default: 5000 },",
      "} } } };",
      "const r = await agent('hang', { prompt: 'this will hang' });",
      "return r === null ? 'bounded' : 'leaked-non-null';",
    ].join('\n'));
    const runId = run['runId'] as string;
    let finalStatus: string | undefined;
    for (let i = 0; i < 30; i++) {
      const s = await mcpCall('run_status', { runId });
      finalStatus = s['status'] as string;
      if (finalStatus === 'completed' || finalStatus === 'failed') break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    expect(finalStatus).toBe('completed');
    const result = await mcpCall('run_result', { runId });
    expect(result['result']).toBe('bounded');
  }, 60000);
});

describe('VAL-023: REQ-020 clause 2 — the provider/timeout failure is visible in the AgentRecord, never smuggled as fake success text', () => {
  it('the run resolves ok:false with a timeout on the AgentRecord, and the process-global slot frees back to 0 (DES-260: kill-on-timeout is now Options.abortController, slot-free is RunManager.withSlot()\'s own finally — the old standalone race primitive is deleted)', async () => {
    const run = await runScriptVia(mcpCall, [
      "export const meta = { params: { agents: { hang: {",
      "  model: { type: 'string', default: 'default' },",
      "  effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' },",
      "  timeoutMs: { type: 'number', default: 5000 },",
      "} } } };",
      "const r = await agent('hang', { prompt: 'this will hang too' });",
      "return r === null ? 'bounded' : 'leaked-non-null';",
    ].join('\n'));
    const runId = run['runId'] as string;
    let finalStatus: string | undefined;
    for (let i = 0; i < 30; i++) {
      const s = await mcpCall('run_status', { runId });
      finalStatus = s['status'] as string;
      if (finalStatus === 'completed' || finalStatus === 'failed') break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    expect(finalStatus).toBe('completed');
    const status = await mcpCall('run_status', { runId });
    const view = status['result'] as { agents: Array<{ label?: string; state: string; detail?: string }> };
    const hangAgent = view.agents.find((a) => a.label === 'hang');
    expect(hangAgent?.state).toBe('failed');
    expect(hangAgent?.detail).toMatch(/timeout/);
    const statusRes = await fetch(`http://127.0.0.1:${server.port}/api/status`);
    const statusBody = await statusRes.json() as { agentSemaphore: { inUse: number } };
    expect(statusBody.agentSemaphore.inUse).toBe(0);
  }, 60000);
});
