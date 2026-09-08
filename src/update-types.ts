// Shared cross-process schema for self-update (TASK-063, DES-060/061, ARCH-039/040).
// Single source of truth: both the privileged bash helper (deploy/rwe-update.sh) and
// the engine (src/self-update.ts, src/server.ts) import from here — no JSON schema drift.

export type UpdateStatus = 'pending' | 'applied' | 'failed' | 'skipped';

/** v26 (DES-172, ARCH-112, TASK-172, REQ-123/070): whether `--check-config` passed before this
 *  outcome's restart. `'skipped'` when `RWE_CONFIG_PATH` wasn't set for the updater — recorded,
 *  never a silent pass. Absent means this outcome was written by a PRE-v26 updater (no key at
 *  all, distinct from any of the three known values). */
export type ConfigCheckOutcome = 'passed' | 'skipped' | 'failed';

export interface UpdateOutcome {
  tag: string;
  status: UpdateStatus;
  ts: string;         // ISO-8601 UTC timestamp produced by the helper
  detail?: string;    // error/log excerpt, capped 4 KB (head+tail)
  configCheck?: ConfigCheckOutcome;
}
