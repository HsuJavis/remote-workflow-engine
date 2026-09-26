// IT-035: v3 rescope (test-defect fix, 2026-07-10) pinned "an accepted mcp-config asset-push is
// REDIRECTED to the Provisioning Registry, never threaded via the old per-asset options.mcpServers
// mechanism" (DES-028/REQ-009 v3).
//
// v24 (TASK-152, DES-153/DES-154, ARCH-101/103): the v3 redirect mechanism (and the Provisioning
// Registry it redirected to) is ITSELF retired — an mcp config is now pushed DIRECTLY as
// `workspace_push({kind:'mcp', config})` (a real catalog row, DES-153) and, when an agent DECLARES
// it (`meta.params.agents.<label>.mcp`), the SDK gateway's `materializeAssets` (DES-154) resolves
// it and writes a real `.mcp.json` for that dispatch — the opposite of the old "never reaches
// options.mcpServers" invariant this file used to pin. Rewritten to the v24 contract: the pushed
// mcp asset DOES reach the real SDK-gateway call once declared, `strictMcpConfig:true` still holds
// (D-V2V-1, unchanged since v2), and an UNDECLARED push (no `mcp` key on the label) does NOT reach
// it (DES-154's `missing[]` case, `tests/unit/materialize-assets.test.ts` covers the fake-fs unit
// shape; this integration case is the real SDK-gateway-call shape TASK-152 restores here).
//
// Mock policy (DES-015, integration tier): real `composeConfig()` + real `createServer()` + real
// HTTP `workspace_push`/`run_start`/`run_status` round trip (no mock of the SUT's own asset
// storage, submission, sandbox, or run lifecycle); only the third-party SDK `query()` export
// (`queryImpl` seam, same convention as IT-021/IT-022) and the managed LiteLLM proxy subprocess
// (fake `spawnImpl`/`fetchImpl`, same convention) are faked — no real network/process I/O.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { EventEmitter } from 'node:events'; // a real ChildProcess IS an EventEmitter — the fake must be too (v23 adjudication #6 V-2)
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { composeConfig } from '../../src/main.js';
import { LiteLLMProxyManager } from '../../src/gateway/litellm-proxy.js';
import { FakeMcpProbe } from '../../src/mcp-probe.js';
import { runScriptVia } from '../helpers/workflow-fixtures.js';

/** Same fake-proxy pattern as main-composition-root.test.ts (IT-021) — proxy.start() resolves
 *  instantly, no real `litellm` subprocess spawned. */
function makeFakeProxyManager(): LiteLLMProxyManager {
  const fakeSpawn = vi.fn(() => (Object.assign(new EventEmitter(), { exitCode: null, kill: vi.fn() })) as unknown as ChildProcess);
  const fakeHealthFetch = vi.fn(async () => ({ ok: true }) as unknown as Response);
  return new LiteLLMProxyManager({
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

describe('a workspace_push mcp asset, once declared by an agent, reaches the real SDK-gateway call (IT-035, DES-153/DES-154, v24 rescope)', () => {
  let server: Server;
  let workRoot: string;
  let baseUrl: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let queryImpl: any;

  beforeAll(async () => {
    workRoot = mkdtempSync(join(tmpdir(), 'rwe-it035-'));
    queryImpl = vi.fn(() => fakeSuccessSession());
    const config = await composeConfig(
      {
        bind: '127.0.0.1', port: 0, workRoot, gateway: 'sdk', assetRoot: join(workRoot, 'assets'),
        // v24 (DES-153/ADR-030, TASK-152): workspace_push's kind:'mcp' http mode checks egress
        // BEFORE probing — this file's fake config points at example.com, so allow it.
        mcpEgressAllowlist: ['https://example.com/'],
      },
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

  it('workspace_push (kind:mcp) stores a real catalog row; a run whose agent DECLARES it reaches the real SDK-gateway call with strictMcpConfig:true', async () => {
    const push = await mcpCall('workspace_push', {
      scope: 'global',
      kind: 'mcp',
      name: 'demo-mcp',
      config: { url: 'https://example.com/demo-mcp' },
    });
    // v24 (DES-153): kind:'mcp' stores a real catalog row — the v3 "redirected, never stored" shape
    // is gone along with the provisioning tool it redirected to.
    expect(push.result?.stored).toBe('demo-mcp');

    const script = [
      "export const meta = { params: { agents: { go: {",
      "  model: { type: 'string', default: 'ollama/qwen2.5:7b' },",
      "  effort: { type: 'enum', default: 'low' },",
      "  timeoutMs: { type: 'number', default: 30000 },",
      "  mcp: ['demo-mcp'],",
      "} } } };",
      "return agent('go', {});",
    ].join('\n');
    const run = await runScriptVia(mcpCall, script);
    const runId = run.runId as string;

    let done = false;
    for (let i = 0; i < 50 && !done; i++) {
      const status = await mcpCall('run_status', { runId });
      done = status.status === 'completed' || status.status === 'failed';
      if (!done) await new Promise((r) => setTimeout(r, 100));
    }
    expect(done).toBe(true);
    expect(queryImpl).toHaveBeenCalled();

    const [[call]] = queryImpl.mock.calls as unknown as [[CapturedCall]];
    // D-V2V-1's strictMcpConfig:true convention still holds under the v24 rescope.
    expect(call.options?.strictMcpConfig).toBe(true);
    // v24 (DES-154): a DECLARED mcp asset now DOES reach options.mcpServers via materializeAssets —
    // the opposite of the retired v3 "never reaches it" invariant.
    expect(call.options?.mcpServers?.['demo-mcp']).toBeDefined();
  }, 20000);
});
