// IT-036: REQ-009 clause 1 route-back — an accepted skill asset must be MATERIALIZED into the run
// workspace's own `.claude/skills` directory and the SDK call must load it via
// `settingSources:['project']` with `cwd` scoped to THAT run's workspace (D-V2V-1, binding ORCH
// ruling on 08-validation.md VAL-017's finding: `settingSources: []` skips ALL filesystem skill
// discovery, and a pushed skill's `SKILL.md` sits under `$workRoot/assets/skill/<name>/`, a
// directory nothing ever reads at agent-invocation time). Host-level settingSources ('user'/
// 'local') stay excluded either way — the D-F11 host-contamination isolation this system was built
// to close is preserved; only 'project' (this run's own materialized, per-run workspace) is added.
// This system's own `rwe-*` plugin skill remains excluded end-to-end (D4 recursion guard,
// unchanged, re-confirmed here at the materialization boundary too).
//
// Mock policy (DES-015, integration tier): real `composeConfig()` + real `createServer()` + real
// HTTP `asset_push`/`workflow_run`/`workflow_status` round trip + real on-disk workspace
// inspection; only the third-party SDK `query()` export and the managed LiteLLM proxy subprocess
// are faked (same seams as IT-035) — no real network/process I/O.
//
// Red reason: no code path copies a stored skill asset into any run workspace at all (confirmed:
// `grep -rn asset src/agent-executor.ts src/run-manager.ts src/gateway/*.ts` -> zero matches, per
// 08-validation.md VAL-017); `ClaudeAgentSdkGatewayClient` hard-codes `settingSources: []` and its
// `cwd` is fixed ONCE at construction time (the whole server `workRoot`, never a per-run
// workspace) — not an import/syntax error. The 2nd case (`rwe-*` stays excluded) is an intentional
// regression guard, NOT a forcing red: the recursion guard already rejects storage of a `rwe-*`
// asset today (DES-019 D4, unchanged), and nothing materializes anything today either way — both
// facts remain true after the route-back fix, so this sub-case is expected to stay green throughout
// (same documented convention as IT-016's "unknown type still fails fast" sub-case, journal
// 2026-07-03 12:35).
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { composeConfig } from '../../src/main.js';
import { LiteLLMProxyManager } from '../../src/gateway/litellm-proxy.js';
import type { AliasMap } from '../../src/gateway/client.js';
import { runScriptVia } from '../helpers/workflow-fixtures.js';

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
  options?: { settingSources?: string[]; cwd?: string };
}

describe('skill asset materialization + scoped settingSources/cwd (IT-036, D-V2V-1, REQ-009)', () => {
  let server: Server;
  let workRoot: string;
  let baseUrl: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let queryImpl: any;

  beforeAll(async () => {
    workRoot = mkdtempSync(join(tmpdir(), 'rwe-it036-'));
    queryImpl = vi.fn(() => fakeSuccessSession());
    const config = await composeConfig(
      { bind: '127.0.0.1', port: 0, workRoot, aliases: ALIASES, gateway: 'sdk', assetRoot: join(workRoot, 'assets') },
      { queryImpl: queryImpl as unknown as never, proxyManager: makeFakeProxyManager() },
    );
    server = await createServer(config);
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

  /** The workflow name every run in this file registers under, so the run's workspace bucket is
   *  known to `expectedWorkspace` below. */
  const WF_NAME = 'it036-skill-asset';

  async function runToCompletion(script: string): Promise<string> {
    const run = await runScriptVia(mcpCall, script, { name: WF_NAME });
    const runId = run.runId as string;
    let done = false;
    for (let i = 0; i < 50 && !done; i++) {
      const status = await mcpCall('workflow_status', { runId });
      done = status.status === 'completed' || status.status === 'failed';
      if (!done) await new Promise((r) => setTimeout(r, 100));
    }
    expect(done).toBe(true);
    return runId;
  }

  // Per WorkflowCatalog's own documented on-disk convention (`workFolder(name)/runs/<runId>` —
  // workflow-catalog.ts header comment). v22 closed inline script, so every run is NAMED and its
  // bucket is the workflow name (`spec.name ?? '_adhoc'`, run-manager.ts) rather than the '_adhoc'
  // bucket the pre-v22 unnamed shape landed in.
  function expectedWorkspace(runId: string): string {
    return join(workRoot, 'workflows', WF_NAME, 'runs', runId);
  }

  it("an accepted skill asset is materialized into the run workspace .claude/skills, and the SDK call carries settingSources:['project'] with cwd = that workspace", async () => {
    const skillMd = '# Demo Skill\n\nDoes a demo thing.\n';
    const push = await mcpCall('asset_push', {
      kind: 'skill',
      name: 'demo-skill',
      files: [{ path: 'SKILL.md', contentB64: Buffer.from(skillMd).toString('base64') }],
    });
    expect(push.error).toBeUndefined();
    expect(push.result?.stored).toContain('demo-skill');

    const runId = await runToCompletion("return agent('use the demo skill', {model:'local'});");

    expect(queryImpl).toHaveBeenCalled();
    const [[call]] = queryImpl.mock.calls as unknown as [[CapturedCall]];
    const workspace = expectedWorkspace(runId);

    // Forcing red: today `cwd` is fixed once at ClaudeAgentSdkGatewayClient construction to the
    // whole server workRoot, never re-scoped per call to the run's own workspace.
    expect(call.options?.cwd).toBe(workspace);
    // Forcing red: today hard-coded `settingSources: []` — 'project' (this run's own materialized
    // .claude/) is missing.
    expect(call.options?.settingSources).toEqual(['project']);
    // Host-level sources must never leak back in (D-F11 isolation preserved).
    expect(call.options?.settingSources ?? []).not.toContain('user');
    expect(call.options?.settingSources ?? []).not.toContain('local');

    // Forcing red: nothing copies the stored skill into the run workspace's .claude/ dir today.
    const materializedPath = join(workspace, '.claude', 'skills', 'demo-skill', 'SKILL.md');
    expect(existsSync(materializedPath)).toBe(true);
    expect(readFileSync(materializedPath, 'utf-8')).toBe(skillMd);
  }, 20000);

  it("this system's own rwe-* skill stays excluded end-to-end: never stored, never materialized into any run workspace (regression guard, D4)", async () => {
    const push = await mcpCall('asset_push', {
      kind: 'skill',
      name: 'rwe-guard-test',
      files: [{ path: 'SKILL.md', contentB64: Buffer.from('# Self-referential').toString('base64') }],
    });
    expect(push.result?.excluded?.some((e: { name: string }) => e.name === 'rwe-guard-test')).toBe(true);
    expect(push.result?.stored).not.toContain('rwe-guard-test');

    const runId = await runToCompletion("return agent('noop', {model:'local'});");
    const neverMaterialized = join(expectedWorkspace(runId), '.claude', 'skills', 'rwe-guard-test');
    expect(existsSync(neverMaterialized)).toBe(false);
  }, 20000);
});
