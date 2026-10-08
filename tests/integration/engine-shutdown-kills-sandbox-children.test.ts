// issue #162 (orphan sandbox children): before this fix, NOTHING on this engine's shutdown path
// (main.ts's SIGINT/SIGTERM handler -> server.ts's close()) ever reached into RunManager's own
// state to kill a live run's forked sandbox child — `http.close()` only stops accepting new
// connections. A script's child OS process (`child_process.fork()`, the same mechanism
// run_stop/run_suspend already SIGKILLs) is a fully independent OS process that outlives this one
// unless explicitly killed; in production a synchronous `while(true){}` child survived an engine
// RESTART this way and spun at 100% CPU for two days.
//
// Mock policy (integration): real RunManager + real on-disk WorkflowCatalog + a REAL forked
// sandbox child (no mock spawner needed — this script never calls agent() at all, so there is
// nothing to mock). The one thing reached into via an unsafe cast is SandboxHost's private
// `_active` map, purely to read the real child's pid for the assertion — the SAME kind of
// private-field reach other integration tests in this suite already use (e.g.
// nested-workflow-args-validation.test.ts's `_runs`/`_handleWorkflowRequest` casts).
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

function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function waitFor(predicate: () => boolean, timeoutMs = 5000, stepMs = 25): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  throw new Error('waitFor timed out');
}

// Reaches SandboxHost's own private `_active` map to read the real forked child's pid — no public
// accessor exists for this (by design: the sandbox boundary is an implementation detail, not an
// API surface), so this is the SAME unsafe-cast style other tests in this suite already use for
// their own private-state assertions.
function childPid(entry: unknown, runId: string): number | undefined {
  const sandbox = (entry as { sandbox: unknown }).sandbox;
  const active = (sandbox as { _active: Map<string, { child: { pid?: number } }> })._active;
  return active.get(runId)?.child.pid;
}

describe('issue #162: engine shutdown SIGKILLs every live run\'s forked sandbox child', () => {
  let workRoot: string;
  afterEach(() => { if (workRoot) rmSync(workRoot, { recursive: true, force: true }); });

  it('a real forked sandbox child running a synchronous infinite loop is dead after RunManager.shutdown()', async () => {
    workRoot = mkdtempSync(join(tmpdir(), 'rwe-shutdown-orphan-'));
    const catalog = new WorkflowCatalog(workRoot, CLOCK);
    const store = new InMemoryRunStore(CLOCK);
    const mgr = new RunManager({ store, clock: CLOCK, catalog, spawner: echoSpawner() });

    // A synchronous infinite loop — the exact shape the production incident named: it blocks the
    // script's own event loop, so it can only ever be reaped from OUTSIDE the child process.
    const runId = await startScript(mgr, 'while (true) {}');

    const runsMap = (mgr as unknown as { _runs: Map<string, unknown> })._runs;
    await waitFor(() => childPid(runsMap.get(runId), runId) !== undefined);
    const pid = childPid(runsMap.get(runId), runId)!;
    expect(isAlive(pid)).toBe(true); // sanity: the real child really is running before we act

    await mgr.shutdown();

    // SIGKILL delivery + the kernel reaping the process is not synchronous with the signal call —
    // poll briefly rather than asserting dead the very next microtask.
    await waitFor(() => !isAlive(pid), 3000);
    expect(isAlive(pid)).toBe(false);
  });

  it('a run with no live sandbox child (already terminal) is a no-op — shutdown() never throws', async () => {
    workRoot = mkdtempSync(join(tmpdir(), 'rwe-shutdown-noop-'));
    const catalog = new WorkflowCatalog(workRoot, CLOCK);
    const store = new InMemoryRunStore(CLOCK);
    const mgr = new RunManager({ store, clock: CLOCK, catalog, spawner: echoSpawner() });
    const runId = await startScript(mgr, 'return 1;');
    // Let the (fast, completing) script actually finish before shutdown — a terminal run must be
    // left alone, never re-killed or otherwise touched.
    let view = await mgr.status(runId);
    for (let i = 0; i < 200 && view.status === 'running'; i++) {
      await new Promise((r) => setTimeout(r, 10));
      view = await mgr.status(runId);
    }
    expect(view.status).toBe('completed');
    await expect(mgr.shutdown()).resolves.toBeUndefined();
  });
});
