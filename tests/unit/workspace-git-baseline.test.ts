// REQ-027 (v2.5): the engine gives a seeded workspace a brownfield git baseline so the in-workspace
// SDLC precheck (`git rev-parse --is-inside-work-tree`) passes and change-control has a commit to diff.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
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
});
