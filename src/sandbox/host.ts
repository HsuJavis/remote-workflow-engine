// SandboxHost (DES-005 / DES-006 / ARCH-003, TASK-006). Spawns a real OS child process per
// run (node:child_process) so a hung/looping script can be killed from outside its own V8
// isolate, then runs the workflow script inside that child's restricted VM context
// (child-entry.ts -> guards.ts). The child's only channel back to this trusted host is the
// IPC seam (DES-006); it holds no secrets/store/network access.
import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';

const CHILD_ENTRY = join(dirname(fileURLToPath(import.meta.url)), 'child-entry.ts');

export type AgentRequestHandler = (prompt: string, opts: unknown, callSeq: number) => Promise<unknown> | unknown;
export type WorkflowRequestHandler = (ref: unknown, args: unknown, callSeq: number) => Promise<unknown> | unknown;

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
  /** Returns the run's real live cumulative RunGuard token total (D-F8) — piggybacked onto
   *  every agentResult message so the sandboxed child's budget.spent()/remaining() reflect real
   *  accounting instead of a hard-coded stub. Absent -> no `spent` field is sent (dry-run seam). */
  onBudgetSnapshot?: () => number;
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

  /** Spawn child process, send init, stream IPC, return when child emits done/error. */
  run(runId: string, script: string, args: unknown, budget: number | null): Promise<RunOutcome> {
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

      child.on('message', (msg: any) => {
        switch (msg?.t) {
          case 'ready':
            child.send({ t: 'start', runId, script, args, budgetTotal: budget });
            break;
          case 'agent': {
            const handler = this._config.onAgentRequest ?? (() => DEFAULT_AGENT_RESPONSE);
            Promise.resolve()
              .then(() => handler(msg.prompt, msg.opts, msg.callSeq))
              .then((value) => child.send({ t: 'agentResult', callSeq: msg.callSeq, value, spent: this._config.onBudgetSnapshot?.() }))
              .catch((err: unknown) =>
                child.send({
                  t: 'agentThrow',
                  callSeq: msg.callSeq,
                  error: { code: 'AGENT_ERROR', message: err instanceof Error ? err.message : String(err) },
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
                  error: { code: 'NESTING_ERROR', message: err instanceof Error ? err.message : String(err) },
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

      child.on('exit', () => {
        // A killed/crashed child that never sent done/error (e.g. aborted mid-script).
        settle({ error: { code: 'ABORTED', message: 'sandbox child process terminated before completion' } });
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

