// IT-117 (DES-155, v24; rewrite target of workspace-artifacts.test.ts per DES-159[T3]): the six
// workspace_* tools — workspace_diff/push/pull/list/delete/purge — are REGISTERED, plus the two
// refusals DES-155 pins on them: a `runId` on workspace_push is refused by the closed per-mode
// schema, and workspace_delete against a still-live run is refused RUN_NOT_TERMINAL.
//
// v24 migration: this file was written test-first (Gate 5, RED) when none of the six names existed,
// so each "is an unknown tool today (-32601)" case asserted the ABSENCE the implementation has since
// removed. The subject — "these exact six names are the v24 workspace surface" — is unchanged; only
// the oracle inverts, to presence in `tools/list`. `src/tool-specs.ts` is authoritative for the
// names, so the list below is checked against it rather than re-typed as prose.
//
// Two other things the pre-implementation draft could not get right and that are fixed here:
//   * a tool-level error code travels inside `result.content[0].text`, never at the JSON-RPC
//     `error` position (that position carries ONLY transport codes such as -32601), so the two
//     refusal cases have to unwrap the envelope to see anything at all;
//   * RUN_NOT_TERMINAL needs a genuinely LIVE run. The draft passed a made-up `'r1'`, which can
//     only ever answer RUN_NOT_FOUND — the guard under test (`withTerminalRun`, run-manager.ts)
//     is reached only after the run resolves.
// Mock policy: real HTTP MCP server, real CAS/workspace FS — no mock of the SUT boundary.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { FIXTURE_SCRIPT, FIXTURE_MERMAID, TOOL_SPECS } from '../../src/tool-specs.js';

describe('the six workspace_* tools (IT-117, DES-155)', () => {
  let server: Server;
  let workRoot: string;
  /** Live runs started here, stopped in afterAll so the suite never leaks a running agent. */
  const startedRuns: string[] = [];

  beforeAll(async () => {
    // A dedicated workRoot: a bare `createServer()` shares one SQLite catalog under `os.tmpdir()`
    // with every other test file (see tests/helpers/workflow-fixtures.ts's `uniqueWorkflowName`).
    workRoot = mkdtempSync(join(tmpdir(), 'rwe-it117-'));
    server = await createServer({ port: 0, bind: '127.0.0.1', workRoot });
  });

  afterAll(async () => {
    for (const runId of startedRuns) await call('run_stop', { runId }).catch(() => undefined);
    await server?.close();
    rmSync(workRoot, { recursive: true, force: true });
  });

  /** Returns both halves of the response: `rpcCode` is the JSON-RPC transport code (-32601 for an
   *  unknown tool), `body` the parsed tool envelope, `code` the tool-level error code inside it. */
  async function call(name: string, args: Record<string, unknown>): Promise<{ rpcCode?: number; code?: string; body: any }> {
    const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
    const json = (await res.json()) as { error?: { code: number }; result?: { content?: Array<{ text?: string }> } };
    if (json.error) return { rpcCode: json.error.code, body: json };
    const text = json.result?.content?.[0]?.text;
    let parsed: unknown = json;
    try { if (text !== undefined) parsed = JSON.parse(text); } catch { /* keep the raw envelope */ }
    return { code: (parsed as { error?: { code?: string } })?.error?.code, body: parsed };
  }

  async function listTools(): Promise<string[]> {
    const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    const json = (await res.json()) as { result?: { tools?: Array<{ name: string }> } };
    return (json.result?.tools ?? []).map((t) => t.name);
  }

  const TOOLS = ['workspace_diff', 'workspace_push', 'workspace_pull', 'workspace_list', 'workspace_delete', 'workspace_purge'];

  it('the workspace entity is exactly these six tools in tool-specs.ts (no seventh, none renamed)', () => {
    const declared = (TOOL_SPECS as ReadonlyArray<{ name: string; entity: string }>)
      .filter((s) => s.entity === 'workspace')
      .map((s) => s.name);
    expect(declared).toEqual(TOOLS);
  });

  it.each(TOOLS)('%s is a registered tool (advertised in tools/list, never -32601)', async (name) => {
    expect(await listTools()).toContain(name);
    // The complement of the retired "unknown tool today" oracle: whatever this call answers about
    // its empty argument object, it is never the transport's unknown-method code.
    const { rpcCode } = await call(name, {});
    expect(rpcCode).toBeUndefined();
  });

  it('workspace_push with a runId arg is refused INVALID_ARGUMENT from the closed schema (a run workspace is immutable while live) — not just unknown-tool', async () => {
    const { code, body } = await call('workspace_push', { runId: 'r1', sha256: 'a'.repeat(64), contentB64: 'eA==' });
    expect(code).toBe('INVALID_ARGUMENT');
    // DES-155's boundary is the SCHEMA, not a runtime check: a `runId` matches neither `oneOf`
    // branch, so ajv refuses it before any handler (and before the bogus runId could be resolved).
    expect(body.error.message).toContain('additional properties');
  });

  it('workspace_delete deleting during a live run is refused RUN_NOT_TERMINAL', async () => {
    const registered = await call('workflow_register', { name: 'it117-live', script: FIXTURE_SCRIPT, mermaid: FIXTURE_MERMAID });
    const version = String(registered.body.result?.version ?? registered.body.version);
    await call('workflow_publish', { name: 'it117-live', version, channel: 'release' });
    const started = await call('run_start', { name: 'it117-live' });
    const runId = started.body.runId as string;
    expect(runId).toBeTruthy();
    startedRuns.push(runId);

    // FIXTURE_SCRIPT calls agent(), so the run stays live while the delete is attempted.
    let status = '';
    for (let i = 0; i < 200 && status !== 'running'; i++) {
      status = (await call('run_status', { runId })).body.status;
      if (status !== 'running') await new Promise((r) => setTimeout(r, 25));
    }
    expect(status).toBe('running');

    const del = await call('workspace_delete', { runId, paths: ['a.txt'] });
    expect(del.code).toBe('RUN_NOT_TERMINAL');
    // Same guard, same run: purging a live workspace is refused for the identical reason.
    expect((await call('workspace_purge', { runId })).code).toBe('RUN_NOT_TERMINAL');
  }, 30_000);
});
