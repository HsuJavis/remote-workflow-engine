// F-1 (sandbox robustness sweep): the sandbox had no execution timeout and no memory cap — a
// `while(true){}` spins a CPU core and holds its concurrency slot forever (it blocks the child's
// OWN event loop, so nothing inside the child can ever notice a deadline — only a HOST-side timer,
// running in a separate OS process, can terminate it), and a memory-growth loop OOMs the child with
// no diagnosis.
//
// Mock policy (unit): `node:child_process`'s `fork` is mocked with a minimal fake ChildProcess
// (EventEmitter-based), same technique as `sandbox-host-env-scrub.test.ts` — this file is purely
// about the HOST's own timer/classification logic, never about running a real script. The real
// forked-child, real-deadline, real-memory-bomb behavior is covered by this change's manual real
// check (ledger report), not by this unit-tier suite.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn(() => true);
  send = vi.fn((_msg: unknown) => true);
}

const createdChildren: FakeChild[] = [];

vi.mock('node:child_process', () => ({
  fork: vi.fn(() => {
    const child = new FakeChild();
    createdChildren.push(child);
    queueMicrotask(() => child.emit('message', { t: 'ready' }));
    return child;
  }),
}));

import { SandboxHost, SANDBOX_CHILD_EXEC_ARGV, SANDBOX_CHILD_MAX_OLD_SPACE_MB, DEFAULT_MAX_RUN_DURATION_MS } from '../../src/sandbox/host.js';

const WORK_DIR = '/tmp/rwe-f1-duration-test';

describe('F-1: SANDBOX_CHILD_EXEC_ARGV caps the sandbox child\'s own V8 heap', () => {
  it('includes --max-old-space-size with the documented, positive-integer MB cap', () => {
    const flag = SANDBOX_CHILD_EXEC_ARGV.find((a) => a.startsWith('--max-old-space-size='));
    expect(flag).toBe(`--max-old-space-size=${SANDBOX_CHILD_MAX_OLD_SPACE_MB}`);
    expect(Number.isInteger(SANDBOX_CHILD_MAX_OLD_SPACE_MB)).toBe(true);
    expect(SANDBOX_CHILD_MAX_OLD_SPACE_MB).toBeGreaterThan(0);
  });
});

