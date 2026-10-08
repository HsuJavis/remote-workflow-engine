// issue #162 (orphan sandbox children, reverify-2 finding): commit 9c444d5's shutdown hook only
// reaps a sandbox child on a GRACEFUL SIGINT/SIGTERM (main.ts -> server.ts close() ->
// RunManager.shutdown()). The actual reported incident (pid 4055762, 44+ hours, 100% CPU) survived
// an engine RESTART — meaning whatever killed the old engine process did NOT run that path (a hard
// kill/crash/OOM never reaches a signal handler). This test covers the layer that does: a boot-time
// sweep that reads a small on-disk record of sandbox-child PIDs the PREVIOUS process instance wrote
// while live, and SIGKILLs any that are still alive and match (start-time-checked, so an unrelated
// LATER process that happens to reuse the same pid is never touched).
//
// Mock policy (integration): a REAL forked `while(true){}` sandbox child (same shape as the
// existing shutdown test), but this test proves the BOOT SWEEP specifically — it SIGKILLs the
// engine's own in-memory bookkeeping is gone (never calls RunManager.shutdown()/mgr.stop()) to
// simulate "the previous process just vanished (kill -9/crash/OOM)", then calls the sweep function
// directly, exactly as a fresh main() boot would, and checks the real OS process dies.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunManager } from '../../src/run-manager.js';
import { WorkflowCatalog } from '../../src/workflow-catalog.js';
import { InMemoryRunStore } from '../../src/run-store.js';
import { FixedClock } from '../../src/clock.js';
import type { AgentSpawner } from '../../src/agent-executor.js';
import { startScript } from '../helpers/workflow-fixtures.js';
import { sandboxChildRegistryDir, sweepOrphanSandboxChildren, recordChildPid } from '../../src/sandbox/host.js';

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

function childPid(entry: unknown, runId: string): number | undefined {
  const sandbox = (entry as { sandbox: unknown }).sandbox;
  const active = (sandbox as { _active: Map<string, { child: { pid?: number } }> })._active;
  return active.get(runId)?.child.pid;
}

describe('issue #162: boot-time sweep reaps a sandbox child that outlived a non-graceful process death', () => {
  let workRoot: string;
  afterEach(() => { if (workRoot) rmSync(workRoot, { recursive: true, force: true }); });

  it('a real forked sandbox child, orphaned by simulating a hard process death (no shutdown() call), is killed by the NEXT boot\'s sweep', async () => {
    workRoot = mkdtempSync(join(tmpdir(), 'rwe-boot-sweep-orphan-'));
    const catalog = new WorkflowCatalog(workRoot, CLOCK);
    const store = new InMemoryRunStore(CLOCK);
    const mgr = new RunManager({ store, clock: CLOCK, catalog, spawner: echoSpawner(), workRoot });

    const runId = await startScript(mgr, 'while (true) {}');
    const runsMap = (mgr as unknown as { _runs: Map<string, unknown> })._runs;
    await waitFor(() => childPid(runsMap.get(runId), runId) !== undefined);
    const pid = childPid(runsMap.get(runId), runId)!;
    expect(isAlive(pid)).toBe(true);

    // The record the live child wrote while this "previous process instance" was still up.
    const dir = sandboxChildRegistryDir(workRoot);
    expect(existsSync(join(dir, `${pid}.json`))).toBe(true);

    // Simulate the previous process just vanishing: NEVER call mgr.shutdown()/mgr.stop() — the
    // in-memory RunManager/SandboxHost state for this pid is gone, exactly as it would be after a
    // real kill -9/OOM/crash. Only the on-disk record (written before the "death") survives, which
    // is exactly what a fresh engine boot would see.
    sweepOrphanSandboxChildren(dir);

    await waitFor(() => !isAlive(pid), 3000);
    expect(isAlive(pid)).toBe(false);
    // The sweep also clears the record it acted on — a boot sweep must not re-kill a LATER,
    // unrelated process should the pid ever be reused.
    expect(existsSync(join(dir, `${pid}.json`))).toBe(false);
  });

  it('a stale record naming a pid that is really a DIFFERENT, later process (start-time mismatch) is left alone', () => {
    workRoot = mkdtempSync(join(tmpdir(), 'rwe-boot-sweep-reuse-'));
    const dir = sandboxChildRegistryDir(workRoot);
    // Record this TEST process's own pid, but under a deliberately wrong recorded start-time —
    // simulating "the recorded pid was reused by an unrelated later process" (the one case the
    // boot sweep must refuse to kill).
    recordChildPid(dir, process.pid);
    const recordPath = join(dir, `${process.pid}.json`);
    const record = JSON.parse(readFileSync(recordPath, 'utf8')) as { pid: number; startTime: string };
    const tampered = { ...record, startTime: `${record.startTime}-not-a-real-starttime` };
    writeFileSync(recordPath, JSON.stringify(tampered));

    sweepOrphanSandboxChildren(dir);

    expect(isAlive(process.pid)).toBe(true); // sanity: we are still here
    // The mismatched (stale/reused-pid) record is still cleared, so it can't accumulate forever.
    expect(existsSync(recordPath)).toBe(false);
  });

  it('an empty / nonexistent registry dir is a no-op — sweep never throws', () => {
    workRoot = mkdtempSync(join(tmpdir(), 'rwe-boot-sweep-empty-'));
    const dir = sandboxChildRegistryDir(workRoot);
    expect(existsSync(dir)).toBe(false);
    expect(() => sweepOrphanSandboxChildren(dir)).not.toThrow();
    if (existsSync(dir)) expect(readdirSync(dir)).toEqual([]);
  });
});
