// E2E-013 (REQ-220/221/225/226/229, v40): the full user journey — register a workflow that
// declares `decisions`/`images` blocks, run it, suspend it once its primitive calls are journaled, resume it (decide/image calls
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
import { mkdtempSync, rmSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { registerPublishedVia, uniqueWorkflowName } from '../helpers/workflow-fixtures.js';
import type { GatewayClient } from '../../src/gateway/client.js';
import { makeStubFetch } from '../helpers/stub-fetch.js';
// v40 Gate 6 ruling R-23: the retired FLUX 1.1 Pro id is replaced by the guide's single image constant.
import { EXAMPLE_IMAGE_MODEL } from '../../src/authoring-guide.js';

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

// v40 Gate 6 ruling R-33 (redesign of step 4): `run_stop` is terminal (stopped cannot resume) and a
// suspend fired before the primitive calls settled made the resume legitimately re-call the provider.
// The run now ends in an agent() call whose fake gateway HOLDS (only while the test arms it), so the
// test suspends only once run_status shows all 3 primitive records done (journaled) — no timers.
// One stub per kind (decide / image), each counting its own provider calls.
function holdGateway() {
  let armed = false;
  let invoked: (() => void) | null = null;
  const gateway: GatewayClient = {
    invoke: async () => {
      if (armed) {
        armed = false;
        invoked?.();
        return await new Promise<never>(() => {}); // in flight until suspend aborts it
      }
      return { ok: true, provider: 'fake', model: 'm', tokens: { input: 1, output: 1 }, content: 'held-ok' };
    },
  } as unknown as GatewayClient;
  return {
    gateway,
    arm(): Promise<void> { armed = true; return new Promise<void>((r) => { invoked = r; }); },
  };
}

function findFile(dir: string, suffix: string, runId: string): string | null {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { const hit = findFile(p, suffix, runId); if (hit) return hit; }
    else if (p.endsWith(suffix) && p.includes(runId)) return p;
  }
  return null;
}

