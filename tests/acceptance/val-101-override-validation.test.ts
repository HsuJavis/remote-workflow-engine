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
import { registerPublishedVia } from '../helpers/workflow-fixtures.js';

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

async function callToolRaw(name: string, args: Record<string, unknown>): Promise<string> {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  return res.text(); // the FULL wire body — not just whatever fields the parsed-object assertions look at
}

describe('REQ-091: overrides validated against the contract; locked config unreachable (VAL-101)', () => {
  it('overrides:{prompt} → PARAM_LOCKED, no run row appears in workflow_list, no workspace dir on disk', async () => {
    await registerPublishedVia(callTool, 'val101-locked', 'return 1;');
    const before = await runCount();

    const r = await callTool('workflow_run', { name: 'val101-locked', overrides: { prompt: 'hijacked' } });
    expect(r.code ?? (r.error as { code?: string } | undefined)?.code).toBe('PARAM_LOCKED');
    expect(await runCount()).toBe(before);
    expect(existsSync(join(tmpDir, 'workflows', 'val101-locked', 'runs'))).toBe(false);
  });

  it('overrides:{timeoutMs: 10_000_000} (out of the engine ceiling) → PARAM_OUT_OF_RANGE, no durable work', async () => {
    await registerPublishedVia(callTool, 'val101-ceiling', 'return 1;');
    const before = await runCount();

    const r = await callTool('workflow_run', { name: 'val101-ceiling', overrides: { timeoutMs: 10_000_000 } });
    expect(r.code ?? (r.error as { code?: string } | undefined)?.code).toBe('PARAM_OUT_OF_RANGE');
    expect(await runCount()).toBe(before);
  });

  it('declared args are type/range-checked; undeclared args keys pass through unchanged (backward compat)', async () => {
    const script = `export const meta = { params: { args: { count: { type: 'number', min: 1, max: 5 } } } };\nreturn args;`;
    await registerPublishedVia(callTool, 'val101-args', script);

    const bad = await callTool('workflow_run', { name: 'val101-args', args: { count: 99 } });
    expect(bad.code ?? (bad.error as { code?: string } | undefined)?.code).toBe('PARAM_OUT_OF_RANGE');

    const okRun = await callTool('workflow_run', { name: 'val101-args', args: { count: 2, extraUndeclared: 'passthrough' } });
    expect(okRun.code).not.toBe('PARAM_OUT_OF_RANGE');
  });

  it('no overrides at all behaves identically to a pre-v21 run (the run starts normally)', async () => {
    await registerPublishedVia(callTool, 'val101-no-overrides', 'return 1;');
    const r = await callTool('workflow_run', { name: 'val101-no-overrides' });
    expect(typeof r.runId).toBe('string');
    expect(r.code).not.toBe('PARAM_LOCKED');
    expect(r.code).not.toBe('PARAM_OUT_OF_RANGE');
  });

  // v21 Gate 7.5 ROUND 3 (post-IMPL-144/997626d): DES-101 row 6's "an appendPrompt rejection never
  // echoes the caller's text" invariant also holds when the constraint violated is an AUTHOR-
  // DECLARED `enum` on appendPrompt (not just the byte ceiling VAL-104 already covers) — the
  // adjacent leak path 997626d closed. Asserted against the FULL raw wire body, not just the
  // parsed fields the other cases check, so a leak anywhere in the response (a `detail`/`supplied`
  // key this test doesn't know to look for by name) would still fail it.
  it('overrides:{appendPrompt} outside an author-declared enum → PARAM_OUT_OF_RANGE; the caller text never appears anywhere in the wire response, no durable work', async () => {
    const script = `export const meta = { params: { knobs: { appendPrompt: { type: 'string', enum: ['be terse', 'be verbose'] } } } };\nreturn 1;`;
    await registerPublishedVia(callTool, 'val101-append-enum', script);
    const before = await runCount();

    const secret = 'SECRET-MARKER hunter2 api-key=sk-abcdef1234567890';
    const raw = await callToolRaw('workflow_run', { name: 'val101-append-enum', overrides: { appendPrompt: secret } });
    expect(raw).not.toContain(secret);
    expect(raw).not.toContain('hunter2');
    const parsed = JSON.parse(JSON.parse(raw).result.content[0].text) as { error?: { code?: string } };
    expect(parsed.error?.code).toBe('PARAM_OUT_OF_RANGE');
    expect(await runCount()).toBe(before);

    // control: a value INSIDE the declared enum is admitted (the constraint really is enforced,
    // not merely never-echoed-because-never-checked).
    const ok = await callTool('workflow_run', { name: 'val101-append-enum', overrides: { appendPrompt: 'be terse' } });
    expect(typeof ok.runId).toBe('string');
  });
});
