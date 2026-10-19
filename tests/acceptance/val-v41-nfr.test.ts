// VAL-290/291 (v41, REQ-227 delta / REQ-231): the real-entrypoint acceptance lock for this
// iteration's two functional NFR deltas, bound against the real MCP HTTP surface (createServer),
// exactly VAL-285..288's own harness. real:false — flips at Gate 7.5, per "v41 real-tier
// validation paths" (04-design.md).
//
// Red reason (uniform): `direct-models/call.ts` still classifies `network` as not-retryable and
// never races a hung body read against the attempt deadline (REQ-227 delta); `run_agent_log`'s
// AgentRecord/agentFailures never carry the primitive's own failure word+detail consistently
// (REQ-231) — see each case's own comment.
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

async function poll(s: Server, runId: string, maxIter = 300): Promise<any> {
  for (let i = 0; i < maxIter; i++) {
    const st = await call(s, 'run_status', { runId });
    if (['completed', 'failed', 'stopped'].includes(st.status)) return st;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error('run did not settle');
}

let tmpDir: string;
beforeAll(() => { tmpDir = mkdtempSync(join(tmpdir(), 'rwe-val-v41-nfr-')); });
afterAll(() => rmSync(tmpDir, { recursive: true, force: true }));

const QUESTIONS = `{ ok: { type: 'bool', instructions: 'i', criteria: { true: 't', false: 'f' } } }`;
function decideScript(retries: number, timeoutMs = 2000): string {
  return `
    export const meta = { phases: [], params: { decisions: { gate: { model: { type: 'string', default: 'openrouter/typesafe/jev-1.13' }, timeoutMs: { type: 'number', default: ${timeoutMs} }, retries: { type: 'number', default: ${retries} } } } } };
    let msg = null;
    try { await decide('gate', { state: {}, questions: ${QUESTIONS} }); } catch (e) { msg = e.message; }
    return msg ?? 'DID_NOT_FAIL';
  `;
}

describe('VAL-290: REQ-227 (v41 delta) — network is now retried; a hung body read still ends within bound', () => {
  it('two network errors then a 200 -> the run completes (network no longer fails fast)', async () => {
    const stub = makeStubFetch([{ status: 0, networkError: true }, { status: 0, networkError: true }, { status: 200, body: { answers: { ok: { type: 'noul', noul: 0.8 } } } }]);
    const s = await createServer({ port: 0, bind: '127.0.0.1', workRoot: join(tmpDir, 'r227a'), directDeps: { fetch: stub.fetch, resolveKey: () => 'sk-test' } } as never);
    try {
      const started: any = await runScriptVia(callerFor(s), decideScript(2), {});
      const view = await poll(s, started.runId ?? started.result?.runId);
      expect(view.status, JSON.stringify(view.error ?? null)).toBe('completed');
      const result = await call(s, 'run_result', { runId: started.runId ?? started.result?.runId });
      expect(result.result).toBe('DID_NOT_FAIL');
    } finally { await s.close(); }
  }, 20000);

  it('a hung (holdBody) response still ends PRIMITIVE_FAILED{timeout} — not a run that never settles', async () => {
    const stub = makeStubFetch([{ status: 200, holdBody: true }]);
    const s = await createServer({ port: 0, bind: '127.0.0.1', workRoot: join(tmpDir, 'r227b'), directDeps: { fetch: stub.fetch, resolveKey: () => 'sk-test' } } as never);
    try {
      const started: any = await runScriptVia(callerFor(s), decideScript(0, 30), {});
      const view = await poll(s, started.runId ?? started.result?.runId);
      expect(view.status, JSON.stringify(view.error ?? null)).toBe('completed');
      const result = await call(s, 'run_result', { runId: started.runId ?? started.result?.runId });
      const msg = result.result;
      expect(msg).toContain('timeout after');
    } finally { await s.close(); }
  }, 20000);
});

describe('VAL-291: REQ-231 — one failure word across the script, run_agent_log, and agentFailures', () => {
  it('a network-exhausted decide(): e.message, run_agent_log.record, and agentFailures agree', async () => {
    const stub = makeStubFetch([{ status: 0, networkError: true }]);
    const s = await createServer({ port: 0, bind: '127.0.0.1', workRoot: join(tmpDir, 'r231'), directDeps: { fetch: stub.fetch, resolveKey: () => 'sk-test' } } as never);
    try {
      const started: any = await runScriptVia(callerFor(s), decideScript(0), {});
      const runId = started.runId ?? started.result?.runId;
      const view = await poll(s, runId);
      expect(view.status, JSON.stringify(view.error ?? null)).toBe('completed');
      const result = await call(s, 'run_result', { runId });
      const scriptMessage = result.result;
      expect(scriptMessage).toContain('network after');

      const log = await call(s, 'run_agent_log', { runId, label: 'gate' });
      expect(log.record?.detail, 'run_agent_log.record.detail').toBe(scriptMessage);
      expect(log.record?.failReason, 'run_agent_log.record.failReason').toBe('network');

      // run_status nests the run under `result`, and an agentFailures entry is keyed by label (no agentId).
      const failure = (view.result?.agentFailures ?? []).find((f: any) => f.label === 'gate');
      expect(failure, 'no agentFailures entry').toBeDefined();
      expect(failure.message, 'agentFailures[].message').toBe(scriptMessage);
      expect(failure.reason, 'agentFailures[].reason').toBe('network');
    } finally { await s.close(); }
  }, 20000);
});