describe('E2E-013: register -> run -> suspend (after the calls are journaled) -> resume -> workspace_list/pull -> run_status.agents[].kind', () => {
  it('the full decide+generateImage journey', async () => {
    const decideStub = makeStubFetch([{ status: 200, body: { answers: { ok: { type: 'noul', noul: 0.75 } } } }]);
    const imageStub = makeStubFetch([{ status: 200, body: { id: 'g1', choices: [{ message: { content: '', images: [{ image_url: 'data:image/png;base64,iVBORw0KGgo=' }] } }] } }]);
    const routed = ((i: Parameters<typeof fetch>[0], n?: Parameters<typeof fetch>[1]) =>
      (String(i).includes('/systemone') ? decideStub.fetch(i, n) : imageStub.fetch(i, n))) as typeof fetch;
    const calls = () => ({ decide: decideStub.calls.length, image: imageStub.calls.length });
    const hold = holdGateway();
    server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir, gateway: hold.gateway, directDeps: { fetch: routed, resolveKey: () => 'sk-test' } } as never);

    const script = `
      export const meta = { phases: [{ title: 'Main' }], params: {
        agents: { hold: { model: { type: 'string', default: 'anthropic/claude-haiku-4-5-20251001' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } } },
        decisions: { gate: { model: { type: 'string', default: 'openrouter/typesafe/jev-1.13' }, timeoutMs: { type: 'number', default: 5000 }, retries: { type: 'number', default: 0 } } },
        images: { hero: { model: { type: 'string', default: '${EXAMPLE_IMAGE_MODEL}' }, timeoutMs: { type: 'number', default: 5000 }, retries: { type: 'number', default: 0 } } }
      } };
      phase('Main');
      const d1 = await decide('gate', { state: { s: 1 }, questions: { ok: { type: 'bool', instructions: 'i', criteria: { true: 't', false: 'f' } } } });
      const img = await generateImage('hero', { prompt: 'a red dog' });
      const d2 = await decide('gate', { state: { s: 2 }, questions: { ok: { type: 'bool', instructions: 'i', criteria: { true: 't', false: 'f' } } } });
      await agent('hold', { prompt: 'p' });
      return { d1, img, d2 };
    `;
    const name = uniqueWorkflowName('e2e011');
    await registerPublishedVia(callerFor(server) as never, name, script);
    const start = async (): Promise<string> => { const r: any = await call(server, 'run_start', { name }); return r.runId ?? r.result?.runId; };
    const primitiveRowsDone = async (runId: string): Promise<void> => {
      for (let i = 0; i < 300; i++) {
        const st = await call(server, 'run_status', { runId });
        const done = (st.result?.agents ?? []).filter((a: any) => (a.kind === 'decide' || a.kind === 'image') && a.state === 'done');
        if (done.length === 3) return;
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error('the 3 primitive rows never landed');
    };

    // --- step 1 (NEGATIVE CONTROL: no suspend): the run completes; baseline = 2 decide + 1 image calls ---
    const runId = await start();
    const firstView = await poll(server, runId);
    expect(firstView.status).toBe('completed');
    expect(calls()).toEqual({ decide: 2, image: 1 });

    // --- step 2: run_status.agents[].kind surfaces 'decide'/'image' (DES-264 AgentRecord.kind) ---
    const kinds = (firstView.result?.agents ?? []).map((a: any) => a.kind);
    expect(kinds).toContain('decide');
    expect(kinds).toContain('image');

    // --- step 3: the generated image is listable and pullable via workspace_list/workspace_pull ---
    const rr1 = await call(server, 'run_result', { runId });
    const files = rr1.result?.img?.files as Array<{ path: string }> | undefined;
    expect(Array.isArray(files) && files.length > 0).toBe(true);
    const listed = await call(server, 'workspace_list', { runId });
    expect(JSON.stringify(listed)).toContain(files![0]!.path);
    const pulled = await call(server, 'workspace_pull', { runId, path: files![0]!.path });
    expect(pulled?.error).toBeUndefined();

    // --- step 4 (REQ-226): suspend only after all 3 primitive rows are journaled, resume -> ZERO
    // further provider calls, the same answers and the same image paths as the uninterrupted run ---
    const held2 = hold.arm();
    const runId2 = await start();
    await primitiveRowsDone(runId2);
    await held2;
    await call(server, 'run_suspend', { runId: runId2 });
    expect((await call(server, 'run_status', { runId: runId2 })).status).toBe('suspended');
    const atSuspend = calls();
    expect(atSuspend).toEqual({ decide: 4, image: 2 }); // run 2 really made its 3 calls before the suspend
    await call(server, 'run_resume', { runId: runId2 });
    expect((await poll(server, runId2)).status).toBe('completed');
    expect(calls()).toEqual(atSuspend);
    const rr2 = await call(server, 'run_result', { runId: runId2 });
    expect(rr2.result).toEqual(rr1.result);

    // --- step 5 (REQ-226 regenerate-then-MISS): a fresh copy, suspended the same way, has its image
    // deleted before resume -> the image is regenerated (1 image call) and every LATER primitive is a
    // MISS (d2 re-called: 1 decide call); d1, BEFORE the image, still replays (no second decide call) ---
    const held3 = hold.arm();
    const runId3 = await start();
    await primitiveRowsDone(runId3);
    await held3;
    await call(server, 'run_suspend', { runId: runId3 });
    const imgPath = findFile(tmpDir, files![0]!.path, runId3);
    expect(imgPath).not.toBeNull();
    unlinkSync(imgPath!);
    const before3 = calls();
    await call(server, 'run_resume', { runId: runId3 });
    expect((await poll(server, runId3)).status).toBe('completed');
    expect(calls()).toEqual({ decide: before3.decide + 1, image: before3.image + 1 });
    expect(existsSync(imgPath!)).toBe(true);
    const rr3 = await call(server, 'run_result', { runId: runId3 });
    expect(rr3.result?.img?.files?.[0]?.path).toBe(files![0]!.path);
  }, 60000);
});
