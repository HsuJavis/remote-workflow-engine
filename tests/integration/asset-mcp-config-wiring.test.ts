// IT-035: superseded scope (test-defect fix, 2026-07-10) — this test originally pinned the v2
// D-V2V-1 contract (an accepted mcp-config asset_push is threaded into the NEXT agent() call's
// real Options.mcpServers via `readMcpConfigAssets()`). DES-028/REQ-009's v3 rescope (04-design.md
// DES-019's own "Gate 6 route-back" note + DES-028) REDIRECTS mcp-config pushes to the Provisioning
// Registry instead (`mcp_provision`/`McpRegistry`, IT-038/VAL-020) — asset_push no longer
// materializes or threads mcp-config assets at all, so the original scenario ("push mcp-config,
// confirm it lands in the next agent() call's options.mcpServers") is now structurally impossible
// by design. This test is rewritten to pin the v3 replacement contract instead: an mcp-config
// asset_push is redirected (never stored, never threaded via the old per-asset mechanism), and a
// run still completes normally. It deliberately does NOT assert that a name provisioned via
// `mcp_provision` reaches a real agent() call's `options.mcpServers` — that GatewayClient-side
// threading (`src/session-options-builder.ts`/TASK-032's `buildSessionOptions`) has no production
// caller yet (confirmed: no non-test caller of `buildSessionOptions` in `src/`), so asserting it
// here would require new production wiring, not a test-only fix. See needs_clarification.
//
// Mock policy (DES-015, integration tier): real `composeConfig()` + real `createServer()` + real
// HTTP `asset_push`/`workflow_run`/`workflow_status` round trip (no mock of the SUT's own asset
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
import type { AliasMap } from '../../src/gateway/client.js';
import { runScriptVia } from '../helpers/workflow-fixtures.js';

const ALIASES: AliasMap = {
  default: { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
  local: { provider: 'ollama', model: 'qwen2.5:7b' },
};

/** Same fake-proxy pattern as main-composition-root.test.ts (IT-021) — proxy.start() resolves
 *  instantly, no real `litellm` subprocess spawned. */
function makeFakeProxyManager(): LiteLLMProxyManager {
  const fakeSpawn = vi.fn(() => (Object.assign(new EventEmitter(), { exitCode: null, kill: vi.fn() })) as unknown as ChildProcess);
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

describe('mcp-config asset_push redirect supersedes the old per-call options.mcpServers threading (IT-035, DES-028, REQ-009 v3 rescope)', () => {
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

  it('an mcp-config asset_push is redirected to provisioning (never stored, never threaded via the old per-asset mechanism); a run still completes normally', async () => {
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
    // v3 rescope (DES-028/REQ-009): mcp-config is redirected, never materialized/stored here.
    expect(push.result?.stored ?? []).toEqual([]);
    expect(push.result?.redirected).toBe(true);

    const run = await runScriptVia(mcpCall, "return agent('use the pushed mcp tool', {model:'local'});");
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
    // D-V2V-1's strictMcpConfig:true convention still holds regardless of the rescope.
    expect(call.options?.strictMcpConfig).toBe(true);
    // The redirected asset must NOT reach options.mcpServers via the old (now-retired for
    // mcp-config) per-asset `readMcpConfigAssets()` mechanism — it was never written to disk.
    expect(call.options?.mcpServers?.['demo-mcp']).toBeUndefined();
  }, 20000);
});
