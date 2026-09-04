// v2 (REQ-026): periodic reclamation of stale run workspaces so seeded whole-tree copies do not
// accumulate unbounded. Deletes ONLY a workspace whose run is TERMINAL (completed/failed/stopped)
// AND older than the TTL — never an active/suspended/queued run, never a runId unknown to the store
// (a snapshot lookup miss => keep). `statusOf`/`nowMs` are injected so this is unit-testable without
// wall-clock or a live store.
import { readdirSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { defaultAssetRoot } from './asset-sync.js';
import type { RunStatus } from './types.js';

const TERMINAL = new Set<RunStatus>(['stopped', 'completed', 'failed']);

export function reclaimStaleWorkspaces(
  workRoot: string,
  ttlMs: number,
  statusOf: (runId: string) => RunStatus | null,
  nowMs: number,
  // v24 (ARCH-098, DES-148, TASK-143): optional — when supplied, ALSO sweeps `<assetRoot>/<name>/`
  // for a workflow name `hasWorkflow` reports as gone. `deregister()`'s FS removal is an after-hook
  // OUTSIDE its DB transaction (workflow-catalog.ts); a crash between the DB delete and that
  // `rmSync` leaves this tree orphaned, reclaimed here on the next sweep.
  // v24 (integrator, adjudication #4 C-7 [12]): `server.ts`'s production sweep DID omit it, so this
  // whole branch had never run outside a test — it is passed now. `assetRoot` defaults to the same
  // `defaultAssetRoot(workRoot)` the writer uses; the server passes its RESOLVED value so an
  // operator-overridden `assetRoot` is swept too, instead of silently accumulating orphans.
  //
  // v24 Gate 8 (AF-1, TASK-160) — READ THIS BEFORE CHANGING THE CALL SITE: this branch is
  // unconditionally destructive over `<assetRoot>/`, and a PRE-v24 deployment's GLOBAL asset tree
  // sits at `<assetRoot>/skill/<name>` — a child whose name is not a live workflow. It survives
  // only because `server.ts` runs `migrateLegacyGlobalAssets()` (asset-sync.ts), which relocates
  // that tree to `<workRoot>/_global_assets/`, BEFORE the sweep timer is armed. Arming the sweep
  // before the migration destroys the operator's skills on the first tick; the ordering is pinned
  // by tests/integration/legacy-asset-migration.test.ts, not by this comment.
  hasWorkflow?: (name: string) => boolean,
  assetRoot: string = defaultAssetRoot(workRoot),
): string[] {
  const reclaimed: string[] = [];
  const wfRoot = join(workRoot, 'workflows');
  let names: string[] = [];
  try {
    names = readdirSync(wfRoot);
  } catch {
    names = []; // no workflows dir yet — fall through to the asset sweep below regardless
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
  if (hasWorkflow) {
    const assetsRoot = assetRoot;
    let wfNames: string[];
    try {
      wfNames = readdirSync(assetsRoot);
    } catch {
      wfNames = [];
    }
    for (const name of wfNames) {
      if (hasWorkflow(name)) continue; // live workflow — never touched
      const dir = join(assetsRoot, name);
      try {
        if (!statSync(dir).isDirectory()) continue;
      } catch {
        continue;
      }
      try {
        rmSync(dir, { recursive: true, force: true });
        reclaimed.push(`assets/${name}`);
      } catch {
        /* raced/permission — skip, try next sweep */
      }
    }
  }
  return reclaimed;
}
