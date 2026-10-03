// pi harness v1, rest of slice (f): the outer `attemptsFor` retry loop (DES-249 parity with the sdk
// gateway's own `invoke()`/`_invokeOnce` split), error classification (401/403/404 terminal; 429/
// 5xx/overloaded retryable), the `agent.confinement` event (late-bound via `bindEventSink`, same
// structural seam server.ts already calls on any gateway that implements it), and `harnessVersion`
// on both the harness descriptor and the confinement event. All against a FAKE child (the
// `spawnChild` seam) — no real pi/ollama needed; the retry COUNT is the fake-child spawn count.
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { PiGatewayClient, classifyPiErrorMessage } from '../../src/gateway/pi-gateway-client.js';
import { PI_HARNESS_VERSION } from '../../src/harness-info.js';
import type { AgentOpts } from '../../src/types.js';
import type { EngineEvent } from '../../src/event-log.js';

function fakeChild() {
  const emitter = new EventEmitter() as EventEmitter & { stdin: PassThrough; stdout: PassThrough; stderr: PassThrough; pid: number; kill: ReturnType<typeof vi.fn> };
  emitter.stdin = new PassThrough();
  emitter.stdout = new PassThrough();
  emitter.stderr = new PassThrough();
  emitter.pid = Math.floor(Math.random() * 100_000) + 60_000;
  emitter.kill = vi.fn();
  return {
    child: emitter,
    sendLine: (obj: unknown) => emitter.stdout.write(JSON.stringify(obj) + '\n'),
    exit: (code: number | null = 0) => emitter.emit('exit', code, null),
  };
}

function req(overrides: Partial<Parameters<PiGatewayClient['invoke']>[0]> = {}) {
  return {
    prompt: 'hi',
    opts: { model: 'ollama/qwen2.5:7b' } as AgentOpts,
    runId: 'r1',
    agentId: 'a1',
    workspace: '/tmp/pi-gw-attempts-ws',
    ...overrides,
  };
}

describe('classifyPiErrorMessage — pattern-matches the HTTP status out of formatProviderError\'s string shapes', () => {
  it.each([
    ['401 Incorrect API key provided: sk-***', 'terminal'],
    ['403: forbidden', 'terminal'],
    ['openrouter (404): model not found', 'terminal'],
    ['429 Too Many Requests', 'retry'],
    ['500: internal server error', 'retry'],
    ['openrouter (503): overloaded', 'retry'],
    ['the model is overloaded, please retry', 'retry'],
    ['ECONNRESET', 'retry'],
  ] as const)('classifyPiErrorMessage(%s) -> %s', (message, expected) => {
    expect(classifyPiErrorMessage(message)).toBe(expected);
  });
});

