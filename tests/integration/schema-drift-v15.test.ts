// IT-082 (DES-099, DES-100, ARCH-062, TASK-089): schema drift-lock for v15 new fields on
// `workflow_register` and `workflow_deregister` tools, and `workflow_source` output shape.
//
// Cases (drift-lock per DES-100 per-tier mock policy):
//   1. tools/list: `workflow_register` schema declares `defaults` (optional) in its input schema
//   2. tools/list: `workflow_register` schema declares `principal` (optional string) — v15 attribution
//   3. tools/list: `workflow_deregister` schema declares `principal` (optional string)
//   4. `workflow_source` output: field `owner` present in description (observable via workflow_source response)
//   5. `workflow_source` output: field `defaults` present in description
//
// Red reason: `workflow_register` tool schema does not yet have `defaults` or `principal` fields →
//   the tool description assertions fail. Correct RED for unimplemented schema changes.
//
// Mock policy (integration): real server, real tools/list response; no LLM.
//
// v24 (batch B migration) — FOUR of the five drift-locks above cover mechanisms that v24 RETIRED,
// so they are deleted rather than re-pointed (nothing in `src/` implements either any more):
//
//  * The registration-time `defaults` argument (HarnessDefaults) — RETIRED by ADR-035: a script
//    that declares `meta.defaults`/`meta.params.knobs` is now refused `DEFAULTS_RETIRED`
//    (`authoring-guide.ts`), an author default lives in `meta.params.agents.<label>.<key>.default`,
//    and `WorkflowCatalog.register()`'s `defaults` parameter is gone (workflow-fixtures.ts's own
//    v24 note). Deleted: cases 1 (`defaults` present), 4 (its 7 HarnessDefaults keys) and the
//    "description mentions harness defaults or model binding" case — all three assert the
//    advertisement of an argument no engine surface accepts. Deleted with them: `workflow_source`
//    "description mentions defaults" — the v15 source projection carried a `defaults` block; the
//    v24 projection (verified over real HTTP) returns `{owner, name, version, description, phases,
//    params, script}` and no `defaults` at all.
//
//  * The caller-supplied `principal` ARGUMENT on `workflow_register`/`workflow_deregister` —
//    RETIRED by ADR-024/ADR-028 + REQ-109: identity is resolved ONCE in the `/mcp` handler from the
//    authenticated principal (`server.ts` `principalFor(p.principal)` → `callTool(deps, name, args,
//    principal)`) and `call-tool.ts` never reads `args.principal`. Advertising an attribution
//    argument would now advertise identity spoofing. Deleted: cases 2 and 3.
//
// What SURVIVES here is the part of DES-098/DES-099 v24 still serves: `workflow_register` is on the
// surface, and `workflow_source` still tells a reader about ownership.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

let server: Server;
let tmpDir: string;
let toolsMap: Record<string, { description?: string; inputSchema?: { properties?: Record<string, unknown> } }>;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-it082-'));
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir });

  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });
  const body = await res.json() as { result?: { tools?: Array<{ name: string; description?: string; inputSchema?: unknown }> } };
  toolsMap = Object.fromEntries(
    (body.result?.tools ?? []).map(t => [t.name, { description: t.description, inputSchema: t.inputSchema as { properties?: Record<string, unknown> } }]),
  );
});

afterAll(async () => {
  await server?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('v15 schema drift-lock — workflow_register (DES-099, IT-082)', () => {
  it('workflow_register exists in tools/list', () => {
    expect(toolsMap['workflow_register']).toBeDefined();
  });
});

describe('v15 schema drift-lock — workflow_source output (DES-098, DES-099, IT-082)', () => {
  it('workflow_source description mentions owner', () => {
    const desc = toolsMap['workflow_source']?.description ?? '';
    expect(desc.toLowerCase()).toMatch(/owner/);
  });
});
