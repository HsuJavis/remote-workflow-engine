// issue #129(b): the CLI subprocess the SDK spawns (via Options.spawnClaudeCodeProcess) used to
// leave its own stdio-MCP grandchildren running after the dispatch ended — a bare `child.kill()`
// (the SDK's own default) only signals the direct child. `wrapCliChildForGroupKill`
// (claude-agent-sdk-client.ts) wraps a freshly-spawned, DETACHED CLI child so BOTH an explicit
// `.kill()` call AND the child's own natural exit reap the whole process group via
// `cli-lifecycle.ts`'s `RealCliLifecycle.killGroup` (DES-029, previously unwired).
//
// Mock policy (integration, per cli-lifecycle-process-group.test.ts's own "stub child" carve-out):
// a REAL detached process tree is spawned and killed; nothing about the real `claude` CLI itself
// is exercised here (that's the real-tier verification run) — this proves the WRAPPER mechanism in
// isolation, independent of the full `_invokeOnce` dispatch plumbing.
import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { wrapCliChildForGroupKill } from '../../src/gateway/claude-agent-sdk-client.js';
import { RealCliLifecycle } from '../../src/cli-lifecycle.js';

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** A real detached shell that forks a long-lived grandchild and writes its pid to `pidFile`,
 *  mirroring the CLI's own stdio-MCP grandchild shape. */
function spawnLeaderWithGrandchild(pidFile: string, leaderLifeSecs: number): ReturnType<typeof spawn> {
  return spawn('/bin/sh', ['-c', `sleep 100 & echo $! > "${pidFile}"; sleep ${leaderLifeSecs}`], { detached: true });
}

describe('wrapCliChildForGroupKill (issue #129b)', () => {
  it('an explicit .kill() on the wrapper reaps the WHOLE process group, not just the direct child', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-i129b-'));
    const pidFile = join(dir, 'g.pid');
    try {
      const child = spawnLeaderWithGrandchild(pidFile, 100);
      const wrapped = wrapCliChildForGroupKill(child, new RealCliLifecycle({}));
      await new Promise((r) => setTimeout(r, 300));
      const grandchildPid = Number(readFileSync(pidFile, 'utf-8').trim());
      expect(pidAlive(child.pid!)).toBe(true);
      expect(pidAlive(grandchildPid)).toBe(true);

      wrapped.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 300));
      expect(pidAlive(grandchildPid)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 10000);

  it('the LEADER exiting on its own (no explicit kill) still reaps a surviving grandchild', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-i129b-'));
    const pidFile = join(dir, 'g.pid');
    try {
      // Leader lives 0.5s then exits by itself — the grandchild (sleep 100) outlives it unless
      // the wrapper's own 'exit' listener sweeps the group.
      const child = spawnLeaderWithGrandchild(pidFile, 0.5);
      wrapCliChildForGroupKill(child, new RealCliLifecycle({}));
      await new Promise((r) => setTimeout(r, 150));
      const grandchildPid = Number(readFileSync(pidFile, 'utf-8').trim());
      expect(pidAlive(grandchildPid)).toBe(true); // confirms the leader hasn't reaped it on its own

      await new Promise((r) => setTimeout(r, 700));
      expect(pidAlive(child.pid!)).toBe(false); // the leader itself is gone
      expect(pidAlive(grandchildPid)).toBe(false); // and so is the grandchild — the wrapper reaped it
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 10000);
});
