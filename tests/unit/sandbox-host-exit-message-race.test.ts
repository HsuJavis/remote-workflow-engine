// issue #163 B1 — TEST-FIRST (RED). `SandboxHost.run()`'s `child.on('exit', ...)` handler settled
// ABORTED ("sandbox child process terminated before completion") the instant `settled` was still
// false, independent of whether a 'done'/'error' IPC message was already on its way — 'exit'
// (SIGCHLD-driven) and 'message' (IPC-pipe-driven) are two independent async notification sources,
// and under real concurrent load (confirmed via a throwaway real engine: 1-3% of n=40-60 parallel
// nested workflow() dispatches) 'exit' can be processed first even once child-entry.ts's own
// send-then-exit race (issue #162 B / #163 B1's OTHER half, already fixed) is closed.
//
// Mock policy (unit): a fake fork()-alike child (EventEmitter + PassThrough stderr) via the
// `forkChild` test seam (mirrors PiGatewayClient's own `spawnChild` seam) — no real process.
import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SandboxHost } from '../../src/sandbox/host.js';

function fakeChild() {
  const emitter = new EventEmitter() as EventEmitter & { stderr: PassThrough; send: (msg: unknown) => boolean; kill: () => void; pid: number };
  emitter.stderr = new PassThrough();
  emitter.send = () => true;
  emitter.kill = () => {};
  emitter.pid = 54321;
  return emitter;
}

const WORK_DIR = mkdtempSync(join(tmpdir(), 'rwe-host-exit-race-'));

describe('issue #163 B1 — SandboxHost does not settle ABORTED when a done message is already in flight past exit', () => {
  it('a done message delivered AFTER exit fires synchronously (deferred one setImmediate tick) still resolves {result}, not ABORTED', async () => {
    const child = fakeChild();
    const host = new SandboxHost({ workspaceRoot: WORK_DIR, forkChild: (() => child) as never, exitMessageGraceMs: 50 });
    const runPromise = host.run('race-1', 'return 1;', undefined, null);
    // Let run() reach its 'message' listener attachment (synchronous within run(), but give the
    // promise executor a tick to be safe across Node versions).
    await new Promise((r) => setImmediate(r));
    child.emit('ready' as never); // no-op for this fake (no 'ready' case special-cased by the fake)
    child.emit('message', { t: 'ready' });
    setImmediate(() => {
      child.emit('message', { t: 'done', runId: 'race-1', result: 'late-but-real' });
    });
    child.emit('exit', 0, null);
    const outcome = await runPromise;
    expect('result' in outcome).toBe(true);
    if ('result' in outcome) expect(outcome.result).toBe('late-but-real');
  });

  it('a done message delivered BEFORE exit still resolves normally (no regression on the common case)', async () => {
    const child = fakeChild();
    const host = new SandboxHost({ workspaceRoot: WORK_DIR, forkChild: (() => child) as never, exitMessageGraceMs: 50 });
    const runPromise = host.run('race-2', 'return 1;', undefined, null);
    await new Promise((r) => setImmediate(r));
    child.emit('message', { t: 'done', runId: 'race-2', result: 'ok' });
    child.emit('exit', 0, null);
    const outcome = await runPromise;
    expect('result' in outcome).toBe(true);
    if ('result' in outcome) expect(outcome.result).toBe('ok');
  });

  it('a child that genuinely never sends done/error still resolves ABORTED (no false negative — bounded wait)', async () => {
    const child = fakeChild();
    const host = new SandboxHost({ workspaceRoot: WORK_DIR, forkChild: (() => child) as never, exitMessageGraceMs: 50 });
    const runPromise = host.run('race-3', 'return 1;', undefined, null);
    await new Promise((r) => setImmediate(r));
    child.emit('exit', 1, null);
    const outcome = await runPromise;
    expect('error' in outcome).toBe(true);
    if ('error' in outcome) expect((outcome.error as { code: string }).code).toBe('ABORTED');
  });

  // issues #158 F4 / #163 B1 / #162 B (fix-of-the-fix): the OLD `child.on('exit', ...)` handler armed
  // a FIXED grace window (200ms in production) the instant 'exit' fired, independent of whether a
  // message was merely delayed rather than never coming. A real-engine check under concurrent load
  // measured this host process's own event-loop delay peaking at 6136-8384ms — 227 terminal messages
  // in one run arrived more than 200ms after 'exit', the slowest 3314ms after — so a fixed short
  // window misclassifies a message that is simply running late as "never coming". No
  // `exitMessageGraceMs` override here: the real (now 30s) safety-bound default applies, and this
  // test proves the message is NOT waited out via that timer at all — `child.on('close', ...)` (a
  // real ChildProcess's own deterministic "IPC channel fully drained" signal) is what the host
  // actually waits for, long before any 30s bound would matter.
  it('a done message delivered 1500ms after exit (far past the old fixed 200ms grace) still resolves {result}, because `close` — not a fixed timer — decides', async () => {
    const child = fakeChild();
    const host = new SandboxHost({ workspaceRoot: WORK_DIR, forkChild: (() => child) as never });
    const runPromise = host.run('race-4', 'return 1;', undefined, null);
    await new Promise((r) => setImmediate(r));
    child.emit('exit', 0, null);
    setTimeout(() => {
      child.emit('message', { t: 'done', runId: 'race-4', result: 'very-late-but-real' });
      child.emit('close', 0, null);
    }, 1500);
    const outcome = await runPromise;
    expect('result' in outcome).toBe(true);
    if ('result' in outcome) expect(outcome.result).toBe('very-late-but-real');
  }, 10_000);

  // issues #158 F4 / #163 B1 / #162 B (fix-of-the-fix): the OLD `exit` handler read the STICKY
  // `sawOomFingerprint` flag synchronously, at 'exit' time, and committed to its ABORTED-vs-SCRIPT_OOM
  // branch right then — a real OS pipe's buffered-but-unread stderr bytes can still be draining to
  // the `'data'` listener AFTER 'exit' fires (independent of anything the child did), so a crash dump
  // whose fingerprint line arrives in that window was misclassified as a generic ABORTED, with the
  // real OOM diagnosis lost. The fix defers the classification decision itself to `close` (ordered
  // after every stderr chunk, same as every IPC message — see host.ts's own module-level doc) via
  // `concludeNoMessage`, which reads the flag at CALL time, never earlier.
  it('OOM fingerprint text arriving on stderr AFTER exit (but before close) is still classified SCRIPT_OOM, not ABORTED', async () => {
    const child = fakeChild();
    const host = new SandboxHost({ workspaceRoot: WORK_DIR, forkChild: (() => child) as never });
    const runPromise = host.run('race-oom-late', 'return 1;', undefined, null);
    await new Promise((r) => setImmediate(r));
    child.emit('exit', null, 'SIGABRT');
    child.stderr.write('FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory\n');
    // Let the PassThrough's own 'data' event actually fire (stream emission is asynchronous even
    // though `.write()` is called synchronously) before the channel is declared fully closed.
    await new Promise((r) => setImmediate(r));
    child.emit('close', null, 'SIGABRT');
    const outcome = await runPromise;
    expect('error' in outcome).toBe(true);
    if ('error' in outcome) expect((outcome.error as { code: string }).code).toBe('SCRIPT_OOM');
  });
});

afterAllCleanup();
function afterAllCleanup() {
  process.once('exit', () => { try { rmSync(WORK_DIR, { recursive: true, force: true }); } catch { /* best-effort */ } });
}
