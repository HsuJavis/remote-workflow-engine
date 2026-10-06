// SandboxHost (DES-005 / DES-006 / ARCH-003, TASK-006). Spawns a real OS child process per
// run (node:child_process) so a hung/looping script can be killed from outside its own V8
// isolate, then runs the workflow script inside that child's restricted VM context
// (child-entry.ts -> guards.ts). The child's only channel back to this trusted host is the
// IPC seam (DES-006); it holds no secrets/store/network access.
import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, realpathSync } from 'node:fs';
import type { Tokens } from '../types.js';

const CHILD_ENTRY = join(dirname(fileURLToPath(import.meta.url)), 'child-entry.ts');

// #157 B1 layer 2: the sandbox child's own env — empty, not the parent's. See the `fork()` call
// site's own doc for why this is both the strictest posture and sufficient for this child's needs.
const SANDBOX_CHILD_ENV: NodeJS.ProcessEnv = {};

// #157 layer 3 (OS/Node-level containment, defense in depth under layers 1+2): even if a future
// regression reopens the in-realm escape (layer 1) AND somehow the child carried secrets anyway
// (layer 2), Node's permission model (stable since Node 22.19) still denies the child fs/child-
// process/worker/addon access outright. `--allow-fs-read` is scoped to exactly the engine's OWN
// source directory (`src/`, resolved to its REAL path — a production install may be reached through
// a symlink swapped atomically by self-update, and the permission model matches the literal path the
// loader resolves to, not the symlink it was entered through) — the only reads child-entry.ts/
// guards.ts's own module graph needs (confirmed empirically: no `node_modules` read ever occurs —
// every import across that module graph is either a relative `.ts` file or a `node:` builtin).
// Deliberately NOT granted: --allow-fs-write, --allow-child-process, --allow-worker, --allow-addons,
// --allow-wasi — the sandbox child has no legitimate need for any of them (agent()/workflow() calls
// round-trip over IPC to this trusted host, which dispatches its OWN, separately-confined child for
// agent work; the sandbox child itself never spawns anything).
const SANDBOX_SRC_DIR = realpathSync(dirname(dirname(CHILD_ENTRY)));

// F-1 (sandbox robustness sweep): caps the sandbox child's own V8 heap. A memory-growth loop in a
// script (e.g. an unbounded array/string accumulation across many agent() calls) now surfaces as a
// coded SCRIPT_OOM (see `run()`'s `exit` handler below) instead of the OS eventually OOM-killing the
// process with no diagnosis, or — worse — degrading the whole host under memory pressure. 512 MiB is
// generous for a workflow script's own bookkeeping (it never holds model output itself: that streams
// back over IPC into the run's own journal/store, not into the script's variables) while still
// bounding the worst case. NOT currently configurable, by choice: making it config-driven would turn
// `SANDBOX_CHILD_EXEC_ARGV` from a constant into a per-run-computed array, which breaks the "exact
// array fork() receives" invariant `sandbox-host-env-scrub.test.ts` pins — revisit with a real
// operator need, not speculatively.
export const SANDBOX_CHILD_MAX_OLD_SPACE_MB = 512;

export const SANDBOX_CHILD_EXEC_ARGV: readonly string[] = [
  '--experimental-transform-types',
  '--disable-warning=ExperimentalWarning',
  '--permission',
  `--allow-fs-read=${SANDBOX_SRC_DIR}/*`,
  `--max-old-space-size=${SANDBOX_CHILD_MAX_OLD_SPACE_MB}`,
];

// F-1: generous default for `SandboxHostConfig.maxRunDurationMs` — a run's script lifetime spans
// EVERY agent()/workflow() round trip across every phase (bounded per-call by `maxTimeoutMs`,
// default 600_000ms), not a single call, so the run-wide deadline must be much larger. 4 hours
// comfortably covers a long multi-phase workflow while still catching a genuine infinite loop
// (`while(true){}`, which blocks the child's own event loop and so can never be caught from inside
// it) or an abandoned/hung run instead of holding its concurrency slot forever.
export const DEFAULT_MAX_RUN_DURATION_MS = 4 * 60 * 60 * 1000;

// F-1: the V8 fingerprint printed to stderr when a child is terminated for exceeding its own heap
// limit (`--max-old-space-size`) — a FATAL ERROR that aborts the process (Node has no catchable JS
// exception for this; it is not a normal uncaught exception). Matched against the RAW stderr tail
// (never the sanitized one — the OOM branch below never surfaces ANY of the raw text to the caller,
// sanitized or not, since it is V8's own internal crash dump: heap statistics, absolute source
// paths, the Node version).
const V8_OOM_FINGERPRINT_RE = /FATAL ERROR:.*heap|JavaScript heap out of memory/i;

