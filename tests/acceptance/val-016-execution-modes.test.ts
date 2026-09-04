// VAL-016: Execution modes — cron schedule fires, one-shot auto-completes,
//           disabled resident rejects; firing logic proven at UT with FixedClock+FakeTicker (REQ-015)
// RED: schedule_create MCP tool does not exist yet — assertions fail.
// Per DES-023: no mock of the SUT boundary; uses real createServer.
// D-V2I-3 (ORCH binding): schedule targets are CATALOG-REGISTERED workflows only (REQ-014/
// REQ-015 wording) — every target below is registered via `workflow_register` first, never a bare
// `run_start({name, script})` (which never persists to WorkflowCatalog — see E2E-004's own note
// for the exact root cause). Also pins: an unregistered workflow name -> WORKFLOW_NOT_FOUND with a
// machine-readable code from `schedule_create`.
//
// v24 (TASK-152, ARCH-087, ch.16.1): the tool this file used to call to fire a resident schedule
// on demand is RETIRED with no v24 replacement — the 35-tool surface has no manual "fire now" tool
// (a resident still fires automatically off the scheduler; only the manual invocation tool is
// gone). The "Resident … (REQ-015, clause 3)" describe block below is removed rather than
// re-pointed at a differently-shaped tool; this is the owner's ch.16.1 decision, not a defect.
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
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-val-016-'));
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

// v22: a schedule/trigger target is STARTED by name, which resolves the `release` channel — so a
// bare register leaves it unpublished (CHANNEL_UNPUBLISHED at fire time). Register AND publish.
// The old `expect(r['error']).toBeUndefined()` setup guard is preserved as the helper's own throw:
// it raises a named error if either register or publish comes back failed.
async function registerWorkflow(name: string, script: string) {
  await registerPublishedVia(mcpCall, name, script);
}

describe('Execution modes (REQ-015, VAL-016)', () => {
  describe('schedule_create / schedule_list / schedule_delete (REQ-015, clause 1)', () => {
    it('schedule_create with a cron expression returns a schedule with an id', async () => {
      await registerWorkflow('cron-val', 'return 1');
      const r = await mcpCall('schedule_create', {
        kind: 'cron', workflow: 'cron-val', cron: '0 3 * * *', enabled: true,
      });
      expect(r['error']).toBeUndefined();
      const id = ((r['result'] as Record<string, unknown>))?.['id'];
      expect(typeof id).toBe('string');
    });

    it('schedule_create for a never-registered workflow name returns WORKFLOW_NOT_FOUND (D-V2I-3)', async () => {
      const r = await mcpCall('schedule_create', {
        kind: 'cron', workflow: 'never-registered-val-target', cron: '0 3 * * *', enabled: true,
      });
      expect((r['error'] as Record<string, unknown>)?.['code']).toBe('WORKFLOW_NOT_FOUND');
      expect(r['result']).toBeUndefined();
    });

    it('schedule_list returns the created cron schedule', async () => {
      const r = await mcpCall('schedule_list');
      const list = (r['result'] as unknown[]) ?? [];
      expect(list.length).toBeGreaterThan(0);
    });

    it('schedule_delete removes the schedule', async () => {
      await registerWorkflow('del-val', 'return 2');
      const r = await mcpCall('schedule_create', { kind: 'resident', workflow: 'del-val', enabled: true });
      const id = ((r['result'] as Record<string, unknown>))?.['id'] as string;
      await mcpCall('schedule_delete', { id });
      const listR = await mcpCall('schedule_list');
      const list = (listR['result'] as Array<{ id: string }>) ?? [];
      expect(list.find((s) => s.id === id)).toBeUndefined();
    });
  });

  describe('One-shot schedule auto-completes (REQ-015, clause 2)', () => {
    it('a one-shot whose `at` is already past fires immediately and becomes enabled:false', async () => {
      await registerWorkflow('once-val', 'return 3');
      // Use a timestamp relative to right now (wall clock is FINE here — it is not used for a
      // scheduling DECISION inside a timer; we merely want a past ISO string for the `at` field).
      const pastAt = new Date(Date.now() - 2000).toISOString();
      const r = await mcpCall('schedule_create', {
        kind: 'once', workflow: 'once-val', at: pastAt, enabled: true,
      });
      const id = ((r['result'] as Record<string, unknown>))?.['id'] as string;
      expect(typeof id).toBe('string');

      // Poll until auto-complete (enabled:false) or timeout.
      let enabled: boolean | undefined = true;
      for (let i = 0; i < 30; i++) {
        await new Promise((r2) => setTimeout(r2, 200));
        const listR = await mcpCall('schedule_list');
        const list = (listR['result'] as Array<{ id: string; enabled: boolean }>) ?? [];
        const found = list.find((s) => s.id === id);
        if (found && !found.enabled) { enabled = false; break; }
      }
      expect(enabled).toBe(false);
    });
  });
});
