// VAL-100 (REQ-090): a workflow declares its tunable-parameter contract, discoverable without
// reading the script. Real entrypoint: npm start's composition root (createServer), real MCP HTTP.
//
// Mock policy (acceptance, DES-108): no mocking of the SUT's own boundaries. No LLM dispatch is
// needed for this REQ (registration + discovery only) — no HAS_PROVIDER gate required.
//
// v24 (TASK-152, DES-144/DES-146/DES-159): the single-script-wide meta.params dot-knobs contract
// this file pinned is ARCHITECTURALLY RETIRED, not renamed — DES-159 explicitly deletes "the 'no
// meta ⇒ canonical contract' branch" and DES-146 deletes the `'call'`/`'agentType'` resolution
// rungs a script-wide knobs block fed. Per-agent parameters now live at
// `meta.params.agents.<label>` (mandatory per label, DES-144) — there is no more one contract
// governing every `agent()` call in a script uniformly. Three of the original five cases had no
// v24 subject left and are REMOVED (not re-pointed at a differently-shaped tool, matching the
// DES-159 [T3] discipline):
//  - "a meta.params dot-knobs block registers; workflow_source returns the structured contract" — the
//    `knobs` shape itself is retired (`DEFAULTS_RETIRED` at registration, DES-144).
//  - "workflow_list also surfaces the declared contract" — the read-side projection changed shape
//    (`params.agents.<label>`, DES-156, TASK-149) — a different task's [T3] rewrite target.
//  - "a script with no params block reads back the canonical 4-knob contract" — that IS the
//    deleted "no meta ⇒ canonical contract" branch (DES-159); a zero-label script now yields
//    `{agents:{}, args:{}}` (DES-144), not four knobs.
//  - "a LOCKED key (mcp) is rejected at REGISTRATION" also had no v24 subject: `LOCKED_KEYS` is
//    enforced ONLY at `run_start` override time (`contract.ts`'s `validateOneAgentOverride`, DES-145)
//    — registration (`parseParamContract`) never references `LOCKED_KEYS` at all, and `mcp` is
//    itself a LEGITIMATE `AgentParamSpec` declaration field in v24 (an agent's allowed MCP names),
//    not a locked one. Removed rather than asserting a registration-time refusal that doesn't exist.
//
// What survives (verified against the real engine, TASK-152): the v21 Gate 8 poisoned-row
// resilience property. A `knobs`-shaped row can still reach `workflow_versions.params` today by
// the same route that motivated the original guard — a row written before any registration guard
// existed (real deployments upgrading from pre-v24). Confirmed live: the engine does NOT crash on
// it (`workflow_source`/`workflow_list` both return cleanly; the legacy `params` value is silently
// ignored, projected as `{agents:{}, args:{}}`) and a sibling workflow stays fully discoverable.
// DES-144 names this exact shape `runnable:false, runnableReason:'LEGACY_REREGISTER'` — NOT YET
// WIRED in `src/` today (no reference anywhere), so that specific field is not asserted here; only
// the "does not crash, sibling unaffected" floor this file has always guarded. Reported as an open
// TASK-136/149 wiring gap, not fabricated.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
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

// v21 Gate 8 RE-REVIEW #4 (review §Q5/§Q7 A1, BLOCKING HIGH, real-tier per REQ-090's own
// "discoverable without reading the script" acceptance): a malformed/poisoned params shape that
// reached storage BEFORE any registration guard existed (simulating a live deployment's pre-fix
// data) must not durably break `workflow_source` for that workflow, nor `workflow_list` for every
// OTHER registered workflow.
describe('REQ-090 real-tier: a malformed/poisoned params contract must not durably break workflow discovery (v21 Gate 8 RE-REVIEW #4, A1)', () => {
  it('a pre-existing poisoned row (seeded directly against catalog.db, simulating data written before the registration guard existed) does not crash workflow_source, nor break workflow_list for a sibling healthy workflow', async () => {
    // A healthy sibling MUST still be discoverable after the poisoned entry is introduced.
    const sib = await callTool('workflow_register', { name: 'val100-poison-sibling', script: 'return 1;', mermaid: 'graph TD;' });
    expect(sib['error']).toBeUndefined();

    // Seed the poisoned row directly — bypasses workflow_register (and thus any registration-time
    // guard entirely), the only way this pre-v24 shape could ever reach storage now.
    const raw = new Database(join(tmpDir, 'catalog.db'));
    const poisonedParams = JSON.stringify({
      knobs: {
        model: { type: 'string' },
        effort: { type: 'enum', enum: 'abc' }, // non-array — the exact v21 poison shape
        timeoutMs: { type: 'number' },
        appendPrompt: { type: 'string' },
      },
      args: {},
    });
    const now100 = new Date().toISOString();
    raw.prepare('INSERT INTO workflows (name, createdAt, owner, release_version) VALUES (?, ?, NULL, ?)')
      .run('val100-poisoned', now100, 'v1');
    raw.prepare('INSERT INTO workflow_versions (name, version, script, createdAt, defaults, params) VALUES (?, ?, ?, ?, NULL, ?)')
      .run('val100-poisoned', 'v1', 'return 1;', now100, poisonedParams);
    raw.close();

    // workflow_source on the poisoned entry itself must not degrade into a transport-level JSON-RPC
    // error (error.code -32000/-32603) — the engine's own typed vocabulary or a total canonical
    // fallback, never an uncaught TypeError escaping to the tool boundary.
    const getBody = await callToolRaw('workflow_source', { name: 'val100-poisoned' });
    expect(getBody.error).toBeUndefined();

    // workflow_list must keep listing every OTHER workflow — one poisoned entry must not be a
    // durable, engine-wide denial of workflow discovery.
    const listBody = await callToolRaw('workflow_list', {});
    expect(listBody.error).toBeUndefined();
    const list = JSON.parse(listBody.result?.content?.[0]?.text ?? '{}') as { result?: Array<{ name?: string }> };
    expect(list.result?.map((e) => e.name)).toContain('val100-poison-sibling');
  });

  // The sibling of the poisoned-`enum` case above, travelling the `max` path instead of the `enum`
  // path — the historically quieter, worse failure mode (a NaN bound silently passing every
  // comparison). Seeded the same way: written straight to the catalog column, the only way this
  // shape could reach storage now.
  it('a poisoned row whose `timeoutMs.max`/`appendPrompt.max` are not numbers does not crash workflow_source', async () => {
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

    const getBody = await callToolRaw('workflow_source', { name: 'val100-poisoned-max' });
    expect(getBody.error).toBeUndefined();
  });
});
