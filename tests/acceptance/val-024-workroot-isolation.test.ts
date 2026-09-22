// VAL-024 (REQ-021 / REQ-219): WorkRoot Project-Isolation Guard — acceptance
// Real-tier: real fs operations (no injected existsImpl/realpathImpl), real function calls, no
// mock of the SUT's own boundaries. Three clauses from REQ-021:
//   (b) boot fails fast with WORKROOT_INSIDE_PROJECT naming the offending ancestor + typed fields
//   (c) clean workRoot → no false positive
//   session-init re-walk → findProjectMarkerAboveWorkspace() refuses when an ancestor BETWEEN the
//     workspace and workRoot carries a project marker
//
// v37 (DES-257, ARCH-180, REQ-219): the re-walk clause is RE-POINTED at the production path —
// `session-options-builder.ts` (the module this clause used to call through) has zero production
// importers and is being deleted this iteration (ADR-085); `findProjectMarkerAboveWorkspace()` is
// the wired replacement (walking ABOVE the workspace, not at it). The SEMANTICS also change, not
// just the target: a `.git` written into the run's OWN workspace root is now ALLOWED (the engine
// creates it itself via `initGitBaseline`) — the pre-v37 assertion here (refuse on a `.git` AT cwd)
// asserted the exact defect ARCH-180 found ("wired as the architecture first wrote it, this refused
// every seeded run"). The refusal case is now a marker on an ancestor BETWEEN the workspace and
// workRoot. Written test-first (Gate 5, RED): findProjectMarkerAboveWorkspace does not exist yet.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertWorkRootIsolated, WorkRootInsideProjectError } from '../../src/workroot-guard.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'val024-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('VAL-024 REQ-021 clause (b): boot fails fast with typed WorkRootInsideProjectError', () => {
  it('throws WorkRootInsideProjectError with .ancestor + .marker + .remedy when workRoot is inside a real git project', () => {
    // Plant a real .git file (git worktree file — existsSync returns true for files and dirs)
    writeFileSync(join(tmpDir, '.git'), 'gitdir: /some/real/repo/.git');
    const workRoot = join(tmpDir, 'data');
    mkdirSync(workRoot);

    let err: unknown;
    try { assertWorkRootIsolated(workRoot); } catch (e) { err = e; }

    expect(err).toBeInstanceOf(WorkRootInsideProjectError);
    const e = err as WorkRootInsideProjectError;
    expect(e.code).toBe('WORKROOT_INSIDE_PROJECT');
    // DES-031 typed fields — all RED until class is extended:
    expect(e.ancestor).toBe(tmpDir);
    expect(e.marker).toBe('.git');
    expect(typeof e.remedy).toBe('string');
    expect(e.remedy.length).toBeGreaterThan(0);
  });

  it('throws WorkRootInsideProjectError with .marker = "CLAUDE.md" when a CLAUDE.md is the tripping marker', () => {
    writeFileSync(join(tmpDir, 'CLAUDE.md'), '# Project CLAUDE.md');
    const workRoot = join(tmpDir, 'data');
    mkdirSync(workRoot);

    let err: unknown;
    try { assertWorkRootIsolated(workRoot); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(WorkRootInsideProjectError);
    // DES-031 typed field — RED:
    expect((err as WorkRootInsideProjectError).marker).toBe('CLAUDE.md');
  });
});

describe('VAL-024 REQ-021 clause (c): clean workRoot — no false positive', () => {
  it('a bare temp dir with no project markers does not throw', () => {
    // tmpDir is freshly created with no .git or CLAUDE.md — real fs, no injection
    expect(() => assertWorkRootIsolated(tmpDir)).not.toThrow();
  });
});

describe('VAL-024 REQ-021/REQ-219 session-init re-walk: production path, walking ABOVE the workspace (DES-257)', () => {
  it("a .git written by the ENGINE ITSELF at the run workspace root is ALLOWED (initGitBaseline regression guard — this is what broke every seeded run under the architecture's first draft)", async () => {
    const { findProjectMarkerAboveWorkspace } = await import('../../src/workroot-guard.js');
    const workRoot = tmpDir;
    const workspace = join(workRoot, 'workflows', 'wf', 'runs', 'run-1');
    mkdirSync(workspace, { recursive: true });
    writeFileSync(join(workspace, '.git'), 'gitdir: /something');
    expect(findProjectMarkerAboveWorkspace(workspace, workRoot)).toBeNull();
  });

  it('a marker on an ancestor BETWEEN the workspace and workRoot is REFUSED', async () => {
    const { findProjectMarkerAboveWorkspace } = await import('../../src/workroot-guard.js');
    const workRoot = tmpDir;
    const wfDir = join(workRoot, 'workflows', 'wf');
    const workspace = join(wfDir, 'runs', 'run-1');
    mkdirSync(workspace, { recursive: true });
    writeFileSync(join(wfDir, '.git'), 'gitdir: /something');
    expect(findProjectMarkerAboveWorkspace(workspace, workRoot)).toBe(wfDir);
  });
});
