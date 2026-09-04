// VAL-114 (REQ-103, DES-128/125, ARCH-078/081): `schedule_create` (and `webhook_create`) against a
// registered workflow, then `workflow_describe`: `triggers` names the live cron/webhook binding,
// and deleting the schedule is reflected IN THE SAME CALL (no diagram regeneration involved).
//
// Mock policy (acceptance, DES-119): real `createServer`, real `/mcp`, real `SqliteSchedulerPort`.
// `triggers` itself needs NO live LLM (structured data the engine already owns) — asserted
// unconditionally. (The file's second case, a `diagramStale` flip seeded through a second
// `WorkflowCatalog` handle, is DELETED in v24 — see the note where it stood.)
//
// Red reason: `workflow_describe` does not exist -> every assertion below fails for the genuine
// unimplemented reason (the `triggers` field cannot even be read back).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
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

  // DELETED (v24, TASK-152/TASK-139/TASK-149, DES-156): the `diagramStale` case covered a
  // mechanism that is RETIRED, not renamed. v24 stopped generating the diagram (the author supplies
  // `mermaid` at registration, checked there), so the whole asynchronous-diagram family it asserted
  // against is gone: `workflow-view.ts:96-97` records that `diagram`/`diagramStatus`/
  // `diagramGeneratedAt`/`diagramStale` are "replaced ... with `mermaid`/`mermaidNote`", and
  // DES-156 pins `EXPECTED_DESCRIBE_KEYS` with "the four `diagram*` keys DELETED, not left
  // optional". There is no `bindingsFp`-vs-stored-diagram staleness comparison left in src/ for a
  // migrated spelling to point at, and the `putDiagramResult` seed this case used is itself slated
  // for deletion by TASK-139 B-2. REQ-103's OTHER clause — live trigger bindings on
  // `workflow_describe` — is unaffected and stays as the case above.
});
