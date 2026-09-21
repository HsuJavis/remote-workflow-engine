// Sandbox child entry point (DES-005/DES-006, TASK-006). Executed in its own OS process
// (spawned by SandboxHost) so a hung/looping script can be terminated from outside the V8
// isolate — something an in-process vm context cannot guarantee. Runs the untrusted script
// inside the restricted VM context (guards.ts) and forwards agent()/workflow() calls to the
// trusted parent over the IPC channel; holds no secrets/store/network access itself.
//
// NOTE: this file is executed directly by `node --experimental-transform-types` (not through
// the project's vitest/bundler TS resolution), so — unlike the rest of the codebase — its
// relative imports use explicit `.ts` extensions, which is what plain Node's loader resolves.
import { evaluateScript, markEngineRefusal } from './guards.ts';
import type { SandboxApi } from './guards.ts';
import type { SandboxBudget } from '../types.ts';

// v26 (DES-182, ARCH-118, TASK-182): the live `{usd, tokens}` spend snapshot — piggybacked onto
// both the initial `start` message (a frame that never calls agent(), e.g. a nested workflow()
// reading `budget.spent()` cold, would otherwise see no accounting at all) and every subsequent
// `agentResult`. Inlined (not imported from `run-guard.ts`'s `ZERO_TOKENS`) — this module does not
// resolve local `.js`→`.ts` value imports (see the `checkMeta` note in `guards.ts`).
interface Spend { usd: number; tokens: { input: number; output: number; cacheRead: number; cacheWrite: number } }
const ZERO_SPEND: Spend = { usd: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };

// Extends the DES-006 ParentMsg 'init' shape with the fields a standalone child process needs
// at spawn time (script text, runId) that the seam's steady-state protocol doesn't carry.
interface StartMsg {
  t: 'start';
  runId: string;
  script: string;
  args: unknown;
  /** v26 (DES-182, ADR-037): was `budgetTotal: number | null` (a bare token count) — now the two
   *  independent limits, or `null` for unbounded on both. */
  budget: { usd: number | null; tokens: number | null } | null;
  /** v26 (DES-182): the live spend as of run start (absent -> the dry-run seam, treated as zero). */
  spent?: Spend;
}
interface AgentResultMsg { t: 'agentResult'; callSeq: number; value: unknown; spent?: Spend }
interface AgentThrowMsg { t: 'agentThrow'; callSeq: number; error: { code: string; message: string } }
interface WorkflowResultMsg { t: 'workflowResult'; callSeq: number; value: unknown }
interface AbortMsg { t: 'abort'; reason: 'suspend' | 'stop' }

type InMsg = StartMsg | AgentResultMsg | AgentThrowMsg | WorkflowResultMsg | AbortMsg;

let nextCallSeq = 0;
const pendingAgent = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
const pendingWorkflow = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
// D-F8 / v26 (DES-182): live script-visible budget accounting, kept current by the `spent` field
// piggybacked onto the initial `start` message and onto every agentResult message (the parent's
// real accounting as of that call) — never a hard-coded stub.
let spentSoFar: Spend = ZERO_SPEND;

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
      // v25 (DES-169, REQ-120, issue #63): the catalog code is written to BOTH `code` and `name`.
      // Until now only `name` was set, so the guide's own recovery example
      // (`if (e.code !== 'BUDGET_EXCEEDED') throw e;`) rethrew every time — a script following the
      // documentation failed the run in exactly the case it was told it could handle. `.code` is
      // what every other surface of this engine uses for a catalog code (`run_result.error.code`,
      // `reasonCode`, `ipcErrorCode`), so it is the field the script gets too. `name` STAYS: it has
      // been the only handle scripts had, `String(e)` renders from it, and `refusalCode()` in
      // guards.ts reads it. Every refusal a script can catch off this seam is fixed at this one
      // line — BUDGET_EXCEEDED from agent(), and NESTING_DEPTH_EXCEEDED / NESTING_CYCLE /
      // DESCENDANT_CAP_EXCEEDED from workflow() (which additionally re-wrap in a GuardError).
      // v36 (DES-248, ARCH-165, TASK-246): mark BEFORE reject — the ref rides on THIS object's
      // identity, so a script that catches and rethrows it (even after forging `e.refusalRef = 99`
      // on the object) still surfaces the map's answer, never the forgery.
      const rejectErr = Object.assign(new Error(msg.error.message), { name: msg.error.code, code: msg.error.code });
      markEngineRefusal(rejectErr, msg.callSeq);
      p.reject(rejectErr);
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
      if (msg.spent !== undefined) spentSoFar = msg.spent;
      void main(msg);
      break;
  }
});

async function main(msg: StartMsg): Promise<void> {
  // v26 (DES-182, ARCH-118, ADR-037): `total`/`spent()`/`remaining()` are USD (the alias/unit the
  // architecture keeps on these three names); `limits`/`tokens()` are the new accessors — a
  // tokens-only budget shows up as `limits.usd === null` / `total === null` / `remaining() ===
  // null` (never `Infinity` — see `SandboxBudget`'s own doc) while `limits.tokens` is a number.
  // Built via a NAMED, explicitly-typed variable (not an inline object literal in `api` below) so
  // its extra fields over `Budget` (`SandboxApi.budget`'s own declared type) don't trip TS's
  // excess-property check.
  const limits = { usd: msg.budget?.usd ?? null, tokens: msg.budget?.tokens ?? null };
  const sandboxBudget: SandboxBudget = {
    limits,
    total: limits.usd,
    spent: () => spentSoFar.usd,
    remaining: () => (limits.usd === null ? null : limits.usd - spentSoFar.usd),
    tokens: () => {
      const t = spentSoFar.tokens;
      return { ...t, sum: t.input + t.output + t.cacheRead + t.cacheWrite };
    },
  };

  const api: SandboxApi = {
    async agent(prompt: string, opts?: unknown): Promise<unknown> {
      const callSeq = nextCallSeq++;
      const result = new Promise<unknown>((resolve, reject) => pendingAgent.set(callSeq, { resolve, reject }));
      send({ t: 'agent', runId: msg.runId, callSeq, prompt, opts: opts ?? {} });
      return result;
    },
    args: msg.args,
    budget: sandboxBudget,
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
    // v36 (DES-248): `refusalRef` hoisted to a SIBLING of `error` on the wire — `host.ts`'s
    // `RunOutcome` reads `msg.refusalRef`, not a nested field, so the parent ledger lookup at
    // settle time has a plain number to key on.
    send({ t: 'error', runId: msg.runId, error: result.error, ...(result.error?.refusalRef !== undefined ? { refusalRef: result.error.refusalRef } : {}) });
  }
  process.exit(0);
}

// Tell the parent we're ready to receive the 'start' message (avoids a lost-message race
// where the parent sends before this process has attached its 'message' listener).
send({ t: 'ready' });
