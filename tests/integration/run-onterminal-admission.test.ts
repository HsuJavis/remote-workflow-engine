// v8 Slice 4 — onTerminal hook (REQ-052) + run-admission counter (REQ-054). TEST-FIRST (RED).
//
// REQ-052: an injected onTerminal(runId,status) fires exactly once per terminal transition, for
//   completed/failed/STOPPED, from the authoritative _transition; never for non-terminal, never for
//   a nested workflow() execution.
// REQ-054: maxConcurrentRuns bounds live top-level runs; an over-limit start() throws RUN_ADMISSION_LIMIT
//   before any durable work; a nested workflow() consumes no slot; a terminal run frees its slot.
//
// Mock policy (integration tier): real RunManager + real on-disk WorkflowCatalog + real sandbox child
// processes/IPC/vm; only the AgentSpawner/GatewayClient faked (the RunManagerDeps.spawner seam).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunManager } from '../../src/run-manager.js';
import { registerPublished, startScript } from '../helpers/workflow-fixtures.js';
import { WorkflowCatalog } from '../../src/workflow-catalog.js';
import { InMemoryRunStore } from '../../src/run-store.js';
import { FixedClock } from '../../src/clock.js';
import type { AgentSpawner } from '../../src/agent-executor.js';
import type { RunStatus } from '../../src/types.js';

const CLOCK = new FixedClock(new Date('2024-01-01T00:00:00Z'));
const echo: AgentSpawner = { async run(req) { return { kind: 'text', value: req.prompt }; } };

async function settled(mgr: RunManager, runId: string) {
  let v = await mgr.status(runId);
  for (let i = 0; i < 300 && (v.status === 'running' || v.status === 'queued'); i++) {
    await new Promise((r) => setTimeout(r, 20));
    v = await mgr.status(runId);
  }
  return v;
}

describe('onTerminal hook + admission counter (v8 Slice 4, REQ-052/054)', () => {
  let workRoot: string;
  beforeEach(() => { workRoot = mkdtempSync(join(tmpdir(), 'rwe-s4-')); });
  afterEach(() => { rmSync(workRoot, { recursive: true, force: true }); });

  it('REQ-052 fires onTerminal once for a completed run, not for non-terminal transitions', async () => {
    const events: Array<{ runId: string; status: RunStatus }> = [];
    const mgr = new RunManager({
      store: new InMemoryRunStore(CLOCK), clock: CLOCK, catalog: new WorkflowCatalog(workRoot, CLOCK),
      spawner: echo, onTerminal: (runId, status) => { events.push({ runId, status }); },
    });
    const runId = await startScript(mgr, `return 1;`);
    await settled(mgr, runId);
    await new Promise((r) => setTimeout(r, 30)); // let the fire-and-forget onTerminal settle
    expect(events).toEqual([{ runId, status: 'completed' }]); // once, terminal only (not 'running')
  });

  it('REQ-052 fires onTerminal for a STOPPED run (the .then in _runLive never covers stop)', async () => {
    const events: Array<{ runId: string; status: RunStatus }> = [];
    const blocker: AgentSpawner = { run: () => new Promise(() => {}) }; // never resolves → stays running
    const mgr = new RunManager({
      store: new InMemoryRunStore(CLOCK), clock: CLOCK, catalog: new WorkflowCatalog(workRoot, CLOCK),
      spawner: blocker, onTerminal: (runId, status) => { events.push({ runId, status }); },
    });
    const runId = await startScript(mgr, `const a = await agent('A', {}); return a;`);
    for (let i = 0; i < 50 && (await mgr.status(runId)).status !== 'running'; i++) await new Promise((r) => setTimeout(r, 20));
    await mgr.stop(runId);
    await new Promise((r) => setTimeout(r, 30));
    expect(events).toEqual([{ runId, status: 'stopped' }]);
  }, 20000);

  it('REQ-052 a composite parent fires exactly ONE onTerminal, not one per nested workflow()', async () => {
    const events: Array<{ runId: string; status: RunStatus }> = [];
    const catalog = new WorkflowCatalog(workRoot, CLOCK);
    await registerPublished(catalog, 'leaf', `return 'L';`);
    const mgr = new RunManager({
      store: new InMemoryRunStore(CLOCK), clock: CLOCK, catalog, spawner: echo, maxWorkflowDepth: 2,
      onTerminal: (runId, status) => { events.push({ runId, status }); },
    });
    const runId = await startScript(mgr, `await workflow('leaf', {}); await workflow('leaf', {}); return 'done';`);
    await settled(mgr, runId);
    await new Promise((r) => setTimeout(r, 30));
    expect(events).toEqual([{ runId, status: 'completed' }]); // exactly one — nested runs never _transition
  });

  it('REQ-054 rejects an over-limit start() with RUN_ADMISSION_LIMIT, frees the slot on terminal', async () => {
    const blocker: AgentSpawner = { run: () => new Promise(() => {}) };
    const mgr = new RunManager({
      store: new InMemoryRunStore(CLOCK), clock: CLOCK, catalog: new WorkflowCatalog(workRoot, CLOCK),
      spawner: blocker, maxConcurrentRuns: 1,
    });
    const first = await startScript(mgr, `const a = await agent('A', {}); return a;`); // occupies the 1 slot
    for (let i = 0; i < 50 && (await mgr.status(first)).status !== 'running'; i++) await new Promise((r) => setTimeout(r, 20));

    // Second concurrent start must be rejected before any durable work.
    await expect(startScript(mgr, `return 2;`)).rejects.toMatchObject({ code: 'RUN_ADMISSION_LIMIT' });

    // Free the slot; a subsequent start now succeeds.
    await mgr.stop(first);
    await new Promise((r) => setTimeout(r, 20));
    const third = await startScript(mgr, `return 3;`);
    expect(typeof third).toBe('string');
  }, 20000);
});
