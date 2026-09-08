// src/audited-read.ts (DES-151, ARCH-091/092, TASK-140/157): the one orchestration function an
// admin cross-owner read (workspace_list/workspace_pull/run_agent_log/run_result) goes through —
// append the audit row BEFORE reading any byte, and never swallow an append failure (fail-closed
// by construction, not by a strip rule someone must remember at each of the four call sites).
//
// v24 (TASK-157, adjudication A-7 [10]): `readArtifactChunk` is NOT a store method — it is a free
// function in workspace-artifacts.ts with its own real signature `(workspace, path, offset,
// length)`, and only ONE of the four call sites (workspace_pull) actually calls it; the other
// three (run_result/run_agent_log/workspace_list) read something else entirely (a run result, a
// transcript, an artifact list). An earlier port invented a `{runId, owner, path}` object shape
// that pretended to be that real signature but was never actually passed to it — the caller
// closures ignored it. Reconciled by removing the competing shape outright: `AuditReadStore`
// carries only `appendAudit`, and the read itself is a plain thunk passed as a third argument —
// the one site that reads workspace bytes (`mcp-facade.ts`'s `workspacePull`) already calls the
// real `readArtifactChunk(workspace, path, offset, length)` inside that thunk.
import { codedError } from './errors.js';
import type { AuditAction } from './types.js';

export interface AuditReadStore {
  appendAudit(ev: { ts: string; actor: string; action: AuditAction; runId: string; owner: string; path?: string }): void;
}

export interface AuditedReadArgs {
  /** `null` = auth disabled (no actor id exists) — no audit row is ever written (DES-151 boundary). */
  actor: string | null;
  action: AuditAction;
  runId: string;
  owner: string;
  path?: string;
}

/** Deliberately NO try/catch around `read()` — only `appendAudit` is guarded, and its guard
 *  rethrows (never swallows): a throwing store must fail the whole read closed, with zero bytes
 *  served, rather than dress an engine fault as a caller-facing code. */
export async function auditedWorkspaceRead<T>(store: AuditReadStore, args: AuditedReadArgs, read: () => T | Promise<T>): Promise<T> {
  const { actor, action, runId, owner, path } = args;
  if (actor !== null) {
    try {
      store.appendAudit({ ts: new Date().toISOString(), actor, action, runId, owner, path }); // det:allow — the audit row stamps when the read actually happened (event recording, not a decision); same disposition as clock.ts:22
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw codedError('INTERNAL_ERROR', `INTERNAL_ERROR: audit append failed, read refused: ${message}`);
    }
  }
  return read();
}
