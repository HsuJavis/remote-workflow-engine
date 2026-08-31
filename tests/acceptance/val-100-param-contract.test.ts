// VAL-100 (REQ-090): a workflow declares its tunable-parameter contract, discoverable without
// reading the script. Real entrypoint: npm start's composition root (createServer), real MCP HTTP.
//
// Mock policy (acceptance, DES-108): no mocking of the SUT's own boundaries. No LLM dispatch is
// needed for this REQ (registration + discovery only) — no HAS_PROVIDER gate required.
//
// Red reason: meta.params is not parsed/stored/validated anywhere today — every assertion below
// fails against the current engine.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

let server: Server;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-val100-'));
  server = await createServer({
    port: 0, bind: '127.0.0.1', workRoot: tmpDir,
    aliases: { sonnet: { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' }, default: { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' } },
  });
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

describe('REQ-090: tunable-parameter contract, discoverable without reading the script (VAL-100)', () => {
  it('a params block constraining model to an enum + timeoutMs to a ceiling registers; workflow_get returns the structured contract', async () => {
    const script = `export const meta = { params: { knobs: { model: { type: 'enum', enum: ['sonnet'] }, timeoutMs: { type: 'number', max: 60000 } } } };\nreturn 1;`;
    const r = await callTool('workflow_register', { name: 'val100-contract', script });
    expect(r.error).toBeUndefined();

    const got = await callTool('workflow_get', { name: 'val100-contract' });
    const params = (got as { params?: { knobs?: Record<string, { enum?: string[]; max?: number }> } }).params;
    expect(params?.knobs?.['model']?.enum).toEqual(['sonnet']);
    expect(params?.knobs?.['timeoutMs']?.max).toBe(60_000);
  });

  it('workflow_list also surfaces the declared contract per entry, without reading the script body', async () => {
    const list = await callTool('workflow_list', {}) as { result?: Array<{ name?: string; params?: unknown }> };
    const entry = list.result?.find((e) => e.name === 'val100-contract');
    expect(entry?.params).toBeDefined();
  });

  it('a params block naming a LOCKED key (mcp) is rejected; nothing is stored (fail-closed)', async () => {
    const script = `export const meta = { params: { knobs: { mcp: { type: 'string' } } } };\nreturn 1;`;
    const r = await callTool('workflow_register', { name: 'val100-locked', script });
    expect(r.error).toBeDefined();
    const got = await callTool('workflow_get', { name: 'val100-locked' });
    expect(got.code).toBe('WORKFLOW_NOT_FOUND');
  });

  it('a script with no params block still registers (backward compatible) and reads back the canonical 4-knob contract', async () => {
    const r = await callTool('workflow_register', { name: 'val100-no-block', script: 'return 1;' });
    expect(r.error).toBeUndefined();
    const got = await callTool('workflow_get', { name: 'val100-no-block' });
    const knobs = (got as { params?: { knobs?: Record<string, unknown> } }).params?.knobs ?? {};
    expect(Object.keys(knobs).sort()).toEqual(['appendPrompt', 'effort', 'model', 'timeoutMs'].sort());
  });
});