export type AgentRequestHandler = (prompt: string, opts: unknown, callSeq: number, phase?: { title: string; index: number }) => Promise<unknown> | unknown;
export type WorkflowRequestHandler = (ref: unknown, args: unknown, callSeq: number) => Promise<unknown> | unknown;

/** C-2 (review finding): carry the underlying error's OWN code across the sandbox IPC boundary
 *  instead of flattening every agent()/workflow() failure to one of two generic codes — so a caller
 *  can branch on the code the error itself carries. Falls back to `fallback` only for anonymous
 *  errors (a bare `new Error()`, name === 'Error').
 *
 *  v25 (DES-167, REQ-120): the `.code` branch above is now the live one for budget refusals. This
 *  docblock used to name `BudgetExceededError` / `AgentCapError` / `CatalogNotFoundError` /
 *  `WorkspaceEscapeError` — CLASS NAMES — as what a script branches on, because those classes
 *  carried no `.code` and `e.name` was all that crossed the boundary. v24 gave the last two (plus
 *  `IllegalTransitionError`) their catalog codes and v25 gives `BudgetExceededError` its
 *  `BUDGET_EXCEEDED`, so a script now reads a closed-catalog code a `tools/list` reader can
 *  anticipate. `AgentCapError` is the one still surfacing as its class name (out of scope here,
 *  recorded so the next reader knows it is a leftover, not a design). */
/** issue #162 A/B (defense in depth): `stderrTail` below is RAW text from the child's own stdio
 *  pipe — if the child crashes for ANY reason (OOM, a real engine bug, a future change to
 *  child-entry.ts that reintroduces an uncaught throw), Node's default uncaught-exception
 *  reporting prints a stack trace through its own internal modules, which names absolute source
 *  paths (this engine's own install path on the host it's running on) and the exact Node version —
 *  implementation details that must never cross the trust boundary into a caller-visible ABORTED
 *  message (a possibly-remote, possibly-untrusted caller). Scrubs unconditionally, whether or not
 *  the crash was ever classified — the one place this content is surfaced to a caller. */
// g2 minor (sandbox robustness sweep): the prior `\bv\d+\.\d+\.\d+\b` matched ANY vX.Y.Z-shaped
// substring — including a legitimate script-authored message naming a dependency/semver version
// (e.g. "dependency v1.2.3 failed"), mangling it into unreadable nonsense. Narrowed to the two
// shapes that are actually NODE'S OWN version: the exact running `process.version` (the sandbox
// child is forked from this same binary, so a leaked version string is always this literal), and/or
// Node's own "Node.js vX.Y.Z" uncaught-exception trailer line format — never a bare "vX.Y.Z" with no
// Node-identifying context.
const NODE_VERSION_LITERAL_RE = new RegExp(process.version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
const NODE_JS_VERSION_LINE_RE = /\bNode\.js v\d+\.\d+\.\d+\b/g;

export function sanitizeStderrTail(raw: string): string {
  return raw
    .replace(/node:internal\/[^\s:)]+/g, '<node internal>')
    .replace(/(?:\/[\w.-]+)+\.(?:ts|js|mjs|cjs)(?=:\d+|\b)/g, '<path>')
    .replace(NODE_JS_VERSION_LINE_RE, 'Node.js <node version>')
    .replace(NODE_VERSION_LITERAL_RE, '<node version>');
}

export function ipcErrorCode(err: unknown, fallback: string): string {
  if (err && typeof err === 'object') {
    const e = err as { code?: unknown; name?: unknown };
    if (typeof e.code === 'string' && e.code) return e.code;
    if (typeof e.name === 'string' && e.name && e.name !== 'Error') return e.name;
  }
  return fallback;
}

