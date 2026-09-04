// IT-081 (DES-099/144/148, TASK-154, v24 RETIREMENT): harness `defaults` / `meta.params.knobs`
// register-time validation — the whole v15/v21 door this file tested is RETIRED (ADR-035,
// DEFAULTS_RETIRED). `workflow_register` takes no `defaults` field at all (DES-148:
// `{name, script, mermaid, triggers}`), and `meta.params.knobs` / `meta.params.defaults` (the two
// keys `parseParamContract` refuses BY NAME inside the `meta.params` sub-object — DES-144's own
// prose shorthands the second one "meta.defaults", but `parseParamContract`'s first argument IS
// `meta.params`, so a TOP-LEVEL `meta.defaults` sibling to `params` is a different, unguarded key;
// see the note on that below) are refused at parse time. Every one of this file's 38 prior cases
// across 8 describe blocks (D-AUTH-5 unknown-key/bad-alias/bad-tool rejection, the partial-write
// guard, the run-time defaults merge, meta.params.knobs contract discovery + ceilings, the
// P-A3/P-A4/F-1/G-1 alias-and-ceiling adjudication pins) exercised that retired door directly and
// has no v24 successor to port to: the equivalent guarantees (ceiling refusal, alias validation,
// no-partial-write) are now pinned against the `meta.params.agents.<label>` shape by
// tests/unit/params-contract.test.ts (TASK-136) and tests/integration/params-admission.test.ts
// (TASK-137) independently. See src/errors.ts's ERROR_CATALOG header and TASK-143's PARIMPL report
// for the cross-task trace that established this was dead code, not a regression to chase.
//
// Retired 2026-09-04 (TASK-154). Case count: 38 (before) -> 5 (after) — the 5 are a real-HTTP
// regression suite (real server + real SQLite catalog, same mock policy this file always used)
// pinning that (1) DEFAULTS_RETIRED fires for both `meta.params`-nested retired keys at the
// integration boundary, not just the pure-function unit level, (2) a stray top-level `defaults`
// ARGUMENT (the pre-v24 call-level field, distinct from any `meta` key) is silently not forwarded
// (never breaks registration, never stored), and (3) the backward-compat no-params-block path
// still registers. NOT covered (found while writing this, reported not fixed — TASK-136's file):
// a literal top-level `export const meta = { defaults: {...} }` (sibling to `params`, never nested
// under it) registers successfully today, unchecked — `parseParamContract` only ever sees
// `meta.params`, so this sibling key is invisible to it. Whether that is intentional (no such
// top-level key was ever a real mechanism pre-v24 either) or a residual gap is for TASK-136 to rule
// on; this file does not assert either way.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

let server: Server;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-it081-'));
  server = await createServer({
    port: 0,
    bind: '127.0.0.1',
    workRoot: tmpDir,
    aliases: {
      sonnet: { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
      default: { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
    },
  });
});

afterAll(async () => {
  await server?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

async function callTool(name: string, args: Record<string, unknown>) {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}') as Record<string, unknown>;
}

describe('v24 retirement regression (IT-081, TASK-154, DES-144/DES-148): the v15 defaults/knobs door is gone', () => {
  it('meta.params.knobs -> DEFAULTS_RETIRED over real MCP HTTP, nothing stored', async () => {
    const script = `export const meta = { params: { knobs: { effort: { type: 'enum', enum: ['low','high'], default: 'low' } } } };\nreturn 1;`;
    const r = await callTool('workflow_register', { name: 'it081-retired-knobs', script, mermaid: 'graph TD;' });
    expect((r.error as { code?: string } | undefined)?.code ?? r.code).toBe('DEFAULTS_RETIRED');

    const check = await callTool('workflow_source', { name: 'it081-retired-knobs' });
    expect(check.code).toBe('WORKFLOW_NOT_FOUND');
  });

  it('meta.params.defaults (the OTHER retired site) -> DEFAULTS_RETIRED, nothing stored', async () => {
    const script = `export const meta = { params: { defaults: { effort: 'low' } } };\nreturn 1;`;
    const r = await callTool('workflow_register', { name: 'it081-retired-defaults', script, mermaid: 'graph TD;' });
    expect((r.error as { code?: string } | undefined)?.code ?? r.code).toBe('DEFAULTS_RETIRED');

    const check = await callTool('workflow_source', { name: 'it081-retired-defaults' });
    expect(check.code).toBe('WORKFLOW_NOT_FOUND');
  });

  it('a stray top-level `defaults` argument on workflow_register is silently ignored (ADR-035: not forwarded to the catalog at all), never HARNESS_DEFAULTS_INVALID', async () => {
    const r = await callTool('workflow_register', {
      name: 'it081-stray-defaults-arg',
      script: 'return "ok";',
      mermaid: 'graph TD;',
      defaults: { model: 'sonnet', timeoutMs: 30_000 }, // pre-v24 field — no longer read anywhere
    });
    expect(r.error).toBeUndefined();
    expect((r as { code?: string }).code).not.toBe('HARNESS_DEFAULTS_INVALID');
  });

  it('backward-compat: a script with no params/defaults block at all still registers (zero-label pure composition)', async () => {
    // Registration only (no publish/read-back): `workflow_publish` is unrelated to this task's
    // retirement scope and is currently unreachable through the wire either way — its inputSchema
    // declares `version:{type:'number'}` (tool-specs.ts's own fixture: `version:1`) while
    // `workflow-catalog.ts#publish` matches against the STRING form ('v1') the register response
    // carries; a number satisfies ajv but then misses every stored key (VERSION_NOT_FOUND), and the
    // string form ajv itself rejects (INVALID_ARGUMENT: /version must be number) — no call shape
    // succeeds. Found while porting this file off `registerPublishedVia`; reported as a cross-task
    // defect (tool-specs.ts is TASK-132's file, mcp-facade.ts/workflow-catalog.ts are outside
    // TASK-154), not fixed here.
    const r = await callTool('workflow_register', { name: 'it081-no-params', script: 'return "ok";', mermaid: 'graph TD;' });
    expect(r.error).toBeUndefined();
    expect(typeof r['version']).toBe('number');
  });

  it('a script whose meta carries no `params` key at all (undefined) with an agent() call declared -> AGENT_UNDECLARED, not DEFAULTS_RETIRED (the two retired-door codes must not leak onto the unrelated v24 door)', async () => {
    const script = `export const meta = { description: 'x' };\nreturn await agent('plan', {});`;
    const r = await callTool('workflow_register', { name: 'it081-undeclared-not-retired', script, mermaid: "graph TD;\nplan([\"plan\"]);" });
    const code = (r.error as { code?: string } | undefined)?.code ?? r.code;
    expect(code).toBe('AGENT_UNDECLARED');
    expect(code).not.toBe('DEFAULTS_RETIRED');
  });
});
