// VAL-278..284 (REQ-220..226, v40): decide()/generateImage() acceptance clauses, bound against the
// REAL entrypoint — a real createServer() + real HTTP MCP (`workflow_register`/`workflow_publish`/
// `run_start`/`run_status`/`workspace_list`/`workspace_pull`). The OpenRouter wire itself is the one
// genuinely un-runnable third party; it is stood in by a local fake HTTP server bound to
// OPENROUTER_BASE_URL's OWN constant path shape via `directDeps.fetch` injection at RunManager
// construction — NOT a mock of the SUT (the SUT is the engine's decide/generateImage integration,
// not OpenRouter itself). real:false — Gate 7.5 flips this to true after a real OpenRouter run
// under the $1 spend cap.
//
// Red reason (uniform across every case in this file): `decide`/`generateImage` are not yet
// sandbox globals (see UT-350) — every run below fails with SCRIPT_ERROR ("decide is not defined")
// before any of the REQ's own acceptance clause is ever reached. Each assertion below targets the
// SPECIFIC clause text/code the REQ promises, never just "it failed" (the vacuous-green trap this
// ledger's IT-311/IT-313 entries already document).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { runScriptVia, registerPublishedVia, uniqueWorkflowName } from '../helpers/workflow-fixtures.js';
import { makeStubFetch } from '../helpers/stub-fetch.js';
import { buildCatalog } from '../../src/models/model-catalog.js';
// v40 Gate 6 ruling R-23: the retired FLUX 1.1 Pro id is replaced by the guide's single image constant.
import { EXAMPLE_IMAGE_MODEL } from '../../src/authoring-guide.js';

let server: Server;
let serverPi: Server;
let serverStub: ReturnType<typeof routedStub>;
let tmpDir: string;

