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
import Database from 'better-sqlite3';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { registerPublishedVia } from '../helpers/workflow-fixtures.js';

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

async function callToolRaw(name: string, args: Record<string, unknown>): Promise<{ result?: { content?: Array<{ text?: string }> }; error?: { code?: number; message?: string } }> {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  return await res.json() as { result?: { content?: Array<{ text?: string }> }; error?: { code?: number; message?: string } };
}

async function callTool(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const body = await callToolRaw(name, args);
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}') as Record<string, unknown>;
}

describe('REQ-090: tunable-parameter contract, discoverable without reading the script (VAL-100)', () => {
  it('a params block constraining model to an enum + timeoutMs to a ceiling registers; workflow_get returns the structured contract', async () => {
    const script = `export const meta = { params: { knobs: { model: { type: 'enum', enum: ['sonnet'] }, timeoutMs: { type: 'number', max: 60000 } } } };\nreturn 1;`;
    // v22 (REQ-097/DES-110): `workflow_get({name})` with no version selector resolves the RELEASE
    // channel, so a registered-but-unpublished draft reads back CHANNEL_UNPUBLISHED instead of its
    // contract. registerPublishedVia does register+publish; it throws (naming the code) if either
    // leg comes back failed, which is the `expect(r.error).toBeUndefined()` setup guard it replaces.
    await registerPublishedVia(callTool, 'val100-contract', script);

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
    await registerPublishedVia(callTool, 'val100-no-block', 'return 1;');
    const got = await callTool('workflow_get', { name: 'val100-no-block' });
    const knobs = (got as { params?: { knobs?: Record<string, unknown> } }).params?.knobs ?? {};
    expect(Object.keys(knobs).sort()).toEqual(['appendPrompt', 'effort', 'model', 'timeoutMs'].sort());
  });
});

