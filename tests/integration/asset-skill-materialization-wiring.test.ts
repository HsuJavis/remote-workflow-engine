// IT-036 / IT-116 (REQ-113, DES-154/ARCH-103, v24 REWRITE [T3] + the C-2 wiring pin).
//
// What this file is for, in one sentence: it is the ONLY test that proves REQ-113 — "each agent
// declares the skills IT needs, rather than the whole workflow sharing one set" — happens on a REAL
// dispatch, driven from a registered script through `run_start`, not from a hand-built `AgentReq`.
//
// Why it had to be rewritten twice over. The pre-v24 version asserted "every stored skill is copied
// into every run workspace", which DES-154 makes the DEFECT. The Gate 5 rewrite then flipped that
// assertion but still only proved the NEGATIVE (an agent declaring nothing gets nothing) — which a
// completely unwired materializer also satisfies, and that is exactly what shipped: adjudication
// (v24) #4 C-2 found `run-manager.ts` never populated `AgentReq.assets` at all, so DES-154's
// selective materialization had never fired outside `materialize-assets.test.ts`, which supplies
// `assets` itself. A negative-only test cannot tell "selective" from "off". So the load-bearing
// case here is the POSITIVE one: two skills are pushed, one label declares one of them, and after a
// real run exactly the declared one is present in that run's workspace.
//
// Mock policy (DES-015, integration tier): real `composeConfig()` + real `createServer()` + real
// MCP HTTP `workflow_register`/`workflow_publish`/`workspace_push`/`run_start`/`run_status`/
// `run_agent_log` round trips + real on-disk workspace inspection; only the third-party SDK
// `query()` export and the managed LiteLLM proxy subprocess are faked — no real network/process I/O.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { EventEmitter } from 'node:events'; // a real ChildProcess IS an EventEmitter — the fake must be too (v23 adjudication #6 V-2)
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { composeConfig } from '../../src/main.js';
import { LiteLLMProxyManager } from '../../src/gateway/litellm-proxy.js';

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
  options?: { settingSources?: string[]; cwd?: string };
}

const WF_NAME = 'it036-skill-asset';

/** One v24 agent contract block (DES-144: model/effort/timeoutMs all required with a default),
 *  optionally declaring the assets THAT label needs (REQ-113). */
function agentBlock(declared?: { skills?: string[]; mcp?: string[] }): string {
  const extra = [
    declared?.skills ? `skills: ${JSON.stringify(declared.skills)}` : '',
    declared?.mcp ? `mcp: ${JSON.stringify(declared.mcp)}` : '',
  ].filter(Boolean).join(', ');
  return `{ model: { type: 'string', default: 'ollama/qwen2.5:7b' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 }${extra ? ', ' + extra : ''} }`;
}

