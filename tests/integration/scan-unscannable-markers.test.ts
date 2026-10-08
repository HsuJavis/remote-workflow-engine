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
// 2026-10-08 integration (rv) fix (MINOR, reverify): `validateStoredVersion()` used to
// short-circuit `scan.unscannable` straight to `{ok:true}` — so `run_start`/`run_resume`/a nested
// `workflow()` (every door this method guards) ADMITTED a row `workflow_describe` already reported
// `runnable:false`/`NOT_RUNNABLE` for, the exact read/run disagreement #157 exists to close. Fixed:
// the short-circuit now returns the SAME `NOT_RUNNABLE` refusal every other staleness cause here
// does. Below, the run that exercises the dag route's live-read warning (arm 4) is started BEFORE
// the stored script is mutated to the unscannable fixture — it must still succeed (the row was
// scannable when `run_start` admitted it; the mutation happens to the SAME version row afterwards,
// which `catalog.resolve()`'s own re-read at the dag route sees live) — a separate case right after
// it proves a FRESH `run_start` against the now-mutated row is refused `NOT_RUNNABLE`.
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
  // Not this file's subject — disabled so a shared-sandbox /tmp running low (unrelated concurrent
  // agents) can't flake a test about SCRIPT_UNSCANNABLE into a DISK_LOW failure instead.
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir, diskFloor: { bytes: 0, percent: 0 } });
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

    // 2. Start a run WHILE the row is still scannable — admission must succeed; the dag route
    //    below re-reads the stored script LIVE (`catalog.resolve()`), so the run itself never needs
    //    to carry the mutated content, only to exist with this version pinned.
    const started = await call('run_start', { name }) as { runId: string };
    expect(started.runId).toBeTruthy();

    // 3. Rewrite the SAME stored version row in place to one the oracle cannot parse — simulating a
    //    version row written before the oracle existed (pre-v35 registration never re-runs), or one
    //    that regressed after a run was already admitted against it.
    const db = new Database(join(tmpDir, 'catalog.db'));
    db.prepare('UPDATE workflow_versions SET script = ? WHERE name = ?').run(UNSCANNABLE_SCRIPT, name);
    db.close();

    // 4. workflow_describe's per-call projection (mcp-facade.ts:494) — toolSurfaceUnscannable.
    const described = await call('workflow_describe', { name }) as Record<string, unknown>;
    const result = (described.result ?? described) as Record<string, unknown>;
    expect(result.toolSurfaceUnscannable).toBe(true);

    // 5. The dag route (server.ts:540) re-resolves the pinned version LIVE and sees the now-mutated,
    //    unscannable script — independent of admission, which already happened in step 2.
    const dagRes = await fetch(`${baseUrl}/api/runs/${started.runId}/dag`);
    const dag = await dagRes.json() as { warnings?: string[] };
    expect(dag.warnings ?? []).toContain('PREDICTED_OVERLAY_UNAVAILABLE: reason=script-unscannable');
  }, 20000);

  // MINOR (2026-10-07 reverify, #157 agreement): the exact disagreement the verifier found — describe
  // says NOT_RUNNABLE for this row, but `run_start` used to admit it anyway. Same row as above, a
  // FRESH `run_start` call made AFTER the mutation must now refuse the SAME NOT_RUNNABLE code
  // `workflow_describe` already reports — the read and the run doors must agree.
  it('[LOAD-BEARING] run_start refuses NOT_RUNNABLE for a row workflow_describe already reports runnable:false for (#157 agreement, unscannable case)', async () => {
    const baseUrl = `http://127.0.0.1:${server.port}`;
    const call = callerFor(baseUrl);
    const name = uniqueWorkflowName('it237-unscannable-run-refuse');

    await registerPublishedVia(call, name, `phase('one');\nawait agent('a', { prompt: 'p' });`);
    const db = new Database(join(tmpDir, 'catalog.db'));
    db.prepare('UPDATE workflow_versions SET script = ? WHERE name = ?').run(UNSCANNABLE_SCRIPT, name);
    db.close();

    const described = await call('workflow_describe', { name }) as Record<string, unknown>;
    const describeResult = (described.result ?? described) as Record<string, unknown>;
    expect(describeResult.runnable).toBe(false);
    expect(describeResult.runnableReason).toBe('NOT_RUNNABLE');

    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'run_start', arguments: { name } } }),
    });
    const body = await res.json() as { result?: { content: Array<{ text: string }> } };
    const payload = JSON.parse(body.result!.content[0]!.text) as { error?: { code?: string } };
    expect(payload.error?.code).toBe('NOT_RUNNABLE');
  }, 20000);
});
