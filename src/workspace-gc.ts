// v2 (REQ-026): periodic reclamation of stale run workspaces so seeded whole-tree copies do not
// accumulate unbounded. Deletes ONLY a workspace whose run is TERMINAL (completed/failed/stopped)
// AND older than the TTL — never an active/suspended/queued run, never a runId unknown to the store
// (a snapshot lookup miss => keep). `statusOf`/`nowMs` are injected so this is unit-testable without
// wall-clock or a live store.
import { readdirSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { RunStatus } from './types.js';

const TERMINAL = new Set<RunStatus>(['stopped', 'completed', 'failed']);

export function reclaimStaleWorkspaces(
  workRoot: string,
  ttlMs: number,
  statusOf: (runId: string) => RunStatus | null,
  nowMs: number,
): string[] {
  const reclaimed: string[] = [];
  const wfRoot = join(workRoot, 'workflows');
  let names: string[];
  try {
    names = readdirSync(wfRoot);
  } catch {
    return reclaimed; // no workflows dir yet
  }
  for (const name of names) {
    const runsDir = join(wfRoot, name, 'runs');
    let runIds: string[];
    try {
      runIds = readdirSync(runsDir);
    } catch {
      continue;
    }
    for (const runId of runIds) {
      const dir = join(runsDir, runId);
      let mtimeMs: number;
      try {
        const st = statSync(dir);
        if (!st.isDirectory()) continue;
        mtimeMs = st.mtimeMs;
      } catch {
        continue;
      }
      const status = statusOf(runId);
      if (status === null || !TERMINAL.has(status)) continue; // active/suspended/unknown -> keep
      if (nowMs - mtimeMs < ttlMs) continue; // still within retention window
      try {
        rmSync(dir, { recursive: true, force: true });
        reclaimed.push(runId);
      } catch {
        /* raced/permission — skip, try next sweep */
      }
    }
  }
  return reclaimed;
}
