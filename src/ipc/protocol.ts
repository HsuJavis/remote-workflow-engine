// IPC message protocol (DES-006). Pure discriminated-union types; no implementation needed.
import type { AgentOpts } from '../types.js';

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
  // `spent` (D-F8): the real cumulative RunGuard token total as of this call's completion,
  // piggybacked so the child can keep its own script-visible budget.spent()/remaining() live
  // instead of a hard-coded stub.
  | { t: 'agentResult';    callSeq: number; value: unknown | null; spent?: number }
  | { t: 'workflowResult'; callSeq: number; value: unknown }
  | { t: 'agentThrow';     callSeq: number; error: { code: string; message: string } }
  | { t: 'abort';          reason: 'suspend' | 'stop' }
  | { t: 'init';           args: unknown; budget: { total: number | null } };
