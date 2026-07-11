// VAL-024 (REQ-021): WorkRoot Project-Isolation Guard — acceptance
// Real-tier: real fs operations (no injected existsImpl/realpathImpl), real function calls, no
// mock of the SUT's own boundaries. Three clauses from REQ-021:
//   (b) boot fails fast with WORKROOT_INSIDE_PROJECT naming the offending ancestor + typed fields
//   (c) clean workRoot → no false positive
//   session-init re-walk → buildSessionOptions refuses when cwd carries a project marker
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertWorkRootIsolated, WorkRootInsideProjectError } from '../../src/workroot-guard.js';
import { buildSessionOptions, type ProviderProfile } from '../../src/session-options-builder.js';

const PROFILE: ProviderProfile = {
  providerClass: 'non-anthropic', supportsExtendedThinking: false, timeoutMs: 30000, retries: 1,
};
const ALLOWLIST = ['Read', 'Write'];

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

describe('VAL-024 REQ-021 session-init re-walk: .git written by agent causes build refusal', () => {
  it('refuses buildSessionOptions when the run-workspace cwd has a real .git file (session-init re-walk, DES-031)', () => {
    const workRoot = tmpDir;
    const cwd = join(tmpDir, 'runs', 'run-1');
    mkdirSync(cwd, { recursive: true });
    // Simulate an agent writing a .git marker into its own workspace after boot
    writeFileSync(join(cwd, '.git'), 'gitdir: /something');

    // After DES-031: buildSessionOptions must re-walk from cwd up to workRoot and refuse on a hit.
    // Currently: no re-walk → returns ok:true → expect(out.ok).toBe(false) fails → RED
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = (buildSessionOptions as any)(
      'local-qwen', PROFILE,
      { modelId: 'qwen2.5:7b', cwd, workRoot },
      {}, [], ALLOWLIST,
    );
    expect(out.ok).toBe(false);
    expect((out as { ok: false; error: string }).error).toMatch(/PROJECT/i);
  });
});
