// IPC message protocol (DES-006). Pure discriminated-union types; no implementation needed.
import type { AgentOpts, Tokens } from '../types.js';

// child → parent
export type ChildMsg =
  | { t: 'agent';    runId: string; callSeq: number; prompt: string; opts: AgentOpts }
  | { t: 'workflow'; runId: string; callSeq: number; ref: string | { scriptPath: string }; args: unknown }
  | { t: 'phase';    runId: string; title: string }
  | { t: 'log';      runId: string; message: string }
  | { t: 'done';     runId: string; result: unknown }
  | { t: 'error';    runId: string; error: { message: string; stack?: string } };

// parent → child
export type ParentMsg =
  // `spent` (D-F8; v26 ARCH-118, M-6 send-back repair): the run's cumulative spend as of this
  // call's completion — `{usd, tokens}`, matching `SandboxHostConfig.onBudgetSnapshot`'s own return
  // shape (host.ts) and the child's own `Spend` reader (child-entry.ts) — piggybacked so the child
  // can keep its own script-visible budget.spent()/remaining() live instead of a hard-coded stub.
  // This was a bare `number` (the pre-v26 token-only total) after DES-182 widened the wire to four
  // token columns plus USD everywhere else in this same file except here.
  | { t: 'agentResult';    callSeq: number; value: unknown | null; spent?: { usd: number; tokens: Tokens } }
  | { t: 'workflowResult'; callSeq: number; value: unknown }
  | { t: 'agentThrow';     callSeq: number; error: { code: string; message: string } }
  | { t: 'abort';          reason: 'suspend' | 'stop' }
  // v26 (DES-182, ADR-037, integrator — clarification 36): the SHAPE the wire actually carries is
  // the two independent limits, not a single `total`. `host.ts`/`child-entry.ts` moved with
  // DES-182; this declaration was left behind describing a message that no longer exists.
  | { t: 'init';           args: unknown; budget: { usd: number | null; tokens: number | null } | null };
