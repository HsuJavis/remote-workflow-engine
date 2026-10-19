// pi harness v1 child entry point. Executed in its own OS process (spawned by PiGatewayClient, one
// per dispatch) by `node --experimental-transform-types` — same convention as
// src/sandbox/child-entry.ts (NOT resolved by tsx's bundler-mode `.js`->`.ts` rewriting), so, like
// that file, every local import here uses an explicit `.ts` extension, and the files it reaches
// (session-runner.ts, protocol.ts) hold no further *value* imports of their own (protocol.ts is
// type-only — see its own header comment) — see the "rwe sandbox child .ts imports" memory note.
//
// Protocol: reads exactly ONE line of JSON (a PiChildConfig) from stdin, then streams PiChildEvent
// JSONL to stdout as the session progresses, then exits. Holds a provider API key in memory only
// (owner decision 3) — never logs `config` verbatim (it may carry one).
import { createInterface } from 'node:readline';
import { spawn } from 'node:child_process';
import { runPiChildSession } from './session-runner.ts';
import { buildBashEnv, isWrapped } from './bash-env.ts';
import { isPathContained, resolveLanding } from '../../path-containment.ts';
import { resolveRipgrepOverride } from './ripgrep-override.ts';
import { runPiPathProbe } from './pi-path-probe.ts';
import { createStdoutFlusher } from './stdout-flusher.ts';
import type { PiChildConfig, PiChildEvent } from './protocol.ts';

// Composition, per the "rwe sandbox child .ts imports" memory note: session-runner.ts (which gets
// full tsc coverage, unlike this file) cannot import these two directly — each is reached through a
// LOCAL sibling `.ts` file, which breaks under this process's raw-node loading the moment the
// importING file itself is not also loaded by an explicit `.ts` specifier. bash-env.ts and
// path-containment.ts both hold zero local imports of their own, so loading them HERE, by explicit
// `.ts` extension, is safe — they are then passed down as plain function parameters (dependency
// injection), never imported a second time inside session-runner.ts.
const deps = { isPathContained, buildBashEnv, isWrapped, resolveLanding, resolveRipgrepOverride };

// issue #158 F4 (defense in depth, same bug class as #162 B / #163 B1): a write to `process.stdout`
// when it is a PIPE (always true here — the parent spawns this child with `stdio: ['pipe','pipe',
// 'pipe']`) can be queued internally rather than completing synchronously (empirically confirmed: a
// 2MB `process.stdout.write(...)` immediately followed by `process.exit(0)` truncates the parent's
// read to exactly 1,048,576 bytes on this machine/Node version — the same "write queued, then torn
// down before it flushes" mechanism `child-entry.ts`'s `rawSend` fixes for the sandbox child's IPC
// channel). The PARENT-side fix above (waiting for `child.stdout`'s own 'end' before concluding no
// result arrived) covers the ordinary case — an ordinary-sized line that already reached the OS pipe
// before 'exit' fires is just delayed, not lost — but a genuinely large final line (a long tool
// result/response) could still be torn down mid-write.
//
// 2026-10-08 integration (rv) latency fix (reverify, same bug class): this used to wait for stdout's
// own 'drain' event when `writableLength > 0` — but 'drain' fires ONLY when a `write()` call itself
// returned `false` (the buffer crossed its highWaterMark, >=16KiB by default), so a SMALL final line
// queued behind an already-full OS pipe buffer left `writableLength > 0` with no 'drain' ever
// coming. A child holding any OTHER live handle (MCP, srt) then sat out the full 60s bound even
// though its data had already reached the OS — latency only, nothing lost (the parent still got the
// line once it stalled through to drain its own end, or the bound finally fired). Fixed the same way
// `child-entry.ts`'s `rawSend` already fixes the analogous IPC case: `stdout-flusher.ts` tracks the
// LATEST `write()`'s own completion callback — the one deterministic "reached the OS" signal — and
// `flushStdout()` waits on THAT instead. `STDOUT_DRAIN_TIMEOUT_MS` is now a dead-parent valve only,
// never a flush deadline: it never fires under ordinary contention (the write callback already
// resolves by then). 'error'/'close' on stdout (a parent that actually died — EPIPE) still resolve
// immediately rather than waiting out the bound (`stdout-flusher.ts`'s own doc).
const STDOUT_DRAIN_TIMEOUT_MS = 60_000;
const stdoutFlusher = createStdoutFlusher(process.stdout, STDOUT_DRAIN_TIMEOUT_MS);

