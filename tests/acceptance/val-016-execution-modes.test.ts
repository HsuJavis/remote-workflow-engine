// VAL-016: Execution modes — cron schedule fires, one-shot auto-completes,
//           disabled resident rejects; firing logic proven at UT with FixedClock+FakeTicker (REQ-015)
// RED: schedule_create MCP tool does not exist yet — assertions fail.
// Per DES-023: no mock of the SUT boundary; uses real createServer.
// D-V2I-3 (ORCH binding): schedule targets are CATALOG-REGISTERED workflows only (REQ-014/
// REQ-015 wording) — every target below is registered via `workflow_register` first, never a bare
// `run_start({name, script})` (which never persists to WorkflowCatalog — see E2E-004's own note
// for the exact root cause). v24 Gate 7.5 (D-1, REQ-115): D-V2I-3's guarantee is now pinned at the
// FIRE path — `schedule_create` no longer resolves the catalog (a trigger is created unclaimed and
// claimed at registration), and an unclaimed target is refused when it comes due, with the refusal
// recorded on the row and no run started.
//
// v24 orchestrator adjudication #8 (H-2, issue #56): `schedule_create({workflow})` is GONE — the
// argument was left behind when Gate 7.5 removed the create-time check, so a schedule could
// self-claim a name that would never exist. Every case below therefore creates the trigger first and
// binds it with `workflow_register({triggers:[id]})`, the only remaining door. One case changes its
// refusal REASON as a direct consequence: a schedule claimed by a NEVER-REGISTERED name is now
// unconstructible over MCP (registering creates the name; deregistering releases the claim), so the
// D-V2I-3 guarantee it exists for — "an unregistered target never silently starts a run" — is
// asserted on the state that IS constructible, an UNCLAIMED trigger coming due: refused, recorded,
// no run. `CLAIMED_WORKFLOW_MISSING` keeps its coverage at the port level
// (webhook-registry.test.ts) where a pre-v24 legacy binding can still be built directly.
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
async function registerWorkflow(name: string, script: string, triggers?: string[]) {
  await registerPublishedVia(mcpCall, name, script, triggers ? { triggers } : {});
}

describe('Execution modes (REQ-015, VAL-016)', () => {
  describe('schedule_create / schedule_list / schedule_delete (REQ-015, clause 1)', () => {
    it('schedule_create with a cron expression returns a schedule with an id, and a workflow claims it', async () => {
      const r = await mcpCall('schedule_create', {
        kind: 'cron', cron: '0 3 * * *', enabled: true,
      });
      expect(r['error']).toBeUndefined();
      const id = ((r['result'] as Record<string, unknown>))?.['id'] as string;
      expect(typeof id).toBe('string');
      await registerWorkflow('cron-val', 'return 1', [id]);
      const row = ((await mcpCall('schedule_list'))['result'] as Array<Record<string, unknown>>).find((x) => x['id'] === id);
      expect(row?.['claimedBy']).toBe('cron-val');
    });

    // v24 Gate 7.5 (D-1, REQ-115 clause 1 + its last clause): this used to assert
    // `WORKFLOW_NOT_FOUND` AT CREATION. REQ-115 reverses the direction — a trigger is created
    // UNCLAIMED and a workflow claims it at registration — so a name that does not exist yet is
    // the normal case at this door and the check MOVES to the fire path. D-V2I-3's actual
    // guarantee ("an unregistered name never silently starts a run") is unchanged and is what the
    // second half below asserts, at the site that can still answer it truthfully.
    it('schedule_create needs no workflow at all — an UNCLAIMED trigger is created and returns its id (REQ-115 clause 1)', async () => {
      const r = await mcpCall('schedule_create', { kind: 'cron', cron: '0 3 * * *', enabled: true });
      expect(r['error']).toBeUndefined();
      const created = r['result'] as Record<string, unknown>;
      expect(typeof created?.['id']).toBe('string');
      expect(created?.['claimedBy'] ?? null).toBeNull();
    });

    it('a schedule NO workflow ever claimed starts NO run when it comes due — it is refused and the refusal is recorded (D-V2I-3, REQ-115)', async () => {
      const r = await mcpCall('schedule_create', {
        kind: 'once', at: new Date(Date.now() + 300).toISOString(), enabled: true,
      });
      expect(r['error']).toBeUndefined();
      const id = (r['result'] as Record<string, unknown>)['id'] as string;

      const rowFor = async () => ((await mcpCall('schedule_list'))['result'] as Array<Record<string, unknown>>).find((x) => x['id'] === id);
      const deadline = Date.now() + 8000;
      let row = await rowFor();
      while (((row?.['refusalCount'] as number) ?? 0) === 0 && Date.now() < deadline) {
        await new Promise((res) => setTimeout(res, 100));
        row = await rowFor();
      }
      expect(row?.['lastRefusalReason']).toBe('UNCLAIMED');
      expect(row?.['lastRunId']).toBeUndefined();
      expect((await mcpCall('run_list', { workflow: 'never-registered-val-target' }))['result'] ?? []).toEqual([]);
    }, 20000);

    it('schedule_list returns the created cron schedule', async () => {
      const r = await mcpCall('schedule_list');
      const list = (r['result'] as unknown[]) ?? [];
      expect(list.length).toBeGreaterThan(0);
    });

    it('schedule_delete removes the schedule', async () => {
      const r = await mcpCall('schedule_create', { kind: 'resident', enabled: true });
      const id = ((r['result'] as Record<string, unknown>))?.['id'] as string;
      await registerWorkflow('del-val', 'return 2', [id]);
      await mcpCall('schedule_delete', { id });
      const listR = await mcpCall('schedule_list');
      const list = (listR['result'] as Array<{ id: string }>) ?? [];
      expect(list.find((s) => s.id === id)).toBeUndefined();
    });
  });

  describe('One-shot schedule auto-completes (REQ-015, clause 2)', () => {
    it('a one-shot whose `at` is already past fires immediately and becomes enabled:false', async () => {
      // Use a timestamp relative to right now (wall clock is FINE here — it is not used for a
      // scheduling DECISION inside a timer; we merely want a past ISO string for the `at` field).
      const pastAt = new Date(Date.now() - 2000).toISOString();
      // v24 adjudication #8 (H-2): the claim can only be taken AFTER the id exists, and a due
      // one-shot fires on the very next 500 ms tick — so it is created DISABLED (never selected by
      // `tick()`), claimed at registration, then enabled. Its `at` is still in the past at the
      // moment it becomes eligible, which is exactly what this case is about.
      const r = await mcpCall('schedule_create', { kind: 'once', at: pastAt, enabled: false });
      const id = ((r['result'] as Record<string, unknown>))?.['id'] as string;
      expect(typeof id).toBe('string');
      await registerWorkflow('once-val', 'return 3', [id]);
      expect((await mcpCall('schedule_setEnabled', { id, enabled: true }))['error']).toBeUndefined();

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
