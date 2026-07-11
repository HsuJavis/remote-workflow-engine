// UT-051 (REQ-021, D-V3M-5): assertWorkRootIsolated fails fast when workRoot is nested under a
// Claude Code project (an ancestor with .git/CLAUDE.md) — because settingSources:['project'] would
// then make the agent CLI load that project's CLAUDE.md + auto-memory into the agent context (a
// confinement leak bypassing the tool-level workspace jail, empirically reproduced 2026-07-11).
// Pure (no real fs): the marker-existence probe is injected.
import { describe, it, expect } from 'vitest';
import { assertWorkRootIsolated, WorkRootInsideProjectError } from '../../src/workroot-guard.js';
import { join } from 'node:path';

// A fake existsSync over a fixed set of present project-marker paths.
function fakeExists(present: string[]): (p: string) => boolean {
  const set = new Set(present);
  return (p: string) => set.has(p);
}

describe('assertWorkRootIsolated (REQ-021)', () => {
  it('throws WORKROOT_INSIDE_PROJECT when an ANCESTOR of workRoot contains .git (the nested-workspace leak)', () => {
    // workRoot=/home/user/Documents/remote-workflow/data, repo root has .git two levels up.
    const repo = '/home/user/Documents/remote-workflow';
    const workRoot = join(repo, 'data');
    const exists = fakeExists([join(repo, '.git')]);
    let err: unknown;
    try {
      assertWorkRootIsolated(workRoot, exists);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(WorkRootInsideProjectError);
    expect((err as { code?: string }).code).toBe('WORKROOT_INSIDE_PROJECT');
    // names the offending ancestor + the remedy
    expect(String((err as Error).message)).toContain(repo);
    expect(String((err as Error).message)).toMatch(/outside/i);
  });

  it('throws when workRoot ITSELF (or an ancestor) has a CLAUDE.md, not only .git', () => {
    const proj = '/srv/some-project';
    const exists = fakeExists([join(proj, 'CLAUDE.md')]);
    expect(() => assertWorkRootIsolated(join(proj, 'runs'), exists)).toThrow(WorkRootInsideProjectError);
  });

  it('does NOT throw for a clean data dir with no project-marker ancestor (no false positive)', () => {
    // /home/user/.local/share/rwe-data — none of its ancestors carry .git/CLAUDE.md
    const exists = fakeExists([]); // nothing present anywhere
    expect(() => assertWorkRootIsolated('/home/user/.local/share/rwe-data', exists)).not.toThrow();
  });

  it('walks all the way to the filesystem root without infinite-looping, then returns cleanly', () => {
    const exists = fakeExists([]);
    expect(() => assertWorkRootIsolated('/', exists)).not.toThrow();
  });
});

// UT-053 (DES-031): WorkRootInsideProjectError typed fields + assertWorkRootIsolated realpathImpl.
// RED reasons: (a) .ancestor/.marker/.remedy fields do not exist on the error class yet;
// (b) the 3rd realpathImpl param is not yet accepted — current impl uses resolve(), so a
// symlinked workRoot is not canonicalised and the symlink-bypass case does not throw.
const idRealpath = (p: string) => p; // identity realpathImpl — no symlink resolution

describe('WorkRootInsideProjectError — typed fields (DES-031)', () => {
  it('carries .ancestor pointing to the offending directory', () => {
    const repo = '/home/user/Documents/repo';
    const exists = fakeExists([join(repo, '.git')]);
    let err: unknown;
    try { assertWorkRootIsolated(join(repo, 'data'), exists, idRealpath); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(WorkRootInsideProjectError);
    expect((err as WorkRootInsideProjectError).ancestor).toBe(repo);
  });

  it('carries .marker = ".git" when the tripping marker is .git', () => {
    const repo = '/srv/proj-git';
    const exists = fakeExists([join(repo, '.git')]);
    let err: unknown;
    try { assertWorkRootIsolated(join(repo, 'data'), exists, idRealpath); } catch (e) { err = e; }
    expect((err as WorkRootInsideProjectError).marker).toBe('.git');
  });

  it('carries .marker = "CLAUDE.md" when the tripping marker is CLAUDE.md (not .git)', () => {
    const proj = '/srv/proj-claude';
    const exists = fakeExists([join(proj, 'CLAUDE.md')]);
    let err: unknown;
    try { assertWorkRootIsolated(join(proj, 'data'), exists, idRealpath); } catch (e) { err = e; }
    expect((err as WorkRootInsideProjectError).marker).toBe('CLAUDE.md');
  });

  it('carries a non-empty string .remedy', () => {
    const proj = '/srv/proj-remedy';
    const exists = fakeExists([join(proj, '.git')]);
    let err: unknown;
    try { assertWorkRootIsolated(join(proj, 'data'), exists, idRealpath); } catch (e) { err = e; }
    const e = err as WorkRootInsideProjectError;
    expect(typeof e.remedy).toBe('string');
    expect(e.remedy.length).toBeGreaterThan(0);
  });

  it('realpathImpl (3rd param) catches a symlinked workRoot into a project (Adv#5/R6)', () => {
    // /tmp/symlink-work is a symlink → /home/user/repo/data; the repo has .git
    const repo = '/home/user/repo-sym';
    const exists = fakeExists([join(repo, '.git')]);
    // real is: /tmp/symlink-work → /home/user/repo-sym/data
    const realpath = (p: string) => p === '/tmp/symlink-work' ? join(repo, 'data') : p;
    // Current impl: uses resolve('/tmp/symlink-work') = '/tmp/symlink-work' (no symlink resolution)
    // → walks /tmp then / → no marker found → does NOT throw → assertion fails → RED
    expect(() => assertWorkRootIsolated('/tmp/symlink-work', exists, realpath)).toThrow(WorkRootInsideProjectError);
  });
});