// v21 Gate 8 RE-REVIEW #4 (review §Q5/§Q7 A1, BLOCKING HIGH, real-tier per REQ-090's own
// "discoverable without reading the script" acceptance): a malformed `params.knobs` shape (a
// declared `enum` that is not an array) must be refused typed at registration with NOTHING stored
// (same fail-closed precedent as the existing LOCKED-key case above) — AND a row that reached
// storage BEFORE this guard existed (seeded directly against `catalog.db`, simulating a live
// deployment's pre-fix data) must not durably break `workflow_get` for that workflow, nor
// `workflow_list` for every OTHER registered workflow. Today: the malformed shape registers
// successfully (no shape guard exists — see A1 half 1's unit-level pin), and a poisoned row throws
// `TypeError: authorEnum.filter is not a function` inside `boundEffort`, which server.ts's generic
// `tools/call` catch turns into a JSON-RPC `error.code:-32000` — the "untyped 500" the review names
// (never the engine's own typed PARAM_CONTRACT_INVALID/PARAM_OUT_OF_RANGE vocabulary).
describe('REQ-090 real-tier: a malformed/poisoned params contract must not durably break workflow discovery (v21 Gate 8 RE-REVIEW #4, A1)', () => {
  it('a params.knobs.effort with a non-array enum is rejected typed at registration; nothing is stored (today: registers successfully)', async () => {
    const script = `export const meta = { params: { knobs: { effort: { type: 'enum', enum: 'abc' } } } };\nreturn 1;`;
    const r = await callTool('workflow_register', { name: 'val100-poison-attempt', script });
    expect(r.error).toBeDefined();
    const got = await callTool('workflow_get', { name: 'val100-poison-attempt' });
    expect(got.code).toBe('WORKFLOW_NOT_FOUND');
  });

  it('a pre-existing poisoned row (seeded directly against catalog.db, simulating data written before the registration guard existed) does not crash workflow_get, nor break workflow_list for a sibling healthy workflow (today: JSON-RPC error.code:-32000 "authorEnum.filter is not a function")', async () => {
    // A healthy sibling MUST still be discoverable after the poisoned entry is introduced.
    await callTool('workflow_register', { name: 'val100-poison-sibling', script: 'return 1;' });

    // Seed the poisoned row directly — bypasses workflow_register (and thus the half-1 guard
    // entirely), the only way a shape like this could ever have reached storage.
    const raw = new Database(join(tmpDir, 'catalog.db'));
    const poisonedParams = JSON.stringify({
      knobs: {
        model: { type: 'string' },
        effort: { type: 'enum', enum: 'abc' }, // non-array — the exact poison shape
        timeoutMs: { type: 'number' },
        appendPrompt: { type: 'string' },
      },
      args: {},
    });
    // v22 (DES-109/DES-111): script/version/defaults/params moved off `workflows` into
    // `workflow_versions`, and the channel pointer lives in `workflows.release_version`. Seeded in
    // the CURRENT schema (same technique as val-109's grandfathered-row fixture) so the poisoned
    // `params` value still reaches storage by the only route that could ever have written it.
    const now100 = new Date().toISOString();
    raw.prepare('INSERT INTO workflows (name, createdAt, owner, release_version) VALUES (?, ?, NULL, ?)')
      .run('val100-poisoned', now100, 'v1');
    raw.prepare('INSERT INTO workflow_versions (name, version, script, createdAt, defaults, params) VALUES (?, ?, ?, ?, NULL, ?)')
      .run('val100-poisoned', 'v1', 'return 1;', now100, poisonedParams);
    raw.close();

    // workflow_get on the poisoned entry itself must not degrade into a transport-level JSON-RPC
    // error (error.code -32000/-32603) — the engine's own typed vocabulary or a total canonical
    // fallback, never an uncaught TypeError escaping to the tool boundary.
    const getBody = await callToolRaw('workflow_get', { name: 'val100-poisoned' });
    expect(getBody.error).toBeUndefined();

    // workflow_list must keep listing every OTHER workflow — one poisoned entry must not be a
    // durable, engine-wide denial of workflow discovery.
    const listBody = await callToolRaw('workflow_list', {});
    expect(listBody.error).toBeUndefined();
    const list = JSON.parse(listBody.result?.content?.[0]?.text ?? '{}') as { result?: Array<{ name?: string }> };
    expect(list.result?.map((e) => e.name)).toContain('val100-poison-sibling');
  });

  // The sibling of the poisoned-`enum` case above, travelling the `max` path instead of the `enum`
  // path. Its failure mode is quieter and worse than a crash: a non-number stored `max` puts NaN
  // into the bound (`Math.min("abc", 600000)` === NaN), and every comparison involving NaN is
  // false — so the admission check `value > max` silently passes and the knob becomes unbounded,
  // a ceiling BYPASS, while `workflow_get` advertises `null` for the same bound. Seeded the same
  // way as the case above (written straight to the catalog column, the only way this shape could
  // have reached storage before the registration guard existed).
  it('a poisoned row whose `timeoutMs.max`/`appendPrompt.max` are not numbers reads back as the ENGINE CEILING, never null/NaN (a NaN bound is a silent ceiling bypass)', async () => {
    const raw = new Database(join(tmpDir, 'catalog.db'));
    const poisonedParams = JSON.stringify({
      knobs: {
        model: { type: 'string' },
        effort: { type: 'enum' },
        timeoutMs: { type: 'number', max: 'abc' }, // non-number max — the poison shape
        appendPrompt: { type: 'string', max: 'xyz' },
      },
      args: {},
    });
    const nowMax = new Date().toISOString();
    raw.prepare('INSERT INTO workflows (name, createdAt, owner, release_version) VALUES (?, ?, NULL, ?)')
      .run('val100-poisoned-max', nowMax, 'v1');
    raw.prepare('INSERT INTO workflow_versions (name, version, script, createdAt, defaults, params) VALUES (?, ?, ?, ?, NULL, ?)')
      .run('val100-poisoned-max', 'v1', 'return 1;', nowMax, poisonedParams);
    raw.close();

    const getBody = await callToolRaw('workflow_get', { name: 'val100-poisoned-max' });
    expect(getBody.error).toBeUndefined();
    const got = JSON.parse(getBody.result?.content?.[0]?.text ?? '{}') as
      { params?: { knobs?: Record<string, { max?: unknown }> } };
    // createServer's defaults for this test server: maxTimeoutMs 600_000, maxAppendPromptBytes 1024.
    expect(got.params?.knobs?.['timeoutMs']?.max).toBe(600_000);
    expect(got.params?.knobs?.['appendPrompt']?.max).toBe(1024);
  });
});
