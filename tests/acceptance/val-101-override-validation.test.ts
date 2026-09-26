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


// v24 (integrator): every case below migrates onto DES-145's PER-AGENT override shape. `UserOverrides`
// is closed to `{agents: {'<label>': {...}}}` — the flat v21 spelling is now refused PARAM_UNKNOWN
// (a v24 improvement: it used to be dropped in silence), which is the code these cases started
// answering. The ORACLES are unchanged: a locked key is still PARAM_LOCKED, an over-ceiling
// timeoutMs is still PARAM_OUT_OF_RANGE, and the never-echo invariant is still asserted against the
// FULL raw wire body. One agent label, `work`, carries the contract for the whole file.
const LABEL = 'work';
function declaredScript(extra = ''): string {
  return [
    'export const meta = { params: { agents: { ' + LABEL + ': {',
    "  model: { type: 'string', default: 'anthropic/claude-haiku-4-5-20251001' },",
    "  effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' },",
    '  timeoutMs: { type: \'number\', default: 60000 }' + (extra ? ',' : ''),
    extra,
    '} } } };',
    "return await agent('" + LABEL + "', { prompt: 'go' });",
  ].filter(Boolean).join('\n');
}

describe('REQ-091: overrides validated against the contract; locked config unreachable (VAL-101)', () => {
  it('overrides:{prompt} → PARAM_LOCKED, no run row appears in workflow_list, no workspace dir on disk', async () => {
    await registerPublishedVia(callTool, 'val101-locked', declaredScript());
    const before = await runCount();

    // A locked key is PARAM_LOCKED at BOTH levels — inside the label block (ADR-001's type-level
    // ban made concrete at the wire) and at the top level of `overrides`.
    const inner = await callTool('run_start', { name: 'val101-locked', overrides: { agents: { [LABEL]: { prompt: 'hijacked' } } } });
    expect(inner.code ?? (inner.error as { code?: string } | undefined)?.code).toBe('PARAM_LOCKED');
    const r = await callTool('run_start', { name: 'val101-locked', overrides: { prompt: 'hijacked' } });
    expect(r.code ?? (r.error as { code?: string } | undefined)?.code).toBe('PARAM_LOCKED');
    expect(await runCount()).toBe(before);
    expect(existsSync(join(tmpDir, 'workflows', 'val101-locked', 'runs'))).toBe(false);
  });

  it('overrides:{timeoutMs: 10_000_000} (out of the engine ceiling) → PARAM_OUT_OF_RANGE, no durable work', async () => {
    await registerPublishedVia(callTool, 'val101-ceiling', declaredScript());
    const before = await runCount();

    const r = await callTool('run_start', { name: 'val101-ceiling', overrides: { agents: { [LABEL]: { timeoutMs: 10_000_000 } } } });
    expect(r.code ?? (r.error as { code?: string } | undefined)?.code).toBe('PARAM_OUT_OF_RANGE');
    expect(await runCount()).toBe(before);
  });

  it('declared args are type/range-checked; undeclared args keys pass through unchanged (backward compat)', async () => {
    const script = `export const meta = { params: { args: { count: { type: 'number', min: 1, max: 5 } } } };\nreturn args;`;
    await registerPublishedVia(callTool, 'val101-args', script);

    const bad = await callTool('run_start', { name: 'val101-args', args: { count: 99 } });
    expect(bad.code ?? (bad.error as { code?: string } | undefined)?.code).toBe('PARAM_OUT_OF_RANGE');

    const okRun = await callTool('run_start', { name: 'val101-args', args: { count: 2, extraUndeclared: 'passthrough' } });
    expect(okRun.code).not.toBe('PARAM_OUT_OF_RANGE');
  });

  it('no overrides at all behaves identically to a pre-v21 run (the run starts normally)', async () => {
    await registerPublishedVia(callTool, 'val101-no-overrides', declaredScript());
    const r = await callTool('run_start', { name: 'val101-no-overrides' });
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
    // v24: an author-declared constraint on appendPrompt now lives on the LABEL's own block
    // (`meta.params.knobs` is refused DEFAULTS_RETIRED, ADR-035) — the constraint and the invariant
    // it protects are identical, only the address moved.
    const script = declaredScript("  appendPrompt: { type: 'string', enum: ['be terse', 'be verbose'] }");
    await registerPublishedVia(callTool, 'val101-append-enum', script);
    const before = await runCount();

    const secret = 'SECRET-MARKER hunter2 api-key=sk-abcdef1234567890';
    const raw = await callToolRaw('run_start', { name: 'val101-append-enum', overrides: { agents: { [LABEL]: { appendPrompt: secret } } } });
    expect(raw).not.toContain(secret);
    expect(raw).not.toContain('hunter2');
    const parsed = JSON.parse(JSON.parse(raw).result.content[0].text) as { error?: { code?: string } };
    expect(parsed.error?.code).toBe('PARAM_OUT_OF_RANGE');
    expect(await runCount()).toBe(before);

    // control: a value INSIDE the declared enum is admitted (the constraint really is enforced,
    // not merely never-echoed-because-never-checked).
    const ok = await callTool('run_start', { name: 'val101-append-enum', overrides: { agents: { [LABEL]: { appendPrompt: 'be terse' } } } });
    expect(typeof ok.runId).toBe('string');
  });
});
