// IT-039 (D-V3M-1, closes ①): the production wiring IT-035 deliberately left unasserted — a name
// provisioned via `mcp_provision` must actually reach a real agent()'s `options.mcpServers` at
// session-build time, with any `${secret:NAME}` handle in its config resolved from the server-side
// secret store (RWE_SECRET_*), and strictMcpConfig preserved. Before D-V3M-1 this path was dead:
// McpRegistry.resolveInjected() had no production caller and the SDK gateway only read the (now
// redirect-emptied) mcp-config asset dir — so agents got ZERO provisioned MCP tools.
//
// Mock policy (integration tier, same as IT-035): real composeConfig() + real createServer() + real
// HTTP round trip + real McpRegistry persistence + real sandbox/run lifecycle; only the third-party
// SDK query() export (queryImpl seam) and the managed LiteLLM proxy subprocess are faked.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { composeConfig } from '../../src/main.js';
import { LiteLLMProxyManager } from '../../src/gateway/litellm-proxy.js';
import { FakeMcpProbe } from '../../src/mcp-probe.js';
import type { AliasMap } from '../../src/gateway/client.js';

const ALIASES: AliasMap = {
  default: { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
  local: { provider: 'ollama', model: 'qwen2.5:7b' },
};

function makeFakeProxyManager(): LiteLLMProxyManager {
  const fakeSpawn = vi.fn(() => ({ exitCode: null, kill: vi.fn() }) as unknown as ChildProcess);
  const fakeHealthFetch = vi.fn(async () => ({ ok: true }) as unknown as Response);
  return new LiteLLMProxyManager(ALIASES, {
    spawnImpl: fakeSpawn as unknown as typeof import('node:child_process').spawn,
    fetchImpl: fakeHealthFetch as unknown as typeof fetch,
  });
}

function fakeSuccessSession() {
  return (async function* () {
    yield { type: 'result', subtype: 'success', is_error: false, result: 'ok', usage: { input_tokens: 1, output_tokens: 1 } };
  })();
}

interface CapturedCall {
  options?: {
    mcpServers?: Record<string, { url?: string; type?: string; command?: string }>;
    strictMcpConfig?: boolean;
  };
}

describe('provisioned MCP by-name injection reaches options.mcpServers with secrets resolved (IT-039, D-V3M-1, REQ-017/REQ-018)', () => {
  let server: Server;
  let workRoot: string;
  let baseUrl: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let queryImpl: any;

  beforeAll(async () => {
    workRoot = mkdtempSync(join(tmpdir(), 'rwe-it039-'));
    // The secret store is read at composeConfig() time (loadSecretSourceFromEnv) — set BEFORE it.
    process.env['RWE_SECRET_DEMO_TOKEN'] = 'super-secret-token-value';
    queryImpl = vi.fn(() => fakeSuccessSession());
    const config = await composeConfig(
      { bind: '127.0.0.1', port: 0, workRoot, aliases: ALIASES, gateway: 'sdk', assetRoot: join(workRoot, 'assets') },
      { queryImpl: queryImpl as unknown as never, proxyManager: makeFakeProxyManager() },
    );
    server = await createServer({ ...config, mcpProbe: new FakeMcpProbe(true) });
    baseUrl = `http://127.0.0.1:${server.port}`;
  });

  afterAll(async () => {
    await server?.close();
    delete process.env['RWE_SECRET_DEMO_TOKEN'];
    rmSync(workRoot, { recursive: true, force: true });
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function mcpCall(name: string, args: Record<string, unknown> = {}): Promise<any> {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: Math.random(), method: 'tools/call', params: { name, arguments: args } }),
    });
    const body = (await res.json()) as { result?: { content: Array<{ text: string }> } };
    return JSON.parse(body.result!.content[0]!.text);
  }

  it('a name provisioned via mcp_provision (config carrying ${secret:...}) lands in the next agent()\'s options.mcpServers with the secret substituted', async () => {
    // Provision an HTTP MCP whose config references a server-side secret by handle (never a literal).
    const prov = await mcpCall('mcp_provision', {
      name: 'demo-search',
      kind: 'http',
      config: { type: 'http', url: 'https://example.com/mcp', headers: { Authorization: 'Bearer ${secret:DEMO_TOKEN}' } },
    });
    expect(prov.error).toBeUndefined();

    // A workflow whose agent explicitly references that MCP by name.
    const run = await mcpCall('workflow_run', {
      script: "return agent('use the provisioned search tool', { mcp: ['demo-search'], model: 'local' });",
    });
    const runId = run.runId as string;
    let done = false;
    for (let i = 0; i < 50 && !done; i++) {
      const status = await mcpCall('workflow_status', { runId });
      done = status.status === 'completed' || status.status === 'failed';
      if (!done) await new Promise((r) => setTimeout(r, 100));
    }
    expect(done).toBe(true);
    expect(queryImpl).toHaveBeenCalled();

    const [[call]] = queryImpl.mock.calls as unknown as [[CapturedCall]];
    // strictMcpConfig isolation invariant still holds.
    expect(call.options?.strictMcpConfig).toBe(true);
    // The provisioned server is injected by name...
    const injected = call.options?.mcpServers?.['demo-search'] as { url?: string; headers?: Record<string, string> } | undefined;
    expect(injected).toBeDefined();
    expect(injected?.url).toBe('https://example.com/mcp');
    // ...with the ${secret:DEMO_TOKEN} handle resolved to the real value from RWE_SECRET_DEMO_TOKEN,
    // and never the literal handle smuggled through.
    expect(injected?.headers?.Authorization).toBe('Bearer super-secret-token-value');
    expect(JSON.stringify(injected)).not.toContain('${secret:');
  }, 20000);
});
