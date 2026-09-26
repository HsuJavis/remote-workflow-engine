// IT (DES-239, ARCH-147/151/152/154/143, TASK-237, REQ-206/207/209/210): the advertised surface —
// (a) `workflow_describe`'s `timeoutMs.attempts`/`worstCaseMs` are COMPUTED from the deployed
// `retries`, forwarded through the composition root to `McpFacade`; (b) BOTH `initialize` results
// (the auth-gated `/mcp` handler and the D-BIND-exempt one) carry `instructions` containing
// `ENVELOPE_NOTE` and a guide-size byte figure the test computes itself from the SAME tool-result
// object a caller receives. Written test-first (Gate 5, RED) — `workflow_describe`'s `timeoutMs`
// carries no `attempts`/`worstCaseMs` today, `retries` never reaches `McpFacade`, and neither
// `initialize` result carries an `instructions` field at all.
//
// Mock policy (integration): real `createServer()`, real MCP HTTP — no mocks.
import { describe, it, expect, afterEach } from 'vitest';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { registerPublishedVia, type ToolCaller } from '../helpers/workflow-fixtures.js';

function callerFor(baseUrl: string): ToolCaller {
  return async (name, args) => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
    const body = (await res.json()) as { result?: { content: Array<{ text: string }> }; error?: unknown };
    if (!body.result) throw new Error(`tool call ${name} failed: ${JSON.stringify(body.error)}`);
    return JSON.parse(body.result.content[0]!.text);
  };
}

async function initialize(baseUrl: string): Promise<{ result?: { instructions?: string; protocolVersion?: string } }> {
  const res = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } }),
  });
  return res.json() as Promise<{ result?: { instructions?: string; protocolVersion?: string } }>;
}

const AGENT_SCRIPT =
  "export const meta = { params: { agents: { worker: { model: { type: 'string', default: 'anthropic/claude-haiku-4-5-20251001' }, " +
  "effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } } } } };\n" +
  "phase('main');\nreturn await agent('worker', {});";

let server: Server | undefined;
afterEach(async () => { await server?.close(); server = undefined; });

describe('workflow_describe advertises COMPUTED attempts/worstCaseMs from the deployed retries (DES-239a, IT)', () => {
  it('a deployed retries:3 changes the advertised attempts/worstCaseMs for a declared 60000ms timeout', async () => {
    server = await createServer({ port: 0, bind: '127.0.0.1', retries: 3 });
    const baseUrl = `http://127.0.0.1:${server.port}`;
    const call = callerFor(baseUrl);
    await registerPublishedVia(call, 'it239-retries', AGENT_SCRIPT);
    const described = (await call('workflow_describe', { name: 'it239-retries' })) as {
      result?: { params?: { agents?: Record<string, { timeoutMs?: { attempts?: number; worstCaseMs?: number } }> } };
    };
    const timeoutMs = described.result?.params?.agents?.['worker']?.timeoutMs;
    expect(timeoutMs?.attempts).toBe(4); // 1 + max(0, 3)
    expect(timeoutMs?.worstCaseMs).toBe(60000 * 4);
  });

  it('the DEFAULT deployment (no retries configured) advertises a DIFFERENT number than retries:3 (the wiring sweep)', async () => {
    server = await createServer({ port: 0, bind: '127.0.0.1' }); // default retries
    const baseUrl = `http://127.0.0.1:${server.port}`;
    const call = callerFor(baseUrl);
    await registerPublishedVia(call, 'it239-default-retries', AGENT_SCRIPT);
    const described = (await call('workflow_describe', { name: 'it239-default-retries' })) as {
      result?: { params?: { agents?: Record<string, { timeoutMs?: { attempts?: number; worstCaseMs?: number } }> } };
    };
    const timeoutMs = described.result?.params?.agents?.['worker']?.timeoutMs;
    // deployed default is retries:1 -> attempts = 1 + max(0,1) = 2, worstCaseMs = 120000 — DIFFERENT
    // from the retries:3 case above (attempts:4) — proves the number actually moves with config,
    // not a value baked in at either end.
    expect(timeoutMs?.attempts).toBe(2);
    expect(timeoutMs?.worstCaseMs).toBe(60000 * 2);
  });
});

describe('BOTH initialize results carry instructions with ENVELOPE_NOTE and a COMPUTED guide size (DES-239b, IT)', () => {
  it('site 1 (auth-gated /mcp handler, default loopback bind): instructions present with the byte figure matching the actual served guide result', async () => {
    server = await createServer({ port: 0, bind: '127.0.0.1' });
    const baseUrl = `http://127.0.0.1:${server.port}`;
    const initResult = await initialize(baseUrl);
    const instructions = initResult.result?.instructions ?? '';
    expect(instructions).toMatch(/content\[0\]\.text/i);

    const guideRes = await fetch(`${baseUrl}/mcp`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'workflow_authoring_guide', arguments: {} } }),
    });
    const guideBody = await guideRes.json();
    const computedBytes = Buffer.byteLength(JSON.stringify((guideBody as { result: unknown }).result));
    expect(instructions).toContain(String(computedBytes));
  });

  it('site 2 (D-BIND-exempt handler, bind 0.0.0.0 + loopback caller): instructions ALSO present, same shape', async () => {
    server = await createServer({ port: 0, bind: '0.0.0.0' });
    const baseUrl = `http://127.0.0.1:${server.port}`; // loopback CALLER against a non-loopback BIND -> dbindExempt path
    const initResult = await initialize(baseUrl);
    const instructions = initResult.result?.instructions ?? '';
    expect(instructions).toMatch(/content\[0\]\.text/i);
  });
});
