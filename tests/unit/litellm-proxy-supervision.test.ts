// S-2 (Gate 8 v2 review, quality-dimensions finding): LiteLLMProxyManager had no post-start
// liveness/restart supervision — a mid-run crash of the now-default gateway's always-on subprocess
// was permanent for the process's life. This pins the supervision behavior via the class's own
// injectable spawnImpl/fetchImpl seams (no real `litellm` binary), using an EventEmitter fake so an
// 'exit' can be simulated.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { LiteLLMProxyManager } from '../../src/gateway/litellm-proxy.js';

const HEALTHY = vi.fn(async () => ({ ok: true }) as unknown as Response);

// A fake child that is a real EventEmitter (so we can emit 'exit'). pid:undefined keeps
// _killProcessGroup off process.kill(-pid) and on the direct handle.kill() (no real signal sent).
function makeFakeProc(): ChildProcess & EventEmitter {
  const proc = new EventEmitter() as EventEmitter & { exitCode: number | null; pid: undefined; kill: () => void };
  proc.exitCode = null;
  proc.pid = undefined;
  proc.kill = () => { proc.exitCode = 0; };
  return proc as unknown as ChildProcess & EventEmitter;
}

function spawnFactory() {
  const procs: (ChildProcess & EventEmitter)[] = [];
  const fakeSpawn = vi.fn(() => {
    const p = makeFakeProc();
    procs.push(p);
    return p;
  });
  return { fakeSpawn, procs };
}

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

describe('LiteLLMProxyManager supervision (S-2)', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('auto-restarts the subprocess when it crashes unexpectedly mid-life', async () => {
    const { fakeSpawn, procs } = spawnFactory();
    const events: Array<{ kind: string; restarts: number }> = [];
    const proxy = new LiteLLMProxyManager({
      port: 48200,
      restartDelayMs: 0,
      spawnImpl: fakeSpawn as unknown as typeof import('node:child_process').spawn,
      fetchImpl: HEALTHY as unknown as typeof fetch,
      onSupervisionEvent: (ev) => events.push({ kind: ev.kind, restarts: ev.restarts }),
    });

    const { baseUrl } = await proxy.start();
    expect(baseUrl).toBe('http://127.0.0.1:48200');
    expect(proxy.liveness()).toEqual({ up: true, restarts: 0 });
    expect(fakeSpawn).toHaveBeenCalledTimes(1);

    // Simulate a mid-run crash of the always-on subprocess.
    (procs[0] as unknown as { exitCode: number }).exitCode = 1;
    procs[0].emit('exit', 1);
    await tick();

    // Supervised: a fresh subprocess was spawned and the manager is up again.
    expect(fakeSpawn).toHaveBeenCalledTimes(2);
    expect(proxy.liveness()).toEqual({ up: true, restarts: 1 });
    expect(events).toEqual([{ kind: 'restart', restarts: 1 }]);
  });

  it('stops restarting after maxRestarts (crash-loop guard) and reports it down', async () => {
    const { fakeSpawn, procs } = spawnFactory();
    const events: Array<{ kind: string }> = [];
    const proxy = new LiteLLMProxyManager({
      port: 48201,
      restartDelayMs: 0,
      maxRestarts: 1,
      spawnImpl: fakeSpawn as unknown as typeof import('node:child_process').spawn,
      fetchImpl: HEALTHY as unknown as typeof fetch,
      onSupervisionEvent: (ev) => events.push({ kind: ev.kind }),
    });

    await proxy.start();                 // proc 0
    procs[0].emit('exit', 1);            // → restart 1 (proc 1)
    await tick();
    expect(proxy.liveness().up).toBe(true);
    procs[1].emit('exit', 1);            // → exceeds maxRestarts=1 → give up
    await tick();

    expect(proxy.liveness()).toEqual({ up: false, restarts: 1 });
    expect(fakeSpawn).toHaveBeenCalledTimes(2); // proc0 + one restart, no third attempt
    expect(events.map((e) => e.kind)).toEqual(['restart', 'exhausted']);
  });

  it('does NOT restart on an expected stop()', async () => {
    const { fakeSpawn, procs } = spawnFactory();
    const proxy = new LiteLLMProxyManager({
      port: 48202,
      restartDelayMs: 0,
      spawnImpl: fakeSpawn as unknown as typeof import('node:child_process').spawn,
      fetchImpl: HEALTHY as unknown as typeof fetch,
    });
    await proxy.start();
    await proxy.stop();                  // expected shutdown
    procs[0].emit('exit', 0);            // the kill's own exit event
    await tick();
    expect(fakeSpawn).toHaveBeenCalledTimes(1); // never auto-restarted
    expect(proxy.liveness()).toEqual({ up: false, restarts: 0 });
  });
});
