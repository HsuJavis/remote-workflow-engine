// E2E-011 (REQ-220/221/225/226/229, v40): the full user journey — register a workflow that
// declares `decisions`/`images` blocks, run it, stop it mid-flight, resume it (decide/image calls
// replay, provider not re-called), list the workspace, pull the generated file, and confirm
// `run_status.agents[].kind` surfaces 'decide'/'image' — all over real MCP HTTP against a real
// createServer(), the OpenRouter wire stood in by `directDeps.fetch` (the designed third-party
// seam, DES-267/274).
//
// Red reason: decide()/generateImage() are not sandbox globals yet (UT-350) — the run fails before
// the journey's first step completes. `expect(view.status).toBe('completed')` is the load-bearing,
// non-vacuous assertion the rest of this journey depends on; everything after it is unreachable
// until the feature exists, which is the correct shape for an end-to-end RED.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { runScriptVia } from '../helpers/workflow-fixtures.js';
import { makeStubFetch } from '../helpers/stub-fetch.js';

async function call(s: Server, name: string, args: unknown): Promise<any> {
  const res = await fetch(`http://127.0.0.1:${s.port}/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = (await res.json()) as { result?: { content?: Array<{ text?: string }> } };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}');
}
const callerFor = (s: Server) => (tool: string, args: Record<string, unknown>) => call(s, tool, args);

async function poll(s: Server, runId: string, status: string[] = ['completed', 'failed', 'stopped']): Promise<any> {
  for (let i = 0; i < 200; i++) {
    const st = await call(s, 'run_status', { runId });
    if (status.includes(st.status)) return st;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error('run did not settle');
}

let server: Server;
let tmpDir: string;
beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-e2e011-'));
});
afterAll(async () => { await server?.close(); rmSync(tmpDir, { recursive: true, force: true }); });

describe('E2E-011: register -> run -> stop -> resume -> workspace_list/pull -> run_status.agents[].kind', () => {
  it('the full decide+generateImage journey', async () => {
    const stub = makeStubFetch([
      { status: 200, body: { answers: { ok: { type: 'noul', noul: 0.75 } } } },
      { status: 200, body: { id: 'g1', choices: [{ message: { content: '', images: [{ image_url: 'data:image/png;base64,iVBORw0KGgo=' }] } }] } },
    ]);
    server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir, directDeps: { fetch: stub.fetch } } as never);

    const script = `
      export const meta = { phases: [], params: {
        decisions: { gate: { model: { type: 'string', default: 'openrouter/typesafe/jev-1.13' }, timeoutMs: { type: 'number', default: 5000 }, retries: { type: 'number', default: 0 } } },
        images: { hero: { model: { type: 'string', default: 'openrouter/black-forest-labs/flux-1.1-pro' }, timeoutMs: { type: 'number', default: 5000 }, retries: { type: 'number', default: 0 } } }
      } };
      const d = await decide('gate', { state: {}, questions: { ok: { type: 'bool', instructions: 'i', criteria: { true: 't', false: 'f' } } } });
      const img = await generateImage('hero', { prompt: 'a red dog' });
      return { d, img };
    `;
    const started: any = await runScriptVia(callerFor(server), script, {});
    const runId = started.runId ?? started.result?.runId;

    // --- step 1: the run completes on its first attempt (load-bearing; everything below is
    // unreachable until this holds) ---
    const firstView = await poll(server, runId);
    expect(firstView.status).toBe('completed');

    // --- step 2: run_status.agents[].kind surfaces 'decide'/'image' (DES-264 AgentRecord.kind) ---
    const kinds = (firstView.agents ?? []).map((a: any) => a.kind);
    expect(kinds).toContain('decide');
    expect(kinds).toContain('image');

    // --- step 3: the generated image is listable and pullable via workspace_list/workspace_pull ---
    const files = firstView.result?.img?.files as Array<{ path: string }> | undefined;
    expect(Array.isArray(files)).toBe(true);
    const listed = await call(server, 'workspace_list', { runId });
    expect(JSON.stringify(listed)).toContain(files?.[0]?.path ?? '__none__');
    const pulled = await call(server, 'workspace_pull', { runId, path: files?.[0]?.path });
    expect(pulled).toBeDefined();

    // --- step 4: a SECOND run of the same script, stopped mid-flight then resumed, replays BOTH
    // primitive calls with ZERO further provider contact (REQ-226) ---
    const started2: any = await runScriptVia(callerFor(server), script, {});
    const runId2 = started2.runId ?? started2.result?.runId;
    await call(server, 'run_stop', { runId: runId2 });
    const callsBeforeResume = stub.calls.length;
    const resumed = await call(server, 'run_resume', { runId: runId2 });
    void resumed;
    const resumedView = await poll(server, runId2);
    expect(resumedView.status).toBe('completed');
    expect(stub.calls.length).toBe(callsBeforeResume);
  }, 30000);
});
