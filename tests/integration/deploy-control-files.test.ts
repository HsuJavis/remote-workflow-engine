// IT-293 (DES-242, ARCH-164, TASK-240, REQ-214): control files are named after the CONFIG that
// owns them, so a second scratch instance (`RWE_CONFIG_PATH` pointing elsewhere, normally IN THE
// SAME DIRECTORY as the primary — the default `RWE_CONFIG_PATH` is `$(pwd)/rwe.config.json`) does
// not clobber the primary's `.rwe.pid`/`.rwe.log`. This is the collision case: a two-DIRECTORY test
// would pass on today's broken `dirname`-only design and is deliberately not written.
//
// Red reason (measured against the real deploy.sh on disk, read in a `beforeAll` guard so nothing
// spawns on a script that would otherwise run `npm install` / start a real engine on the shared
// tree): `deploy.sh` has no `--dry-run` handling, no `RWE_INSTANCE`/`RWE_PID_FILE`/`RWE_LOG_FILE`
// derivation, and writes unconditionally to `.rwe.pid`/`.rwe.log`. The `beforeAll` guard throws
// before any subprocess is spawned, which fails every case in this file for the same reason —
// legitimate suite-level red for "the seam does not exist yet", not a spawn hazard.
//
// Mock policy (integration, real-tier per 04-design.md's per-tier mock policy for this slice): the
// REAL deploy.sh script, shelled out to via `--dry-run` only (never a real background boot in a
// Gate-5 RED run) — vitest keeps this inside the `npm test` surface per DES-242's own boundary note.
import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..');
const DEPLOY_SH = join(REPO_ROOT, 'deploy.sh');
const SCRIPT_SRC = readFileSync(DEPLOY_SH, 'utf8');

beforeAll(() => {
  // Guard: refuse to spawn deploy.sh at all until it understands --dry-run — an accidental spawn
  // on the unmodified script would run `npm install` and attempt to start a real engine on this
  // shared working tree.
  if (!SCRIPT_SRC.includes('--dry-run')) {
    throw new Error('deploy.sh does not implement --dry-run yet (TASK-240 unimplemented) — refusing to spawn it for real');
  }
});

function dryRun(configPath: string, cwd: string): { pid: string; log: string } {
  const out = execFileSync('bash', [DEPLOY_SH, '--dry-run'], {
    cwd,
    env: { ...process.env, RWE_CONFIG_PATH: configPath, PATH: process.env.PATH },
    encoding: 'utf8',
  });
  const pidLine = out.split('\n').find((l) => l.startsWith('RWE_PID_FILE='));
  const logLine = out.split('\n').find((l) => l.startsWith('RWE_LOG_FILE='));
  if (!pidLine || !logLine) throw new Error(`--dry-run did not print both paths: ${out}`);
  return { pid: pidLine.slice('RWE_PID_FILE='.length), log: logLine.slice('RWE_LOG_FILE='.length) };
}

describe('IT-293: deploy.sh control files are named after the config that owns them (REQ-214)', () => {
  it('two configs in ONE directory yield two distinct pid/log paths — the actual collision shape', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-it293-'));
    try {
      const primary = join(dir, 'rwe.config.json');
      const scratch = join(dir, 'scratch.config.json');
      writeFileSync(primary, '{}');
      writeFileSync(scratch, '{}');

      const a = dryRun(primary, dir);
      const b = dryRun(scratch, dir);

      expect(a.pid).not.toBe(b.pid);
      expect(a.log).not.toBe(b.log);
      expect(a.pid).toBe(join(dir, '.rwe.rwe.config.pid'));
      expect(b.pid).toBe(join(dir, '.rwe.scratch.config.pid'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('--dry-run writes NO pid file and starts nothing', () => {
    const dir = mktempOrThrow();
    try {
      const cfg = join(dir, 'rwe.config.json');
      writeFileSync(cfg, '{}');
      const { pid } = dryRun(cfg, dir);
      expect(existsSync(pid)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the log is created 0600 via a SUBSHELL umask, never a bare top-level umask before nohup', () => {
    // Source-text assertion: a bare top-level `umask` (not inside `(...)`) is inherited by the
    // started engine and turns every SQLite db/workspace/CAS blob 0600 — a fleet-wide permission
    // change smuggled in by a pid-file requirement. Matches a line that is `umask ...` with no
    // preceding `(` on the same logical statement.
    const bareUmask = /^\s*umask\s+\d+/m.test(SCRIPT_SRC);
    expect(bareUmask).toBe(false);
    expect(SCRIPT_SRC).toMatch(/\(\s*umask\s+077[\s\S]{0,40}\)/);
  });

  it('the log is appended, never truncated: no `>` or `: >` writes $RWE_LOG_FILE', () => {
    expect(SCRIPT_SRC).not.toMatch(/[^>]>\s*"?\$RWE_LOG_FILE"?/);
    expect(SCRIPT_SRC).not.toMatch(/:\s*>\s*"?\$RWE_LOG_FILE"?/);
  });

  it('a pre-seeded log line SURVIVES a second --dry-run (append semantics, not truncate)', () => {
    const dir = mktempOrThrow();
    try {
      const cfg = join(dir, 'rwe.config.json');
      writeFileSync(cfg, '{}');
      const { log } = dryRun(cfg, dir);
      writeFileSync(log, 'pre-existing incident line\n');
      dryRun(cfg, dir);
      expect(readFileSync(log, 'utf8')).toContain('pre-existing incident line');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('.gitignore covers .rwe.*.pid / .rwe.*.log and keeps the two bare legacy literals', () => {
    const gi = readFileSync(join(REPO_ROOT, '.gitignore'), 'utf8');
    expect(gi).toMatch(/\.rwe\.\*\.pid/);
    expect(gi).toMatch(/\.rwe\.\*\.log/);
  });

  it('DEPLOY.md states the new per-instance behaviour, not the v34 single-file workaround', () => {
    const deploy = readFileSync(join(REPO_ROOT, 'DEPLOY.md'), 'utf8');
    expect(deploy).toMatch(/\.rwe\.<[^>]*instance[^>]*>\.pid|\.rwe\.\$\{?RWE_INSTANCE/i);
  });
});

function mktempOrThrow(): string {
  return mkdtempSync(join(tmpdir(), 'rwe-it293-'));
}
