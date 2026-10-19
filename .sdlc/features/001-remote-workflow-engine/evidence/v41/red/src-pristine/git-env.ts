// 2026-09-26 incident: a pre-push hook exported GIT_DIR for its own use, and that env var was
// inherited by `git` child processes spawned by tests (and would equally be inherited by any git
// child process spawned by the engine itself, if it were ever launched with GIT_DIR set) — silently
// redirecting `git init/add/commit/tag` at whatever repo GIT_DIR names, regardless of the `cwd` the
// caller passed. GIT_DIR is not the only variable that can retarget a git invocation this way; this
// is the full set that can. GIT_ENV_KEYS is the single source of truth for that list — do not
// hand-copy it elsewhere (a second copy is how the two lists silently drift apart).
export const GIT_ENV_KEYS = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_COMMON_DIR',
  'GIT_PREFIX',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_QUARANTINE_PATH',
] as const;

/** Returns a copy of `env` with GIT_ENV_KEYS removed, so a `git` subprocess spawned with the result
 *  can only ever operate on the repo implied by the `cwd` it's given. */
export function sanitizeGitEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && !(GIT_ENV_KEYS as readonly string[]).includes(key)) {
      clean[key] = value;
    }
  }
  return clean;
}
