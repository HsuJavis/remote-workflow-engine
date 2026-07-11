// TASK-027 hardening: pre-bind port ownership check + process-group cascade-kill on
// LiteLLMProxyManager. Gate 5's own 05-tests.md scoped TASK-027's test coverage to UT-033's
// `litellmPort` composeConfig-wiring case + VAL-011's generic deploy-artifact checks; neither
// forces this class's own internal hardening behavior (the actual "orphan-reap + pre-bind check"
// deliverable both Gate-3/4 panels called binding). Since it's deterministically testable via the
// class's own pre-existing spawnImpl/fetchImpl injection seams (no real `litellm` binary needed),
// this implementer round closes that coverage gap directly rather than shipping it untested.
import { describe, it, expect, vi, afterEach } from 'vitest';
import net from 'node:net';
import type { ChildProcess } from 'node:child_process';
import { LiteLLMProxyManager } from '../../src/gateway/litellm-proxy.js';

const ALIASES = { default: { provider: 'anthropic' as const, model: 'claude-3-5-haiku-20241022' } };

function makeFakeSpawn(pid: number | undefined) {
  const fakeProc = { exitCode: null, kill: vi.fn(), pid } as unknown as ChildProcess;
  return { fakeSpawn: vi.fn(() => fakeProc), fakeProc };
}

describe('LiteLLMProxyManager hardening (TASK-027)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fails fast with an actionable message when the port is already bound (pre-bind ownership check)', async () => {
    // Real TCP bind on an ephemeral, then-fixed port — simulates a stale/foreign process already
    // occupying it, WITHOUT ever spawning a real `litellm` binary.
    const occupier = net.createServer();
    await new Promise<void>((resolve) => occupier.listen(0, '127.0.0.1', resolve));
    const address = occupier.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    const { fakeSpawn } = makeFakeSpawn(123);
    const fakeHealthFetch = vi.fn(async () => ({ ok: true }) as unknown as Response);
    const proxy = new LiteLLMProxyManager(ALIASES, {
      port,
      spawnImpl: fakeSpawn as unknown as typeof import('node:child_process').spawn,
      fetchImpl: fakeHealthFetch as unknown as typeof fetch,
    });

    await expect(proxy.start()).rejects.toThrow(/already in use/i);
    expect(fakeSpawn).not.toHaveBeenCalled(); // never even tries to spawn onto an owned port

    await new Promise<void>((resolve) => occupier.close(() => resolve()));
  });

  it('starts normally on a genuinely free port (pre-bind check is a non-issue on the happy path)', async () => {
    const { fakeSpawn } = makeFakeSpawn(456);
    const fakeHealthFetch = vi.fn(async () => ({ ok: true }) as unknown as Response);
    // Port 0 is never itself bindable as a fixed target for the ownership probe semantics we want
    // to exercise here, so pick a high, essentially-never-colliding fixed port instead.
    const proxy = new LiteLLMProxyManager(ALIASES, {
      port: 48173,
      spawnImpl: fakeSpawn as unknown as typeof import('node:child_process').spawn,
      fetchImpl: fakeHealthFetch as unknown as typeof fetch,
    });

    const { baseUrl } = await proxy.start();
    expect(baseUrl).toBe('http://127.0.0.1:48173');
    expect(fakeSpawn).toHaveBeenCalled();
  });

  it('D-V3M-4: with NO configured port, binds a dynamic ephemeral port (never the old hard-coded 4000) and spawns litellm with it', async () => {
    const { fakeSpawn } = makeFakeSpawn(321);
    const fakeHealthFetch = vi.fn(async () => ({ ok: true }) as unknown as Response);
    const proxy = new LiteLLMProxyManager(ALIASES, {
      // no `port` — the dynamic-port path
      spawnImpl: fakeSpawn as unknown as typeof import('node:child_process').spawn,
      fetchImpl: fakeHealthFetch as unknown as typeof fetch,
    });

    const { baseUrl } = await proxy.start();
    const m = /^http:\/\/127\.0\.0\.1:(\d+)$/.exec(baseUrl);
    expect(m).not.toBeNull();
    const port = Number(m![1]);
    expect(port).toBeGreaterThan(0);
    expect(port).not.toBe(4000); // no more squatting the fixed port that collided across instances
    // the SAME resolved port is what litellm was actually spawned with
    const spawnArgs = (fakeSpawn.mock.calls[0] as unknown as unknown[])[1] as string[];
    expect(spawnArgs).toContain('--port');
    expect(spawnArgs[spawnArgs.indexOf('--port') + 1]).toBe(String(port));
  });

  it('stop() cascade-kills the whole process group via a negative-pid signal, not just the direct handle', async () => {
    const { fakeSpawn, fakeProc } = makeFakeSpawn(789);
    const fakeHealthFetch = vi.fn(async () => ({ ok: true }) as unknown as Response);
    const proxy = new LiteLLMProxyManager(ALIASES, {
      port: 48174,
      spawnImpl: fakeSpawn as unknown as typeof import('node:child_process').spawn,
      fetchImpl: fakeHealthFetch as unknown as typeof fetch,
    });
    await proxy.start();

    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
    await proxy.stop();

    expect(killSpy).toHaveBeenCalledWith(-789, 'SIGTERM');
    expect(fakeProc.kill).not.toHaveBeenCalled(); // group signal alone was sufficient
  });

  it('stop() falls back to the direct handle kill when the child has no usable pid (test-double shape)', async () => {
    const { fakeSpawn, fakeProc } = makeFakeSpawn(undefined);
    const fakeHealthFetch = vi.fn(async () => ({ ok: true }) as unknown as Response);
    const proxy = new LiteLLMProxyManager(ALIASES, {
      port: 48175,
      spawnImpl: fakeSpawn as unknown as typeof import('node:child_process').spawn,
      fetchImpl: fakeHealthFetch as unknown as typeof fetch,
    });
    await proxy.start();

    await proxy.stop();

    expect(fakeProc.kill).toHaveBeenCalled();
  });
});
