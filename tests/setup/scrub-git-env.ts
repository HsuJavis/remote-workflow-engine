// Global vitest setup (wired via `test.setupFiles` in vitest.config.ts), runs once per worker
// before any test in that worker. 2026-09-26 incident: a git pre-push hook's exported GIT_DIR was
// inherited by `git` child processes spawned from inside the test suite (tests that build their own
// throwaway git repos in temp dirs, plus src code under test that spawns git — e.g.
// src/workspace-git.ts's baseline init), silently redirecting init/add/commit/tag at the REAL repo
// instead of the temp dir the test intended. The hook itself now unsets these before invoking
// vitest, but tests must not depend on being launched from that one call site — this makes every
// worker's env clean regardless of what invoked it.
//
// GIT_ENV_KEYS is shared with src/workspace-git.ts's own env-sanitizing spawn call (src/git-env.ts)
// so the list of dangerous vars has exactly one source of truth.
import { GIT_ENV_KEYS } from '../../src/git-env.js';

for (const key of GIT_ENV_KEYS) {
  delete process.env[key];
}
