// Bug fix: a nested `workflow('C', …)` child agent's declared assets (skills/mcp) and asset-root
// `workflow` name were built in `_handleAgentRequest` from the PARENT run's `entry.declaredAssets`/
// `entry.name` — the top-level run's own admission snapshot — even when the dispatching call came
// from a nested frame. A same-named label on the PARENT ('w' declaring skill 'a') therefore leaked
// into the CHILD's own same-named label ('w' declaring skill 'b' + an mcp server only the child
// provisions): the child agent got the parent's skill, never its own, and an mcp server only the
// child provisions never reached it (`_resolveMcpConfigs` is keyed by `assets.workflow`, which was
// the PARENT's name). When the parent has NO label of that name at all, the nested call got no
// assets whatsoever instead of the child's own.
//
// Fix: `_handleWorkflowRequest` (the nested frame's own admission point — it already resolves the
// CHILD's own `ParamContract` to admit it, issue #103a) now also derives THIS frame's own
// declared-asset map + workflow name from that same child contract, and threads it down to
// `_handleAgentRequest` the same way `childParams` already travels (`frameParams`) — never the
// parent's `entry.declaredAssets`/`entry.name`. A top-level call passes no frame scope and keeps
// reading the run's own registration, unchanged.
//
// Mock policy (DES-015, integration tier; same recipe as asset-skill-materialization-wiring.test.ts
// IT-036/IT-116 and asset-mcp-config-wiring.test.ts IT-035): real `composeConfig()` + real
// `createServer()` + real MCP HTTP `workflow_register`/`workflow_publish`/`workspace_push`/
// `run_start`/`run_status`/`run_agent_log` round trips + a `FakeMcpProbe(true)` (no real network
// egress) + real on-disk asset storage; only the third-party SDK `query()` export and the managed
// LiteLLM proxy subprocess are faked.
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
import { registerPublishedVia } from '../helpers/workflow-fixtures.js';
import { RWE_SKILLS_PLUGIN_NAME } from '../../src/gateway/claude-agent-sdk-client.js';

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
  options?: { skills?: string[]; mcpServers?: Record<string, { url?: string }>; cwd?: string };
}

const WF_CHILD = 'nst-scope-child';
const WF_PARENT = 'nst-scope-parent';
const WF_PARENT_NO_LABEL = 'nst-scope-parent-no-label';

const agentBlock = (declared: { skills?: string[]; mcp?: string[] }) => {
  const extra = [
    declared.skills ? `skills: ${JSON.stringify(declared.skills)}` : '',
    declared.mcp ? `mcp: ${JSON.stringify(declared.mcp)}` : '',
  ].filter(Boolean).join(', ');
  return `{ model: { type: 'string', default: 'ollama/qwen2.5:7b' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 }${extra ? ', ' + extra : ''} }`;
};

