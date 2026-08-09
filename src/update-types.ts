// Shared cross-process schema for self-update (TASK-063, DES-060/061, ARCH-039/040).
// Single source of truth: both the privileged bash helper (deploy/rwe-update.sh) and
// the engine (src/self-update.ts, src/server.ts) import from here — no JSON schema drift.

export type UpdateStatus = 'pending' | 'applied' | 'failed' | 'skipped';

export interface UpdateOutcome {
  tag: string;
  status: UpdateStatus;
  ts: string;         // ISO-8601 UTC timestamp produced by the helper
  detail?: string;    // error/log excerpt, capped 4 KB (head+tail)
}
