// UT (REQ-026): reclaimStaleWorkspaces deletes only TERMINAL + old workspaces, never active/unknown.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, utimesSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reclaimStaleWorkspaces } from '../../src/workspace-gc.js';
import type { RunStatus } from '../../src/types.js';

let root: string;
const NOW = 1_000_000_000_000;
function mkRun(name: string, runId: string, ageMs: number): string {
  const dir = join(root, 'workflows', name, 'runs', runId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'f.txt'), 'x');
  const t = (NOW - ageMs) / 1000;
  utimesSync(dir, t, t);
  return dir;
}
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'rwe-gc-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe('reclaimStaleWorkspaces (REQ-026)', () => {
  it('deletes a TERMINAL workspace older than the TTL', () => {
    const d = mkRun('wf', 'old-done', 10_000);
    const reclaimed = reclaimStaleWorkspaces(root, 5_000, () => 'completed' as RunStatus, NOW);
    expect(reclaimed).toEqual(['old-done']);
    expect(existsSync(d)).toBe(false);
  });
  it('KEEPS an active/suspended/queued run, and one younger than the TTL, and an unknown runId', () => {
    const running = mkRun('wf', 'running', 10_000);
    const suspended = mkRun('wf', 'suspended', 10_000);
    const young = mkRun('wf', 'young-done', 1_000);
    const unknown = mkRun('wf', 'unknown', 10_000);
    const status: Record<string, RunStatus> = { running: 'running', suspended: 'suspended', 'young-done': 'completed' };
    const reclaimed = reclaimStaleWorkspaces(root, 5_000, (id) => status[id] ?? null, NOW);
    expect(reclaimed).toEqual([]);
    for (const d of [running, suspended, young, unknown]) expect(existsSync(d)).toBe(true);
  });
  it('no workflows dir -> no-op, no throw', () => {
    expect(reclaimStaleWorkspaces(join(root, 'nope'), 1, () => null, NOW)).toEqual([]);
  });

  // Gate 6.5+7 round 2 (verifier): the sweep's tolerate-and-continue arms. A GC that throws on one
  // odd directory entry stops reclaiming everything after it, so "skip it and keep going" is the
  // behaviour under test — and none of it was exercised.
  it('a workflow directory with no runs/ subdir is SKIPPED, and later workflows are still swept', () => {
    mkdirSync(join(root, 'workflows', 'no-runs-dir'), { recursive: true });
    const d = mkRun('wf', 'old-done', 10_000);
    const reclaimed = reclaimStaleWorkspaces(root, 5_000, () => 'completed' as RunStatus, NOW);
    expect(reclaimed).toEqual(['old-done']);
    expect(existsSync(d)).toBe(false);
  });

  it('an unstattable entry inside runs/ (a dangling symlink) is SKIPPED, and its siblings are still swept', () => {
    const d = mkRun('wf', 'old-done', 10_000);
    symlinkSync(join(root, 'definitely-absent'), join(root, 'workflows', 'wf', 'runs', 'aaa-ghost'));
    const reclaimed = reclaimStaleWorkspaces(root, 5_000, () => 'completed' as RunStatus, NOW);
    expect(reclaimed).toEqual(['old-done']);
    expect(existsSync(d)).toBe(false);
  });

  it('the asset sweep skips an unstattable entry and a plain FILE, and still reclaims an orphaned tree', () => {
    const assetRoot = join(root, 'assets');
    mkdirSync(join(assetRoot, 'orphaned-wf'), { recursive: true });
    writeFileSync(join(assetRoot, 'zz-a-file'), 'not a directory');
    symlinkSync(join(root, 'definitely-absent'), join(assetRoot, 'aaa-ghost'));
    const reclaimed = reclaimStaleWorkspaces(root, 5_000, () => null, NOW, () => false, assetRoot);
    expect(reclaimed).toEqual(['assets/orphaned-wf']);
    expect(existsSync(join(assetRoot, 'orphaned-wf'))).toBe(false);
    expect(existsSync(join(assetRoot, 'zz-a-file'))).toBe(true); // a stray file is left alone, not deleted
  });

  it('a LIVE workflow name is never touched by the asset sweep', () => {
    const assetRoot = join(root, 'assets');
    mkdirSync(join(assetRoot, 'live-wf'), { recursive: true });
    expect(reclaimStaleWorkspaces(root, 5_000, () => null, NOW, (n) => n === 'live-wf', assetRoot)).toEqual([]);
    expect(existsSync(join(assetRoot, 'live-wf'))).toBe(true);
  });

  // issue #126 B: a run's own MCP state dir (<workflowFolder>/mcp-state/<runId>/, a SIBLING of
  // runs/<runId> — mcp-run-state.ts) is reclaimed on the SAME terminal+TTL sweep as its workspace.
  describe('mcp-state dir cleanup (issue #126 B)', () => {
    function mkMcpState(name: string, runId: string): string {
      const dir = join(root, 'workflows', name, 'mcp-state', runId, 'kv');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'memory.jsonl'), '{}');
      return dir;
    }

    it('a TERMINAL + TTL-expired run also reclaims its mcp-state dir', () => {
      const ws = mkRun('wf', 'old-done', 10_000);
      const state = mkMcpState('wf', 'old-done');
      const reclaimed = reclaimStaleWorkspaces(root, 5_000, () => 'completed' as RunStatus, NOW);
      expect(reclaimed).toEqual(['old-done']); // unchanged shape — no second entry for the mcp-state dir
      expect(existsSync(ws)).toBe(false);
      expect(existsSync(state)).toBe(false);
    });

    it('an ACTIVE run\'s mcp-state dir is KEPT, same as its workspace', () => {
      mkRun('wf', 'running', 10_000);
      const state = mkMcpState('wf', 'running');
      reclaimStaleWorkspaces(root, 5_000, () => 'running' as RunStatus, NOW);
      expect(existsSync(state)).toBe(true);
    });

    it('a run with no mcp-state dir at all is a no-op for that part — no throw, workspace still reclaimed', () => {
      const ws = mkRun('wf', 'old-done-no-state', 10_000);
      expect(() => reclaimStaleWorkspaces(root, 5_000, () => 'completed' as RunStatus, NOW)).not.toThrow();
      expect(existsSync(ws)).toBe(false);
    });

    it('two DIFFERENT runs never share or cross-delete each other\'s mcp-state dir', () => {
      mkRun('wf', 'keep-me', 10_000);
      const keepState = mkMcpState('wf', 'keep-me');
      mkRun('wf', 'old-done', 10_000);
      mkMcpState('wf', 'old-done');
      reclaimStaleWorkspaces(root, 5_000, (id) => (id === 'old-done' ? 'completed' as RunStatus : 'running' as RunStatus), NOW);
      expect(existsSync(keepState)).toBe(true);
    });

    // review v035 M-1 part 2: the loop above only ever finds a run's mcp-state dir by walking
    // `runs/<runId>` — once something else has ALREADY removed `runs/<runId>` (e.g. `workspace_purge`,
    // mcp-facade.ts, which is terminal-gated the same as this GC) the above loop never iterates that
    // runId again, so its mcp-state dir would be orphaned forever. This sweep walks `mcp-state/`
    // itself and reclaims any `<runId>` whose `runs/<runId>` sibling is already gone — independent of
    // the TTL (the workspace is already gone, so there's nothing left to age out).
    describe('orphan mcp-state sweep — runs/<runId> already gone (review v035 M-1 part 2)', () => {
      it('a mcp-state dir whose runs/<runId> no longer exists is reclaimed even though the TTL loop never iterates it', () => {
        const state = mkMcpState('wf', 'already-purged');
        const reclaimed = reclaimStaleWorkspaces(root, 5_000, () => 'completed' as RunStatus, NOW);
        expect(reclaimed).toContain('mcp-state/already-purged');
        expect(existsSync(state)).toBe(false);
      });

      it('an orphaned mcp-state dir whose run is UNKNOWN to the store (status null) is also reclaimed — the workspace\'s own absence is independent proof it is not live', () => {
        const state = mkMcpState('wf', 'forgotten-run');
        reclaimStaleWorkspaces(root, 5_000, () => null, NOW);
        expect(existsSync(state)).toBe(false);
      });

      it('an orphaned mcp-state dir is KEPT when the store reports the run as still LIVE (defense-in-depth — nothing should ever delete runs/<runId> while a run is live)', () => {
        const state = mkMcpState('wf', 'somehow-still-running');
        reclaimStaleWorkspaces(root, 5_000, () => 'running' as RunStatus, NOW);
        expect(existsSync(state)).toBe(true);
      });

      it('a run whose runs/<runId> STILL exists is left to the TTL loop above — the orphan sweep never double-handles it', () => {
        mkRun('wf', 'young', 1_000); // younger than the TTL — the TTL loop above keeps it
        const state = mkMcpState('wf', 'young');
        reclaimStaleWorkspaces(root, 5_000, () => 'completed' as RunStatus, NOW);
        expect(existsSync(state)).toBe(true);
      });
    });
  });
});
