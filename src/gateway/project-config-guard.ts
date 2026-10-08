// The run workspace is the Claude CLI's project directory (`cwd` = workspace,
// `settingSources:['project']`), so project configuration one agent leaves there is loaded by the
// next agent's CLI in the same run. Three controls live here, all over the lists in bash-confinement.ts:
//  - `protectedConfigTarget`: the file-tool check (`toolUsePreCheck`) — no writing tool may name a
//    path that lands on project configuration, however the path is spelled.
//  - `sweepPlantedConfig`: before every dispatch, whatever got there anyway (Bash on an unconfined
//    host, anything the file-tool check cannot see) is removed, so the CLI never loads it.
//  - `prepareReadonlyMountTargets` (issue #95): before a `bashMode:'readonly'` dispatch, pre-creates
//    the CLI's OWN forced sandbox mount targets — see `READONLY_MOUNT_TARGETS`'s own doc comment.
import { lstatSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { PROJECT_CONFIG_PATHS, PROJECT_CONFIG_MOUNT_TARGETS, READONLY_MOUNT_TARGETS } from './bash-confinement.js';
import { resolveLanding } from '../path-containment.js';

/** `.git/config` (`core.fsmonitor`, `core.hooksPath`) and `.git/hooks/` run commands whenever git
 *  runs in the workspace — the CLI does, unsandboxed, for its session context. Not CLI configuration,
 *  so not swept (a repo needs its config); refused to file tools only. The CLI keeps them on its own
 *  Bash denyWrite whenever they exist. */
const GIT_EXEC_PATHS = ['.git/config', '.git/hooks'] as const;

// Issue #144: `ENGINE_OWNED_CONFIG_PATHS` is gone (its one entry, `.claude/skills`, merged into
// `PROJECT_CONFIG_PATHS`) — this no longer unions three lists, just the two.
const TOOL_DENIED = [...PROJECT_CONFIG_PATHS, ...GIT_EXEC_PATHS].map((p) => p.toLowerCase());

function matchUnder(abs: string, root: string): string | null {
  const rel = relative(root, abs);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null;
  const key = rel.split(sep).join('/').toLowerCase();
  const hit = TOOL_DENIED.find((p) => key === p || key.startsWith(`${p}/`));
  return hit ?? null;
}

/** The protected entry a writing tool's path argument lands on, or null. Checks the path as the CLI
 *  will LOAD it (lexical, `..` collapsed) and where the write will really LAND (symlinks followed), each
 *  against the workspace both as given and as resolved — a link either way cannot get around it.
 *  Case-insensitive: on a case-insensitive filesystem `.Claude/Settings.json` IS the loaded file. */
export function protectedConfigTarget(candidate: string, root: string): string | null {
  const lexical = join(isAbsolute(candidate) ? '/' : root, candidate);
  const landing = resolveLanding(lexical);
  const realRoot = resolveLanding(root);
  for (const abs of [lexical, landing]) {
    for (const r of [root, realRoot]) {
      const hit = matchUnder(abs, r);
      if (hit !== null) return hit;
    }
  }
  return null;
}

function present(p: string): boolean {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

/** Removes agent-planted project configuration from `root` and returns what was removed
 *  (workspace-relative), or throws if something could not be removed — the caller must then refuse to
 *  dispatch rather than start a CLI that would load it. A `.claude` that is a symlink is unlinked
 *  first: the CLI would load settings through it (and, pre-#144, the engine would have materialized
 *  skills through it to wherever it points — moot now, see below). Links are removed as links
 *  (`rmSync` never follows them). **Issue #128**: `.mcp.json` used to be left alone here (rewritten
 *  per dispatch, so a planted one never survived to be loaded); the engine stopped writing it at all,
 *  so it moved into `PROJECT_CONFIG_PATHS` (bash-confinement.ts) and is swept like everything else in
 *  this loop. **Issue #144**: `.claude/skills` followed the identical path for the identical reason —
 *  the engine no longer materializes a declared skill into the workspace at all (a private
 *  per-dispatch directory outside it, loaded via the SDK's own `plugins` option, replaces it — see
 *  `materializeAssets`'s doc comment), so there is no engine-owned entry left to exempt from this
 *  sweep any more; every `PROJECT_CONFIG_PATHS` entry, including `.claude/skills`, is now treated the
 *  same way. This also sweeps a leftover `.claude/skills` an OLDER (pre-#144) engine version left in
 *  an existing workspace, before this dispatch's CLI could load it.
 *
 *  Issue #95: an EMPTY, real (non-symlink) directory at a `PROJECT_CONFIG_PATHS` entry is left alone
 *  — not removed, not reported. Two of those entries (`.claude/agents`, `.claude/commands`) are ALSO
 *  `READONLY_MOUNT_TARGETS`, this engine's own pre-created placeholders for a readonly-Bash
 *  dispatch's kernel sandbox (`prepareReadonlyMountTargets`). Every agent in a run shares ONE
 *  workspace, and a parallel sibling's dispatch (a different agent in the SAME run, running
 *  concurrently) calls THIS function too — before this fix, its sweep removed the still-empty
 *  placeholder a readonly agent's OWN still-running session depends on (its `.claude` never loads a
 *  second time, but the KERNEL sandbox for its NEXT Bash tool call needs that mount target to still
 *  exist), reintroducing the exact "Can't create file... Read-only file system" failure this fix
 *  exists to close, and logging a false `agent.planted_config_removed` for content no agent ever
 *  planted. An empty directory loads nothing into the CLI either way (a planted `.claude/agents/x.md`
 *  still has REAL CONTENT and is still removed below) — so leaving one in place changes nothing this
 *  sweep exists to protect against.
 *
 *  Issue #148: the SAME exemption, extended to a 0-byte real (non-symlink) FILE at a
 *  `PROJECT_CONFIG_PATHS` entry — `prepareDispatchMountTargets`'s own placeholders for the
 *  non-readonly confined-Bash denyWrite race (two concurrent Bash calls in one turn both lazily
 *  materializing the SAME still-missing mount point — see that function's own doc comment). Without
 *  this, the FIRST sibling agent's sweep (this function runs before every dispatch, and every agent
 *  in a run shares one workspace) would delete the placeholder out from under a second, already-
 *  spawned dispatch's still-running session the instant it ran — reopening the exact race this fix
 *  exists to close, one dispatch later. A 0-byte file carries no more content than an empty
 *  directory does — a planted `.claude/launch.json` with REAL content is still removed below, same
 *  as a planted `.claude/agents/x.md`. */
export function sweepPlantedConfig(root: string): string[] {
  const removed: string[] = [];
  const dotClaude = join(root, '.claude');
  let dotClaudeIsLink = false;
  try {
    dotClaudeIsLink = lstatSync(dotClaude).isSymbolicLink();
  } catch {
    /* absent — nothing under it to sweep */
  }
  if (dotClaudeIsLink) {
    rmSync(dotClaude, { force: true });
    removed.push('.claude');
  }
  const attempted: string[] = [];
  for (const rel of PROJECT_CONFIG_PATHS) {
    const abs = join(root, rel);
    let st;
    try {
      st = lstatSync(abs);
    } catch {
      continue; // absent — nothing to sweep
    }
    if (st.isDirectory() && readdirSync(abs).length === 0) continue; // empty real dir — an engine placeholder, not planted content
    if (st.isFile() && st.size === 0) continue; // issue #148: 0-byte real file — an engine placeholder, not planted content
    attempted.push(rel);
    rmSync(abs, { recursive: true, force: true });
    removed.push(rel);
  }
  const left = [dotClaudeIsLink ? '.claude' : null, ...attempted].filter((rel): rel is string => rel !== null && present(join(root, rel)));
  if (left.length > 0) throw new Error(`could not remove ${left.join(', ')}`);
  return removed;
}

/** Issue #95: pre-creates each `READONLY_MOUNT_TARGETS` entry under `root` that is not already
 *  present, as the correct empty TYPE (a `dir` entry as an empty directory, a `file` entry as an
 *  empty file) — see that constant's own doc comment for WHY this is needed at all. Runs after
 *  `sweepPlantedConfig` in the dispatch sequence (nothing here overlaps `PROJECT_CONFIG_PATHS`, so
 *  correctness does not depend on the order between the two, but matching the sweep's own "clean,
 *  then prepare" shape keeps the two reads together). `mkdirSync(root, {recursive:true})` first:
 *  a workspace with no seed and no prior materialization may not exist on disk yet, and there is
 *  nothing to mount read-only if it does not. Idempotent — an already-present target is left
 *  untouched, so re-dispatching the same run (retry, or a second agent) never re-creates or fails on
 *  its own earlier work. Returns the workspace-relative paths it created, for the caller's own
 *  observability; THROWS on a genuine creation failure (e.g. `.claude` surviving the sweep as a
 *  non-directory, or a real host permission problem) — the caller must refuse the dispatch rather
 *  than start a CLI whose sandbox setup just failed in an unverifiable way. */
function createMountTargets(root: string, targets: readonly { readonly rel: string; readonly kind: 'dir' | 'file' }[]): string[] {
  mkdirSync(root, { recursive: true });
  const created: string[] = [];
  for (const { rel, kind } of targets) {
    const abs = join(root, rel);
    if (present(abs)) continue;
    if (kind === 'dir') {
      mkdirSync(abs, { recursive: true });
    } else {
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, '');
    }
    created.push(rel);
  }
  return created;
}

export function prepareReadonlyMountTargets(root: string): string[] {
  return createMountTargets(root, READONLY_MOUNT_TARGETS);
}

/** Issue #148: pre-creates each `PROJECT_CONFIG_MOUNT_TARGETS` entry under `root` that is not
 *  already present, as the correct empty TYPE — same idempotent shape as `prepareReadonlyMountTargets`
 *  (that one pre-creates a DIFFERENT list, `READONLY_MOUNT_TARGETS`, for a readonly-Bash dispatch's
 *  fully-denied root; this one is for the ORDINARY non-readonly confined-Bash posture, where the root
 *  stays writable and `buildBashConfinement` denyWrite's each `PROJECT_CONFIG_PATHS` entry
 *  INDIVIDUALLY instead).
 *
 *  Issue #148's race: pi-agent-core's `executeToolCallsParallel` runs every Bash tool call in one
 *  assistant turn genuinely concurrently (`Promise.all`, not merely concurrently SCHEDULED — see
 *  `agent-loop.js`'s own code), and each one independently calls
 *  `SandboxManager.wrapWithSandboxArgv()` with no lock between them. bwrap materializes a missing
 *  `denyWrite` destination lazily, on the host, the first time it binds it (`/dev/null` for a file,
 *  an empty tmpfs for a dir) — so two concurrent bwrap invocations can race to create the SAME
 *  still-missing mount point (observed: `.claude/launch.json`). Calling this ONCE, before any Bash
 *  call in the dispatch starts, means bwrap only ever binds an ALREADY-PRESENT node, on every
 *  concurrent call — never asked to create anything, so there is nothing left to race.
 *
 *  Run AFTER `sweepPlantedConfig` in the dispatch sequence (matching `prepareReadonlyMountTargets`'s
 *  own ordering) — `sweepPlantedConfig` now leaves a 0-byte real file at one of these entries alone
 *  (issue #148 amendment to its own doc comment), so a parallel sibling agent's sweep, running
 *  against the SAME shared workspace, cannot undo this dispatch's still-live placeholders. Idempotent
 *  and side-effect-free on an already-present entry, so re-dispatching the same run is always safe. */
export function prepareDispatchMountTargets(root: string): string[] {
  return createMountTargets(root, PROJECT_CONFIG_MOUNT_TARGETS);
}
