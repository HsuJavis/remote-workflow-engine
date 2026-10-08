// pi harness v1, residual fix: srt-mux socket leak. `@anthropic-ai/sandbox-runtime`'s mux proxy
// names its unix socket `srt-mux-<process.pid>-<seq>.sock` under `os.tmpdir()` (mux-proxy.js) —
// that `process.pid` is the PI CHILD's own pid (SandboxManager runs inside session-runner.ts,
// which executes in the spawned child, not a grandchild), so it is byte-identical to the
// `child.pid` PiGatewayClient already observes. `SandboxManager.reset()`'s teardown is async, but
// srt registers it only on `process.once('exit', ...)` (sandbox-manager.js) — a listener Node
// invokes SYNCHRONOUSLY right before the event loop stops, so the awaited `muxProxyServer.close()`
// inside reset() never gets to finish before entry.ts's own `process.exit(0)` actually ends the
// process. A SIGKILLed child (abort/timeout) never runs ANY exit handler at all. Either way, the
// parent is the only place a leaked socket can be swept with certainty — this suite proves that
// sweep without needing real srt/bwrap: a fake child (the same `spawnChild` seam
// pi-gateway-client.test.ts uses) with a REAL pid-shaped temp file standing in for the socket.
import { describe, it, expect, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { existsSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PiGatewayClient } from '../../src/gateway/pi-gateway-client.js';
import type { AgentOpts } from '../../src/types.js';

function fakeChild(pid: number) {
  const emitter = new EventEmitter() as EventEmitter & { stdin: PassThrough; stdout: PassThrough; stderr: PassThrough; pid: number; kill: (sig?: string) => void };
  emitter.stdin = new PassThrough();
  emitter.stdout = new PassThrough();
  emitter.stderr = new PassThrough();
  emitter.pid = pid;
  emitter.kill = () => { /* the unit test drives exit itself, never a real signal */ };
  return {
    child: emitter,
    sendLine: (obj: unknown) => emitter.stdout.write(JSON.stringify(obj) + '\n'),
    exit: (code: number | null = 0) => { emitter.stdout.end(); emitter.stderr.end(); emitter.emit('exit', code, null); },
  };
}

function req(pid: number, overrides: Partial<Parameters<PiGatewayClient['invoke']>[0]> = {}) {
  return {
    prompt: 'hi',
    opts: { model: 'ollama/qwen2.5:7b' } as AgentOpts,
    runId: `sweep-r-${pid}`,
    agentId: `sweep-a-${pid}`,
    workspace: '/tmp/pi-gw-sweep-ws',
    ...overrides,
  };
}

const leftoverSockets: string[] = [];
function plantSocket(pid: number, seq = 0): string {
  const p = join(tmpdir(), `srt-mux-${pid}-${seq.toString(36)}.sock`);
  writeFileSync(p, '');
  leftoverSockets.push(p);
  return p;
}

afterEach(() => {
  for (const p of leftoverSockets.splice(0)) { try { rmSync(p, { force: true }); } catch { /* already swept, expected */ } }
});

describe('PiGatewayClient — sweeps srt-mux-<childPid>-*.sock after every dispatch (residual fix)', () => {
  it('sweeps the planted socket after a normal successful exit', async () => {
    const pid = 51001;
    const sock = plantSocket(pid);
    const f = fakeChild(pid);
    const gw = new PiGatewayClient({ spawnChild: (() => f.child) as never, entryPath: '/fake/entry.ts' });
    const promise = gw.invoke(req(pid));
    await new Promise((r) => setTimeout(r, 10));
    f.sendLine({ t: 'final', seq: 1, text: 'ok', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, stopReason: 'stop' });
    f.exit(0);
    await promise;
    expect(existsSync(sock)).toBe(false);
  });

  it('sweeps the planted socket after an aborted dispatch (child killed, never ran its own cleanup)', async () => {
    const pid = 51002;
    const sock = plantSocket(pid);
    const f = fakeChild(pid);
    const gw = new PiGatewayClient({ spawnChild: (() => f.child) as never, entryPath: '/fake/entry.ts' });
    const controller = new AbortController();
    const promise = gw.invoke(req(pid, { signal: controller.signal }));
    await new Promise((r) => setTimeout(r, 10));
    controller.abort();
    f.exit(null); // a killed process reports exit with no code, signal SIGTERM/SIGKILL
    await promise;
    expect(existsSync(sock)).toBe(false);
  });

  it('sweeps the planted socket after a timeout', async () => {
    const pid = 51003;
    const sock = plantSocket(pid);
    const f = fakeChild(pid);
    const gw = new PiGatewayClient({ spawnChild: (() => f.child) as never, entryPath: '/fake/entry.ts', timeoutMs: 20 });
    const promise = gw.invoke(req(pid));
    await new Promise((r) => setTimeout(r, 40));
    f.exit(null);
    const result = await promise;
    expect(result.ok).toBe(false);
    expect(existsSync(sock)).toBe(false);
  });

  it('never touches a socket belonging to a DIFFERENT pid', async () => {
    const pid = 51004;
    const otherPid = 51005;
    const own = plantSocket(pid);
    const other = plantSocket(otherPid);
    const f = fakeChild(pid);
    const gw = new PiGatewayClient({ spawnChild: (() => f.child) as never, entryPath: '/fake/entry.ts' });
    const promise = gw.invoke(req(pid));
    await new Promise((r) => setTimeout(r, 10));
    f.sendLine({ t: 'final', seq: 1, text: 'ok', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, stopReason: 'stop' });
    f.exit(0);
    await promise;
    expect(existsSync(own)).toBe(false);
    expect(existsSync(other)).toBe(true);
  });
});
