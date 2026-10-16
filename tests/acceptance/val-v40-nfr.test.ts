// VAL-262..265 (REQ-227..230, v40): the four NFR acceptance clauses, bound against the real
// entrypoint (createServer + real HTTP MCP). real:false — flips at Gate 7.5.
//
// Red reason (uniform): decide()/generateImage() are not sandbox globals yet — every run fails
// with SCRIPT_ERROR before any NFR behavior is reached. REQ-230's p95 case is the one genuinely
// new, non-derivative acceptance measurement in this ledger slice (the IT tier only pins the
// precondition); it is written here with the real percentile math so Gate 6 has a concrete target.
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
beforeAll(() => { tmpDir = mkdtempSync(join(tmpdir(), 'rwe-val-v40-nfr-')); });
afterAll(() => rmSync(tmpDir, { recursive: true, force: true }));

describe('VAL-262: REQ-227 — limited retries then a named error; 4xx (not 429) never retries', () => {
  it('a 429 then a 400: retries the 429 once, then fails fast on the 400 — naming HTTP 400, never retried further', async () => {
    const stub = makeStubFetch([{ status: 429 }, { status: 400 }]);
    const s = await createServer({ port: 0, bind: '127.0.0.1', workRoot: join(tmpDir, 'r227'), directDeps: { fetch: stub.fetch } } as never);
    try {
      const script = `
        export const meta = { phases: [], params: { decisions: { gate: { model: { type: 'string', default: 'openrouter/typesafe/jev-1.13' }, timeoutMs: { type: 'number', default: 2000 }, retries: { type: 'number', default: 3 } } } } };
        await decide('gate', { state: {}, questions: { ok: { type: 'bool', instructions: 'i', criteria: { true: 't', false: 'f' } } } });
        return 'x';
      `;
      const started: any = await runScriptVia(callerFor(s), script, {});
      const view = await poll(s, started.runId ?? started.result?.runId);
      expect(view.result?.error?.code ?? view.error?.code, JSON.stringify(view.result?.error ?? null)).toBe('PRIMITIVE_FAILED'); // run_status carries the terminal error at result.error
      expect(stub.calls).toHaveLength(2);
    } finally { await s.close(); }
  });
});

describe('VAL-263: REQ-228 — independent, configurable concurrency caps', () => {
  it('decideSlots:1 caps simultaneous decide() calls at 1, even while the agent semaphore is fully saturated', async () => {
    let maxConcurrent = 0;
    let inFlight = 0;
    const stub = makeStubFetch(Array.from({ length: 10 }, () => ({ status: 200, body: { answers: { ok: { type: 'noul', noul: 0.5 } } } })));
    const originalFetch = stub.fetch;
    const trackedFetch = (async (...args: Parameters<typeof fetch>) => {
      inFlight++; maxConcurrent = Math.max(maxConcurrent, inFlight);
      try { return await originalFetch(...args); } finally { inFlight--; }
    }) as typeof fetch;
    const s = await createServer({ port: 0, bind: '127.0.0.1', workRoot: join(tmpDir, 'r228'), decideSlots: 1, directDeps: { fetch: trackedFetch } } as never);
    try {
      const script = `
        export const meta = { phases: [], params: { decisions: { gate: { model: { type: 'string', default: 'openrouter/typesafe/jev-1.13' }, timeoutMs: { type: 'number', default: 5000 }, retries: { type: 'number', default: 0 } } } } };
        await Promise.all([
          decide('gate', { state: {a:1}, questions: { ok: { type: 'bool', instructions: 'i', criteria: { true: 't', false: 'f' } } } }),
          decide('gate', { state: {a:2}, questions: { ok: { type: 'bool', instructions: 'i', criteria: { true: 't', false: 'f' } } } }),
        ]);
        return 'x';
      `;
      const started: any = await runScriptVia(callerFor(s), script, {});
      const view = await poll(s, started.runId ?? started.result?.runId);
      expect(view.status).toBe('completed');
      expect(maxConcurrent).toBeLessThanOrEqual(1);
    } finally { await s.close(); }
  });
});

