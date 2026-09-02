// IT-090 (v22 adjudication #4, N-1; REQ-099): a GRANDFATHERED workflow naming an MCP that is no
// longer provisioned must still run (REQ-099 forbids a retroactive refusal) — and the dropped
// capability must be OBSERVABLE on the run's own record, not silently swallowed.
//
// The dispatch path (`ClaudeAgentSdkGatewayClient.resolveProvisionedMcp`) returns `{}` when
// `resolveInjected` reports MCP_NOT_PROVISIONED. Since v22 moved that check to registration only
// (`script-checks.ts` via `WorkflowCatalog.register`, ADR-013), nothing else re-checks it at run
// time: the agent is dispatched with the capability missing and no surface says so. The fix records
// the unresolved names on the harness descriptor — the same place `effortApplied`'s `{reason}`
// branch already records an honest no-op — so `workflow_agent_log(runId, agentId).harness` names it.
//
// ORACLE NOTE (binding, adjudication #4): this file asserts the SURFACING, never the drop. An
// oracle that only checked `mcpServers` came back empty would keep passing if the surfacing were
// deleted again, which is exactly the failure mode this case exists to prevent.
//
// Fixture note: the workflow this needs CANNOT be registered — registration now refuses it
// MCP_NOT_PROVISIONED — so the catalog row is hand-seeded in the v22 two-table shape, the
// grandfathered-row technique `val-109-registration-checks.test.ts` and `val-100` already use.
//
// Mock policy (integration tier, same as IT-039): real `composeConfig()` + real `createServer()` +
// real HTTP + real `McpRegistry` persistence + real sandbox/run lifecycle; only the third-party SDK
// `query()` export (the `queryImpl` seam) and the managed LiteLLM proxy subprocess are faked.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { EventEmitter } from 'node:events'; // a real ChildProcess IS an EventEmitter — the fake must be too (v23 adjudication #6 V-2)
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import Database from 'better-sqlite3';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { composeConfig } from '../../src/main.js';
import { LiteLLMProxyManager } from '../../src/gateway/litellm-proxy.js';
import { FakeMcpProbe } from '../../src/mcp-probe.js';
import type { AliasMap } from '../../src/gateway/client.js';
import { runScriptVia } from '../helpers/workflow-fixtures.js';

// `local` (ollama) is deliberate, not cosmetic: an `anthropic` alias with no ANTHROPIC_API_KEY fails
// ANTHROPIC_AUTH_MISSING inside `_invokeOnce` BEFORE `onHarness` fires, so no harness would ever be
// recorded and the assertions below would have nothing to read.
const ALIASES: AliasMap = {
  default: { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
  local: { provider: 'ollama', model: 'qwen2.5:7b' },
};

const MISSING_MCP = 'it090-never-provisioned';
const LIVE_MCP = 'it090-provisioned-search';

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

interface HarnessView {
  mcpServers?: string[];
  mcpUnresolved?: string[];
}

describe('a grandfathered workflow naming an unprovisioned MCP still runs, and the run RECORDS the dropped capability (IT-090, REQ-099, adjudication #4 N-1)', () => {
  let server: Server;
  let workRoot: string;
  let baseUrl: string;

  beforeAll(async () => {
    workRoot = mkdtempSync(join(tmpdir(), 'rwe-it090-'));
    const config = await composeConfig(
      { bind: '127.0.0.1', port: 0, workRoot, aliases: ALIASES, gateway: 'sdk', assetRoot: join(workRoot, 'assets') },
      { queryImpl: vi.fn(() => fakeSuccessSession()) as unknown as never, proxyManager: makeFakeProxyManager() },
    );
    server = await createServer({ ...config, mcpProbe: new FakeMcpProbe(true) });
    baseUrl = `http://127.0.0.1:${server.port}`;
  });

  afterAll(async () => {
    await server?.close();
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

  async function pollTerminal(runId: string): Promise<string> {
    for (let i = 0; i < 100; i++) {
      const status = await mcpCall('workflow_status', { runId });
      if (status.status === 'completed' || status.status === 'failed' || status.status === 'stopped') return status.status as string;
      await new Promise((r) => setTimeout(r, 100));
    }
    return 'timeout';
  }

  async function harnessOfFirstAgent(runId: string): Promise<HarnessView> {
    // `workflow_status` carries the run record under `result` (the ResultEnvelope shape); the agent
    // roster lives there, not at the top level.
    const status = await mcpCall('workflow_status', { runId });
    const agentId = status.result?.agents?.[0]?.agentId as string | undefined;
    expect(agentId).toBeDefined();
    const log = await mcpCall('workflow_agent_log', { runId, agentId });
    expect(log.harness).toBeTruthy();
    return log.harness as HarnessView;
  }

  it('the run is NOT retroactively refused, and its harness record NAMES the MCP that could not be resolved', async () => {
    // Hand-seeded because `workflow_register` now refuses this script MCP_NOT_PROVISIONED — this is
    // the pre-v22 row that got in before the check existed (val-109's grandfathered technique).
    const db = new Database(join(workRoot, 'catalog.db'));
    const now = new Date().toISOString();
    db.prepare('INSERT INTO workflows (name, createdAt, owner, release_version) VALUES (?, ?, NULL, ?)').run('it090-stale-mcp', now, 'v1');
    db.prepare('INSERT INTO workflow_versions (name, version, script, createdAt) VALUES (?, ?, ?, ?)')
      .run('it090-stale-mcp', 'v1', `return agent('use the search tool', { mcp: ['${MISSING_MCP}'], model: 'local' });`, now);
    db.close();

    const run = await mcpCall('workflow_run', { name: 'it090-stale-mcp' });
    expect(run.error).toBeUndefined(); // REQ-099: not retroactively refused
    const runId = run.runId as string;
    expect(await pollTerminal(runId)).toBe('completed');

    const harness = await harnessOfFirstAgent(runId);
    // THE oracle: the run's own record names the capability the dispatch dropped.
    expect(harness.mcpUnresolved).toContain(MISSING_MCP);
    // Secondary (never sufficient on its own): the capability really was absent from the session.
    expect(harness.mcpServers ?? []).not.toContain(MISSING_MCP);
  }, 30000);

  it('a resolvable MCP reference records NO unresolved field at all (the field is conditional, never an empty array)', async () => {
    const prov = await mcpCall('mcp_provision', { name: LIVE_MCP, kind: 'http', config: { type: 'http', url: 'https://example.com/mcp' } });
    expect(prov.error).toBeUndefined();

    const run = await runScriptVia(mcpCall, `return agent('use the search tool', { mcp: ['${LIVE_MCP}'], model: 'local' });`);
    const runId = run.runId as string;
    expect(await pollTerminal(runId)).toBe('completed');

    const harness = await harnessOfFirstAgent(runId);
    expect(harness.mcpServers).toContain(LIVE_MCP);
    expect('mcpUnresolved' in harness).toBe(false);
  }, 30000);
});
