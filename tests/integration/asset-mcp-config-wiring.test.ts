// IT-035: REQ-009 clauses 1/2 route-back — an accepted mcp-config asset must be threaded into the
// NEXT agent() call's real @anthropic-ai/claude-agent-sdk Options.mcpServers (D-V2V-1, binding
// ORCH ruling on 08-validation.md VAL-017's finding: `settingSources:[]`+`strictMcpConfig:true`
// with `mcpServers` never populated means a probe-accepted mcp-config asset sits on disk but is
// NEVER reachable by any agent() call). `strictMcpConfig:true` stays true (D-V2V-1 binding); only
// `mcpServers` must gain the accepted entry, threaded PER-CALL (so a push made after boot still
// reaches the very next run, not merely a startup-time snapshot).
//
// Mock policy (DES-015, integration tier): real `composeConfig()` + real `createServer()` + real
// HTTP `asset_push`/`workflow_run`/`workflow_status` round trip (no mock of the SUT's own asset
// storage, submission, sandbox, or run lifecycle); only the third-party SDK `query()` export
// (`queryImpl` seam, same convention as IT-021/IT-022) and the managed LiteLLM proxy subprocess
// (fake `spawnImpl`/`fetchImpl`, same convention) are faked — no real network/process I/O. The
// mcp-config's own live-probe (DES-020) is satisfied via the pre-existing `FakeMcpProbe` injectable
// seam (`ServerConfig.mcpProbe`), so this test needs no real network reachability check either.
//
// Red reason: `src/gateway/claude-agent-sdk-client.ts` never sets `options.mcpServers` anywhere in
// the constructed `Options` object (confirmed by reading the file); `composeConfig()`/
// `createServer()` never read `AssetSyncService`'s stored assets at all (confirmed: `grep -rn asset
// src/agent-executor.ts src/run-manager.ts src/gateway/*.ts` -> zero matches, per 08-validation.md
// VAL-017). The captured `queryImpl` call's `options.mcpServers` is therefore `undefined`, not the
// pushed config keyed by its asset name — not an import/syntax error.
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

/** Same fake-proxy pattern as main-composition-root.test.ts (IT-021) — proxy.start() resolves
 *  instantly, no real `litellm` subprocess spawned. */
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
  options?: { mcpServers?: Record<string, { url?: string; type?: string }>; strictMcpConfig?: boolean };
}

describe('mcp-config asset wiring into the SDK gateway per-call options.mcpServers (IT-035, D-V2V-1, REQ-009)', () => {
  let server: Server;
  let workRoot: string;
  let baseUrl: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let queryImpl: any;

  beforeAll(async () => {
    workRoot = mkdtempSync(join(tmpdir(), 'rwe-it035-'));
    queryImpl = vi.fn(() => fakeSuccessSession());
    const config = await composeConfig(
      { bind: '127.0.0.1', port: 0, workRoot, aliases: ALIASES, gateway: 'sdk', assetRoot: join(workRoot, 'assets') },
      { queryImpl: queryImpl as unknown as never, proxyManager: makeFakeProxyManager() },
    );
    // FakeMcpProbe: the mcp-config's own live-probe (DES-020) always accepts — this test is about
    // the wiring-into-agent()-calls gap, not the already-real-verified probe itself (VAL-009).
    server = await createServer({ ...config, mcpProbe: new FakeMcpProbe(true) });
    baseUrl = `http://127.0.0.1:${server.port}`;
  });

  afterAll(async () => {
    await server?.close();
    rmSync(workRoot, { recursive: true, force: true });
  });

  async function mcpCall(name: string, args: Record<string, unknown> = {}): Promise<any> {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: Math.random(), method: 'tools/call', params: { name, arguments: args } }),
    });
    const body = (await res.json()) as { result?: { content: Array<{ text: string }> } };
    return JSON.parse(body.result!.content[0]!.text);
  }

  it("an accepted mcp-config asset is threaded into the NEXT agent() call's options.mcpServers; strictMcpConfig stays true", async () => {
    const push = await mcpCall('asset_push', {
      kind: 'mcp-config',
      name: 'demo-mcp',
      files: [
        {
          path: 'config.json',
          contentB64: Buffer.from(JSON.stringify({ type: 'http', url: 'https://example.com/demo-mcp' })).toString('base64'),
        },
      ],
    });
    expect(push.error).toBeUndefined();
    expect(push.result?.stored).toContain('demo-mcp');

    const run = await mcpCall('workflow_run', { script: "return agent('use the pushed mcp tool', {model:'local'});" });
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
    // D-V2V-1 (binding): strictMcpConfig stays true regardless of this fix.
    expect(call.options?.strictMcpConfig).toBe(true);
    // Forcing red: today `options.mcpServers` is never set at all (undefined) — no code path
    // threads AssetSyncService's stored, probe-accepted mcp-config entries into any agent() call.
    expect(call.options?.mcpServers).toBeDefined();
    expect(Object.keys(call.options?.mcpServers ?? {})).toContain('demo-mcp');
    expect(call.options?.mcpServers?.['demo-mcp']?.url).toBe('https://example.com/demo-mcp');
  }, 20000);
});