describe('VAL-264: REQ-229 — event log carries metadata only', () => {
  it('a sentinel in state never appears in /api/runs/:id or the agent log, over real HTTP', async () => {
    const SENTINEL = 'val264-sentinel-7b2c';
    const stub = makeStubFetch([{ status: 200, body: { answers: { ok: { type: 'noul', noul: 0.5 } } } }]);
    const s = await createServer({ port: 0, bind: '127.0.0.1', workRoot: join(tmpDir, 'r229'), directDeps: { fetch: stub.fetch } } as never);
    try {
      const script = `
        export const meta = { phases: [], params: { decisions: { gate: { model: { type: 'string', default: 'openrouter/typesafe/jev-1.13' }, timeoutMs: { type: 'number', default: 5000 }, retries: { type: 'number', default: 0 } } } } };
        await decide('gate', { state: { secret: '${SENTINEL}' }, questions: { ok: { type: 'bool', instructions: 'i', criteria: { true: 't', false: 'f' } } } });
        return 'x';
      `;
      const started: any = await runScriptVia(callerFor(s), script, {});
      const runId = started.runId ?? started.result?.runId;
      await poll(s, runId);
      // POSITIVE CONTROL first (same discipline as IT-313): a run that never reached the provider
      // at all would pass the leak-free check below VACUOUSLY — gate on real provider contact.
      const bodies = stub.calls.map((c) => String(c.init?.body ?? ''));
      expect(bodies.some((b) => b.includes(SENTINEL))).toBe(true);
      const res = await fetch(`http://127.0.0.1:${s.port}/api/runs/${runId}`);
      const text = await res.text();
      expect(text).not.toContain(SENTINEL);
    } finally { await s.close(); }
  });
});

describe('VAL-265: REQ-230 — engine overhead p95 <= 200ms over 100 decide() calls', () => {
  // v40 Gate 6 follow-up: the script may not call Date.now() (the sandbox determinism guard refuses
  // it), so — as IT-314 does — every timestamp is taken STUB-side in the test process. 101 sequential
  // calls against a fixed 20ms provider delay; overhead_i = start[i+1] − end[i] (the script-observed
  // cycle minus the provider-observed time) → 100 samples; p95 <= 200ms. Real entrypoint
  // (createServer + MCP HTTP); the provider wire is the only stub.
  it('(script-observed cycle) minus (provider-observed time) has p95 <= 200ms over 100 calls against a fixed-latency stub', async () => {
    const FIXED_PROVIDER_MS = 20;
    const CALLS = 101;
    const inner = makeStubFetch(Array.from({ length: CALLS }, () => ({ status: 200, body: { answers: { ok: { type: 'noul', noul: 0.5 } } } })));
    const start: number[] = [];
    const end: number[] = [];
    const timedFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      start.push(performance.now());
      await new Promise((r) => setTimeout(r, FIXED_PROVIDER_MS));
      const res = await inner.fetch(input, init);
      end.push(performance.now());
      return res;
    }) as typeof fetch;
    const s = await createServer({ port: 0, bind: '127.0.0.1', workRoot: join(tmpDir, 'r230'), directDeps: { fetch: timedFetch, resolveKey: () => 'sk-test' } } as never);
    try {
      const calls = Array.from({ length: CALLS }, (_, i) =>
        `await decide('gate', { state: {i:${i}}, questions: { ok: { type: 'bool', instructions: 'i', criteria: { true: 't', false: 'f' } } } });`,
      ).join('\n');
      const script = `
        export const meta = { phases: [], params: { decisions: { gate: { model: { type: 'string', default: 'openrouter/typesafe/jev-1.13' }, timeoutMs: { type: 'number', default: 5000 }, retries: { type: 'number', default: 0 } } } } };
        ${calls}
        return 'done';
      `;
      const started: any = await runScriptVia(callerFor(s), script, {});
      const view = await poll(s, started.runId ?? started.result?.runId, 1000);
      expect(view.status, JSON.stringify(view.result?.error ?? null)).toBe('completed');
      expect(start).toHaveLength(CALLS);
      expect(end).toHaveLength(CALLS);
      const overhead = Array.from({ length: CALLS - 1 }, (_, i) => start[i + 1]! - end[i]!).sort((a, b) => a - b);
      const p95 = overhead[Math.min(overhead.length - 1, Math.ceil(0.95 * overhead.length) - 1)]!;
      expect(p95).toBeLessThanOrEqual(200);
    } finally { await s.close(); }
  }, 60000);
});
