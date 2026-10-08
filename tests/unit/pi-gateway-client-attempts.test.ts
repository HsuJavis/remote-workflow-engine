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
    exit: (code: number | null = 0) => { emitter.stdout.end(); emitter.stderr.end(); emitter.emit('exit', code, null); },
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

describe('PiGatewayClient — usage on an errored assistant message is not dropped (residual fix, #127)', () => {
  it('an error event carrying its own usage folds it into the reported tokens, marked partial', async () => {
    const f = fakeChild();
    const gw = new PiGatewayClient({ spawnChild: (() => f.child) as never, entryPath: '/fake/entry.ts' });
    const promise = gw.invoke(req());
    await new Promise((r) => setTimeout(r, 10));
    // No prior message_end — the error event is the ONLY source of usage for this attempt (spike
    // S4: "usage IS present on an aborted/errored message" — pi reports real partial tokens even
    // when the turn itself ends in error).
    f.sendLine({ t: 'error', message: '503: overloaded', usage: { input: 42, output: 7, cacheRead: 0, cacheWrite: 0 } });
    f.exit(1);
    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.tokens).toEqual({ input: 42, output: 7, cacheRead: 0, cacheWrite: 0 });
      expect(result.partial).toBe(true);
    }
  });

  it('an error event\'s own usage is ADDED to usage already folded from a prior message_end in the SAME attempt', async () => {
    const f = fakeChild();
    const gw = new PiGatewayClient({ spawnChild: (() => f.child) as never, entryPath: '/fake/entry.ts' });
    const promise = gw.invoke(req());
    await new Promise((r) => setTimeout(r, 10));
    f.sendLine({ t: 'message_end', seq: 1, text: 'partial reply', usage: { input: 10, output: 3, cacheRead: 0, cacheWrite: 0 }, stopReason: 'stop' });
    f.sendLine({ t: 'error', message: '500: boom', usage: { input: 2, output: 1, cacheRead: 0, cacheWrite: 0 } });
    f.exit(1);
    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.tokens).toEqual({ input: 12, output: 4, cacheRead: 0, cacheWrite: 0 });
      expect(result.partial).toBe(true);
    }
  });

  it('errored-attempt usage is summed into the total across a retry that then succeeds', async () => {
    let n = 0;
    const spawnChild = vi.fn(() => {
      n += 1;
      const f = fakeChild();
      if (n === 1) {
        queueMicrotask(() => { f.sendLine({ t: 'error', message: '500: boom', usage: { input: 5, output: 2, cacheRead: 0, cacheWrite: 0 } }); f.exit(1); });
      } else {
        queueMicrotask(() => {
          f.sendLine({ t: 'final', seq: 1, text: 'ok', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, stopReason: 'stop' });
          f.exit(0);
        });
      }
      return f.child as never;
    });
    const gw = new PiGatewayClient({ spawnChild: spawnChild as never, entryPath: '/fake/entry.ts', retries: 1 });
    const result = await gw.invoke(req({ opts: { model: 'ollama/qwen2.5:7b', timeoutMs: 5000 } as AgentOpts }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.tokens).toEqual({ input: 5, output: 2, cacheRead: 0, cacheWrite: 0 });
  });

  it('a fatal event (no usage field at all) still reports zero tokens, never throws on the missing field', async () => {
    const f = fakeChild();
    const gw = new PiGatewayClient({ spawnChild: (() => f.child) as never, entryPath: '/fake/entry.ts' });
    const promise = gw.invoke(req());
    await new Promise((r) => setTimeout(r, 10));
    f.sendLine({ t: 'fatal', message: 'INTERNAL_ERROR: boom' });
    f.exit(1);
    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.tokens).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
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

  // issue #152: a timed-out attempt that never reached its first message_end used to report tokens
  // all-zero with NO `partial` flag and NO `detail` at all — run-manager.ts's `failureMessage` then
  // fell back to the opaque "no failure detail recorded", and the zero figure read as an exact,
  // priced "this call was free" rather than the unknown lower bound it actually is.
  it('a zero-usage timeout now carries a non-empty detail naming the attempt/timeout, and partial:true even though the figure is 0', async () => {
    const f = fakeChild();
    const spawnChild = vi.fn(() => f.child as never);
    const gw = new PiGatewayClient({ spawnChild: spawnChild as never, entryPath: '/fake/entry.ts', timeoutMs: 30 });
    const promise = gw.invoke(req());
    await vi.waitFor(() => expect(f.child.kill).toHaveBeenCalled(), { timeout: 2000 });
    f.exit(null);
    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('timeout');
      expect(result.tokens).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
      expect(result.partial).toBe(true);
      expect(result.detail).toBeDefined();
      expect(result.detail).toContain('attempt 1/1');
      expect(result.detail).toContain('timed out after 30ms');
      // issue #153 L4: zero turns completed before the kill signal — the detail must say so
      // accurately, never the old blanket "no response from model" that read the same whether zero
      // or several turns had already completed.
      expect(result.detail).toContain('before the first response');
      expect(result.detail).not.toContain('completed turn');
    }
  });

  // issue #153 L4: before this fix, a timeout AFTER one or more completed turns (a tool call and its
  // result, say) still said "no response from model" — false, since the model clearly had responded
  // at least once. The detail must name how many turns actually completed.
  it('a timeout after completed turns names the turn count, never the blanket "no response from model" (issue #153 L4)', async () => {
    const f = fakeChild();
    const spawnChild = vi.fn(() => f.child as never);
    const gw = new PiGatewayClient({ spawnChild: spawnChild as never, entryPath: '/fake/entry.ts', timeoutMs: 30 });
    const promise = gw.invoke(req());
    f.sendLine({ t: 'message_end', seq: 1, text: 'turn one', usage: { input: 10, output: 3, cacheRead: 0, cacheWrite: 0 }, stopReason: 'stop' });
    f.sendLine({ t: 'message_end', seq: 2, text: 'turn two', usage: { input: 5, output: 2, cacheRead: 0, cacheWrite: 0 }, stopReason: 'stop' });
    await vi.waitFor(() => expect(f.child.kill).toHaveBeenCalled(), { timeout: 2000 });
    f.exit(null);
    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('timeout');
      expect(result.tokens).toEqual({ input: 15, output: 5, cacheRead: 0, cacheWrite: 0 });
      expect(result.detail).toContain('after 2 completed turns');
      expect(result.detail).not.toContain('no response from model');
      expect(result.detail).not.toContain('before the first response');
    }
  });

  it('two timed-out attempts sum their usage (#127 parity) and the detail names the LAST attempt, "2/2"', async () => {
    let n = 0;
    const children: ReturnType<typeof fakeChild>[] = [];
    const spawnChild = vi.fn(() => {
      n += 1;
      const f = fakeChild();
      children.push(f);
      if (n === 1) {
        // This attempt streams some real usage before it, too, stalls past the timeout.
        queueMicrotask(() => { f.sendLine({ t: 'message_end', seq: 1, text: 'partial', usage: { input: 10, output: 3, cacheRead: 0, cacheWrite: 0 }, stopReason: 'stop' }); });
      }
      return f.child as never;
    });
    const gw = new PiGatewayClient({ spawnChild: spawnChild as never, entryPath: '/fake/entry.ts', timeoutMs: 30, retries: 1 });
    const promise = gw.invoke(req({ opts: { model: 'ollama/qwen2.5:7b', timeoutMs: 30 } as AgentOpts }));
    await vi.waitFor(() => expect(children[0]?.child.kill).toHaveBeenCalled(), { timeout: 2000 });
    children[0]!.exit(null);
    await vi.waitFor(() => expect(children[1]?.child.kill).toHaveBeenCalled(), { timeout: 2000 });
    children[1]!.exit(null);
    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('timeout');
      // Summed across both attempts (#127 parity): the first attempt's own streamed 10/3 survives
      // into the final failure even though IT timed out too, never dropped just because the call
      // that ultimately gave up was a later attempt.
      expect(result.tokens).toEqual({ input: 10, output: 3, cacheRead: 0, cacheWrite: 0 });
      expect(result.partial).toBe(true);
      expect(result.detail).toContain('attempt 2/2');
    }
  });

  it('an externally aborted dispatch (run_suspend/run_stop) also gets a non-empty detail and partial:true at zero tokens', async () => {
    const f = fakeChild();
    const spawnChild = vi.fn(() => f.child as never);
    const gw = new PiGatewayClient({ spawnChild: spawnChild as never, entryPath: '/fake/entry.ts' });
    const ac = new AbortController();
    const promise = gw.invoke(req({ signal: ac.signal }));
    await new Promise((r) => setTimeout(r, 10));
    ac.abort();
    await vi.waitFor(() => expect(f.child.kill).toHaveBeenCalled(), { timeout: 2000 });
    f.exit(null);
    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('aborted');
      expect(result.tokens).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
      expect(result.partial).toBe(true);
      expect(result.detail).toBeDefined();
      expect(result.detail).toContain('attempt 1/1');
      expect(result.detail).toContain('aborted');
    }
  });

  // issue #160 BUG-4: a provider MAY populate `usage` on an intermediate stream chunk, before the
  // turn's own message_end — session-runner.ts forwards that as a `usage_update` wire event. An
  // abort that lands while such a turn is still in flight must charge that already-known figure
  // (a real provider-reported number, never a client-side estimate) instead of an unconditional 0.
  it('an abort mid-turn charges the latest usage_update figure as a lower bound, not an unconditional 0', async () => {
    const f = fakeChild();
    const spawnChild = vi.fn(() => f.child as never);
    const gw = new PiGatewayClient({ spawnChild: spawnChild as never, entryPath: '/fake/entry.ts' });
    const ac = new AbortController();
    const liveUsage: unknown[] = [];
    const promise = gw.invoke(req({ signal: ac.signal, onUsage: (t) => liveUsage.push(t) }));
    f.sendLine({ t: 'usage_update', usage: { input: 42, output: 7, cacheRead: 0, cacheWrite: 0 } });
    await new Promise((r) => setTimeout(r, 10));
    ac.abort();
    await vi.waitFor(() => expect(f.child.kill).toHaveBeenCalled(), { timeout: 2000 });
    f.exit(null);
    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('aborted');
      // The provider's own mid-turn figure, never the unconditional 0 this reported before the fix.
      expect(result.tokens).toEqual({ input: 42, output: 7, cacheRead: 0, cacheWrite: 0 });
      expect(result.partial).toBe(true);
    }
    // The live onUsage stream also saw the figure before the abort landed (agent-executor.ts's
    // markUsage/_finalizeAborted path depends on this for the SAME scenario at the executor level).
    expect(liveUsage).toContainEqual({ input: 42, output: 7, cacheRead: 0, cacheWrite: 0 });
  });

  // A turn that completes NORMALLY (message_end) after its own usage_update must not double-count
  // that turn's usage — message_end's own figure supersedes it exactly once.
  it('a usage_update followed by that SAME turn\'s message_end does not double-count the turn', async () => {
    const f = fakeChild();
    const spawnChild = vi.fn(() => f.child as never);
    const gw = new PiGatewayClient({ spawnChild: spawnChild as never, entryPath: '/fake/entry.ts' });
    const promise = gw.invoke(req());
    f.sendLine({ t: 'usage_update', usage: { input: 20, output: 2, cacheRead: 0, cacheWrite: 0 } });
    f.sendLine({ t: 'message_end', seq: 1, text: 'done', usage: { input: 20, output: 9, cacheRead: 0, cacheWrite: 0 }, stopReason: 'stop' });
    f.sendLine({ t: 'final', seq: 1, text: 'done', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, stopReason: 'stop' });
    f.exit(0);
    const result = await promise;
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.tokens).toEqual({ input: 20, output: 9, cacheRead: 0, cacheWrite: 0 });
  });
});