export interface SandboxHostConfig {
  workspaceRoot: string;
  /** Handles a child's agent() call. Defaults to a canned response (no model call) — the
   *  master test seam (DES-006) that lets callers dry-run scripts with zero model calls;
   *  real wiring (RunManager -> AgentExecutor) injects the real handler. */
  onAgentRequest?: AgentRequestHandler;
  /** Handles a child's workflow() call. Absent -> the child has no delegate, so guards.ts's
   *  own nesting guard throws NESTING_ERROR inside the script (no IPC round trip needed). */
  onWorkflowRequest?: WorkflowRequestHandler;
  /** Handles a child's phase(title) notification (DES-006/DES-008 observability). */
  onPhase?: (title: string) => void;
  /** v26 (DES-182, ARCH-118, TASK-182, ADR-037): the run's two independent limits — `undefined`
   *  (key absent) falls back to `run()`'s legacy `budget: number|null` positional argument (a
   *  bare token count, the pre-v26 shape every existing non-budget-shape test still passes there);
   *  a key PRESENT here (even `null`) wins outright, which is what lets a caller who already holds
   *  both limits (RunManager, post-TASK-181) hand them over directly instead of collapsing to one
   *  legacy number. */
  budget?: { usd: number | null; tokens: number | null } | null;
  /** Returns the run's real live cumulative spend — piggybacked onto every agentResult message
   *  (D-F8) AND onto the initial `start` message (so a frame that never calls agent() still sees
   *  the spend it inherited, e.g. a nested frame reading the parent's spend at entry) so the
   *  sandboxed child's budget.spent()/tokens() reflect real accounting instead of a hard-coded
   *  stub. v26 (DES-182): reshaped from a bare token number to `{usd, tokens}` — `spent()` is USD,
   *  `tokens()` is the four-column breakdown. Absent -> no `spent` field is sent (dry-run seam). */
  onBudgetSnapshot?: () => { usd: number; tokens: Tokens };
  /** v26 (DES-175, ARCH-114, TASK-186): the CURRENT phase lane, snapshotted at the moment `case
   *  'agent'` calls it — SYNCHRONOUSLY, before the `Promise.resolve().then(handler)` deferral
   *  below. `case 'phase'` calls `onPhase` synchronously while `case 'agent'` defers to a
   *  microtask, and Node drains the IPC message queue before that microtask runs — a handler-time
   *  read would stamp the LATER phase, not the one the agent() call was actually issued under.
   *  Absent -> no phase snapshot travels with this call (dry-run seam / no phase tracking wired). */
  currentPhase?: () => { title: string; index: number } | undefined;
  /** F-1 (sandbox robustness sweep): wall-clock deadline for ONE `run()` execution — covers the
   *  WHOLE script lifetime, including every awaited agent()/workflow() round trip, not just CPU
   *  time: a synchronous `while(true){}` blocks the child's own event loop, so only a HOST-side
   *  timer (running in a separate OS process) can ever terminate it. Defaults to
   *  `DEFAULT_MAX_RUN_DURATION_MS`. Suspend/resume are unaffected: `resume()` installs a brand-new
   *  `SandboxHost`/`run()` call (run-manager.ts's own issue #53 note on `entry.sandbox` identity), so
   *  each LIVE execution gets its own fresh deadline — time spent suspended never counts against it. */
  maxRunDurationMs?: number;
}

const DEFAULT_AGENT_RESPONSE = 'stub-response';

// v36 (DES-248, ARCH-167, TASK-246): `refusalRef`, when the child's terminal error carried one —
// read from the wire message, never invented here.
type RunOutcome = { result: unknown } | { error: unknown; refusalRef?: number };

interface ActiveRun {
  child: ChildProcess;
  settle: (outcome: RunOutcome) => void;
}

export class SandboxHost {
  private readonly _config: SandboxHostConfig;
  private readonly _active = new Map<string, ActiveRun>();

  constructor(config: SandboxHostConfig) {
    this._config = config;
  }