describe('PiGatewayClient — outer attemptsFor retry loop (rest of slice f)', () => {
  it('an untimed call gets exactly ONE attempt even on a retryable failure', async () => {
    const spawned: ReturnType<typeof fakeChild>[] = [];
    const spawnChild = vi.fn(() => {
      const f = fakeChild();
      spawned.push(f);
      queueMicrotask(() => { f.sendLine({ t: 'error', message: '500: boom' }); f.exit(1); });
      return f.child as never;
    });
    const gw = new PiGatewayClient({ spawnChild: spawnChild as never, entryPath: '/fake/entry.ts' });
    const result = await gw.invoke(req());
    expect(result.ok).toBe(false);
    expect(spawnChild).toHaveBeenCalledTimes(1);
  });

  it('a timed call retries a retryable (5xx) failure up to 1+retries attempts, then gives up', async () => {
    let n = 0;
    const spawnChild = vi.fn(() => {
      n += 1;
      const f = fakeChild();
      queueMicrotask(() => { f.sendLine({ t: 'error', message: '503: overloaded' }); f.exit(1); });
      return f.child as never;
    });
    const gw = new PiGatewayClient({ spawnChild: spawnChild as never, entryPath: '/fake/entry.ts', retries: 2 });
    const result = await gw.invoke(req({ opts: { model: 'ollama/qwen2.5:7b', timeoutMs: 5000 } as AgentOpts }));
    expect(result.ok).toBe(false);
    expect(spawnChild).toHaveBeenCalledTimes(3); // 1 + retries
    expect(n).toBe(3);
  });

  it('a terminal (401) failure stops retrying immediately, never spawning a second child', async () => {
    const spawnChild = vi.fn(() => {
      const f = fakeChild();
      queueMicrotask(() => { f.sendLine({ t: 'error', message: '401: invalid api key' }); f.exit(1); });
      return f.child as never;
    });
    const gw = new PiGatewayClient({ spawnChild: spawnChild as never, entryPath: '/fake/entry.ts', retries: 2 });
    const result = await gw.invoke(req({ opts: { model: 'ollama/qwen2.5:7b', timeoutMs: 5000 } as AgentOpts }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.retryable).toBe(false);
    expect(spawnChild).toHaveBeenCalledTimes(1);
  });

  it('a success on the second attempt returns ok:true with usage folded across both attempts', async () => {
    let n = 0;
    const spawnChild = vi.fn(() => {
      n += 1;
      const f = fakeChild();
      if (n === 1) {
        queueMicrotask(() => {
          f.sendLine({ t: 'message_end', seq: 1, text: 'partial', usage: { input: 3, output: 1, cacheRead: 0, cacheWrite: 0 }, stopReason: 'stop' });
          f.sendLine({ t: 'error', message: '500: boom' });
          f.exit(1);
        });
      } else {
        queueMicrotask(() => {
          f.sendLine({ t: 'message_end', seq: 1, text: 'ok', usage: { input: 5, output: 2, cacheRead: 0, cacheWrite: 0 }, stopReason: 'stop' });
          f.sendLine({ t: 'final', seq: 1, text: 'ok', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, stopReason: 'stop' });
          f.exit(0);
        });
      }
      return f.child as never;
    });
    const gw = new PiGatewayClient({ spawnChild: spawnChild as never, entryPath: '/fake/entry.ts', retries: 2 });
    const result = await gw.invoke(req({ opts: { model: 'ollama/qwen2.5:7b', timeoutMs: 5000 } as AgentOpts }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.tokens).toEqual({ input: 8, output: 3, cacheRead: 0, cacheWrite: 0 });
    expect(spawnChild).toHaveBeenCalledTimes(2);
  });
});

describe('PiGatewayClient — agent.confinement event + harnessVersion (rest of slice f)', () => {
  it('emits agent.confinement once per attempt via bindEventSink, with harnessVersion set', async () => {
    let n = 0;
    const spawnChild = vi.fn(() => {
      n += 1;
      const f = fakeChild();
      if (n === 1) queueMicrotask(() => { f.sendLine({ t: 'error', message: '500: boom' }); f.exit(1); });
      else queueMicrotask(() => { f.sendLine({ t: 'final', seq: 1, text: 'ok', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, stopReason: 'stop' }); f.exit(0); });
      return f.child as never;
    });
    const gw = new PiGatewayClient({ spawnChild: spawnChild as never, entryPath: '/fake/entry.ts', retries: 1, confinementPosture: 'unconfined' });
    const events: EngineEvent[] = [];
    gw.bindEventSink((ev) => events.push(ev));
    await gw.invoke(req({ opts: { model: 'ollama/qwen2.5:7b', timeoutMs: 5000 } as AgentOpts }));
    const confinementEvents = events.filter((e): e is Extract<EngineEvent, { kind: 'agent.confinement' }> => e.kind === 'agent.confinement');
    expect(confinementEvents.map((e) => e.attempt)).toEqual([1, 2]);
    expect(confinementEvents[0]!.harnessVersion).toBe(PI_HARNESS_VERSION);
    expect(confinementEvents[0]!.posture).toBe('unconfined');
    expect(confinementEvents[0]!.sdkVersion).toBeUndefined();
  });

  it('a gateway with no bound sink never throws (the default is a no-op, same as the sdk gateway)', async () => {
    const f = fakeChild();
    const gw = new PiGatewayClient({ spawnChild: (() => f.child) as never, entryPath: '/fake/entry.ts' });
    const promise = gw.invoke(req());
    await new Promise((r) => setTimeout(r, 10));
    f.sendLine({ t: 'final', seq: 1, text: 'ok', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, stopReason: 'stop' });
    f.exit(0);
    await expect(promise).resolves.toMatchObject({ ok: true });
  });

  it('onHarness carries harnessVersion and is still called exactly once per call (not once per attempt)', async () => {
    let n = 0;
    const spawnChild = vi.fn(() => {
      n += 1;
      const f = fakeChild();
      if (n === 1) queueMicrotask(() => { f.sendLine({ t: 'error', message: '500: boom' }); f.exit(1); });
      else queueMicrotask(() => { f.sendLine({ t: 'final', seq: 1, text: 'ok', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, stopReason: 'stop' }); f.exit(0); });
      return f.child as never;
    });
    const gw = new PiGatewayClient({ spawnChild: spawnChild as never, entryPath: '/fake/entry.ts', retries: 1 });
    const harnessCalls: unknown[] = [];
    await gw.invoke(req({ opts: { model: 'ollama/qwen2.5:7b', timeoutMs: 5000 } as AgentOpts, onHarness: async (h) => { harnessCalls.push(h); } }));
    expect(harnessCalls.length).toBe(1);
    expect((harnessCalls[0] as { harnessVersion?: string }).harnessVersion).toBe(PI_HARNESS_VERSION);
  });
});

describe('PiGatewayClient — timeout path (rest of slice f)', () => {
  it('a child that never responds before timeoutMs is killed and reported as reason:"timeout"', async () => {
    const f = fakeChild();
    const spawnChild = vi.fn(() => f.child as never);
    const gw = new PiGatewayClient({ spawnChild: spawnChild as never, entryPath: '/fake/entry.ts', timeoutMs: 30 });
    const promise = gw.invoke(req());
    // Simulate the real world: `child.kill('SIGTERM')` on a real process eventually makes it exit —
    // the fake child's `kill` is a spy, so the test drives the 'exit' itself once the gateway's own
    // timer has fired and called kill().
    await vi.waitFor(() => expect(f.child.kill).toHaveBeenCalled(), { timeout: 2000 });
    f.exit(null);
    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('timeout');
  });
});
