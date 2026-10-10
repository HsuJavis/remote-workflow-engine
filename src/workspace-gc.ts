// v2 (REQ-026): periodic reclamation of stale run workspaces so seeded whole-tree copies do not
// accumulate unbounded. Deletes ONLY a workspace whose run is TERMINAL (completed/failed/stopped)
// AND older than the TTL — never an active/suspended/queued run, never a runId unknown to the store
// (a snapshot lookup miss => keep). `statusOf`/`nowMs` are injected so this is unit-testable without
// wall-clock or a live store.
//
// Issue #121 (owner decision, 2026-10-10): the TTL ages from the run's own END time — its first
// terminal transition (`RunSummary.terminalAt`/`RunStatusView.terminalAt`, the run store's
// authoritative field, NOT `AgentRecord.endedAt`, which is per-agent) — not the workspace
// directory's mtime. A long-running run (days in flight) must not be reclaimed the moment it
// finishes merely because its workspace directory is old; conversely a run that finished long ago
// but whose directory mtime was bumped recently (a stray write, a `workspace_pull`, a filesystem
// touch) must still be reclaimed. `statusOf` therefore returns `{status, endedAt}` — `endedAt` is
// the run's terminal-transition time in epoch ms, or `null`/absent for a LEGACY row with no
// recorded terminal transition, which falls back to the directory's own mtime (documented in
// DEPLOY.md). The mcp-state branches below use the identical `{status, endedAt}` shape for
// consistency, though the orphan mcp-state sweep (review v035 M-1 part 2, further down) has no age
// check of its own — there is nothing left to age out once the sibling workspace is already gone.
import { readdirSync, statSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { defaultAssetRoot } from './asset-sync.js';
import { mcpStateRunDir } from './mcp-run-state.js';
import type { RunStatus, RunSummary } from './types.js';

const TERMINAL = new Set<RunStatus>(['stopped', 'completed', 'failed']);

/** Issue #121: what `reclaimStaleWorkspaces` needs to know about a run to age it — its current
 *  status, and (when known) its end time as epoch ms. `endedAt` absent/`null` means "no recorded
 *  terminal transition" (a legacy pre-this-feature row), which the TTL loop falls back to the
 *  workspace directory's mtime for. */
export interface RunStatusInfo {
  status: RunStatus;
  endedAt?: number | null;
}

/** Issue #121: the ONE `RunSummary` -> `RunStatusInfo` mapping — `server.ts`'s sweep builds its
 *  `statusOf` lookup from this, never re-deriving the `terminalAt` parse inline, so the wiring
 *  can be unit-tested directly (no real server boot, no real timer) instead of only through a
 *  real sweep tick racing the TTL itself. `terminalAt` is an ISO string (`RunSummary`'s own
 *  "first terminal transition" field, sqlite-run-store.ts) absent on a legacy row with no
 *  recorded terminal transition — mapped to `endedAt: null`, which `reclaimStaleWorkspaces`
 *  falls back to the directory's mtime for. */
export function gcStatusFromSummary(r: Pick<RunSummary, 'status' | 'terminalAt'>): RunStatusInfo {
  if (!r.terminalAt) return { status: r.status, endedAt: null };
  const parsed = Date.parse(r.terminalAt);
  // A malformed `terminalAt` (should never happen — it is engine-written ISO — but "uncertain" must
  // resolve to "fall back to mtime", never to a `NaN` that could slip through an unguarded `??`
  // downstream) normalises to `null` here too, at the one source of this value.
  return { status: r.status, endedAt: Number.isFinite(parsed) ? parsed : null };
}

export function reclaimStaleWorkspaces(
  workRoot: string,
  ttlMs: number,
  statusOf: (runId: string) => RunStatusInfo | null,
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
  // Issue #121: caps how many entries ONE call reclaims (workspaces + mcp-state dirs + orphaned
  // asset trees combined, counted off the same `reclaimed` array every branch below pushes onto),
  // so a large already-expired backlog (the first sweep after `workspaceTtlMs` goes from "off" to
  // a 7-day default with months of accumulated terminal workspaces behind it) cannot block the
  // event loop draining it all in one synchronous call — server.ts re-arms a follow-up sweep soon
  // when the cap was hit, so the backlog still drains, just across several ticks instead of one.
  // Infinity (every existing call site) -> unbounded, unchanged behavior.
  maxReclaim: number = Infinity,
): string[] {
  const reclaimed: string[] = [];
  const atCap = (): boolean => reclaimed.length >= maxReclaim;
  const wfRoot = join(workRoot, 'workflows');
  let names: string[] = [];
  try {
    names = readdirSync(wfRoot);
  } catch {
    names = []; // no workflows dir yet — fall through to the asset sweep below regardless
  }
  for (const name of names) {
    if (atCap()) break;
    const runsDir = join(wfRoot, name, 'runs');
    const mcpStateDirPath = join(wfRoot, name, 'mcp-state');
    let runIds: string[] = [];
    try {
      runIds = readdirSync(runsDir);
    } catch {
      runIds = []; // no runs/ dir for this workflow — fall through to the orphan mcp-state sweep below
    }
    for (const runId of runIds) {
      if (atCap()) break; // cap hit — the rest of this workflow's runs wait for the next sweep tick
      const dir = join(runsDir, runId);
      let mtimeMs: number;
      try {
        const st = statSync(dir);
        if (!st.isDirectory()) continue;
        mtimeMs = st.mtimeMs;
      } catch {
        continue;
      }
      const info = statusOf(runId);
      if (info === null || !TERMINAL.has(info.status)) continue; // active/suspended/unknown -> keep
      // Issue #121: age from the run's own recorded end time; a legacy row with none falls back to
      // the directory's mtime (`endedAt` absent/null -> `mtimeMs`). `Number.isFinite` (not `??`)
      // guards the destructive branch below against `NaN` too — a malformed `terminalAt` (an
      // unparseable string past `Date.parse`) must fall back to mtime exactly like "no `terminalAt`
      // at all", never pass `NaN` through: `nowMs - NaN < ttlMs` is `false`, which would otherwise
      // skip the retention-window `continue` and reach the `rmSync` below on ANY malformed row,
      // regardless of its actual age — this is the one branch in this file where "uncertain" must
      // resolve to "keep", not "delete".
      const endedAtMs = Number.isFinite(info.endedAt) ? (info.endedAt as number) : mtimeMs;
      if (nowMs - endedAtMs < ttlMs) continue; // still within retention window
      try {
        rmSync(dir, { recursive: true, force: true });
        reclaimed.push(runId);
      } catch {
        /* raced/permission — skip, try next sweep */
      }
      // issue #126 B: a run's own MCP state dir (`${run:dir}` placeholders resolve under
      // `<workflowFolder>/mcp-state/<runId>/`, mcp-run-state.ts — a SIBLING of `runs/<runId>`,
      // never inside it) is reclaimed on the SAME terminal+TTL gate as the run's own workspace —
      // independently try/catch'd so one failing rm never blocks the other, and (same as the
      // workspace rm above) a raced/permission failure here is simply retried on the next sweep
      // rather than ever thrown.
      try {
        rmSync(mcpStateRunDir(join(wfRoot, name), runId), { recursive: true, force: true });
      } catch {
        /* no mcp-state dir for this run (the common case — most runs declare no stateful MCP
           server), or raced/permission — either way, nothing to report and nothing to retry for */
      }
    }
    // review v035 M-1 part 2: the TTL loop above only ever reclaims a run's mcp-state dir as a
    // SIDE EFFECT of iterating `runs/<runId>` — once something else has ALREADY removed
    // `runs/<runId>` (`workspace_purge`, mcp-facade.ts, terminal-gated the same as this sweep) that
    // runId is no longer in `runIds` above, so its mcp-state dir would be orphaned forever. This
    // walks `mcp-state/` itself and reclaims any `<runId>` whose `runs/<runId>` sibling is ALREADY
    // gone — independent of the TTL (there is nothing left to age out: the workspace is gone). Never
    // deletes a runId the TTL loop above still owns (its `runs/<runId>` sibling still exists), and
    // never deletes one the store reports as still live — nothing in this engine deletes
    // `runs/<runId>` while a run is live, but a defense-in-depth re-check costs nothing here.
    let stateRunIds: string[] = [];
    try {
      stateRunIds = readdirSync(mcpStateDirPath);
    } catch {
      continue; // no mcp-state dir for this workflow at all
    }
    for (const runId of stateRunIds) {
      if (atCap()) break; // cap hit — the rest wait for the next sweep tick
      if (existsSync(join(runsDir, runId))) continue; // still has a runs/<runId> sibling — the TTL loop above owns it
      const info = statusOf(runId);
      if (info !== null && !TERMINAL.has(info.status)) continue; // defense-in-depth: never touch a live run
      try {
        rmSync(join(mcpStateDirPath, runId), { recursive: true, force: true });
        reclaimed.push(`mcp-state/${runId}`);
      } catch {
        /* raced/permission — skip, try next sweep */
      }
    }
  }
  if (hasWorkflow && !atCap()) {
    const assetsRoot = assetRoot;
    let wfNames: string[];
    try {
      wfNames = readdirSync(assetsRoot);
    } catch {
      wfNames = [];
    }
    for (const name of wfNames) {
      if (atCap()) break; // cap hit — the rest wait for the next sweep tick
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