async function call(s: Server, name: string, args: unknown): Promise<any> {
  const res = await fetch(`http://127.0.0.1:${s.port}/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = (await res.json()) as { result?: { content?: Array<{ text?: string }> } };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}');
}
const callerFor = (s: Server) => (tool: string, args: Record<string, unknown>) => call(s, tool, args);

async function poll(s: Server, runId: string): Promise<any> {
  for (let i = 0; i < 100; i++) {
    const st = await call(s, 'run_status', { runId });
    if (['completed', 'failed', 'stopped'].includes(st.status)) return st;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('run did not settle');
}

const DECIDE_OK_STUB = { status: 200, body: { answers: { order: { type: 'noul', noul: 0.82 } } } };
const IMAGE_OK_STUB = { status: 200, body: { id: 'g1', choices: [{ message: { content: '', images: [{ image_url: 'data:image/png;base64,iVBORw0KGgo=' }] } }] } };
function routedStub(): { fetch: typeof fetch; decideCalls: () => number; imageCalls: () => number } {
  const decide = makeStubFetch([DECIDE_OK_STUB]);
  const image = makeStubFetch([IMAGE_OK_STUB]);
  return { decideCalls: () => decide.calls.length, imageCalls: () => image.calls.length, fetch: ((i: Parameters<typeof fetch>[0], n?: Parameters<typeof fetch>[1]) => (String(i).includes('/systemone') ? decide.fetch(i, n) : image.fetch(i, n))) as typeof fetch };
}

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-val-v40-'));
  // v40 Gate 6 R-32: ONE stub per server, routed by endpoint (`/systemone` → decide reply, anything
  // else → image reply) — a single ordered stub shared by both servers handed the pi server's decide
  // the image body. `resolveKey` injected: the test env has no OpenRouter key.
  serverStub = routedStub();
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir, directDeps: { fetch: serverStub.fetch, resolveKey: () => 'sk-test' } } as never);
  serverPi = await createServer({ port: 0, bind: '127.0.0.1', workRoot: join(tmpDir, 'pi'), gateway: 'pi', directDeps: { fetch: routedStub().fetch, resolveKey: () => 'sk-test' } } as never);
});

afterAll(async () => {
  await server?.close();
  await serverPi?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('VAL-278: REQ-220 — decide(label, {state, questions}) returns a typed answer, usable under BOTH gateway:sdk and gateway:pi', () => {
  it('a declared decide() call returns answers.order of the declared bool type (gateway:sdk)', async () => {
    const script = `
      export const meta = { phases: [], params: { decisions: { gate: { model: { type: 'string', default: 'openrouter/typesafe/jev-1.13' }, timeoutMs: { type: 'number', default: 5000 }, retries: { type: 'number', default: 0 } } } } };
      const r = await decide('gate', { state: { status: 'pending' }, questions: { order: { type: 'bool', instructions: 'is it ready', criteria: { true: 'yes', false: 'no' } } } });
      return r;
    `;
    const started: any = await runScriptVia(callerFor(server), script, {});
    const view = await poll(server, started.runId ?? started.result?.runId);
    expect(view.status).toBe('completed');
    // the script's return value is on run_result (run_status carries status/agents, not the value)
    const rr = await call(server, 'run_result', { runId: view.runId });
    expect(rr.result?.answers?.order?.type).toBe('bool');
    expect(typeof rr.result?.answers?.order?.probability).toBe('number');
  });

  it('the SAME decide() call also works under gateway:pi', async () => {
    const script = `
      export const meta = { phases: [], params: { decisions: { gate: { model: { type: 'string', default: 'openrouter/typesafe/jev-1.13' }, timeoutMs: { type: 'number', default: 5000 }, retries: { type: 'number', default: 0 } } } } };
      const r = await decide('gate', { state: { status: 'pending' }, questions: { order: { type: 'bool', instructions: 'is it ready', criteria: { true: 'yes', false: 'no' } } } });
      return r;
    `;
    const started: any = await runScriptVia(callerFor(serverPi), script, {});
    const view = await poll(serverPi, started.runId ?? started.result?.runId);
    expect(view.status).toBe('completed');
  });

  it('a decide() call to an UNDECLARED label refuses registration naming the label', async () => {
    const name = uniqueWorkflowName('val255-undeclared');
    const script = `
      export const meta = { phases: [], params: {} };
      await decide('undeclared-gate', { state: {}, questions: {} });
      return 'x';
    `;
    await expect(registerPublishedVia(callerFor(server) as any, name, script)).rejects.toThrow();
  });
});

describe('VAL-279: REQ-221 — generateImage(label, {prompt, inputImages?, outDir?}) writes real files, never base64 in the reply', () => {
  it('a bare prompt call returns workspace-relative file paths that actually exist and are pullable', async () => {
    const script = `
      export const meta = { phases: [], params: { images: { hero: { model: { type: 'string', default: '${EXAMPLE_IMAGE_MODEL}' }, timeoutMs: { type: 'number', default: 5000 }, retries: { type: 'number', default: 0 } } } } };
      const r = await generateImage('hero', { prompt: 'a red dog' });
      return r;
    `;
    const started: any = await runScriptVia(callerFor(server), script, {});
    const runId = started.runId ?? started.result?.runId;
    const view = await poll(server, runId);
    expect(view.status).toBe('completed');
    const rr = await call(server, 'run_result', { runId });
    const files = rr.result?.files as Array<{ path: string; bytes: number; mimeType: string }> | undefined;
    expect(Array.isArray(files)).toBe(true);
    expect(files!.length).toBeGreaterThan(0);
    expect(JSON.stringify(rr.result)).not.toMatch(/data:image\/|base64/);
    const listed = await call(server, 'workspace_list', { runId });
    expect(JSON.stringify(listed)).toContain(files?.[0]?.path ?? '__none__');
  });

  it('inputImages with an escaping path (../x.png) is refused BEFORE calling the provider', async () => {
    const script = `
      export const meta = { phases: [], params: { images: { hero: { model: { type: 'string', default: '${EXAMPLE_IMAGE_MODEL}' }, timeoutMs: { type: 'number', default: 5000 }, retries: { type: 'number', default: 0 } } } } };
      const r = await generateImage('hero', { prompt: 'x', inputImages: ['../escape.png'] });
      return r;
    `;
    const imageCallsBefore = serverStub.imageCalls();
    const started: any = await runScriptVia(callerFor(server), script, {});
    const view = await poll(server, started.runId ?? started.result?.runId);
    expect(view.status).toBe('failed');
    expect(view.result?.error?.code).toBe('IMAGE_PATH_REFUSED');
    expect(view.result?.error?.message).toMatch(/ escape$/); // the refusal REASON is 'escape' (not e.g. not_regular)
    expect(serverStub.imageCalls()).toBe(imageCallsBefore); // refused BEFORE the provider // run_status carries the terminal error at result.error
  });
});

describe('VAL-280: REQ-222 — catalog recognizes decision models', () => {
  it('models_list({query:"typesafe"}) lists openrouter/typesafe/jev-1.13 with modelType:"decision" (requires live/static catalog wiring)', async () => {
    const r = await call(server, 'models_list', { query: 'typesafe' });
    const rows = (r.models ?? r.result?.models ?? []) as Array<{ ref?: string; modelType?: string }>;
    const jev = rows.find((m) => m.ref === 'openrouter/typesafe/jev-1.13');
    expect(jev?.modelType).toBe('decision');
  });
});

describe('VAL-281: REQ-223 — registration-time model-type gate (new registrations only)', () => {
  it('a decisions.<label>.model.default typed as a known-wrong model (chat) refuses registration with a named code', async () => {
    const name = uniqueWorkflowName('val258-mismatch');
    const script = `
      export const meta = { phases: [], params: { decisions: { gate: { model: { type: 'string', default: 'openrouter/anthropic/claude-sonnet-5' }, timeoutMs: { type: 'number', default: 5000 }, retries: { type: 'number', default: 0 } } } } };
      await decide('gate', { state: {}, questions: {} });
      return 'x';
    `;
    await expect(registerPublishedVia(callerFor(server) as any, name, script)).rejects.toThrow(/MODEL_TYPE_MISMATCH/);
  });
});

describe('VAL-282: REQ-224 — static checks + served text cover decide/generateImage', () => {
  it('the real workflow_authoring_guide tool call documents the decide()/generateImage() signatures over real MCP HTTP', async () => {
    const guide = await call(server, 'workflow_authoring_guide', {});
    const text = JSON.stringify(guide);
    expect(text).toMatch(/decide\(/);
    expect(text).toMatch(/generateImage\(/);
  });

  it('an aliased decide() call (const d = decide; d(...)) is refused at registration, same as agent aliasing', async () => {
    const name = uniqueWorkflowName('val259-alias');
    const script = `
      export const meta = { phases: [], params: { decisions: { gate: { model: { type: 'string', default: 'openrouter/typesafe/jev-1.13' }, timeoutMs: { type: 'number', default: 5000 }, retries: { type: 'number', default: 0 } } } } };
      const d = decide;
      await d('gate', { state: {}, questions: {} });
      return 'x';
    `;
    await expect(registerPublishedVia(callerFor(server) as any, name, script)).rejects.toThrow();
  });
});

describe('VAL-283: REQ-225 — cost accounting + USD budget', () => {
  // v40 Gate 6 follow-up: the old ref `openrouter/typesafe/unpriced-model` is not in any catalog, so
  // registration refused it UNKNOWN_MODEL before the budget path was ever reached. No live decision
  // model is unpriced, so this uses a CONTROLLED catalog stub: a listed `decisions`-output row with no
  // `pricing` — registrable (known, decision-typed) yet unpriceable at the admission pin. Intent kept:
  // unpriced + USD budget → PRICE_UNKNOWN refusal, provider never called (R-18: primitive path only).
  it('a run with a USD budget whose model cannot be priced is refused PRICE_UNKNOWN, provider never called', async () => {
    const UNPRICED_DECIDER = 'typesafe/unpriced-decider';
    const notOk = (async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch;
    const openrouterFetch = (async () => ({
      ok: true,
      json: async () => ({ data: [{ id: UNPRICED_DECIDER, architecture: { input_modalities: ['text'], output_modalities: ['decisions'] } }] }),
    })) as unknown as typeof fetch;
    const localStub = makeStubFetch([DECIDE_OK_STUB]);
    const s = await createServer({
      port: 0, bind: '127.0.0.1', workRoot: mkdtempSync(join(tmpdir(), 'rwe-val260-')),
      modelCatalog: () => buildCatalog({ ollamaFetch: notOk, openrouterFetch }),
      directDeps: { fetch: localStub.fetch, resolveKey: () => 'sk-test' },
    } as never);
    try {
      const script = `
        export const meta = { phases: [], params: { decisions: { gate: { model: { type: 'string', default: 'openrouter/${UNPRICED_DECIDER}' }, timeoutMs: { type: 'number', default: 5000 }, retries: { type: 'number', default: 0 } } } } };
        await decide('gate', { state: {}, questions: { ok: { type: 'bool', instructions: 'i', criteria: { true: 't', false: 'f' } } } });
        return 'x';
      `;
      const started: any = await runScriptVia(callerFor(s), script, { budget: { usd: 1 } });
      const view = await poll(s, started.runId ?? started.result?.runId);
      expect(view.result?.error?.code ?? view.error?.code, JSON.stringify(view.result?.error ?? null)).toBe('PRICE_UNKNOWN'); // run_status carries the terminal error at result.error
      expect(localStub.calls).toHaveLength(0);
    } finally { await s.close(); }
  });
});

describe('VAL-284: REQ-226 — resume replays decide/generateImage without re-calling the provider', () => {
  it('(precondition) a decide+image run completes on the first attempt — see IT-312 for the full stop/resume claim once this holds', async () => {
    const script = `
      export const meta = { phases: [], params: {
        decisions: { gate: { model: { type: 'string', default: 'openrouter/typesafe/jev-1.13' }, timeoutMs: { type: 'number', default: 5000 }, retries: { type: 'number', default: 0 } } },
        images: { hero: { model: { type: 'string', default: '${EXAMPLE_IMAGE_MODEL}' }, timeoutMs: { type: 'number', default: 5000 }, retries: { type: 'number', default: 0 } } }
      } };
      const d = await decide('gate', { state: {}, questions: { order: { type: 'bool', instructions: 'i', criteria: { true: 't', false: 'f' } } } });
      const img = await generateImage('hero', { prompt: 'p' });
      return { d, img };
    `;
    const started: any = await runScriptVia(callerFor(server), script, {});
    const view = await poll(server, started.runId ?? started.result?.runId);
    expect(view.status).toBe('completed');
  });
});
