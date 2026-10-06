// UT (issue #160 BUG-1): `RunManager.result()` was written against a two-state terminal model
// (completed/failed) and never updated when `TERMINAL` (run-manager.ts:184) grew a third member,
// 'stopped' (added for run_stop). A stopped run has no `entry.result`/`entry.resultError`, and
// nothing in `result()` covers it before the generic `RUN_NOT_TERMINAL` fallback — even though
// `run_status`/`run_list` both already report `terminalAt` for a stopped run (it IS terminal
// everywhere else). This pins the fix: `run_result` on a stopped run answers a typed, terminal
// `{ok:false, error:{code:'RUN_STOPPED', ...}}`, never `RUN_NOT_TERMINAL`.
//
// Mock policy (unit tier): real RunManager + real in-memory RunStore + real on-disk WorkflowCatalog
// (temp dir) + echo AgentSpawner — same convention as run-manager-service-account-admission.test.ts,
// which already drives suspend()->stop() on an agent()-shaped script this same way.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunManager } from '../../src/run-manager.js';
import { WorkflowCatalog } from '../../src/workflow-catalog.js';
import { InMemoryRunStore } from '../../src/run-store.js';
import { FixedClock } from '../../src/clock.js';
import type { AgentSpawner } from '../../src/agent-executor.js';
import { startScript } from '../helpers/workflow-fixtures.js';

const CLOCK = new FixedClock(new Date('2024-01-01T00:00:00Z'));

function echoSpawner(): AgentSpawner {
  return { async run(req) { return { kind: 'text', value: req.prompt }; } };
}

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'rwe-ut160-'));
  dirs.push(d);
  return d;
}
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe('RunManager.result() on a stopped run (issue #160 BUG-1, UT)', () => {
  it('answers ok:false RUN_STOPPED, never RUN_NOT_TERMINAL, for an in-memory stopped entry', async () => {
    const catalog = new WorkflowCatalog(tempDir(), CLOCK);
    const store = new InMemoryRunStore(CLOCK);
    const mgr = new RunManager({ store, clock: CLOCK, catalog, spawner: echoSpawner() } as never);
    const runId = await startScript(mgr, `phase('p'); return await agent('a', {});`, {});
    await mgr.suspend(runId);
    await mgr.stop(runId);

    const view = await mgr.status(runId);
    expect(view.status).toBe('stopped'); // sanity: this run really is terminal already

    const result = await mgr.result(runId);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('RUN_STOPPED');
      expect(result.error.code).not.toBe('RUN_NOT_TERMINAL');
    }
  });

  it('answers the same RUN_STOPPED when the run is no longer cached in-process (persisted-store path)', async () => {
    const catalog = new WorkflowCatalog(tempDir(), CLOCK);
    const store = new InMemoryRunStore(CLOCK);
    const mgr = new RunManager({ store, clock: CLOCK, catalog, spawner: echoSpawner() } as never);
    const runId = await startScript(mgr, `phase('p'); return await agent('a', {});`, {});
    await mgr.suspend(runId);
    await mgr.stop(runId);

    // Simulate a restart: a fresh RunManager over the SAME store, nothing cached in `_runs`.
    const mgr2 = new RunManager({ store, clock: CLOCK, catalog, spawner: echoSpawner() } as never);
    const result = await mgr2.result(runId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('RUN_STOPPED');
  });
});
