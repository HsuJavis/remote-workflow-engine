// IT (DES-237, DES-239, ARCH-149/151, TASK-237, REQ-208/209): item 6 of the v35 Gate 8 return —
// the two remaining `SCRIPT_UNSCANNABLE` read callers (`mcp-facade.ts:494`'s per-call projection
// and `server.ts:540`'s skeleton-graph route) ship `toolSurfaceUnscannable: true` on
// `workflow_describe` and `PREDICTED_OVERLAY_UNAVAILABLE: reason=script-unscannable` on
// `GET /api/runs/:id/dag`'s `warnings` respectively — but until now with NO test behind either
// marker. Written test-first for THIS file (Gate 8 return) — both markers exist in source already;
// this proves they actually fire together on a real unscannable script through the real read paths.
//
// A registered workflow can never carry an unscannable script through `workflow_register` itself
// (`workflow-catalog.ts`'s `scan.violations.length > 0` gate refuses `SCRIPT_UNSCANNABLE` at
// registration, same as any other scan violation). The two read callers exist for the cohort that
// slips past that gate anyway — a version row written before the `nonCodeSpans` oracle existed (or
// by any other pre-scan writer). This test reaches that cohort exactly the way
// `diagram-contract-grandfather.test.ts`'s "REQ-124: a GRANDFATHERED v1 run" case does: register a
// normal, scannable sibling script first (so the name/version/diagram rows exist and pass every
// registration gate), then rewrite the STORED `workflow_versions.script` in place via a direct
// SQLite write — the same "a version row is immutable to the ENGINE" technique
// `catalog-versions.test.ts`'s migrations already use.
//
// Mock policy (integration): real `createServer()`, real MCP HTTP, real SQLite catalog — no mocks.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerPublishedVia, uniqueWorkflowName, type ToolCaller } from '../helpers/workflow-fixtures.js';

let server: Server;
let tmpDir: string;

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

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-it237-unscannable-'));
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir });
});
afterAll(async () => { await server?.close(); rmSync(tmpDir, { recursive: true, force: true }); });

// The SAME fixture `tests/unit/workflow-meta-scan.test.ts` uses to force a genuine `nonCodeSpans`
// oracle parse failure: valid-looking meta, unparseable code after it.
const UNSCANNABLE_SCRIPT = "export const meta = {};\nconst x = ((((;";

describe('both SCRIPT_UNSCANNABLE read-side markers fire on the SAME grandfathered script (item 6, Gate 8 return)', () => {
  it('workflow_describe shows toolSurfaceUnscannable:true AND the dag route warns PREDICTED_OVERLAY_UNAVAILABLE: reason=script-unscannable', async () => {
    const baseUrl = `http://127.0.0.1:${server.port}`;
    const call = callerFor(baseUrl);
    const name = uniqueWorkflowName('it237-unscannable');

    // 1. Register+publish a normal, scannable sibling — every registration gate passes.
    await registerPublishedVia(call, name, `phase('one');\nawait agent('a', { prompt: 'p' });`);

    // 2. Rewrite the stored script in place to one the oracle cannot parse — simulating a version
    //    row written before the oracle existed (pre-v35 registration never re-runs).
    const db = new Database(join(tmpDir, 'catalog.db'));
    db.prepare('UPDATE workflow_versions SET script = ? WHERE name = ?').run(UNSCANNABLE_SCRIPT, name);
    db.close();

    // 3. workflow_describe's per-call projection (mcp-facade.ts:494) — toolSurfaceUnscannable.
    const described = await call('workflow_describe', { name }) as Record<string, unknown>;
    const result = (described.result ?? described) as Record<string, unknown>;
    expect(result.toolSurfaceUnscannable).toBe(true);

    // 4. The dag route (server.ts:540) — start a run (it will fail fast on the broken script; that
    //    is irrelevant here, the dag route reads the run's PINNED script independent of outcome)
    //    and read its warnings.
    const started = await call('run_start', { name }) as { runId: string };
    const dagRes = await fetch(`${baseUrl}/api/runs/${started.runId}/dag`);
    const dag = await dagRes.json() as { warnings?: string[] };
    expect(dag.warnings ?? []).toContain('PREDICTED_OVERLAY_UNAVAILABLE: reason=script-unscannable');
  }, 20000);
});
