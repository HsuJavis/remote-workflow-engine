// IT-013: server.ts's default GatewayClient construction routes agent() calls through the managed
// LiteLLM proxy path (D-R1) — not the direct-per-provider-fetch path — when the caller does not
// explicitly opt out. Observed via the injected LiteLLMProxyManager seam (its own spawnImpl/
// fetchImpl faked, so no real `litellm` binary is ever spawned — DES-015 policy: this test mocks
// only the third-party subprocess boundary, everything else — real HTTP server, real sandboxed
// child process, real McpFacade/RunManager/AgentExecutor wiring — is genuine).
//
// Tier note: labelled "a forcing unit test" in the route-back directive (D-R1), but per DES-015's
// own tier definitions (unit mocks freely / integration = real adjacent components, only
// third-party network mocked) this is more accurately integration tier — it exercises the real
// server.ts composition root end-to-end (the only way to observe that root's own wiring decision)
// with only the litellm subprocess faked, matching the existing IT-005/IT-010 precedent. Filed
// under tests/integration/ and tier:integration for that reason; flagged here rather than silently
// mislabelled.
//
// Red reason (2026-07-03, before Gate 6 rework): src/server.ts's `createServer()` constructs
// `new LiteLLMGatewayClient({ aliases: config.aliases, timeoutMs, retries })` with no
// `useLiteLLMProxy` and no `proxyManager` forwarded at all, so `LiteLLMGatewayClient` always
// defaults to the direct-per-provider-fetch path (`_proxy` stays undefined). This test's injected
// proxyManager's `spawnImpl` is therefore never called.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import { createServer } from '../../src/server.js';
import type { Server, ServerConfig } from '../../src/server.js';
import { LiteLLMProxyManager } from '../../src/gateway/litellm-proxy.js';
import { runScriptVia, type ToolCaller } from '../helpers/workflow-fixtures.js';

const ALIASES = { default: { provider: 'anthropic' as const, model: 'claude-3-5-haiku-20241022' } };

function makeFakeProxyManager() {
  // Fakes the proxy's own process boundary only (D-R2/DES-015: never spawn/require a real
  // `litellm` binary in automated tests) — the health check resolves instantly so no real
  // subprocess timing is involved either.
  const fakeSpawn = vi.fn(() => ({ exitCode: null, kill: vi.fn() }) as unknown as ChildProcess);
  const fakeHealthFetch = vi.fn(async () => ({ ok: true }) as unknown as Response);
  const proxyManager = new LiteLLMProxyManager(ALIASES, {
    spawnImpl: fakeSpawn as unknown as typeof import('node:child_process').spawn,
    fetchImpl: fakeHealthFetch as unknown as typeof fetch,
  });
  return { proxyManager, fakeSpawn };
}

async function pollUntilSettled(baseUrl: string, runId: string) {
  const call = async (name: string, args: Record<string, unknown>) => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
    const body = (await res.json()) as { result?: { content: Array<{ text: string }> } };
    return JSON.parse(body.result!.content[0].text) as { status: string };
  };
  let status = await call('workflow_status', { runId });
  for (let i = 0; i < 60 && (status.status === 'running' || status.status === 'queued'); i++) {
    await new Promise((r) => setTimeout(r, 50));
    status = await call('workflow_status', { runId });
  }
  return status;
}

describe('Default GatewayClient/server construction uses the LiteLLM proxy path (IT-013, D-R1)', () => {
  const ORIGINAL_KEY = process.env['ANTHROPIC_API_KEY'];
  let server: Server | undefined;

  beforeEach(() => {
    // D-R2 hermeticity: no billed calls, ever, in automation — hold no real credential for the
    // duration of this test regardless of what happens to be set in the host environment.
    delete process.env['ANTHROPIC_API_KEY'];
  });

  afterEach(async () => {
    await server?.close();
    server = undefined;
    if (ORIGINAL_KEY === undefined) delete process.env['ANTHROPIC_API_KEY'];
    else process.env['ANTHROPIC_API_KEY'] = ORIGINAL_KEY;
  });

  it('an agent() call routes through the injected proxyManager by default (no explicit useLiteLLMProxy opt-in)', async () => {
    const { proxyManager, fakeSpawn } = makeFakeProxyManager();

    // Deliberately do NOT set useLiteLLMProxy — D-R1 requires the proxy path to be the default.
    server = await createServer({
      port: 0,
      bind: '127.0.0.1',
      aliases: ALIASES,
      proxyManager,
    } as ServerConfig & { proxyManager: LiteLLMProxyManager });
    const baseUrl = `http://127.0.0.1:${server.port}`;

    const callTool: ToolCaller = async (name, args) => {
      const res = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
      });
      const body = (await res.json()) as { result?: { content: Array<{ text: string }> } };
      return JSON.parse(body.result!.content[0]!.text);
    };
    const runId = (await runScriptVia(callTool, `return agent('ping');`) as { runId: string }).runId;

    const status = await pollUntilSettled(baseUrl, runId);
    expect(status.status).toBe('completed');

    // Proves the default wiring dispatched through the injected proxyManager, not a direct
    // per-provider fetch — the proxy's own spawnImpl is only ever invoked from inside
    // LiteLLMProxyManager.start(), which LiteLLMGatewayClient only calls when useLiteLLMProxy
    // is (by default) true.
    expect(fakeSpawn).toHaveBeenCalled();
  }, 15000);
});
