// VAL-114 (REQ-103, DES-128/125, ARCH-078/081): `schedule_create` (and `webhook_create`) against a
// registered workflow, then `workflow_describe`: `triggers` names the live cron/webhook binding;
// delete the schedule and describe reflects it IN THE SAME CALL, while `diagramStale` flips `true`
// against an unchanged diagram (a `bindingsFp` mismatch, no model call).
//
// Mock policy (acceptance, DES-119): real `createServer`, real `/mcp`, real `SqliteSchedulerPort`.
// `triggers` itself needs NO live LLM (structured data the engine already owns) — asserted
// unconditionally. The `diagramStale` flip needs an EXISTING `ready` diagram row to flip against; a
// live analyzer run is REQ-102's own concern (VAL-113), so this file seeds a `ready` row directly
// through a second `WorkflowCatalog` handle on the SAME on-disk workRoot (same technique as
// IT-097/VAL's own established "second handle on the real store" pattern) rather than depending on a
// live provider for a REQ-103-scoped assertion.
//
// Red reason: `workflow_describe` does not exist -> every assertion below fails for the genuine
// unimplemented reason (the `triggers` field cannot even be read back).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { WorkflowCatalog } from '../../src/workflow-catalog.js';
import { registerPublishedVia } from '../helpers/workflow-fixtures.js';

let server: Server;
let workRoot: string;

async function call(name: string, args: unknown): Promise<any> {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}');
}

beforeAll(async () => {
  workRoot = mkdtempSync(join(tmpdir(), 'rwe-val114-'));
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot });
  await registerPublishedVia(call, 'val114-flow', `return 1;`);
});
afterAll(async () => { await server?.close(); rmSync(workRoot, { recursive: true, force: true }); });

describe('REQ-103: live trigger bindings on workflow_describe (VAL-114)', () => {
  it('a bound cron schedule is named in `triggers`; deleting it is reflected in the SAME call (no diagram regeneration needed)', async () => {
    const created = await call('schedule_create', { kind: 'cron', workflow: 'val114-flow', cron: '0 3 * * *', enabled: true });
    const scheduleId = created.result?.id;
    expect(scheduleId).toBeTruthy();

    const withSchedule = await call('workflow_describe', { name: 'val114-flow' });
    expect(withSchedule.result?.triggers).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'cron', cron: '0 3 * * *' })]),
    );

    await call('schedule_delete', { id: scheduleId });
    const afterDelete = await call('workflow_describe', { name: 'val114-flow' });
    expect(afterDelete.result?.triggers).toEqual([]);
  });

  it('diagramStale flips true when the live bindingsFp no longer matches a stored ready diagram\'s bindings_fp', async () => {
    // Seed a `ready` diagram row directly against the SAME on-disk catalog the running server writes
    // to — a real store, not a mock, but reached without depending on a live LLM (REQ-103's own
    // concern is the staleness FLAG, not diagram generation, which is REQ-102/VAL-113's).
    const sideCatalog = new WorkflowCatalog(workRoot);
    await (sideCatalog as any).putDiagramResult('val114-flow', 'v1', {
      status: 'ready', diagram: '╭─Draft─╮', generatedAt: '2026-09-02T10:00:00.000Z', bindingsFp: 'fp-before-any-trigger',
    });

    const created = await call('schedule_create', { kind: 'cron', workflow: 'val114-flow', cron: '0 4 * * *', enabled: true });
    expect(created.result?.id).toBeTruthy();

    const resp = await call('workflow_describe', { name: 'val114-flow' });
    expect(resp.result?.diagramStatus).toBe('ready');
    expect(resp.result?.diagramStale).toBe(true);
  });
});
