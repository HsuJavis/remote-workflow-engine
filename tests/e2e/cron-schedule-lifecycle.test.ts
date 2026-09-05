// E2E-004: Cron schedule fires a run → run appears in workflow_list; keeps firing until disabled (REQ-015, REQ-014, REQ-005)
// RED: schedule_create / schedule_list MCP tools do not exist yet — assertions fail on "Unknown tool".
// No mock of the SUT boundary: real createServer, real MCP HTTP calls.
// D-V2I-3 (ORCH binding): schedule targets are CATALOG-REGISTERED workflows only (REQ-014/REQ-015
// wording — "a registered workflow with a cron schedule"), never an inline ad-hoc `run_start`
// script. `run_start({name, script})` with BOTH fields present runs an ad-hoc script tagged with
// that name — it does NOT persist to WorkflowCatalog (src/run-manager.ts:118 only consults the
// catalog when `spec.name && !spec.script`) — so every schedule/trigger target below is registered
// via `workflow_register` first, exactly like VAL-014/E2E-003 already do.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { registerPublishedVia } from '../helpers/workflow-fixtures.js';

let server: Server;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-e2e-cron-'));
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir });
});

afterAll(async () => {
  await server?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

async function mcpCall(name: string, args: Record<string, unknown> = {}) {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}') as Record<string, unknown>;
}

// Registers a named workflow in the catalog (D-V2I-3) — the ONLY way a schedule/trigger target
// becomes resolvable; a bare `run_start({name, script})` never persists to the catalog.
// v22 (adjudication #1 K-1): and registration alone is no longer enough — a freshly registered
// version is on NO channel, so every scheduled firing failed to start with
// `CHANNEL_UNPUBLISHED: release` while these schedule-bookkeeping assertions stayed green. Register
// AND publish, via the shared helper (which throws on either half failing, preserving the old
// `expect(r.error).toBeUndefined()` oracle).
async function registerWorkflow(name: string, script: string) {
  await registerPublishedVia(mcpCall, name, script);
}

describe('Cron schedule fires a run (REQ-015, E2E-004)', () => {
  it('schedule_create returns a schedule ID', async () => {
    await registerWorkflow('cron-target', 'return 1');

    // Create a cron schedule with a very tight interval (every minute = the smallest standard cron unit).
    // Note: actual firing requires the engine to tick; this test verifies the tool creates correctly.
    const result = await mcpCall('schedule_create', {
      kind: 'cron',
      workflow: 'cron-target',
      cron: '* * * * *',
      enabled: true,
    });
    expect(result['error']).toBeUndefined();
    expect(typeof (result['result'] as Record<string, unknown>)?.['id']).toBe('string');
  });

  // v24 Gate 7.5 (D-1, REQ-115 clause 1 + its last clause): this used to assert `WORKFLOW_NOT_FOUND`
  // AT CREATION. REQ-115 reverses the direction — a trigger is created UNCLAIMED and a workflow
  // claims it at registration — so a name that does not exist yet is the normal case at this door,
  // and the catalog check moves to the FIRE path, where the refusal is recorded on the row
  // (`CLAIMED_WORKFLOW_MISSING`; IT-093 and VAL-016 pin that end, this file's subject is the cron
  // firing itself). D-V2I-3's guarantee — an unregistered name never silently starts a run — is
  // unchanged: no run is ever dispatched for this schedule.
  it('schedule_create for a never-registered workflow name is ACCEPTED, and no run is ever started for it', async () => {
    const result = await mcpCall('schedule_create', {
      kind: 'cron',
      workflow: 'never-registered-cron-target',
      cron: '* * * * *',
      enabled: true,
    });
    expect(result['error']).toBeUndefined();
    const id = (result['result'] as Record<string, unknown>)['id'] as string;
    expect(typeof id).toBe('string');
    expect((await mcpCall('run_list', { workflow: 'never-registered-cron-target' }))['result'] ?? []).toEqual([]);
  });

  it('schedule_list returns the created schedule', async () => {
    const result = await mcpCall('schedule_list');
    // schedule_list returns a ResultEnvelope whose result is an array of ScheduleStatus.
    const list = (result['result'] as unknown[]) ?? [];
    expect(list.length).toBeGreaterThan(0);
  });

  it('a one-shot schedule auto-completes after firing exactly once (REQ-015 clause 2)', async () => {
    // A one-shot schedule whose `at` is in the PAST relative to boot fires immediately.
    // We use an ISO timestamp derived from the clock relative to now.
    // "past" here = just booted, the at time should be a few seconds ago.
    const pastAt = new Date(Date.now() - 5000).toISOString(); // 5s ago
    await registerWorkflow('once-target', 'return 2');
    const createResult = await mcpCall('schedule_create', {
      kind: 'once',
      workflow: 'once-target',
      at: pastAt,
      enabled: true,
    });
    expect(createResult['error']).toBeUndefined();
    const id = ((createResult['result'] as Record<string, unknown>))?.['id'] as string;
    expect(typeof id).toBe('string');

    // After the next tick, the schedule should auto-complete (enabled=false).
    // Poll for up to 5s.
    let enabled: boolean | undefined = true;
    for (let i = 0; i < 25; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const listResult = await mcpCall('schedule_list');
      const list = (listResult['result'] as Array<{ id: string; enabled: boolean }>) ?? [];
      const found = list.find((s) => s.id === id);
      if (found && !found.enabled) { enabled = false; break; }
    }
    expect(enabled).toBe(false);
  });

  it('schedule_delete removes the schedule', async () => {
    await registerWorkflow('del-target', 'return 3');
    const r = await mcpCall('schedule_create', {
      kind: 'resident', workflow: 'del-target', enabled: true,
    });
    // schedule_create must succeed (fails here if the tool doesn't exist — the forcing assertion)
    expect(r['error']).toBeUndefined();
    const id = ((r['result'] as Record<string, unknown>))?.['id'] as string;
    expect(typeof id).toBe('string');
    await mcpCall('schedule_delete', { id });
    const listResult = await mcpCall('schedule_list');
    const list = (listResult['result'] as Array<{ id: string }>) ?? [];
    expect(list.find((s) => s.id === id)).toBeUndefined();
  });
});
