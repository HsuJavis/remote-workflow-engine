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
// real run exactly the declared one reached the model.
//
// Issue #144 rewrite: a declared skill no longer materializes into `<workspace>/.claude/skills/` —
// it goes into a PRIVATE per-dispatch directory outside the workspace, removed again before this
// file's own `run_status`-polling loop ever sees the run go terminal. Every assertion that used to
// `existsSync`/`readFileSync` a workspace path now does one of: (a) check `options.plugins`/
// `options.skills` on the captured `queryImpl` call (the wire shape, captured synchronously at call
// time, before any cleanup runs), (b) read `run_agent_log`'s own durable `harness.materialized`
// record (survives past the dispatch, unlike the private directory itself), or (c) for mode bits
// (issue #105 part A), `statSync` the path named in the captured `options.plugins[0].path` from
// INSIDE the `queryImpl` mock itself — synchronous, so it runs before `_invokeOnce`'s `finally`
// removes the directory.
//
// Mock policy (DES-015, integration tier): real `composeConfig()` + real `createServer()` + real
// MCP HTTP `workflow_register`/`workflow_publish`/`workspace_push`/`run_start`/`run_status`/
// `run_agent_log` round trips + real on-disk workspace inspection; only the third-party SDK
// `query()` export and the managed LiteLLM proxy subprocess are faked — no real network/process I/O.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { EventEmitter } from 'node:events'; // a real ChildProcess IS an EventEmitter — the fake must be too (v23 adjudication #6 V-2)
import { mkdtempSync, rmSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { composeConfig } from '../../src/main.js';
import { LiteLLMProxyManager } from '../../src/gateway/litellm-proxy.js';
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
  options?: { settingSources?: string[]; cwd?: string; plugins?: Array<{ type: string; path: string }>; skills?: string[] };
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
    // Issue #102 (asset squatting): workspace_push now requires WF_NAME to already be registered
    // (WORKFLOW_NOT_FOUND otherwise) — register a placeholder v1 first; `registerRunAndWait` below
    // registers the real (skill-declaring) script as v2.
    const preReg = await mcpCall('workflow_register', { name: WF_NAME, script: 'export const meta = { phases: [] };\nreturn "placeholder";', mermaid: 'graph LR' });
    expect(preReg.error, `pre-register failed: ${JSON.stringify(preReg.error)}`).toBeUndefined();

    const declaredMd = '# Declared Skill\n\nThe one this label asked for.\n';
    await pushSkill('declared-skill', declaredMd);
    await pushSkill('undeclared-skill', '# Undeclared Skill\n');

    const script =
      `export const meta = { phases: [{ title: 'Work' }], params: { agents: { picky: ${agentBlock({ skills: ['declared-skill'] })} } } };\n` +
      // v26 (REQ-128): rule L2 — every agent() is dispatched inside a phase(); the lane name
      // matches the diagram's subgraph title.
      `phase('Work');\n` +
      `return await agent('picky', { prompt: 'use the declared skill' });`;
    const runId = await registerRunAndWait(script, 'graph LR\nsubgraph "Work"\npicky(["picky"])\nend');
    const workspace = expectedWorkspace(runId);

    // THE pin: without `run-manager.ts` populating `AgentReq.assets`, `req.assets` is undefined,
    // the gateway takes its "materialize nothing" branch and `options.plugins` is never set at all —
    // `toBeDefined()` on it is the C-2 regression guard this file exists for.
    // D-V2V-1: the SDK call must actually be able to LOAD what was materialized.
    expect(queryImpl).toHaveBeenCalled();
    const calls = queryImpl.mock.calls as unknown as Array<[CapturedCall]>;
    const call = calls[calls.length - 1]![0];
    expect(call.options?.plugins, 'the declared skill was not materialized — AgentReq.assets is not wired').toBeDefined();
    expect(call.options?.plugins).toHaveLength(1);
    const pluginPath = call.options!.plugins![0]!.path;
    // Issue #144: the plugin directory is OUTSIDE the run workspace — never `<workspace>/.claude/
    // skills/...` any more. Selective, not copy-all: only ONE skill's worth of content is under it
    // (proven below via `run_agent_log`, since the directory itself is already gone by the time this
    // assertion runs).
    expect(pluginPath.startsWith(workspace)).toBe(false);
    expect(call.options?.skills).toEqual([`${RWE_SKILLS_PLUGIN_NAME}:declared-skill`]);
    expect(call.options?.cwd).toBe(workspace);
    expect(call.options?.settingSources).toEqual(['project']);
    // Host-level sources must never leak back in (D-F11 isolation preserved).
    expect(call.options?.settingSources ?? []).not.toContain('user');
    expect(call.options?.settingSources ?? []).not.toContain('local');

    // `run_agent_log`'s own durable `harness.materialized` record — the declared skill really
    // reached this agent, content and all is covered by `materialize-assets.test.ts`/the copyDir
    // call; this is the end-to-end proof that it travelled through a REAL dispatch — and nothing of
    // the sibling, undeclared asset in the SAME tree did (selective, not copy-all).
    const log = await mcpCall('run_agent_log', { runId, label: 'picky' });
    expect(log.harness?.materialized?.skills).toEqual(['declared-skill']);
    expect(log.harness?.skillsExposed).toEqual(['declared-skill']);
    // Never touches the workspace at all, at any point.
    expect(existsSync(join(workspace, '.claude', 'skills'))).toBe(false);
  }, 30000);

  // Issue #144's own reported repro, reproduced here at the wiring level (the real-CLI activation
  // half — a NON-declaring agent's Skill tool genuinely cannot reach another agent's materialized
  // skill — is verified separately against a real bundled CLI; see the executor's report). THREE
  // sequential agents in ONE run share the SAME workspace: `snoopBefore` and `snoopAfter` both
  // declare nothing; only the middle one, `writer`, declares the skill. Before this fix, EVERY one
  // of the three would have seen `<ws>/.claude/skills/leaky-skill/` on disk (materialized once by
  // `writer`'s own dispatch, then simply left there for the next agent sharing the workspace to
  // read with nothing but Read/Bash/Glob).
  it("issue #144 repro: a non-declaring agent before AND after the declaring one gets no plugin, no skill, and never sees .claude/skills in the shared workspace", async () => {
    const preReg = await mcpCall('workflow_register', { name: WF_NAME, script: 'export const meta = { phases: [] };\nreturn "placeholder-repro";', mermaid: 'graph LR' });
    expect(preReg.error, `pre-register failed: ${JSON.stringify(preReg.error)}`).toBeUndefined();
    await pushSkill('leaky-skill', '# Leaky Skill\n\nPrivate instructions nobody else should read.\n');

    const script =
      `export const meta = { phases: [{ title: 'Before' }, { title: 'Declare' }, { title: 'After' }], params: { agents: {\n` +
      `  snoopBefore: ${agentBlock()},\n` +
      `  writer: ${agentBlock({ skills: ['leaky-skill'] })},\n` +
      `  snoopAfter: ${agentBlock()},\n` +
      `} } };\n` +
      `phase('Before');\n` +
      `await agent('snoopBefore', { prompt: 'look for a skill' });\n` +
      `phase('Declare');\n` +
      `await agent('writer', { prompt: 'use the leaky skill' });\n` +
      `phase('After');\n` +
      `return await agent('snoopAfter', { prompt: 'look for a skill again' });`;
    const mermaid =
      'graph LR\nsubgraph "Before"\nsnoopBefore(["snoopBefore"])\nend\nsubgraph "Declare"\nwriter(["writer"])\nend\nsubgraph "After"\nsnoopAfter(["snoopAfter"])\nend\nsnoopBefore-->writer\nwriter-->snoopAfter';
    const runId = await registerRunAndWait(script, mermaid);
    const workspace = expectedWorkspace(runId);

    // `queryImpl` is one shared mock for the whole describe block (not reset between tests) — take
    // only the LAST three calls, this run's own three dispatches.
    const allCalls = queryImpl.mock.calls as unknown as Array<[CapturedCall]>;
    const [beforeCall, writerCall, afterCall] = allCalls.slice(-3).map((c) => c[0]);
    // Neither snoop dispatch ever got a plugin or a non-empty skills list — not before the skill was
    // materialized, and not after it was already materialized (and removed) for `writer`.
    expect(beforeCall!.options?.plugins).toBeUndefined();
    expect(beforeCall!.options?.skills ?? []).toEqual([]);
    expect(afterCall!.options?.plugins).toBeUndefined();
    expect(afterCall!.options?.skills ?? []).toEqual([]);
    // The declaring agent, and only it, got the plugin — outside the shared workspace.
    expect(writerCall!.options?.plugins).toHaveLength(1);
    expect(writerCall!.options!.plugins![0]!.path.startsWith(workspace)).toBe(false);
    expect(writerCall!.options?.skills).toEqual([`${RWE_SKILLS_PLUGIN_NAME}:leaky-skill`]);

    // The durable log record agrees: only `writer` ever had it materialized/exposed.
    const beforeLog = await mcpCall('run_agent_log', { runId, label: 'snoopBefore' });
    const writerLog = await mcpCall('run_agent_log', { runId, label: 'writer' });
    const afterLog = await mcpCall('run_agent_log', { runId, label: 'snoopAfter' });
    expect(beforeLog.harness?.skillsExposed ?? []).toEqual([]);
    expect(writerLog.harness?.skillsExposed).toEqual(['leaky-skill']);
    expect(afterLog.harness?.skillsExposed ?? []).toEqual([]);

    // The shared workspace itself never carried `.claude/skills` at any point in the run — the
    // leftover-artifact half of the issue: `workspace_list` (what workspace_pull would also see)
    // shows no trace of it after the run completes.
    expect(existsSync(join(workspace, '.claude', 'skills'))).toBe(false);
    const listed = await mcpCall('workspace_list', { runId });
    const paths = ((listed.result ?? []) as Array<{ path: string }>).map((f) => f.path);
    expect(paths.some((p) => p.includes('.claude/skills'))).toBe(false);
  }, 30000);

  // issue #103(a) (owner decision, superseding the earlier "still runs" contract this case used to
  // pin): a label declaring a skill name with no provisioned asset is now refused at admission,
  // before any dispatch — `registration-mcp-provisioning-warning.test.ts` covers the (non-fatal)
  // `workflow_register` warning for the very same declaration; this case is what happens next, at
  // `run_start`, which is where DES-154's `AssetSyncService.resolveDeclaredAssets` is authoritative.
  it('a label declaring an ABSENT skill is refused SKILL_NOT_PROVISIONED at run_start, before any dispatch (issue #103a)', async () => {
    const script =
      `export const meta = { phases: [{ title: 'Work' }], params: { agents: { hopeful: ${agentBlock({ skills: ['never-pushed'] })} } } };\n` +
      `phase('Work');\n` +
      `return await agent('hopeful', { prompt: 'ask for a skill nobody pushed' });`;
    const mermaid = 'graph LR\nsubgraph "Work"\nhopeful(["hopeful"])\nend';
    const registered = await mcpCall('workflow_register', { name: WF_NAME, script, mermaid });
    expect(registered.error, `workflow_register failed: ${JSON.stringify(registered.error)}`).toBeUndefined();
    const version = registered.result.version as string;
    const published = await mcpCall('workflow_publish', { name: WF_NAME, version, channel: 'release' });
    expect(published.error, `workflow_publish failed: ${JSON.stringify(published.error)}`).toBeUndefined();

    const run = await mcpCall('run_start', { name: WF_NAME });
    expect(run.error?.code, `expected SKILL_NOT_PROVISIONED, got: ${JSON.stringify(run.error)}`).toBe('SKILL_NOT_PROVISIONED');
    expect(run.error?.detail?.missing).toEqual([{ label: 'hopeful', names: ['never-pushed'] }]);
    // No run was ever created — admission refused before any dispatch, so there is nothing for
    // run_status/run_agent_log to report on (`runId: ''` is this envelope's own refusal shape,
    // call-tool.ts's `admissionRefusal()` — not `undefined`).
    expect(run.runId).toBe('');
  }, 30000);

  it('a label declaring NO assets materializes neither of two stored skills (selective, not copy-all)', async () => {
    const script =
      `export const meta = { phases: [{ title: 'Work' }], params: { agents: { plain: ${agentBlock()} } } };\n` +
      `phase('Work');\n` +
      `return await agent('plain', { prompt: 'noop' });`;
    const runId = await registerRunAndWait(script, 'graph LR\nsubgraph "Work"\nplain(["plain"])\nend');
    const workspace = expectedWorkspace(runId);
    expect(existsSync(join(workspace, '.claude', 'skills'))).toBe(false);
    const calls = queryImpl.mock.calls as unknown as Array<[CapturedCall]>;
    expect(calls[calls.length - 1]![0].options?.plugins).toBeUndefined();
  }, 30000);

  // Issue #105 part A (owner decision): a skill file's exec flag must survive the WHOLE hop —
  // asset-sync write (0o755/0o644), then the run-workspace materialization copy
  // (`materializeAssets`'s `copyDir`, real fs `copyFileSync` in production) — not just the pushed
  // asset tree. `copyFileSync` preserves the source file's mode (verified separately, node -e
  // repro); this test proves it end-to-end through the SAME real dispatch path (real
  // composeConfig/createServer/MCP round trips, run-manager, gateway, materializeAssets) this
  // file's OWN mock policy already uses — only the third-party SDK `query()` export is faked (no
  // real model call), same as every other case here. Not real-tier / paid-model (that was
  // optional per the dispatch); this is the same "REAL dispatch" this file's header already means.
  it('exec:true on a pushed skill file survives materialization into the run workspace (issue #105 part A)', async () => {
    const preReg = await mcpCall('workflow_register', { name: WF_NAME, script: 'export const meta = { phases: [] };\nreturn "placeholder-exec";', mermaid: 'graph LR' });
    expect(preReg.error, `pre-register failed: ${JSON.stringify(preReg.error)}`).toBeUndefined();

    const push = await mcpCall('workspace_push', {
      workflow: WF_NAME, kind: 'skill', name: 'exec-skill',
      files: [
        { path: 'SKILL.md', contentB64: Buffer.from('# Exec Skill\n').toString('base64') },
        { path: 'run.sh', contentB64: Buffer.from('#!/bin/sh\necho hi\n').toString('base64'), exec: true },
      ],
    });
    expect(push.error, `workspace_push(exec-skill) failed: ${JSON.stringify(push.error)}`).toBeUndefined();

    const script =
      `export const meta = { phases: [{ title: 'Work' }], params: { agents: { execpicky: ${agentBlock({ skills: ['exec-skill'] })} } } };\n` +
      `phase('Work');\n` +
      `return await agent('execpicky', { prompt: 'use the exec skill' });`;
    // Issue #144: the materialized directory is private and removed before `_invokeOnce` returns —
    // gone by the time `run_start`'s polling loop (inside `registerRunAndWait`) sees the run go
    // terminal. `statSync` it from INSIDE the `queryImpl` mock itself instead: that callback runs
    // SYNCHRONOUSLY, before the SDK session generator is ever iterated, i.e. before the cleanup
    // `finally` that removes the directory.
    const modes: { runSh?: number; skillMd?: number } = {};
    queryImpl.mockImplementationOnce((opts: { options?: { plugins?: Array<{ path: string }> } }) => {
      const pluginPath = opts.options?.plugins?.[0]?.path;
      if (pluginPath !== undefined) {
        modes.runSh = statSync(join(pluginPath, 'skills', 'exec-skill', 'run.sh')).mode & 0o777;
        modes.skillMd = statSync(join(pluginPath, 'skills', 'exec-skill', 'SKILL.md')).mode & 0o777;
      }
      return fakeSuccessSession();
    });
    const runId = await registerRunAndWait(script, 'graph LR\nsubgraph "Work"\nexecpicky(["execpicky"])\nend');
    const workspace = expectedWorkspace(runId);

    expect(modes.runSh, 'run.sh was not materialized (options.plugins[0] never captured)').toBe(0o755);
    expect(modes.skillMd).toBe(0o644);
    expect(existsSync(join(workspace, '.claude', 'skills'))).toBe(false);
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
