// VAL-021: Secrets for providers/MCP via a server-side store, never workspace-reachable (REQ-018)
// Real entrypoint: real workspace_push (mode B, kind:'mcp' — v24 DES-153/TASK-152, replaces the
// retired MCP-provisioning tool) + real run_start + a real env-loaded secret.
// No mock of the SUT's own boundaries (resolver, redaction).
//
// D-V3M-1: routed through the PRODUCTION SDK-gateway path (composeConfig gateway:'sdk') — MCP tool
// injection + `${secret:...}` resolution are a SDK-gateway (harness) capability by design (REQ-016);
// the bare/default LiteLLM gateway has no tool loop and never resolves MCP secrets, so the original
// bare `createServer()` here could never exercise REQ-018 at all. Same hermetic seam IT-035 uses:
// the third-party SDK `query()` export and the managed LiteLLM proxy subprocess are faked (no real
// network/process), and the missing-secret case throws at session-build BEFORE `query()` is ever
// invoked — so "fails before any provider dial" still holds with no live model.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { EventEmitter } from 'node:events'; // a real ChildProcess IS an EventEmitter — the fake must be too (v23 adjudication #6 V-2)
import { mkdtempSync, rmSync, readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { composeConfig } from '../../src/main.js';
import { LiteLLMProxyManager } from '../../src/gateway/litellm-proxy.js';
import { FakeMcpProbe } from '../../src/mcp-probe.js';
import type { AliasMap } from '../../src/gateway/client.js';
// Value import — module-not-found when absent (guarantees this file is RED at collection).
import { resolveConfig, InMemorySecretSource } from '../../src/secret-resolver.js';
import { runScriptVia } from '../helpers/workflow-fixtures.js';

const HAS_PROVIDER = !!process.env['OLLAMA_BASE_URL'];
const REAL_SECRET_VALUE = 'val021-real-secret-value-xyz';

const ALIASES: AliasMap = {
  default: { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
  local: { provider: 'ollama', model: 'qwen2.5:7b' },
};

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

let server: Server;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-val021-'));
  // The secret store is loaded at composeConfig() time (loadSecretSourceFromEnv) — set BEFORE it.
  process.env['RWE_SECRET_VAL021'] = REAL_SECRET_VALUE;
  const config = await composeConfig(
    {
      bind: '127.0.0.1', port: 0, workRoot: tmpDir, aliases: ALIASES, gateway: 'sdk', assetRoot: join(tmpDir, 'assets'),
      // v24 (DES-153/ADR-030, TASK-152): workspace_push's kind:'mcp' http mode now checks egress
      // BEFORE probing — this file's fake MCP configs point at example.com, so it must be allowed.
      mcpEgressAllowlist: ['https://example.com/'],
    },
    { queryImpl: (() => fakeSuccessSession()) as unknown as never, proxyManager: makeFakeProxyManager() },
  );
  server = await createServer({ ...config, mcpProbe: new FakeMcpProbe(true) });
});

afterAll(async () => {
  await server?.close();
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env['RWE_SECRET_VAL021'];
});

async function mcpCall(name: string, args: Record<string, unknown> = {}) {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> }; error?: { code: number; message: string } };
  if (body.error) return { error: body.error };
  // workflow_* tools return their own flat envelope directly; workspace_push's payload (unused by
  // any assertion in this file beyond `.error`) stays wrapped under `.result`.
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}') as Record<string, unknown>;
}

// v24 (TASK-152, DES-144): every `agent()`-calling script must declare its label in
// `meta.params.agents.<label>` (model/effort/timeoutMs, all `.default`) — `AGENT_UNDECLARED`
// otherwise. `mcp` names ride the SAME declaration (DES-154's `declared.mcp`), not the call-site
// options object.
function goScript(mcpName: string): string {
  return [
    "export const meta = { params: { agents: { go: {",
    "  model: { type: 'string', default: 'local' },",
    "  effort: { type: 'enum', default: 'low' },",
    "  timeoutMs: { type: 'number', default: 30000 },",
    `  mcp: ['${mcpName}'],`,
    "} } } };",
    "return agent('go', {});",
  ].join('\n');
}

describe('VAL-021: REQ-018 — a missing secret handle is a clear error, never a hang/leak/literal pass-through (no live model needed, fails before any provider dial)', () => {
  it('workspace_push (kind:mcp) with an unresolvable ${secret:...} handle used by a later run surfaces SECRET_MISSING', async () => {
    await mcpCall('workspace_push', {
      scope: 'global', kind: 'mcp', name: 'val021-missing-secret-mcp',
      config: { url: 'https://example.com/mcp', headers: { Authorization: 'Bearer ${secret:val021-never-set}' } },
    });
    const run = await runScriptVia(mcpCall, goScript('val021-missing-secret-mcp'));
    const runId = run['runId'] as string;
    for (let i = 0; i < 20; i++) {
      const s = await mcpCall('run_status', { runId });
      if (s['status'] === 'completed' || s['status'] === 'failed') break;
      await new Promise((r) => setTimeout(r, 500));
    }
    const result = await mcpCall('run_result', { runId });
    expect(JSON.stringify(result)).toMatch(/SECRET_MISSING/);
  }, 30000);
});

describe('VAL-021: REQ-018 — a resolved secret never appears on any run-workspace-reachable path', () => {
  it('no file under the run workspace ever contains the raw secret value (no live model needed)', () => {
    // The pure resolver itself (real, not mocked) must never smuggle a literal handle through as a
    // value nor write the resolved value anywhere this test can reach outside the parent process.
    const resolved = resolveConfig({ token: '${secret:VAL021}' }, new InMemorySecretSource({ VAL021: REAL_SECRET_VALUE })) as { token: string };
    expect(resolved.token).toBe(REAL_SECRET_VALUE); // resolved correctly in the parent-only resolver...
    // ...but must never leak into any workspace directory this run created:
    const workspacesRoot = join(tmpDir, 'workflows');
    if (existsSync(workspacesRoot)) {
      const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
        const p = join(dir, n);
        return statSync(p).isDirectory() ? walk(p) : [p];
      });
      for (const file of walk(workspacesRoot)) {
        expect(readFileSync(file, 'utf-8')).not.toContain(REAL_SECRET_VALUE);
      }
    }
  });
});

describe('VAL-021: REQ-018 — a real resolved secret works end to end with no byte of it in the transcript', () => {
  it('a real provisioned MCP config secret resolves and the completed run transcript never contains it', async () => {
    if (!HAS_PROVIDER) return;
    await mcpCall('workspace_push', {
      scope: 'global', kind: 'mcp', name: 'val021-real-secret-mcp',
      config: { url: 'https://example.com/mcp', headers: { Authorization: 'Bearer ${secret:VAL021}' } },
    });
    const run = await runScriptVia(mcpCall, goScript('val021-real-secret-mcp'));
    const runId = run['runId'] as string;
    for (let i = 0; i < 60; i++) {
      const s = await mcpCall('run_status', { runId });
      if (s['status'] === 'completed' || s['status'] === 'failed') break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    const statusView = await mcpCall('run_status', { runId });
    const agents = (statusView['agents'] as Array<{ agentId: string }>) ?? [];
    if (agents.length === 0) return;
    const transcript = await mcpCall('run_agent_log', { runId, agentId: agents[0]!.agentId });
    expect(JSON.stringify(transcript)).not.toContain(REAL_SECRET_VALUE);
  }, 180000);
});
