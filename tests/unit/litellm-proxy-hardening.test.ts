// TASK-027 hardening: pre-bind port ownership check + process-group cascade-kill on
// LiteLLMProxyManager. Gate 5's own 05-tests.md scoped TASK-027's test coverage to UT-033's
// `litellmPort` composeConfig-wiring case + VAL-011's generic deploy-artifact checks; neither
// forces this class's own internal hardening behavior (the actual "orphan-reap + pre-bind check"
// deliverable both Gate-3/4 panels called binding). Since it's deterministically testable via the
// class's own pre-existing spawnImpl/fetchImpl injection seams (no real `litellm` binary needed),
// this implementer round closes that coverage gap directly rather than shipping it untested.
import { describe, it, expect, vi, afterEach } from 'vitest';
import net from 'node:net';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { LiteLLMProxyManager } from '../../src/gateway/litellm-proxy.js';

const ALIASES = { default: { provider: 'anthropic' as const, model: 'claude-3-5-haiku-20241022' } };

function makeFakeSpawn(pid: number | undefined) {
  // A real ChildProcess IS an EventEmitter; this fake was a plain object, so it silently lacked
  // `.on`/`.once` and any production code attaching a listener would blow up here rather than in
  // production. Built on EventEmitter now (v23 adjudication #6 V-2, which attaches an 'error'
  // listener at spawn) — a more faithful stand-in, not a concession to the code under test.
  const fakeProc = Object.assign(new EventEmitter(), { exitCode: null, kill: vi.fn(), pid }) as unknown as ChildProcess;
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

// V-2 (v23 orchestrator adjudication #6 — REQ-102, ARCH-005): the managed-LiteLLM spawn has no
// `proc.on('error', ...)` handler. A ChildProcess's 'error' event with ZERO listeners throws
// synchronously wherever Node emits it (EventEmitter's own contract); for a real spawn failure
// (e.g. `litellm` missing from PATH -> ENOENT) that emission happens from libuv's own callback with
// no enclosing try/catch, i.e. an UNCAUGHT PROCESS-LEVEL EXCEPTION — and v23 made this reachable
// from `workflow_register` (registration now enqueues an analyzer job that lazily starts this
// proxy). Verified at source: `litellm-proxy.ts` attaches `proc.once('exit', ...)` only AFTER a
// successful healthcheck (`_superviseExit`, called only on the `res.ok` branch) — there is no
// `.on('error', ...)`/`.once('error', ...)` call anywhere in the file.
//
// This test asserts a listener is attached to the spawned child by the time of the FIRST startup
// health poll — the actual vulnerable window (a real spawn failure fires 'error' during startup,
// before the process is ever healthy) — not merely by the time `start()` eventually settles: a fix
// that only attaches the listener in `_superviseExit` (next to the existing `once('exit')`, the
// natural place to look) would leave this exact window open while still turning a weaker
// after-settle assertion green. Deterministic and safe: it checks registration, not a real crash,
// because deliberately triggering the real (unhandled, async) crash inside a test would risk taking
// the whole test worker down with it.
//
// Red reason: no such listener is ever attached anywhere in `start()` — verified by reading
// litellm-proxy.ts's full `start()` body before writing this assertion, not assumed.
describe('LiteLLMProxyManager — a spawn failure must not escape as an unhandled process-level exception (V-2, adjudication #6)', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('attaches an error listener to the spawned child BEFORE the first startup health poll', async () => {
    let proc: (EventEmitter & { exitCode: number | null; pid: undefined; kill: () => void }) | undefined;
    const fakeSpawn = vi.fn(() => {
      proc = new EventEmitter() as EventEmitter & { exitCode: number | null; pid: undefined; kill: () => void };
      proc.exitCode = null;
      proc.pid = undefined;
      proc.kill = () => { proc!.exitCode = 0; };
      return proc as unknown as ChildProcess;
    });
    let listenersAtFirstPoll = -1;
    const fakeHealthFetch = vi.fn(async () => {
      if (listenersAtFirstPoll === -1) listenersAtFirstPoll = proc!.listenerCount('error');
      return { ok: true } as unknown as Response;
    });
    const proxy = new LiteLLMProxyManager(ALIASES, {
      port: 48176,
      spawnImpl: fakeSpawn as unknown as typeof import('node:child_process').spawn,
      fetchImpl: fakeHealthFetch as unknown as typeof fetch,
    });

    await proxy.start();

    expect(listenersAtFirstPoll).toBeGreaterThan(0);
  });
});
