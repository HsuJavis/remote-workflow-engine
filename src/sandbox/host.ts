// SandboxHost (DES-005 / DES-006 / ARCH-003, TASK-006). Spawns a real OS child process per
// run (node:child_process) so a hung/looping script can be killed from outside its own V8
// isolate, then runs the workflow script inside that child's restricted VM context
// (child-entry.ts -> guards.ts). The child's only channel back to this trusted host is the
// IPC seam (DES-006); it holds no secrets/store/network access.
import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';
import type { Tokens } from '../types.js';

const CHILD_ENTRY = join(dirname(fileURLToPath(import.meta.url)), 'child-entry.ts');

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
}

const DEFAULT_AGENT_RESPONSE = 'stub-response';

type RunOutcome = { result: unknown } | { error: unknown };

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
      const settle = (outcome: RunOutcome) => {
        if (settled) return;
        settled = true;
        this._active.delete(runId);
        resolve(outcome);
      };

      mkdirSync(this._config.workspaceRoot, { recursive: true });
      const child = fork(CHILD_ENTRY, [], {
        cwd: this._config.workspaceRoot,
        execArgv: ['--experimental-transform-types', '--disable-warning=ExperimentalWarning'],
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      });
      this._active.set(runId, { child, settle });

      // Capture the child's stderr so an uncaught crash (an exception/rejection that exits the
      // process before it can send 'done'/'error') is not lost — its tail is surfaced in the
      // ABORTED message below instead of an opaque "terminated before completion". (Previously the
      // pipe had no reader, so every sandbox-child crash reason was discarded.)
      let stderrTail = '';
      child.stderr?.on('data', (d: Buffer) => {
        stderrTail = (stderrTail + d.toString()).slice(-2000);
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
            settle({ error: msg.error });
            break;
        }
      });

      child.on('exit', (code, signal) => {
        // A killed/crashed child that never sent done/error (e.g. aborted mid-script). Include the
        // exit code/signal and the tail of the child's own stderr so a real crash (uncaught error,
        // OOM, determinism-guard throw) is diagnosable instead of opaque.
        const detail = stderrTail.trim();
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

