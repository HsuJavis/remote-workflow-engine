// Issue #159 (3rd reverification): `run_start({seed:[...]})` with a seeded `.claude/settings.json`
// and `.claude/hooks/h.sh` strips both at MATERIALIZE time (workspace-seed.ts's `lexicalVerdict`
// 'stripped' verdict — neither ever touches disk), but until this fix nothing anywhere reported it:
// `AgentHarnessDescriptor.plantedConfigRemoved` only reports what the dispatch-time sweep
// (`sweepPlantedConfig`) finds ALREADY ON DISK, and a stripped seed path never reaches disk, so the
// sweep correctly finds nothing and stays silent — while `materializeSeed`'s own `{stripped,
// rejected}` return value was discarded outright by RunManager (never captured, never surfaced).
// A tester seeding both paths saw them silently vanish with zero observability, while `.mcp.json`
// and `.claude/skills` (NOT stripped at seed time — written, then swept at first dispatch) DID show
// up, in `plantedConfigRemoved`. Earlier triage wrongly called this "cannot reproduce" because its
// own probes planted files directly into an existing workspace (bypassing seed entirely), which
// always hits the sweep and always reports — only a SEEDED run hits the silent gap.
//
// Red reason (pre-fix): `RunStatusView` has no `seedConfigStripped` field; `run-manager.ts`'s
// materialize call site discards `materializeSeed`'s return value entirely
// (`materialize(workspace);` with nothing captured) — `done.result.seedConfigStripped` is always
// `undefined`, even though `.claude/settings.json`/`.claude/hooks/h.sh` were genuinely dropped.
//
// Mock policy (integration): real createServer(), real MCP HTTP, real RunManager/materializeSeed —
// no agent ever dispatches (the script returns before any agent() call), so no gateway/model/network
// is needed to prove the reporting gap.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { runScriptVia, uniqueWorkflowName } from '../helpers/workflow-fixtures.js';

let server: Server;
let workRoot: string;

async function mcpCall(name: string, args: unknown): Promise<any> {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = (await res.json()) as { result?: { content?: Array<{ text?: string }> } };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}');
}

async function poll(runId: string): Promise<any> {
  for (let i = 0; i < 60; i++) {
    const st = await mcpCall('run_status', { runId });
    if (['completed', 'failed', 'stopped'].includes(st.status)) return st;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('run did not settle');
}

beforeAll(async () => {
  workRoot = mkdtempSync(join(tmpdir(), 'rwe-it159-'));
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot });
});

afterAll(async () => {
  await server?.close();
  rmSync(workRoot, { recursive: true, force: true });
});

describe('issue #159: seed-time .claude/settings.json + .claude/hooks strip is observable', () => {
  it('run_status.result.seedConfigStripped lists both stripped paths; neither is written to the workspace', async () => {
    const name = uniqueWorkflowName('it159-seed-strip');
    const run = await runScriptVia(mcpCall, `return 'ok';`, {
      name,
      seed: [
        { path: '.claude/settings.json', contentB64: Buffer.from('{"hooks":{}}').toString('base64') },
        { path: '.claude/hooks/h.sh', contentB64: Buffer.from('#!/bin/sh\necho pwned').toString('base64') },
        { path: 'real.txt', contentB64: Buffer.from('hello').toString('base64') },
      ],
    });
    const runId = run.result?.runId ?? run.runId;
    expect(runId).toBeTruthy();

    const done = await poll(runId);
    expect(done.status).toBe('completed');

    // The fix: both stripped paths are now observable on the run.
    expect(done.result?.seedConfigStripped).toEqual(
      expect.arrayContaining(['.claude/settings.json', '.claude/hooks/h.sh']),
    );
    expect(done.result?.seedConfigStripped).toHaveLength(2);

    // Never written: workspace_list sees only the legitimate file.
    const arts = await mcpCall('workspace_list', { runId });
    const paths: string[] = (arts.result as Array<{ path: string }>).map((a) => a.path);
    expect(paths).toContain('real.txt');
    expect(paths).not.toContain('.claude/settings.json');
    expect(paths).not.toContain('.claude/hooks/h.sh');

    // #159 (4th reverification): the guide (and docs/AUTHORING.md:247) tells the reader
    // `seedConfigStripped` shows up on BOTH `run_status` AND `run_result` — so `run_result` must
    // actually carry it too (on `meta`, beside `usage`/`budgetEnforceable`), or a tester who checks
    // run_result instead of run_status sees nothing and reports NOT FIXED again.
    const runResult = await mcpCall('run_result', { runId });
    expect(runResult.meta?.seedConfigStripped).toEqual(
      expect.arrayContaining(['.claude/settings.json', '.claude/hooks/h.sh']),
    );
    expect(runResult.meta?.seedConfigStripped).toHaveLength(2);
  });

  it('a seed with nothing to strip omits seedConfigStripped entirely (never [])', async () => {
    const name = uniqueWorkflowName('it159-no-strip');
    const run = await runScriptVia(mcpCall, `return 'ok';`, {
      name,
      seed: [{ path: 'real.txt', contentB64: Buffer.from('hello').toString('base64') }],
    });
    const runId = run.result?.runId ?? run.runId;
    const done = await poll(runId);
    expect(done.status).toBe('completed');
    expect('seedConfigStripped' in (done.result ?? {})).toBe(false);

    const runResult = await mcpCall('run_result', { runId });
    expect('seedConfigStripped' in (runResult.meta ?? {})).toBe(false);
  });
});
