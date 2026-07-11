// UT-052 (DES-031, REQ-021): findProjectMarkerAncestor — pure predicate, full truth table.
// RED: findProjectMarkerAncestor is not yet exported from workroot-guard.ts; importing it yields
// undefined, so every call throws TypeError: findProjectMarkerAncestor is not a function.
import { describe, it, expect } from 'vitest';
// Value import: if the named export is absent it resolves to undefined (no module-not-found since
// the module itself exists), and calling undefined() raises TypeError at test time.
import { findProjectMarkerAncestor } from '../../src/workroot-guard.js';

const id = (p: string) => p; // identity realpathImpl — no symlink resolution

describe('findProjectMarkerAncestor — pure predicate (DES-031)', () => {
  it('returns the path itself when it carries a .git marker', () => {
    const dir = '/srv/data';
    const exists = (p: string) => p === `${dir}/.git`;
    expect(findProjectMarkerAncestor(dir, null, exists, id)).toBe(dir);
  });

  it('returns a mid-ancestor when the .git marker is above the given path', () => {
    const mid = '/home/user/repo';
    const workRoot = `${mid}/data`;
    const exists = (p: string) => p === `${mid}/.git`;
    expect(findProjectMarkerAncestor(workRoot, null, exists, id)).toBe(mid);
  });

  it('trips on a .git FILE (git worktree), not only a .git directory', () => {
    const proj = '/srv/submodule';
    // existsSync returns true for files — both file and dir pass existsImpl
    const exists = (p: string) => p === `${proj}/.git`;
    expect(findProjectMarkerAncestor(`${proj}/work`, null, exists, id)).toBe(proj);
  });

  it('trips on CLAUDE.md as well as .git', () => {
    const proj = '/srv/claude-proj';
    const exists = (p: string) => p === `${proj}/CLAUDE.md`;
    expect(findProjectMarkerAncestor(`${proj}/run`, null, exists, id)).toBe(proj);
  });

  it('returns null for a clean path with no project-marker ancestor (no false positive)', () => {
    expect(findProjectMarkerAncestor('/var/lib/rwe-data', null, () => false, id)).toBeNull();
  });

  it('returns null from / without looping (terminates at the filesystem root)', () => {
    expect(findProjectMarkerAncestor('/', null, () => false, id)).toBeNull();
  });

  it('does NOT trip on ~/.claude alone — global CLI config dir is not a project marker', () => {
    // ~/.claude is the CLI global config location, not a .git / CLAUDE.md project marker
    const home = '/home/user';
    const exists = (p: string) => p === `${home}/.claude`; // only .claude, not .git or CLAUDE.md
    expect(findProjectMarkerAncestor(`${home}/.claude/projects/abc`, null, exists, id)).toBeNull();
  });

  it('resolves symlinks via realpathImpl before walking — catches a workRoot symlinked into a project', () => {
    // /tmp/mywork is a symlink → /home/user/repo/data; the repo has .git at /home/user/repo
    const repo = '/home/user/repo';
    const exists = (p: string) => p === `${repo}/.git`;
    const realpath = (p: string) => p === '/tmp/mywork' ? `${repo}/data` : p;
    expect(findProjectMarkerAncestor('/tmp/mywork', null, exists, realpath)).toBe(repo);
  });

  it('session-init (stopAt=workRoot): returns the cwd when it carries a project marker', () => {
    const workRoot = '/work';
    const cwd = '/work/runs/run-1';
    const exists = (p: string) => p === `${cwd}/.git`;
    expect(findProjectMarkerAncestor(cwd, workRoot, exists, id)).toBe(cwd);
  });

  it('session-init (stopAt=workRoot): does NOT walk above workRoot and does NOT check workRoot itself', () => {
    const workRoot = '/work';
    const cwd = '/work/runs/run-1';
    // marker at workRoot itself — the session-init walk (stopAt=workRoot) must NOT report it
    const exists = (p: string) => p === `${workRoot}/.git`;
    expect(findProjectMarkerAncestor(cwd, workRoot, exists, id)).toBeNull();
  });

  it('session-init (stopAt=workRoot): returns null when the workspace is clean', () => {
    expect(findProjectMarkerAncestor('/work/runs/run-1', '/work', () => false, id)).toBeNull();
  });
});
