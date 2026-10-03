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
import { ENGINE_OWNED_CONFIG_PATHS, PROJECT_CONFIG_PATHS, READONLY_MOUNT_TARGETS } from './bash-confinement.js';
import { resolveLanding } from '../path-containment.js';

/** `.git/config` (`core.fsmonitor`, `core.hooksPath`) and `.git/hooks/` run commands whenever git
 *  runs in the workspace — the CLI does, unsandboxed, for its session context. Not CLI configuration,
 *  so not swept (a repo needs its config); refused to file tools only. The CLI keeps them on its own
 *  Bash denyWrite whenever they exist. */
const GIT_EXEC_PATHS = ['.git/config', '.git/hooks'] as const;

const TOOL_DENIED = [...PROJECT_CONFIG_PATHS, ...ENGINE_OWNED_CONFIG_PATHS, ...GIT_EXEC_PATHS].map((p) => p.toLowerCase());

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
 *  first: the CLI would load settings through it, and the engine would materialize skills through it
 *  to wherever it points. Links are removed as links (`rmSync` never follows them). The one
 *  engine-owned entry (`.claude/skills`) is left for the engine's own per-dispatch rewrite —
 *  **issue #128**: `.mcp.json` used to be a second one (rewritten per dispatch, so a planted one
 *  never survived to be loaded); the engine stopped writing it at all, so it moved into
 *  `PROJECT_CONFIG_PATHS` (bash-confinement.ts) and is swept like everything else in this loop.
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
 *  sweep exists to protect against. */
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
export function prepareReadonlyMountTargets(root: string): string[] {
  mkdirSync(root, { recursive: true });
  const created: string[] = [];
  for (const { rel, kind } of READONLY_MOUNT_TARGETS) {
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