describe('a nested workflow() child agent gets ITS OWN declared skills/mcp, never the parent label of the same name', () => {
  let server: Server;
  let workRoot: string;
  let baseUrl: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let queryImpl: any;

  beforeAll(async () => {
    workRoot = mkdtempSync(join(tmpdir(), 'rwe-nested-scope-'));
    queryImpl = vi.fn(() => fakeSuccessSession());
    const config = await composeConfig(
      {
        bind: '127.0.0.1', port: 0, workRoot, gateway: 'sdk', assetRoot: join(workRoot, 'assets'),
        mcpEgressAllowlist: ['https://example.com/'],
      },
      { queryImpl: queryImpl as unknown as never, proxyManager: makeFakeProxyManager() },
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

  async function preRegisterPlaceholder(name: string): Promise<void> {
    const reg = await mcpCall('workflow_register', { name, script: 'export const meta = { phases: [] };\nreturn "placeholder";', mermaid: 'graph LR' });
    expect(reg.error, `pre-register(${name}) failed: ${JSON.stringify(reg.error)}`).toBeUndefined();
  }

  async function pushSkill(workflow: string, name: string, body: string): Promise<void> {
    const push = await mcpCall('workspace_push', {
      workflow, kind: 'skill', name,
      files: [{ path: 'SKILL.md', contentB64: Buffer.from(body).toString('base64') }],
    });
    expect(push.error, `pushSkill(${workflow}/${name}) failed: ${JSON.stringify(push.error)}`).toBeUndefined();
  }

  async function pushMcp(workflow: string, name: string): Promise<void> {
    const push = await mcpCall('workspace_push', {
      workflow, kind: 'mcp', name, config: { url: `https://example.com/${name}` },
    });
    expect(push.error, `pushMcp(${workflow}/${name}) failed: ${JSON.stringify(push.error)}`).toBeUndefined();
  }

  async function runAndWait(name: string): Promise<string> {
    const run = await mcpCall('run_start', { name });
    expect(run.error, `run_start(${name}) failed: ${JSON.stringify(run.error)}`).toBeUndefined();
    const runId = run.runId as string;
    for (let i = 0; i < 150; i++) {
      const status = await mcpCall('run_status', { runId });
      if (status.status === 'completed' || status.status === 'failed') return runId;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`run ${name} never reached a terminal state`);
  }

  // The child workflow is set up ONCE: declares label 'w' with its OWN skill ('b') and an mcp
  // server ('child-mcp') the parent never declares and never provisions.
  beforeAll(async () => {
    await preRegisterPlaceholder(WF_CHILD);
    await pushSkill(WF_CHILD, 'b', '# Child Skill b\n\nOnly the child declares this.\n');
    await pushMcp(WF_CHILD, 'child-mcp');
    const childScript =
      `export const meta = { phases: [{ title: 'Work' }], params: { agents: { w: ${agentBlock({ skills: ['b'], mcp: ['child-mcp'] })} } } };\n` +
      `phase('Work');\n` +
      `return await agent('w', { prompt: 'child-work' });`;
    await registerPublishedVia(mcpCall, WF_CHILD, childScript);
  }, 30000);

  it("the child's nested 'w' gets skill 'b' + 'child-mcp'; the parent's own top-level 'w' gets ONLY its own skill 'a' (REQ-113 nested close)", async () => {
    await preRegisterPlaceholder(WF_PARENT);
    await pushSkill(WF_PARENT, 'a', '# Parent Skill a\n\nOnly the parent declares this.\n');
    const parentScript =
      `export const meta = { phases: [{ title: 'Work' }], params: { agents: { w: ${agentBlock({ skills: ['a'] })} } } };\n` +
      `phase('Work');\n` +
      `const mine = await agent('w', { prompt: 'parent-work' });\n` +
      `const r = await workflow(${JSON.stringify(WF_CHILD)}, {});\n` +
      `return { mine, r };`;
    await registerPublishedVia(mcpCall, WF_PARENT, parentScript);

    const runId = await runAndWait(WF_PARENT);
    const status = await mcpCall('run_status', { runId });
    expect(status.status).toBe('completed');

    // dispatch order is deterministic (sequential awaits): parent's own call first, the nested
    // child's call second.
    expect(queryImpl).toHaveBeenCalledTimes(2);
    const calls = queryImpl.mock.calls as unknown as Array<[CapturedCall]>;
    const parentCall = calls[0]![0];
    const childCall = calls[1]![0];

    // pre-fix: both calls read `entry.declaredAssets['w']`/`entry.name` off the PARENT's own
    // admission snapshot, so childCall would be byte-identical to parentCall (skill 'a', no mcp).
    expect(parentCall.options?.skills).toEqual([`${RWE_SKILLS_PLUGIN_NAME}:a`]);
    expect(parentCall.options?.mcpServers ?? {}).toEqual({});
    expect(childCall.options?.skills).toEqual([`${RWE_SKILLS_PLUGIN_NAME}:b`]); // never 'a'
    expect(childCall.options?.mcpServers?.['child-mcp']).toBeDefined();

    // run_agent_log's own harness.materialized — the durable record `run_agent_log` exposes —
    // must independently agree with what was actually dispatched.
    const view = (await (await fetch(`${baseUrl}/api/runs/${runId}`)).json()) as { agents: Array<{ agentId: string; label?: string; frame: string }> };
    const topAgent = view.agents.find((a) => a.label === 'w' && a.frame === '');
    const nestedAgent = view.agents.find((a) => a.label === 'w' && a.frame !== '');
    expect(topAgent, 'top-level w agent record not found').toBeDefined();
    expect(nestedAgent, 'nested w agent record not found').toBeDefined();

    // `run_agent_log`'s advertised schema requires `label`; `agentId` (also accepted, and what the
    // facade actually keys the lookup by when present) disambiguates same-labelled top/nested rows.
    const topLog = await mcpCall('run_agent_log', { runId, label: 'w', agentId: topAgent!.agentId });
    expect(topLog.harness?.materialized?.skills).toEqual(['a']);
    expect(topLog.harness?.materialized?.mcp ?? []).toEqual([]);

    const nestedLog = await mcpCall('run_agent_log', { runId, label: 'w', agentId: nestedAgent!.agentId });
    expect(nestedLog.harness?.materialized?.skills).toEqual(['b']);
    expect(nestedLog.harness?.materialized?.mcp).toEqual(['child-mcp']);
  }, 30000);

  it("a parent with NO label of that name still lets the nested child materialize its OWN declared skill/mcp (pre-fix: child got nothing)", async () => {
    const parentScript = `return await workflow(${JSON.stringify(WF_CHILD)}, {});`;
    await registerPublishedVia(mcpCall, WF_PARENT_NO_LABEL, parentScript);

    const runId = await runAndWait(WF_PARENT_NO_LABEL);
    const status = await mcpCall('run_status', { runId });
    expect(status.status).toBe('completed');

    expect(queryImpl).toHaveBeenCalled();
    const calls = queryImpl.mock.calls as unknown as Array<[CapturedCall]>;
    const lastCall = calls[calls.length - 1]![0];
    // pre-fix: `entry.declaredAssets['w']` is undefined on a parent with no 'w' label at all, so
    // `assets` was never built and nothing materialized for the nested call either.
    expect(lastCall.options?.skills).toEqual([`${RWE_SKILLS_PLUGIN_NAME}:b`]);
    expect(lastCall.options?.mcpServers?.['child-mcp']).toBeDefined();
  }, 30000);
});
