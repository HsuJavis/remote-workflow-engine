// issue #126 B: dispatch-time ${run:dir}/${run:id} resolution in the gateway's _resolveMcpConfigs
// (claude-agent-sdk-client.ts) — per-run, per-server isolation. Mock policy (unit): the injected
// `queryImpl` seam stands in for the SDK (same convention as mcp-first-turn-harness.test.ts);
// real fs under a tmp root so the created state directory is genuinely observable.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaudeAgentSdkGatewayClient } from '../../src/gateway/claude-agent-sdk-client.js';

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'rwe-run-state-dispatch-')); });
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** A run's workspace, laid out exactly as workflow-catalog.ts's runWorkspace() does:
 *  `<workRoot>/workflows/<name>/runs/<runId>`. */
function workspaceFor(name: string, runId: string): string {
  const ws = join(root, 'workflows', name, 'runs', runId);
  mkdirSync(ws, { recursive: true });
  return ws;
}

async function dispatch(opts: { workspace: string; runId: string; agentId: string; config: Record<string, unknown> }) {
  async function* session() {
    yield { type: 'result', subtype: 'success', is_error: false, result: 'ok', usage: { input_tokens: 1, output_tokens: 1 } };
  }
  const queryImpl = vi.fn(() => session());
  const client = new ClaudeAgentSdkGatewayClient({
    baseUrl: 'http://127.0.0.1:1',
    queryImpl: queryImpl as never,
    resolveMcp: async () => ({ configs: { kv: opts.config as never }, missing: [] }),
  });
  const result = await client.invoke({
    prompt: 'hi',
    opts: { allowedTools: [] },
    runId: opts.runId,
    agentId: opts.agentId,
    workspace: opts.workspace,
    assets: { roots: { workflow: join(root, 'assets-wf'), global: join(root, 'assets-gl') }, declared: { skills: [], mcp: ['kv'] }, workflow: 'wf' },
  });
  expect(result.ok).toBe(true);
  const options = (queryImpl.mock.calls[0] as unknown as [{ options: { mcpServers?: Record<string, Record<string, unknown>> } }])[0].options;
  return options.mcpServers?.['kv'] as Record<string, unknown>;
}

describe('_resolveMcpConfigs — ${run:dir}/${run:id} resolution (issue #126 B)', () => {
  it('resolves ${run:dir} to a real directory it creates (0700) and ${run:id} to the runId', async () => {
    const ws = workspaceFor('wf', 'run-1');
    const srv = await dispatch({
      workspace: ws, runId: 'run-1', agentId: 'a1',
      config: { type: 'stdio', command: 'npx', args: ['-y', 'x'], env: { MEMORY_FILE_PATH: '${run:dir}/memory.jsonl', RUN: '${run:id}' } },
    });
    const env = srv['env'] as Record<string, string>;
    expect(env['RUN']).toBe('run-1');
    const expectedDir = join(root, 'workflows', 'wf', 'mcp-state', 'run-1', 'kv');
    expect(env['MEMORY_FILE_PATH']).toBe(join(expectedDir, 'memory.jsonl'));
    expect(existsSync(expectedDir)).toBe(true);
    expect(statSync(expectedDir).mode & 0o777).toBe(0o700);
  });

  it('is NOT inside the run workspace (not reachable via workspace_pull)', async () => {
    const ws = workspaceFor('wf', 'run-2');
    const srv = await dispatch({
      workspace: ws, runId: 'run-2', agentId: 'a1',
      config: { type: 'stdio', command: 'npx', args: ['-y', 'x'], env: { MEMORY_FILE_PATH: '${run:dir}/memory.jsonl' } },
    });
    const env = srv['env'] as Record<string, string>;
    expect(env['MEMORY_FILE_PATH']).not.toContain(ws);
  });

  it('two DIFFERENT runs of the SAME server get two DIFFERENT state dirs', async () => {
    const cfg = { type: 'stdio', command: 'npx', args: ['-y', 'x'], env: { MEMORY_FILE_PATH: '${run:dir}/memory.jsonl' } };
    const srvA = await dispatch({ workspace: workspaceFor('wf', 'run-a'), runId: 'run-a', agentId: 'a1', config: cfg });
    const srvB = await dispatch({ workspace: workspaceFor('wf', 'run-b'), runId: 'run-b', agentId: 'a1', config: cfg });
    expect((srvA['env'] as Record<string, string>)['MEMORY_FILE_PATH']).not.toBe((srvB['env'] as Record<string, string>)['MEMORY_FILE_PATH']);
  });

  it('a SECOND agent in the SAME run reuses the SAME state dir (persists across agents within a run)', async () => {
    const ws = workspaceFor('wf', 'run-c');
    const cfg = { type: 'stdio', command: 'npx', args: ['-y', 'x'], env: { MEMORY_FILE_PATH: '${run:dir}/memory.jsonl' } };
    const srv1 = await dispatch({ workspace: ws, runId: 'run-c', agentId: 'a1', config: cfg });
    const srv2 = await dispatch({ workspace: ws, runId: 'run-c', agentId: 'a2', config: cfg });
    expect((srv1['env'] as Record<string, string>)['MEMORY_FILE_PATH']).toBe((srv2['env'] as Record<string, string>)['MEMORY_FILE_PATH']);
  });

  it('a config with no ${run:dir} reference never creates a state directory at all', async () => {
    const ws = workspaceFor('wf', 'run-d');
    await dispatch({ workspace: ws, runId: 'run-d', agentId: 'a1', config: { type: 'stdio', command: 'npx', args: ['-y', 'x'] } });
    expect(existsSync(join(root, 'workflows', 'wf', 'mcp-state'))).toBe(false);
  });
});
