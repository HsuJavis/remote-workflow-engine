// WorkRoot isolation guard (REQ-021 / D-V3M-5): a run workspace nested under a Claude Code project
// makes the SDK-gateway agent CLI (which runs with settingSources:['project'] to load the workspace's
// own materialized .claude/skills) resolve the project root to that ancestor and load ITS CLAUDE.md +
// ~/.claude/projects/<hash>/memory into the agent context — a confinement leak that bypasses the
// tool-level workspace jail (D-V2G8-1(d)), because it happens at session-init, not via a Read tool
// call (empirically reproduced 2026-07-11: workRoot:"./data" inside the engine repo → a qwen agent
// verbatim echoed the operator's MEMORY.md). This is a boot-time fail-closed guard: refuse to start
// when workRoot (or any ancestor) is a Claude Code project, rather than run and leak silently.
import { existsSync, realpathSync as fsRealpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { isPathContained } from './path-containment.js';

const REMEDY =
  'Set workRoot to a path OUTSIDE any project/git repo ' +
  '(e.g. /var/lib/remote-workflow-engine, or ~/.local/share/rwe-data).';

/** v37 (DES-257, ARCH-180, TASK-253, REQ-219): ONE exported constant shared by the boot error
 *  class's `.code` below AND `findProjectMarkerAboveWorkspace`'s gateway-side refusal `detail` —
 *  not three hand-copied literals. */
export const WORKROOT_INSIDE_PROJECT = 'WORKROOT_INSIDE_PROJECT';

export class WorkRootInsideProjectError extends Error {
  readonly code = WORKROOT_INSIDE_PROJECT;
  readonly ancestor: string;
  readonly marker: '.git' | 'CLAUDE.md';
  readonly remedy: string;

  constructor(workRoot: string, ancestor: string, marker: '.git' | 'CLAUDE.md') {
    super(
      `workRoot "${workRoot}" is inside a Claude Code project (${ancestor} contains ${marker}). ` +
        'Agent run workspaces nested under a project cause the SDK-gateway agent CLI to load that ' +
        "project's CLAUDE.md and auto-memory into the agent context — a confinement leak (it bypasses " +
        `the tool-level workspace jail because it happens at session-init). ${REMEDY}`,
    );
    this.name = 'WorkRootInsideProjectError';
    this.ancestor = ancestor;
    this.marker = marker;
    this.remedy = REMEDY;
  }
}

/** PURE: resolves symlinks via realpathImpl first (catches a workRoot symlinked into a project —
 *  a plain resolve() would miss this — Adv#5/R6), then walks EXISTING ancestors from the
 *  resolved path up to (but EXCLUDING) stopAt. Returns the first directory carrying a `.git` or
 *  `CLAUDE.md` marker, or null if none found. stopAt=null means walk all the way to the filesystem
 *  root (boot-time check); stopAt=workRoot means walk only within the run-workspace subtree
 *  (session-init re-walk). */
export function findProjectMarkerAncestor(
  path: string,
  stopAt: string | null,
  existsImpl: (p: string) => boolean,
  realpathImpl: (p: string) => string,
): string | null {
  let dir = realpathImpl(path);
  for (;;) {
    if (dir === stopAt) return null; // stop BEFORE checking stopAt itself
    if (existsImpl(join(dir, '.git')) || existsImpl(join(dir, 'CLAUDE.md'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null; // reached filesystem root
    dir = parent;
  }
}

/** Default realpathImpl: real realpathSync, with a fallback to path.resolve for non-existent paths
 *  (a freshly-provisioned server may boot before its workRoot dir exists — non-existent workRoot
 *  must NOT bypass the check; we still walk existing ancestors). */
function defaultRealpath(p: string): string {
  try {
    return fsRealpathSync(p);
  } catch {
    return resolve(p);
  }
}

/** PURE (fs probes injected for tests): throws WorkRootInsideProjectError when `workRoot` itself or any
 *  ancestor up to the filesystem root contains a `.git` or `CLAUDE.md` project marker. A `.git`/
 *  `CLAUDE.md` ancestor is exactly what makes the agent CLI treat that dir as the project whose
 *  CLAUDE.md/auto-memory it loads — so it is the precise signal for the REQ-021 leak. (`~/.claude`
 *  alone is the CLI's GLOBAL config, not a project marker, so a data dir merely under $HOME does not
 *  trip this — only a real git repo / CLAUDE.md-bearing dir does.) */
export function assertWorkRootIsolated(
  workRoot: string,
  existsImpl: (p: string) => boolean = existsSync,
  realpathImpl: (p: string) => string = defaultRealpath,
): void {
  // Canonicalise first — catches a workRoot that is a symlink into a project (Adv#5/R6).
  let dir = realpathImpl(workRoot);
  for (;;) {
    if (existsImpl(join(dir, '.git'))) {
      throw new WorkRootInsideProjectError(workRoot, dir, '.git');
    }
    if (existsImpl(join(dir, 'CLAUDE.md'))) {
      throw new WorkRootInsideProjectError(workRoot, dir, 'CLAUDE.md');
    }
    const parent = dirname(dir);
    if (parent === dir) return; // reached the filesystem root — clean
    dir = parent;
  }
}

/** v37 (DES-257, ARCH-180, TASK-253, REQ-219): REQ-021's intra-run re-walk, wired for the first
 *  time — walks ABOVE the workspace (`dirname(workspace)`, not the workspace itself), so the
 *  engine's own `.git`/`CLAUDE.md` markers AT the workspace root (`initGitBaseline`, a seeded
 *  repo) are ALLOWED. Two checks, not one displaced check: (1) a containment check — a workspace
 *  whose REAL location is outside `workRoot` (e.g. a symlink into a project) is refused on its own
 *  terms; (2) the marker walk itself, stopping at (excluding) `workRoot`. The degenerate
 *  `workspace === workRoot` case is short-circuited BEFORE either check — `dirname(workspace)`
 *  would sit ABOVE `workRoot` and the walk would never hit its stop condition, wandering toward
 *  the filesystem root on a config that boot's own guard (`assertWorkRootIsolated`) already owns.
 *  Returns the offending ancestor (or, for the containment failure, the workspace's own real
 *  path), or `null` when the walk finds nothing to refuse. Defaults supplied HERE so the caller
 *  (the gateway) acquires no direct `node:fs` import of its own for this check. */
export function findProjectMarkerAboveWorkspace(
  workspace: string,
  workRoot: string,
  deps?: { existsImpl?: (p: string) => boolean; realpathImpl?: (p: string) => string },
): string | null {
  const existsImpl = deps?.existsImpl ?? existsSync;
  const realpathImpl = deps?.realpathImpl ?? defaultRealpath;
  const realWorkspace = realpathImpl(workspace);
  const realWorkRoot = realpathImpl(workRoot);
  if (realWorkspace === realWorkRoot) return null; // degenerate config — boot's guard already owns workRoot
  if (!isPathContained(realWorkspace, realWorkRoot, realpathImpl)) return realWorkspace; // symlinked out of workRoot
  return findProjectMarkerAncestor(dirname(workspace), realWorkRoot, existsImpl, realpathImpl);
}
