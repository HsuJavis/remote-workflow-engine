// IT-297 (DES-247, ARCH-163/172, TASK-245, REQ-213/REQ-216): `workflow_list` stops DROPPING the
// `description` it already computes (`catalog.list()` has produced it since v9/REQ-061; the
// projection's `.map` silently discards it) and gains `lastRunAt` (one `lastRunAtByName()` call per
// request, NOT per row). Also K4: `run_status`/`run_list` agree on a zero-agent terminal run
// (`failedAgentCount` omitted on both).
//
// Red reason: `McpFacade.workflowList`'s projection is
// `{name, owner, versions, channels, runnable}` — no `description`, no `lastRunAt` field at all.
//
// Mock policy (integration): real SqliteRunStore + real WorkflowCatalog + real McpFacade — no mock
// of either SUT boundary.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteRunStore } from '../../src/store/sqlite-run-store.js';
import { WorkflowCatalog } from '../../src/workflow-catalog.js';
import { RunManager } from '../../src/run-manager.js';
import { McpFacade } from '../../src/mcp-facade.js';
import { FixedClock } from '../../src/clock.js';
import type { Principal } from '../../src/authz.js';
import { registerPublished } from '../helpers/workflow-fixtures.js';

const clock = new FixedClock(new Date('2026-09-21T00:00:00.000Z'));
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const ADMIN: Principal = { kind: 'admin', id: 'root-admin' };

function boot() {
  const dir = mkdtempSync(join(tmpdir(), 'rwe-it297-list-'));
  dirs.push(dir);
  const store = new SqliteRunStore(join(dir, 'store'), clock);
  const catalog = new WorkflowCatalog(join(dir, 'catalog'), clock);
  const runManager = new RunManager({ store, clock, catalog, workRoot: dir } as any);
  const facade = new McpFacade({ clock, store, runManager } as any);
  return { store, catalog, runManager, facade };
}

async function waitForStatus(mgr: RunManager, runId: string, want: string, maxIters = 120): Promise<void> {
  for (let i = 0; i < maxIters; i++) {
    const v = await mgr.status(runId);
    if (v.status === want) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`waitForStatus: run ${runId} never reached ${want}`);
}

describe('IT-297: workflow_list forwards description + lastRunAt', () => {
  it('a run workflow carries its description and lastRunAt; a never-run workflow carries null', async () => {
    const { catalog, runManager, facade } = boot();
    await registerPublished(catalog, 'it297-ran', "meta = { description: 'runs things' };\nreturn 1;");
    await runManager.start({ name: 'it297-ran', principal: 'alice' } as any);
    await registerPublished(catalog, 'it297-never', "meta = { description: 'never run' };\nreturn 1;");

    const result = await (facade as any).workflowList({}, ADMIN);
    const rows: Array<Record<string, unknown>> = result.result;
    const ran = rows.find((r) => r.name === 'it297-ran')!;
    const never = rows.find((r) => r.name === 'it297-never')!;
    expect(ran.description).toBe('runs things');
    expect(ran.lastRunAt).toBeTypeOf('string');
    expect(never.lastRunAt).toBeNull();
  });

  it('exactly ONE lastRunAtByName() call per workflow_list request, not one per row', async () => {
    const { catalog, facade, store } = boot();
    await registerPublished(catalog, 'it297-a', "meta = { description: 'a' };\nreturn 1;");
    await registerPublished(catalog, 'it297-b', "meta = { description: 'b' };\nreturn 1;");
    let calls = 0;
    const orig = (store as any).lastRunAtByName?.bind(store);
    (store as any).lastRunAtByName = async (...args: unknown[]) => { calls++; return orig ? orig(...args) : new Map(); };
    await (facade as any).workflowList({}, ADMIN);
    expect(calls).toBe(1);
  });

  it('K4: run_status and run_list agree on a zero-agent terminal run (failedAgentCount omitted on both)', async () => {
    const { catalog, runManager, facade } = boot();
    await registerPublished(catalog, 'it297-zero', "return 'no agents here';");
    const runId = await runManager.start({ name: 'it297-zero', principal: 'alice' } as any);
    await waitForStatus(runManager, runId, 'completed');

    const statusEnvelope = await (facade as any).runStatus({ runId }, ADMIN, false, 'root-admin');
    const list = await (facade as any).runList({}, ADMIN);
    const listRow = (list.result as any[]).find((r: any) => r.runId === runId);
    expect(Object.prototype.hasOwnProperty.call(statusEnvelope.result ?? statusEnvelope, 'failedAgentCount')).toBe(
      Object.prototype.hasOwnProperty.call(listRow, 'failedAgentCount'),
    );
  });
});
