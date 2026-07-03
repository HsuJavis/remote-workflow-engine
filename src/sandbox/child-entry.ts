// Sandbox child entry point (DES-005/DES-006, TASK-006). Executed in its own OS process
// (spawned by SandboxHost) so a hung/looping script can be terminated from outside the V8
// isolate — something an in-process vm context cannot guarantee. Runs the untrusted script
// inside the restricted VM context (guards.ts) and forwards agent()/workflow() calls to the
// trusted parent over the IPC channel; holds no secrets/store/network access itself.
//
// NOTE: this file is executed directly by `node --experimental-transform-types` (not through
// the project's vitest/bundler TS resolution), so — unlike the rest of the codebase — its
// relative imports use explicit `.ts` extensions, which is what plain Node's loader resolves.
import { evaluateScript } from './guards.ts';
import type { SandboxApi } from './guards.ts';

// Extends the DES-006 ParentMsg 'init' shape with the fields a standalone child process needs
// at spawn time (script text, runId) that the seam's steady-state protocol doesn't carry.
interface StartMsg {
  t: 'start';
  runId: string;
  script: string;
  args: unknown;
  budgetTotal: number | null;
}
interface AgentResultMsg { t: 'agentResult'; callSeq: number; value: unknown; spent?: number }
interface AgentThrowMsg { t: 'agentThrow'; callSeq: number; error: { code: string; message: string } }
interface WorkflowResultMsg { t: 'workflowResult'; callSeq: number; value: unknown }
interface AbortMsg { t: 'abort'; reason: 'suspend' | 'stop' }

type InMsg = StartMsg | AgentResultMsg | AgentThrowMsg | WorkflowResultMsg | AbortMsg;

let nextCallSeq = 0;
const pendingAgent = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
const pendingWorkflow = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
// D-F8: live script-visible budget accounting, kept current by the `spent` field piggybacked
// onto every agentResult message (the parent's real RunGuard total as of that call) — never a
// hard-coded stub.
let spentSoFar = 0;

function send(msg: unknown): void {
  process.send?.(msg);
}

process.on('message', (msg: InMsg) => {
  switch (msg.t) {
    case 'agentResult': {
      if (msg.spent !== undefined) spentSoFar = msg.spent;
      const p = pendingAgent.get(msg.callSeq);
      if (!p) return;
      pendingAgent.delete(msg.callSeq);
      p.resolve(msg.value);
      return;
    }
    case 'agentThrow': {
      // 'agentThrow' correlates by callSeq to EITHER a pending agent() or a pending workflow()
      // call (DES-006: one shared throw-signal for budget/nesting/unknown-name errors) — the two
      // pending maps share the same callSeq counter, so exactly one of them holds this entry.
      const p = pendingAgent.get(msg.callSeq) ?? pendingWorkflow.get(msg.callSeq);
      if (!p) return;
      pendingAgent.delete(msg.callSeq);
      pendingWorkflow.delete(msg.callSeq);
      p.reject(Object.assign(new Error(msg.error.message), { name: msg.error.code }));
      return;
    }
    case 'workflowResult': {
      const p = pendingWorkflow.get(msg.callSeq);
      if (!p) return;
      pendingWorkflow.delete(msg.callSeq);
      p.resolve(msg.value);
      return;
    }
    case 'abort':
      process.exit(0);
      break;
    case 'start':
      void main(msg);
      break;
  }
});

async function main(msg: StartMsg): Promise<void> {
  const api: SandboxApi = {
    async agent(prompt: string, opts?: unknown): Promise<unknown> {
      const callSeq = nextCallSeq++;
      const result = new Promise<unknown>((resolve, reject) => pendingAgent.set(callSeq, { resolve, reject }));
      send({ t: 'agent', runId: msg.runId, callSeq, prompt, opts: opts ?? {} });
      return result;
    },
    args: msg.args,
    budget: {
      total: msg.budgetTotal,
      spent: () => spentSoFar,
      remaining: () => (msg.budgetTotal === null ? Infinity : msg.budgetTotal - spentSoFar),
    },
    async workflow(nameOrRef: unknown, wfArgs?: unknown): Promise<unknown> {
      const callSeq = nextCallSeq++;
      const result = new Promise<unknown>((resolve, reject) => pendingWorkflow.set(callSeq, { resolve, reject }));
      send({ t: 'workflow', runId: msg.runId, callSeq, ref: nameOrRef, args: wfArgs });
      return result;
    },
    phase(title: string): void {
      send({ t: 'phase', runId: msg.runId, title });
    },
  };

  const result = await evaluateScript(msg.script, api);
  if (result.kind === 'done') {
    send({ t: 'done', runId: msg.runId, result: result.value });
  } else {
    send({ t: 'error', runId: msg.runId, error: result.error });
  }
  process.exit(0);
}

// Tell the parent we're ready to receive the 'start' message (avoids a lost-message race
// where the parent sends before this process has attached its 'message' listener).
send({ t: 'ready' });
