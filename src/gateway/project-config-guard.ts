// The run workspace is the Claude CLI's project directory (`cwd` = workspace,
// `settingSources:['project']`), so project configuration one agent leaves there is loaded by the
// next agent's CLI in the same run. Two controls live here, both over the list in bash-confinement.ts:
//  - `protectedConfigTarget`: the file-tool check (`toolUsePreCheck`) — no writing tool may name a
//    path that lands on project configuration, however the path is spelled.
//  - `sweepPlantedConfig`: before every dispatch, whatever got there anyway (Bash on an unconfined
//    host, anything the file-tool check cannot see) is removed, so the CLI never loads it.
import { lstatSync, readlinkSync, rmSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { ENGINE_OWNED_CONFIG_PATHS, PROJECT_CONFIG_PATHS } from './bash-confinement.js';

/** `.git/config` (`core.fsmonitor`, `core.hooksPath`) and `.git/hooks/` run commands whenever git
 *  runs in the workspace — the CLI does, unsandboxed, for its session context. Not CLI configuration,
 *  so not swept (a repo needs its config); refused to file tools only. The CLI keeps them on its own
 *  Bash denyWrite whenever they exist. */
const GIT_EXEC_PATHS = ['.git/config', '.git/hooks'] as const;

const TOOL_DENIED = [...PROJECT_CONFIG_PATHS, ...ENGINE_OWNED_CONFIG_PATHS, ...GIT_EXEC_PATHS].map((p) => p.toLowerCase());

/** Where `p` really lands, the way the kernel walks it: component by component, following every
 *  symlink (including a dangling LEAF link — writing through it creates its target) and applying
 *  `..` after resolution. A component that does not exist yet ends the walk; the rest is appended. */
function resolveLanding(p: string, hops = 0): string {
  const parts = p.split('/');
  let cur = '/';
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    if (part === '' || part === '.') continue;
    if (part === '..') {
      cur = dirname(cur);
      continue;
    }
    const next = join(cur, part);
    let isLink: boolean;
    try {
      isLink = lstatSync(next).isSymbolicLink();
    } catch {
      return join(next, ...parts.slice(i + 1).filter((x) => x !== '' && x !== '.'));
    }
    if (!isLink) {
      cur = next;
      continue;
    }
    if (hops >= 40) return next; // ELOOP: the write fails anyway; judge the link itself
    const target = readlinkSync(next);
    cur = resolveLanding(isAbsolute(target) ? target : `${cur}/${target}`, hops + 1);
  }
  return cur;
}

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
 *  to wherever it points. Links are removed as links (`rmSync` never follows them). Engine-owned
 *  entries (`.claude/skills`, `.mcp.json`) are left for the engine's own per-dispatch rewrite. */
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
  for (const rel of PROJECT_CONFIG_PATHS) {
    const abs = join(root, rel);
    if (!present(abs)) continue;
    rmSync(abs, { recursive: true, force: true });
    removed.push(rel);
  }
  const left = [dotClaudeIsLink ? '.claude' : null, ...PROJECT_CONFIG_PATHS].filter((rel): rel is string => rel !== null && present(join(root, rel)));
  if (left.length > 0) throw new Error(`could not remove ${left.join(', ')}`);
  return removed;
}
