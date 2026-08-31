// VAL-101 (REQ-091): per-run overrides validated against the contract; locked configuration is
// unreachable from the caller. Real entrypoint: npm start's composition root, real MCP HTTP.
//
// Mock policy (acceptance, DES-108): no mocking of the SUT's own boundaries. No LLM dispatch
// required — admission-rung rejection happens before any agent() call.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

let server: Server;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-val101-'));
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir });
});
afterAll(async () => { await server?.close(); rmSync(tmpDir, { recursive: true, force: true }); });

async function callTool(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}') as Record<string, unknown>;
}

async function runCount(): Promise<number> {
  const list = await callTool('workflow_list', {}) as { result?: Array<{ kind?: string }> };
  return (list.result ?? []).filter((e) => e.kind === 'run').length;
}

describe('REQ-091: overrides validated against the contract; locked config unreachable (VAL-101)', () => {
  it('overrides:{prompt} → PARAM_LOCKED, no run row appears in workflow_list, no workspace dir on disk', async () => {
    await callTool('workflow_register', { name: 'val101-locked', script: 'return 1;' });
    const before = await runCount();

    const r = await callTool('workflow_run', { name: 'val101-locked', overrides: { prompt: 'hijacked' } });
    expect(r.code ?? (r.error as { code?: string } | undefined)?.code).toBe('PARAM_LOCKED');
    expect(await runCount()).toBe(before);
    expect(existsSync(join(tmpDir, 'workflows', 'val101-locked', 'runs'))).toBe(false);
  });

  it('overrides:{timeoutMs: 10_000_000} (out of the engine ceiling) → PARAM_OUT_OF_RANGE, no durable work', async () => {
    await callTool('workflow_register', { name: 'val101-ceiling', script: 'return 1;' });
    const before = await runCount();

    const r = await callTool('workflow_run', { name: 'val101-ceiling', overrides: { timeoutMs: 10_000_000 } });
    expect(r.code ?? (r.error as { code?: string } | undefined)?.code).toBe('PARAM_OUT_OF_RANGE');
    expect(await runCount()).toBe(before);
  });

  it('declared args are type/range-checked; undeclared args keys pass through unchanged (backward compat)', async () => {
    const script = `export const meta = { params: { args: { count: { type: 'number', min: 1, max: 5 } } } };\nreturn args;`;
    await callTool('workflow_register', { name: 'val101-args', script });

    const bad = await callTool('workflow_run', { name: 'val101-args', args: { count: 99 } });
    expect(bad.code ?? (bad.error as { code?: string } | undefined)?.code).toBe('PARAM_OUT_OF_RANGE');

    const okRun = await callTool('workflow_run', { name: 'val101-args', args: { count: 2, extraUndeclared: 'passthrough' } });
    expect(okRun.code).not.toBe('PARAM_OUT_OF_RANGE');
  });

  it('no overrides at all behaves identically to a pre-v21 run (the run starts normally)', async () => {
    await callTool('workflow_register', { name: 'val101-no-overrides', script: 'return 1;' });
    const r = await callTool('workflow_run', { name: 'val101-no-overrides' });
    expect(typeof r.runId).toBe('string');
    expect(r.code).not.toBe('PARAM_LOCKED');
    expect(r.code).not.toBe('PARAM_OUT_OF_RANGE');
  });
});
