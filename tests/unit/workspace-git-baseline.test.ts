// REQ-027 (v2.5): the engine gives a seeded workspace a brownfield git baseline so the in-workspace
// SDLC precheck (`git rev-parse --is-inside-work-tree`) passes and change-control has a commit to diff.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initGitBaseline } from '../../src/workspace-git.js';

const git = (cwd: string, args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

describe('initGitBaseline (REQ-027)', () => {
  let ws: string;
  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), 'rwe-git-'));
  });
  afterEach(() => {
    rmSync(ws, { recursive: true, force: true });
  });

  it('turns a materialized tree into a work tree with a single baseline commit', () => {
    writeFileSync(join(ws, 'snake.py'), 'print("hi")\n');
    mkdirSync(join(ws, '.sdlc'), { recursive: true });
    writeFileSync(join(ws, '.sdlc', 'state.yaml'), 'x: 1\n');

    const { baseSha } = initGitBaseline(ws);

    expect(baseSha).toMatch(/^[0-9a-f]{40}$/);
    expect(git(ws, ['rev-parse', '--is-inside-work-tree'])).toBe('true');
    expect(git(ws, ['rev-parse', 'HEAD'])).toBe(baseSha);
    // The seed files are committed (nothing left uncommitted), so a later diff has a clean baseline.
    expect(git(ws, ['status', '--porcelain'])).toBe('');
    // The whole seed is in the baseline tree.
    const tracked = git(ws, ['ls-files']).split('\n').sort();
    expect(tracked).toContain('snake.py');
    expect(tracked).toContain('.sdlc/state.yaml');
  });

  it('commits even an empty seed so git_repo=true still holds', () => {
    const { baseSha } = initGitBaseline(ws);
    expect(baseSha).toMatch(/^[0-9a-f]{40}$/);
    expect(git(ws, ['rev-parse', '--is-inside-work-tree'])).toBe('true');
  });

  it('is idempotent: a second call keeps the existing baseline (resume-safe)', () => {
    writeFileSync(join(ws, 'a.txt'), '1\n');
    const first = initGitBaseline(ws).baseSha;
    const second = initGitBaseline(ws).baseSha;
    expect(second).toBe(first);
    // Exactly one commit — the second call did not add another.
    expect(git(ws, ['rev-list', '--count', 'HEAD'])).toBe('1');
  });

  // 2026-09-26 incident: a git hook's exported GIT_DIR was inherited by git child processes and
  // redirected init/add/commit/tag at the REAL repo instead of the caller's cwd. This reproduces
  // that ambient env directly (bypassing tests/setup/scrub-git-env.ts's worker-start scrub, which
  // this test intentionally does not rely on) to prove src/workspace-git.ts's OWN spawn defends
  // itself: it must build the workspace baseline entirely under `ws` and never touch the sentinel
  // repo GIT_DIR points at.
  it('ignores an ambient GIT_DIR pointing at an unrelated repo (REQ-027 hardening)', () => {
    const sentinel = mkdtempSync(join(tmpdir(), 'rwe-git-sentinel-'));
    execFileSync('git', ['init', '-q', sentinel]);
    execFileSync('git', ['-c', 'user.email=test@test.local', '-c', 'user.name=Test', 'commit', '-q', '--allow-empty', '-m', 'sentinel baseline'], { cwd: sentinel });
    const sentinelRefsBefore = execFileSync('git', ['for-each-ref'], { cwd: sentinel, encoding: 'utf8' });

    writeFileSync(join(ws, 'snake.py'), 'print("hi")\n');

    const prevGitDir = process.env.GIT_DIR;
    process.env.GIT_DIR = join(sentinel, '.git');
    let baseSha: string | null;
    try {
      baseSha = initGitBaseline(ws).baseSha;
    } finally {
      if (prevGitDir === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = prevGitDir;
    }

    // The sentinel must be byte-for-byte unaffected: no new commit, no new ref, no reinit message.
    const sentinelRefsAfter = execFileSync('git', ['for-each-ref'], { cwd: sentinel, encoding: 'utf8' });
    expect(sentinelRefsAfter).toBe(sentinelRefsBefore);

    // The workspace itself must be a genuine, independent repo with its own baseline commit.
    expect(baseSha).toMatch(/^[0-9a-f]{40}$/);
    expect(existsSync(join(ws, '.git'))).toBe(true);
    expect(git(ws, ['rev-parse', 'HEAD'])).toBe(baseSha);
    expect(git(ws, ['ls-files'])).toContain('snake.py');

    rmSync(sentinel, { recursive: true, force: true });
  });
});