describe('F-1: SandboxHost.run() enforces a wall-clock run-duration deadline', () => {
  beforeEach(() => {
    createdChildren.length = 0;
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a run that never completes (the host-side proxy for a synchronous while(true){}) is SIGKILLed and settles SCRIPT_TIMEOUT at its configured deadline', async () => {
    const host = new SandboxHost({ workspaceRoot: WORK_DIR, maxRunDurationMs: 1000 });
    const runPromise = host.run('r-timeout', 'while(true){}', {}, null);
    // Let the mocked fork's queued 'ready' microtask fire (the child never replies after that —
    // simulating a hung/looping script that can never process the host's own IPC messages either).
    await vi.advanceTimersByTimeAsync(0);
    expect(createdChildren).toHaveLength(1);

    // The deadline has not fired yet — the run must still be pending.
    await vi.advanceTimersByTimeAsync(999);
    let settledYet = false;
    void runPromise.then(() => { settledYet = true; });
    await Promise.resolve();
    expect(settledYet).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    const outcome = await runPromise;
    expect('error' in outcome).toBe(true);
    if (!('error' in outcome)) throw new Error('unreachable');
    expect(outcome.error).toMatchObject({ code: 'SCRIPT_TIMEOUT' });
    expect((outcome.error as { message: string }).message).toContain('1000ms');
    expect(createdChildren[0]!.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('a run that completes well within its deadline is unaffected, and leaves no pending timer behind', async () => {
    const host = new SandboxHost({ workspaceRoot: WORK_DIR, maxRunDurationMs: 1000 });
    const runPromise = host.run('r-ok', 'return 1;', {}, null);
    await vi.advanceTimersByTimeAsync(0);
    const child = createdChildren[0]!;
    child.emit('message', { t: 'done', runId: 'r-ok', result: 1 });
    const outcome = await runPromise;
    expect(outcome).toEqual({ result: 1 });
    // Advancing well past the deadline must not re-settle or throw — settle() is idempotent and the
    // timer was cleared on completion.
    await vi.advanceTimersByTimeAsync(5000);
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('absent maxRunDurationMs falls back to DEFAULT_MAX_RUN_DURATION_MS (a generous, documented default)', async () => {
    const host = new SandboxHost({ workspaceRoot: WORK_DIR });
    const runPromise = host.run('r-default', 'while(true){}', {}, null);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(DEFAULT_MAX_RUN_DURATION_MS - 1);
    let settledYet = false;
    void runPromise.then(() => { settledYet = true; });
    await Promise.resolve();
    expect(settledYet).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const outcome = await runPromise;
    expect('error' in outcome && outcome.error).toMatchObject({ code: 'SCRIPT_TIMEOUT' });
  });
});

describe('F-1: a child terminated by its own V8 heap limit settles a coded SCRIPT_OOM, not ABORTED', () => {
  beforeEach(() => {
    createdChildren.length = 0;
  });

  it('matches the real V8 FATAL ERROR heap-limit fingerprint and leaks none of the raw crash dump', async () => {
    const host = new SandboxHost({ workspaceRoot: WORK_DIR });
    const runPromise = host.run('r-oom', 'return 1;', {}, null);
    await Promise.resolve();
    const child = createdChildren[0]!;
    const rawCrash =
      '\n<--- Last few GCs --->\n\n[12345:0x...]   123 ms: Mark-sweep 500.1 (520.0) -> 499.8 (520.0) MB\n' +
      '\n<--- JS stacktrace --->\n\n' +
      'FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory\n' +
      ' 1: 0x... node::Abort() [/home/rwe/app/node]\n' +
      'Node.js v22.14.3\n';
    child.stderr.emit('data', Buffer.from(rawCrash));
    child.emit('exit', null, 'SIGABRT');
    const outcome = await runPromise;
    expect('error' in outcome).toBe(true);
    if (!('error' in outcome)) throw new Error('unreachable');
    expect(outcome.error).toMatchObject({ code: 'SCRIPT_OOM' });
    const message = (outcome.error as { message: string }).message;
    expect(message).not.toMatch(/heap limit|Allocation failed|node::Abort|\/home\//);
  });

  // F-1 real-check finding: a REAL V8 OOM abort writes the FATAL ERROR line, THEN 10-20 native
  // stack frames each naming the engine's own absolute install path — measured at ~2.5KB total,
  // comfortably overflowing the 2000-char windowed `stderrTail` kept for the ORDINARY-crash ABORTED
  // message. Reproduces that shape: the fingerprint line arrives first, split across TWO 'data'
  // chunks (a realistic pipe-buffering boundary), followed by >2000 chars of native frames that
  // would otherwise evict it from a naive trimmed-tail check.
  it('detects the FATAL ERROR fingerprint even when later native-frame output overflows the 2000-char stderr tail window', async () => {
    const host = new SandboxHost({ workspaceRoot: WORK_DIR });
    const runPromise = host.run('r-oom-overflow', 'return 1;', {}, null);
    await Promise.resolve();
    const child = createdChildren[0]!;
    // Split the fingerprint line itself across a chunk boundary.
    child.stderr.emit('data', Buffer.from('\n<--- Last few GCs --->\n\n<--- JS stacktrace --->\n\nFATAL ERROR: Reached heap li'));
    child.stderr.emit('data', Buffer.from('mit Allocation failed - JavaScript heap out of memory\n'));
    // >2000 chars of native frames AFTER the fingerprint — this is what evicts it from a naive
    // trimmed-tail check (the pre-fix behavior this case pins against).
    const frame = ' N: 0x1234567 v8::internal::SomeNativeFrame(args) [/home/rwe/.local/node/bin/node]\n';
    child.stderr.emit('data', Buffer.from(frame.repeat(40))); // ~3200 chars, well over 2000
    child.emit('exit', null, 'SIGABRT');
    const outcome = await runPromise;
    expect('error' in outcome).toBe(true);
    if (!('error' in outcome)) throw new Error('unreachable');
    expect(outcome.error).toMatchObject({ code: 'SCRIPT_OOM' });
  });

  it('an ordinary (non-OOM) crash is unaffected — still ABORTED with the sanitized stderr tail', async () => {
    const host = new SandboxHost({ workspaceRoot: WORK_DIR });
    const runPromise = host.run('r-crash', 'return 1;', {}, null);
    await Promise.resolve();
    const child = createdChildren[0]!;
    child.stderr.emit('data', Buffer.from('TypeError: something broke\n'));
    child.emit('exit', 1, null);
    const outcome = await runPromise;
    expect('error' in outcome).toBe(true);
    if (!('error' in outcome)) throw new Error('unreachable');
    expect(outcome.error).toMatchObject({ code: 'ABORTED' });
  });
});
