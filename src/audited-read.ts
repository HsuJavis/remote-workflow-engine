// src/audited-read.ts (DES-151, ARCH-091/092, TASK-140): the one orchestration function an admin
// cross-owner read (workspace_list/workspace_pull/run_agent_log/run_result) goes through — append
// the audit row BEFORE reading any byte, and never swallow an append failure (fail-closed by
// construction, not by a strip rule someone must remember at each of the four call sites).
import { codedError } from './errors.js';
import type { AuditAction } from './types.js';

export interface AuditReadStore {
  appendAudit(ev: { ts: string; actor: string; action: AuditAction; runId: string; owner: string; path?: string }): void;
  readArtifactChunk(args: { runId: string; owner: string; path?: string }): unknown;
}

export interface AuditedReadArgs {
  /** `null` = auth disabled (no actor id exists) — no audit row is ever written (DES-151 boundary). */
  actor: string | null;
  action: AuditAction;
  runId: string;
  owner: string;
  path?: string;
}

/** Deliberately NO try/catch around `readArtifactChunk` — only `appendAudit` is guarded, and its
 *  guard rethrows (never swallows): a throwing store must fail the whole read closed, with zero
 *  bytes served, rather than dress an engine fault as a caller-facing code. */
export async function auditedWorkspaceRead(store: AuditReadStore, args: AuditedReadArgs): Promise<unknown> {
  const { actor, action, runId, owner, path } = args;
  if (actor !== null) {
    try {
      store.appendAudit({ ts: new Date().toISOString(), actor, action, runId, owner, path });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw codedError('INTERNAL_ERROR', `INTERNAL_ERROR: audit append failed, read refused: ${message}`);
    }
  }
  return store.readArtifactChunk({ runId, owner, path });
}