  /** Spawn child process, send init, stream IPC, return when child emits done/error.
   *  `budget` is the LEGACY positional (a bare token count, or `null`) — kept for every existing
   *  caller that predates the two-limit shape; `SandboxHostConfig.budget`, when the key is present
   *  at all, wins over it (see the config field's own doc). */
  run(runId: string, script: string, args: unknown, budget: number | null): Promise<RunOutcome> {
    // v26 (DES-182, ARCH-118, TASK-182, ADR-037): the IPC `start` message's `budget` field —
    // `SandboxHostConfig.budget` if the caller set the key at all (even to `null`), else the
    // legacy positional collapsed into the v25-true meaning (a bare number was always TOKENS).
    const wireBudget = this._config.budget !== undefined ? this._config.budget : budget === null ? null : { usd: null, tokens: budget };
    return new Promise((resolve) => {
      let settled = false;
      // F-1: cleared inside `settle` itself (every settle path — done/error/exit/spawn-error, AND
      // the deadline firing on itself below) so exactly one of "the run finished" / "the deadline
      // fired" ever wins, and a run that finishes normally never leaves a live timer behind.
      let deadlineTimer: NodeJS.Timeout | undefined;
      const settle = (outcome: RunOutcome) => {
        if (settled) return;
        settled = true;
        if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
        this._active.delete(runId);
        resolve(outcome);
      };

      mkdirSync(this._config.workspaceRoot, { recursive: true });
      const child = fork(CHILD_ENTRY, [], {
        cwd: this._config.workspaceRoot,
        execArgv: [...SANDBOX_CHILD_EXEC_ARGV],
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        // #157 B1 layer 2 (defense in depth): `fork()` defaults to inheriting the FULL parent env —
        // this engine process's own (provider API keys, per main.ts's documented "read straight from
        // process.env"). The script-escape path that could have READ that env is closed in
        // guards.ts (commit 149d887); this independently ensures the child never CARRIES it at all,
        // so a future regression in the reachability fix would not also be a secrets leak.
        // child-entry.ts/guards.ts read no `process.env.*` of their own, so an empty env is both the
        // strictest posture and sufficient (verified: a child forked with `env: {}` boots and runs a
        // real script to completion).
        env: SANDBOX_CHILD_ENV,
      });
      this._active.set(runId, { child, settle });

      // F-1: the wall-clock deadline for this ONE execution. Started here (not after 'ready') so a
      // child that never even boots (a corrupt install, a missing CHILD_ENTRY file) is also bounded,
      // not just a child that boots and then hangs. Fires in the HOST process, never the child's own
      // event loop — the only thing that can terminate a synchronous `while(true){}`, which blocks
      // the child's event loop and so can never notice its own deadline from the inside.
      const deadlineMs = this._config.maxRunDurationMs ?? DEFAULT_MAX_RUN_DURATION_MS;
      deadlineTimer = setTimeout(() => {
        settle({
          error: {
            code: 'SCRIPT_TIMEOUT',
            message: `the script did not complete within its ${deadlineMs}ms run-duration deadline (maxRunDurationMs) and was terminated`,
          },
        });
        child.kill('SIGKILL');
      }, deadlineMs);
      // Node-only API (no-op under some non-Node runtimes' timer shims) — don't hold this process's
      // event loop open for a potentially multi-hour timer when every OTHER reason to stay alive
      // (the HTTP listener, other in-flight runs) has already gone away.
      deadlineTimer.unref?.();

      // Capture the child's stderr so an uncaught crash (an exception/rejection that exits the
      // process before it can send 'done'/'error') is not lost — its tail is surfaced in the
      // ABORTED message below instead of an opaque "terminated before completion". (Previously the
      // pipe had no reader, so every sandbox-child crash reason was discarded.)
      let stderrTail = '';
      // F-1 (real-check finding): a REAL V8 heap-limit abort prints `<-- Last few GCs -->`, THEN
      // `<-- JS stacktrace -->`, THEN the `FATAL ERROR: ...` line, THEN 10-20 native frames each
      // naming the engine's own install path (`N: 0x... node::Abort() [<long path>]`) — measured at
      // ~2.5KB total. `stderrTail`'s 2000-char windowed trim (needed to bound what an ordinary crash
      // surfaces in the ABORTED message) can push the FATAL ERROR line itself out of the window
      // before `exit` fires, which would misclassify a real OOM as a generic ABORTED. Detected
      // independently, as each chunk arrives, against a SEPARATE small untrimmed buffer (never fed
      // into the caller-visible `stderrTail`/ABORTED path) — `sawOomFingerprint` is sticky (sets
      // once, never clears) so a later chunk evicting the fingerprint from `oomCarry` can't un-detect
      // it; `oomCarry` itself keeps only the last 200 chars of raw stream (prepended to each new
      // chunk before testing) so a fingerprint split exactly across two `'data'` events is still
      // matched, without accumulating the whole crash dump a second time.
      let sawOomFingerprint = false;
      let oomCarry = '';
      child.stderr?.on('data', (d: Buffer) => {
        const text = d.toString();
        stderrTail = (stderrTail + text).slice(-2000);
        if (!sawOomFingerprint && V8_OOM_FINGERPRINT_RE.test(oomCarry + text)) sawOomFingerprint = true;
        oomCarry = (oomCarry + text).slice(-200);
      });

      child.on('message', (msg: any) => {
        switch (msg?.t) {
          case 'ready':
            // v26 (DES-182): `spent` seeds the child's live counter at start — a frame that never
            // calls agent() (a nested `workflow()` reading `budget.spent()`/`tokens()` cold) would
            // otherwise never receive ANY accounting, since today the only other carrier is the
            // per-call `agentResult` piggyback below.
            child.send({ t: 'start', runId, script, args, budget: wireBudget, spent: this._config.onBudgetSnapshot?.() });
            break;
          case 'agent': {
            const handler = this._config.onAgentRequest ?? (() => DEFAULT_AGENT_RESPONSE);
            // v26 (DES-175): snapshot the phase HERE, synchronously, at IPC receipt — see
            // SandboxHostConfig.currentPhase's own doc for why a read inside the deferred handler
            // below would stamp the wrong (later) phase.
            const phase = this._config.currentPhase?.();
            Promise.resolve()
              .then(() => handler(msg.prompt, msg.opts, msg.callSeq, phase))
              .then((value) => child.send({ t: 'agentResult', callSeq: msg.callSeq, value, spent: this._config.onBudgetSnapshot?.() }))
              .catch((err: unknown) =>
                child.send({
                  t: 'agentThrow',
                  callSeq: msg.callSeq,
                  error: { code: ipcErrorCode(err, 'AGENT_ERROR'), message: err instanceof Error ? err.message : String(err) },
                }),
              );
            break;
          }
          case 'workflow': {
            if (!this._config.onWorkflowRequest) {
              child.send({ t: 'agentThrow', callSeq: msg.callSeq, error: { code: 'NESTING_ERROR', message: 'workflow() nesting is limited to one level' } });
              break;
            }
            Promise.resolve()
              .then(() => this._config.onWorkflowRequest!(msg.ref, msg.args, msg.callSeq))
              .then((value) => child.send({ t: 'workflowResult', callSeq: msg.callSeq, value }))
              .catch((err: unknown) =>
                child.send({
                  t: 'agentThrow',
                  callSeq: msg.callSeq,
                  // A delegate present-but-throwing is NOT a nesting violation (that's the
                  // !onWorkflowRequest branch above) — preserve the real code, e.g. CatalogNotFoundError.
                  error: { code: ipcErrorCode(err, 'WORKFLOW_ERROR'), message: err instanceof Error ? err.message : String(err) },
                }),
              );
            break;
          }
          case 'phase':
            this._config.onPhase?.(msg.title);
            break;
          case 'done':
            settle({ result: msg.result });
            break;
          case 'error':
            settle({ error: msg.error, ...(typeof msg.refusalRef === 'number' ? { refusalRef: msg.refusalRef } : {}) });
            break;
        }
      });

      child.on('exit', (code, signal) => {
        const rawTail = stderrTail.trim();
        // F-1: a V8 heap-limit abort is NOT an ordinary crash — it is a FATAL ERROR that aborts the
        // process outright (no catchable JS exception), so it always reaches this branch, never
        // guards.ts's own classification. Checked via the STICKY `sawOomFingerprint` set as each
        // stderr chunk arrived (see its own doc above) — NEVER by re-testing the windowed, trimmed
        // `rawTail` here, which a real crash's many native frames can push the fingerprint line out
        // of before `exit` fires (measured in this change's own real-check: a real OOM's ~2.5KB dump
        // overflows the 2000-char window). V8's own crash dump content (heap statistics, absolute
        // source paths, the Node version) must never cross the trust boundary either way — the code
        // alone is the caller-visible signal, with a clean, fixed message.
        if (sawOomFingerprint) {
          settle({ error: { code: 'SCRIPT_OOM', message: 'the sandboxed script exhausted its memory limit and was terminated' } });
          return;
        }
        // A killed/crashed child that never sent done/error (e.g. aborted mid-script). Include the
        // exit code/signal and the tail of the child's own stderr so a real crash (uncaught error,
        // determinism-guard throw) is diagnosable instead of opaque.
        const detail = sanitizeStderrTail(rawTail);
        settle({
          error: {
            code: 'ABORTED',
            message:
              `sandbox child process terminated before completion (exit ${code ?? 'null'}, signal ${signal ?? 'null'})` +
              (detail ? `\n--- child stderr (tail) ---\n${detail}` : ''),
          },
        });
      });

      child.on('error', (err) => {
        settle({ error: { code: 'SPAWN_ERROR', message: err.message } });
      });
    });
  }

  /** Send abort signal to the running child process (force-kill: a looping script cannot
   *  process an in-band IPC message, so termination must happen from outside the process). */
  async abort(runId: string, _reason: 'suspend' | 'stop'): Promise<void> {
    const active = this._active.get(runId);
    if (!active) return;
    active.child.kill('SIGKILL');
  }
}

