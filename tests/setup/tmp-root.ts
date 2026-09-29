// Global vitest setup (wired via `test.setupFiles` in vitest.config.ts, sibling to
// scrub-git-env.ts — that file sanitizes git-related env vars; this one sanitizes tmp-dir state).
// Runs once per worker before any test file is imported.
//
// Root cause: the engine's self-update helper (deploy/rwe-update.sh) now runs `npm test` as a
// dedicated OS user (`rwe`) before restarting. Many tests build paths with FIXED names under
// `os.tmpdir()` — either directly (`join(tmpdir(), 'rwe-test-catalog')`) or indirectly via a
// src default (e.g. `RunManager`'s `workRoot` fallback, `join(tmpdir(), 'remote-workflow-runs')`).
// On a shared host those fixed names get created (and owned) by whichever uid ran the suite
// first; a later run as a DIFFERENT uid then hits SQLITE_READONLY_DIRECTORY / EACCES trying to
// write into a directory or file it doesn't own — not a logic bug, a shared-tmp collision.
//
// Fix: before any test file loads, give this worker process its OWN fresh, private tmp root and
// repoint `os.tmpdir()` at it (Node's `os.tmpdir()` re-reads TMPDIR/TMP/TEMP from the environment
// on every call, so this takes effect for every subsequent `tmpdir()` call in this process,
// including ones inside src/ code under test) — and forward the same vars via env so any child
// process a test spawns inherits it too. Every `join(tmpdir(), '<fixed literal>')` a test or src
// default computes is now unique to THIS run and owned by whichever uid is running it, regardless
// of what any other uid left behind in the real shared tmp dir.
//
// A few tests deliberately need the REAL, host-shared tmp dir rather than this private one (e.g.
// the Claude CLI's own `<tmpdir>/claude-<uid>` scratch convention, VAL-101-CLI-SCRATCH) — they
// read `process.env['RWE_TEST_ORIG_TMPDIR']`, captured below BEFORE the override. In practice
// those tests compute that same convention via `tmpdir()` themselves at call time too, so they
// stay self-consistent with whichever root is live — RWE_TEST_ORIG_TMPDIR exists for the rare
// case a test needs the genuine original path regardless.
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const ORIG_TMPDIR = tmpdir();
process.env['RWE_TEST_ORIG_TMPDIR'] = ORIG_TMPDIR;

const privateRoot = mkdtempSync(join(ORIG_TMPDIR, 'rwe-test-'));
process.env['TMPDIR'] = privateRoot;
process.env['TMP'] = privateRoot;
process.env['TEMP'] = privateRoot;

// Best-effort cleanup; never block process exit on it, and never throw if something under it is
// still open (e.g. a sqlite file a test forgot to close).
process.once('exit', () => {
  try {
    rmSync(privateRoot, { recursive: true, force: true });
  } catch {
    // best effort
  }
});
