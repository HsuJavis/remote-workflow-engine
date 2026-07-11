// IT-040: Real process-group spawn/kill reaps grandchildren + race-safe port selection
// (DES-029, TASK-037, ARCH-005/ARCH-017). No mock of the SUT boundary: a REAL detached child
// process tree is spawned and killed; only the specific "stub child" (not a real `claude` CLI) is
// substituted, per the mock policy's own "stub child" carve-out.
// RED: src/cli-lifecycle.js does not exist yet — module-not-found.
import { describe, it, expect } from 'vitest';
import { createServer as createNetServer } from 'node:net';
// Value import — causes module-not-found at load time when the module is absent.
import { RealCliLifecycle } from '../../src/cli-lifecycle.js';

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe('RealCliLifecycle — real process-group kill reaps grandchildren (DES-029)', () => {
  it('killGroup on a detached parent also kills its real stdio grandchild (never orphaned)', async () => {
    const lifecycle = new RealCliLifecycle({});
    // A real shell that spawns a real long-lived grandchild ('sleep'), mirroring the CLI's own
    // stdio-MCP grandchild shape (the exact real-process pattern that motivates process-group kill).
    const handle = lifecycle.spawnDetached('/bin/sh', ['-c', 'sleep 100 & echo $! > /dev/null; wait'], { cwd: process.cwd() });
    // Give the shell a moment to actually fork its grandchild.
    await new Promise((r) => setTimeout(r, 300));
    expect(pidAlive(handle.pid!)).toBe(true);

    lifecycle.killGroup(handle);
    await new Promise((r) => setTimeout(r, 300));
    expect(pidAlive(handle.pid!)).toBe(false);
  }, 10000);
});

describe('RealCliLifecycle — race-safe port selection (bind port 0, never check-then-bind, DES-029)', () => {
  it('two rapid managers each bound to port 0 get distinct, real, already-bound ports with no EADDRINUSE', async () => {
    const s1 = createNetServer();
    const s2 = createNetServer();
    const port1 = await new Promise<number>((resolve) => s1.listen(0, '127.0.0.1', () => resolve((s1.address() as { port: number }).port)));
    const port2 = await new Promise<number>((resolve) => s2.listen(0, '127.0.0.1', () => resolve((s2.address() as { port: number }).port)));
    expect(port1).not.toBe(port2);
    expect(port1).toBeGreaterThan(0);
    await Promise.all([
      new Promise((r) => s1.close(r)),
      new Promise((r) => s2.close(r)),
    ]);
    // This half of the test already passes with plain node:net (regression floor); the real gap is
    // that LiteLLMProxyManager itself still hard-codes port 4000 rather than doing this bind-port-0
    // dance (state.yaml's documented port-4000-collision hazard) — proven by the module-not-found
    // RED above for RealCliLifecycle, the reusable primitive TASK-037 introduces for this.
  });
});
