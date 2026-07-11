// v2.5 (REQ-027): a seeded run workspace is a whole product tree the client materialized WITHOUT a
// `.git/` (materializeSeed rejects `.git/` internals — a client can't hand us its history, and we
// wouldn't trust it if it could). But the SDLC flow that runs INSIDE the workspace is brownfield: its
// precheck refuses to proceed unless `git rev-parse --is-inside-work-tree` is true, and its
// change-control (diffs, patch-return baseSha) needs a committed baseline to diff against. So the
// engine — the only party that can, since the client is barred from seeding `.git/` — initializes a
// fresh repo over the materialized tree and records ONE baseline commit before any agent starts.
//
// Best-effort by design: if git is absent or a command fails, we log and return null rather than
// failing the run — a workflow that does not need git is unaffected, and one that does gets a clear
// precheck failure downstream instead of an opaque engine crash. Runs in the workspace only (never
// touches the host repo); the committer identity is set LOCALLY so it works with no global git config.
import { execFileSync } from 'node:child_process';

export interface GitBaseline {
  /** The baseline commit SHA (40-hex) agents/workflows can diff against, or null if init failed. */
  baseSha: string | null;
}

function git(workspace: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: workspace,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    // A committer identity passed via env so we never mutate the host's global git config, and the
    // commit still succeeds on a machine with no user.name/user.email configured at all.
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'rwe-engine',
      GIT_AUTHOR_EMAIL: 'rwe-engine@localhost',
      GIT_COMMITTER_NAME: 'rwe-engine',
      GIT_COMMITTER_EMAIL: 'rwe-engine@localhost',
    },
  }).trim();
}

/**
 * Initializes a git repo over an already-materialized workspace tree and records a single baseline
 * commit. Idempotent: if the workspace is already a work tree (e.g. a resumed run), it is left as-is
 * and the current HEAD (if any) is returned. Never throws — returns `{ baseSha: null }` on failure.
 */
export function initGitBaseline(workspace: string): GitBaseline {
  try {
    // Already a repo (resume / re-entry)? Leave history intact, just report HEAD.
    try {
      const inside = git(workspace, ['rev-parse', '--is-inside-work-tree']);
      if (inside === 'true') {
        try {
          return { baseSha: git(workspace, ['rev-parse', 'HEAD']) };
        } catch {
          return { baseSha: null }; // repo exists but is unborn (no commit yet) — fall through would re-init; keep as-is
        }
      }
    } catch {
      /* not a repo yet — initialize below */
    }
    git(workspace, ['init', '--quiet']);
    // A stable default branch name so downstream tooling never depends on the host's init.defaultBranch.
    try {
      git(workspace, ['checkout', '-q', '-B', 'main']);
    } catch {
      /* older git without -B on an unborn branch — the default branch is fine */
    }
    git(workspace, ['add', '-A']);
    // --allow-empty so a genuinely empty seed still yields a baseline commit (git_repo=true holds).
    git(workspace, ['commit', '--quiet', '--allow-empty', '-m', 'rwe: seed baseline']);
    return { baseSha: git(workspace, ['rev-parse', 'HEAD']) };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[rwe] initGitBaseline failed for ${workspace}: ${(err as Error).message}`);
    return { baseSha: null };
  }
}