describe('REQ-113 selective skill materialization on a REAL dispatch (IT-036/IT-116, DES-154)', () => {
  let server: Server;
  let workRoot: string;
  let baseUrl: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let queryImpl: any;

  beforeAll(async () => {
    workRoot = mkdtempSync(join(tmpdir(), 'rwe-it036-'));
    queryImpl = vi.fn(() => fakeSuccessSession());
    const config = await composeConfig(
      { bind: '127.0.0.1', port: 0, workRoot, gateway: 'sdk', assetRoot: join(workRoot, 'assets') },
      { queryImpl: queryImpl as unknown as never, proxyManager: makeFakeProxyManager() },
    );
    server = await createServer(config);
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

  async function pushSkill(name: string, body: string): Promise<void> {
    const push = await mcpCall('workspace_push', {
      workflow: WF_NAME, kind: 'skill', name,
      files: [{ path: 'SKILL.md', contentB64: Buffer.from(body).toString('base64') }],
    });
    expect(push.error, `workspace_push(${name}) failed: ${JSON.stringify(push.error)}`).toBeUndefined();
  }

  async function registerRunAndWait(script: string, mermaid: string): Promise<string> {
    const registered = await mcpCall('workflow_register', { name: WF_NAME, script, mermaid });
    expect(registered.error, `workflow_register failed: ${JSON.stringify(registered.error)}`).toBeUndefined();
    const version = registered.result.version as string;
    const published = await mcpCall('workflow_publish', { name: WF_NAME, version, channel: 'release' });
    expect(published.error, `workflow_publish failed: ${JSON.stringify(published.error)}`).toBeUndefined();
    const run = await mcpCall('run_start', { name: WF_NAME });
    expect(run.error, `run_start failed: ${JSON.stringify(run.error)}`).toBeUndefined();
    const runId = run.runId as string;
    for (let i = 0; i < 100; i++) {
      const status = await mcpCall('run_status', { runId });
      if (status.status === 'completed' || status.status === 'failed') return runId;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('run never reached a terminal state');
  }

  // Per WorkflowCatalog's own documented on-disk convention (`workFolder(name)/runs/<runId>`).
  function expectedWorkspace(runId: string): string {
    return join(workRoot, 'workflows', WF_NAME, 'runs', runId);
  }

  it('the ONE declared skill is materialized and the sibling stored skill is NOT — the positive half C-2 found missing', async () => {
    const declaredMd = '# Declared Skill\n\nThe one this label asked for.\n';
    await pushSkill('declared-skill', declaredMd);
    await pushSkill('undeclared-skill', '# Undeclared Skill\n');

    const script =
      `export const meta = { params: { agents: { picky: ${agentBlock({ skills: ['declared-skill'] })} } } };\n` +
      // v26 (REQ-128): rule L2 — every agent() is dispatched inside a phase(); the lane name
      // matches the diagram's subgraph title.
      `phase('Work');\n` +
      `return await agent('picky', { prompt: 'use the declared skill' });`;
    const runId = await registerRunAndWait(script, 'graph LR\nsubgraph "Work"\npicky(["picky"])\nend');
    const workspace = expectedWorkspace(runId);

    // THE pin: without `run-manager.ts` populating `AgentReq.assets`, `req.assets` is undefined,
    // the gateway takes its "materialize nothing" branch and this path does not exist.
    const materializedPath = join(workspace, '.claude', 'skills', 'declared-skill', 'SKILL.md');
    expect(existsSync(materializedPath), 'the declared skill was not materialized — AgentReq.assets is not wired').toBe(true);
    expect(readFileSync(materializedPath, 'utf-8')).toBe(declaredMd);
    // Selective, not copy-all: the sibling asset in the SAME tree was never asked for.
    expect(existsSync(join(workspace, '.claude', 'skills', 'undeclared-skill'))).toBe(false);

    // D-V2V-1: the SDK call must actually be able to LOAD what was materialized.
    expect(queryImpl).toHaveBeenCalled();
    const calls = queryImpl.mock.calls as unknown as Array<[CapturedCall]>;
    const call = calls[calls.length - 1]![0];
    expect(call.options?.cwd).toBe(workspace);
    expect(call.options?.settingSources).toEqual(['project']);
    // Host-level sources must never leak back in (D-F11 isolation preserved).
    expect(call.options?.settingSources ?? []).not.toContain('user');
    expect(call.options?.settingSources ?? []).not.toContain('local');
  }, 30000);

  it('a label declaring an ABSENT skill still runs, and run_agent_log reports it in materialized.missing (DES-154 boundary + DES-160)', async () => {
    const script =
      `export const meta = { params: { agents: { hopeful: ${agentBlock({ skills: ['never-pushed'] })} } } };\n` +
      `phase('Work');\n` +
      `return await agent('hopeful', { prompt: 'ask for a skill nobody pushed' });`;
    const runId = await registerRunAndWait(script, 'graph LR\nsubgraph "Work"\nhopeful(["hopeful"])\nend');

    const status = await mcpCall('run_status', { runId });
    expect(status.result.status, 'a missing skill must NOT fail the run (owner 19.5.3)').toBe('completed');
    const log = await mcpCall('run_agent_log', { runId, label: 'hopeful' });
    expect(log.error, `run_agent_log refused: ${JSON.stringify(log.error)}`).toBeUndefined();
    expect(log.harness?.materialized?.missing).toContain('never-pushed');
    expect(log.harness?.materialized?.skills ?? []).not.toContain('never-pushed');
  }, 30000);

  it('a label declaring NO assets materializes neither of two stored skills (selective, not copy-all)', async () => {
    const script =
      `export const meta = { params: { agents: { plain: ${agentBlock()} } } };\n` +
      `phase('Work');\n` +
      `return await agent('plain', { prompt: 'noop' });`;
    const runId = await registerRunAndWait(script, 'graph LR\nsubgraph "Work"\nplain(["plain"])\nend');
    const workspace = expectedWorkspace(runId);
    expect(existsSync(join(workspace, '.claude', 'skills', 'declared-skill'))).toBe(false);
    expect(existsSync(join(workspace, '.claude', 'skills', 'undeclared-skill'))).toBe(false);
  }, 30000);

  it("this system's own rwe-* skill stays excluded end-to-end: never stored (regression guard, D4/A-5)", async () => {
    const push = await mcpCall('workspace_push', {
      workflow: WF_NAME, kind: 'skill', name: 'rwe-guard-test',
      files: [{ path: 'SKILL.md', contentB64: Buffer.from('# Self-referential').toString('base64') }],
    });
    // A-5 (adjudication (v24) #2): the reserved prefix is refused, not silently excluded from a
    // success envelope — the point is that engine-owned names can never be impersonated.
    expect(push.error?.code ?? push.code, 'a reserved rwe-* asset name must be refused').toBe('RESERVED_PREFIX');
    expect(existsSync(join(workRoot, 'assets', WF_NAME, 'skill', 'rwe-guard-test'))).toBe(false);
  }, 20000);
});