function emit(event: PiChildEvent): void {
  stdoutFlusher.write(JSON.stringify(event) + '\n');
}

function flushStdout(): Promise<void> {
  return stdoutFlusher.flush();
}

/** Emits the event, then waits for it (and anything still queued ahead of it) to actually reach the
 *  OS pipe before resolving — ONLY for the handful of call sites in `main()` that call
 *  `process.exit()` right after, never for the many fire-and-forget streaming emits inside
 *  `runPiChildSession` (those have more events coming right behind them; nothing is about to tear
 *  the process down). */
async function emitAndFlush(event: PiChildEvent): Promise<void> {
  emit(event);
  await flushStdout();
}

/** `entry.ts --probe`: the pi-path confinement boot probe (spec "Confinement posture"), run as its
 *  OWN short-lived child so srt's process-global state never touches the long-lived engine. Prints
 *  ONE JSON line (`PiPathProbeResult`-shaped) to stdout and exits — never reads stdin. */
async function runProbe(): Promise<void> {
  const result = await runPiPathProbe(
    { isWrapped },
    (argv, env) => new Promise((resolvePromise) => {
      const child = spawn(argv[0]!, argv.slice(1), { env, stdio: 'ignore' });
      child.once('exit', (code) => resolvePromise(code));
      child.once('error', () => resolvePromise(null));
    }),
    resolveRipgrepOverride,
  );
  // Routed through `stdoutFlusher` (not a bare `process.stdout.write`) — same reason as every other
  // write in this file: `flushStdout()` below only waits on a write it is actually tracking.
  stdoutFlusher.write(JSON.stringify(result) + '\n');
  // issue #158 F4 (defense in depth, same bug class): see `flushStdout`'s own doc — this probe result
  // line is written and this process exits immediately, exactly the shape that can truncate.
  await flushStdout();
  process.exit(0);
}

async function main(): Promise<void> {
  if (process.argv.includes('--probe')) {
    await runProbe();
    return;
  }
  const rl = createInterface({ input: process.stdin });
  const firstLine = await new Promise<string | undefined>((resolve) => {
    rl.once('line', (line) => resolve(line));
    rl.once('close', () => resolve(undefined));
  });
  rl.close();
  if (firstLine === undefined) {
    await emitAndFlush({ t: 'fatal', message: 'INTERNAL_ERROR: pi child received no config on stdin' });
    process.exit(1);
  }
  let config: PiChildConfig;
  try {
    config = JSON.parse(firstLine) as PiChildConfig;
  } catch (err) {
    await emitAndFlush({ t: 'fatal', message: `INTERNAL_ERROR: pi child could not parse its own config: ${err instanceof Error ? err.message : String(err)}` });
    process.exit(1);
  }
  emit({ t: 'ready' });
  try {
    await runPiChildSession(config, emit, deps);
  } catch (err) {
    // A throw here is a programming defect inside session-runner.ts (it is documented to convert
    // every dispatch-shaped failure into an {t:'error'} event itself) — surfaced as 'fatal' so the
    // parent never mistakes it for an ordinary provider failure it should classify/retry.
    await emitAndFlush({ t: 'fatal', message: err instanceof Error ? (err.stack ?? err.message) : String(err) });
    process.exit(1);
  }
  // issues #158 F4 / #162 B / #163 B1 (same bug class): `runPiChildSession` above already emitted its
  // own final 'final'/'error' event internally (via the `emit` callback it was handed) before
  // resolving — fire-and-forget, same as every other streaming event it emits. This is the one place
  // that matters: right before the process tears itself down, wait for every write still queued to
  // actually reach the OS pipe (see `flushStdout`'s own doc) — never for the intermediate events,
  // which have more writes coming right behind them.
  await flushStdout();
  // review R2-2: this used to ALSO call a `killOwnDescendants()` walk here, SIGKILLing every live
  // descendant of this whole process right before exit — removed, not amended: it ran only AFTER
  // `runPiChildSession` already returned, by which point a `nohup`/`setsid`-backgrounded grandchild
  // has already been reparented away from this tree entirely (the kernel completes that reparenting
  // SYNCHRONOUSLY as part of bash's OWN exit processing, before session-runner.ts's `exec()` ever
  // regains control) — so this walk could never have seen it, dead code pretending to be a fix. The
  // REAL fix is `reapBashGroup()` (session-runner.ts), which acts WHILE bash is still the group
  // leader, on every exec() exit path, not after the fact here.
  process.exit(0);
}

void main();
