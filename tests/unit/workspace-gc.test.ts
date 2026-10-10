// UT (REQ-026): reclaimStaleWorkspaces deletes only TERMINAL + old workspaces, never active/unknown.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, utimesSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reclaimStaleWorkspaces, gcStatusFromSummary, type RunStatusInfo } from '../../src/workspace-gc.js';
import type { RunStatus } from '../../src/types.js';

/** Issue #121: `statusOf` now returns `{status, endedAt}` — this helper builds the common
 *  no-recorded-end-time case (every pre-endedAt test below), which `reclaimStaleWorkspaces` falls
 *  back to the directory's mtime for, preserving this file's existing mtime-based scenarios. */
const st = (status: RunStatus): RunStatusInfo => ({ status });

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
    const reclaimed = reclaimStaleWorkspaces(root, 5_000, () => st('completed'), NOW);
    expect(reclaimed).toEqual(['old-done']);
    expect(existsSync(d)).toBe(false);
  });
  it('KEEPS an active/suspended/queued run, and one younger than the TTL, and an unknown runId', () => {
    const running = mkRun('wf', 'running', 10_000);
    const suspended = mkRun('wf', 'suspended', 10_000);
    const young = mkRun('wf', 'young-done', 1_000);
    const unknown = mkRun('wf', 'unknown', 10_000);
    const status: Record<string, RunStatus> = { running: 'running', suspended: 'suspended', 'young-done': 'completed' };
    const reclaimed = reclaimStaleWorkspaces(root, 5_000, (id) => (status[id] ? st(status[id]!) : null), NOW);
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
    const reclaimed = reclaimStaleWorkspaces(root, 5_000, () => st('completed'), NOW);
    expect(reclaimed).toEqual(['old-done']);
    expect(existsSync(d)).toBe(false);
  });

  it('an unstattable entry inside runs/ (a dangling symlink) is SKIPPED, and its siblings are still swept', () => {
    const d = mkRun('wf', 'old-done', 10_000);
    symlinkSync(join(root, 'definitely-absent'), join(root, 'workflows', 'wf', 'runs', 'aaa-ghost'));
    const reclaimed = reclaimStaleWorkspaces(root, 5_000, () => st('completed'), NOW);
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
      const reclaimed = reclaimStaleWorkspaces(root, 5_000, () => st('completed'), NOW);
      expect(reclaimed).toEqual(['old-done']); // unchanged shape — no second entry for the mcp-state dir
      expect(existsSync(ws)).toBe(false);
      expect(existsSync(state)).toBe(false);
    });

    it('an ACTIVE run\'s mcp-state dir is KEPT, same as its workspace', () => {
      mkRun('wf', 'running', 10_000);
      const state = mkMcpState('wf', 'running');
      reclaimStaleWorkspaces(root, 5_000, () => st('running'), NOW);
      expect(existsSync(state)).toBe(true);
    });

    it('a run with no mcp-state dir at all is a no-op for that part — no throw, workspace still reclaimed', () => {
      const ws = mkRun('wf', 'old-done-no-state', 10_000);
      expect(() => reclaimStaleWorkspaces(root, 5_000, () => st('completed'), NOW)).not.toThrow();
      expect(existsSync(ws)).toBe(false);
    });

    it('two DIFFERENT runs never share or cross-delete each other\'s mcp-state dir', () => {
      mkRun('wf', 'keep-me', 10_000);
      const keepState = mkMcpState('wf', 'keep-me');
      mkRun('wf', 'old-done', 10_000);
      mkMcpState('wf', 'old-done');
      reclaimStaleWorkspaces(root, 5_000, (id) => st(id === 'old-done' ? 'completed' : 'running'), NOW);
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
        const reclaimed = reclaimStaleWorkspaces(root, 5_000, () => st('completed'), NOW);
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
        reclaimStaleWorkspaces(root, 5_000, () => st('running'), NOW);
        expect(existsSync(state)).toBe(true);
      });

      it('a run whose runs/<runId> STILL exists is left to the TTL loop above — the orphan sweep never double-handles it', () => {
        mkRun('wf', 'young', 1_000); // younger than the TTL — the TTL loop above keeps it
        const state = mkMcpState('wf', 'young');
        reclaimStaleWorkspaces(root, 5_000, () => st('completed'), NOW);
        expect(existsSync(state)).toBe(true);
      });
    });
  });

  // Issue #121: with workspaceTtlMs now defaulting to 7 days instead of "no auto-GC at all"
  // (composeConfig, main.ts), a deployment's FIRST sweep after upgrading can face a large backlog
  // of already-expired terminal-run workspaces that accumulated over months with GC previously off
  // — this loop is fully synchronous (readdirSync/statSync/rmSync, no await), so draining an
  // unbounded backlog in one call blocks the event loop (every MCP call, dashboard request, and
  // live agent's own IPC) for however long that many `rmSync(recursive:true)` calls take. An
  // optional trailing `maxReclaim` caps how many entries ONE call reclaims (across workspaces,
  // mcp-state, and asset trees combined — the same `reclaimed` array every one of them pushes
  // onto) and returns as soon as the cap is hit, leaving the rest for the next sweep tick (never
  // thrown, never skipped — just deferred) rather than draining an unbounded backlog in one
  // blocking call. Omitted (every existing call site above) -> Infinity, unchanged behavior.
  describe('maxReclaim (issue #121: bounds one sweep call against a large backlog)', () => {
    it('reclaims at most maxReclaim entries in one call, leaving the rest for next time', () => {
      mkRun('wf', 'old-1', 10_000);
      mkRun('wf', 'old-2', 10_000);
      mkRun('wf', 'old-3', 10_000);
      const reclaimed = reclaimStaleWorkspaces(root, 5_000, () => st('completed'), NOW, undefined, undefined, 2);
      expect(reclaimed.length).toBe(2);
      // The sweep stopped at the cap — exactly one of the three old runs is still on disk, ready
      // for the next sweep tick to pick up (never silently lost, never force-drained past the cap).
      const remaining = ['old-1', 'old-2', 'old-3'].filter((id) => existsSync(join(root, 'workflows', 'wf', 'runs', id)));
      expect(remaining.length).toBe(1);
    });

    it('omitted maxReclaim reclaims everything eligible in one call (unchanged default behavior)', () => {
      mkRun('wf', 'old-1', 10_000);
      mkRun('wf', 'old-2', 10_000);
      mkRun('wf', 'old-3', 10_000);
      const reclaimed = reclaimStaleWorkspaces(root, 5_000, () => st('completed'), NOW);
      expect(reclaimed.sort()).toEqual(['old-1', 'old-2', 'old-3']);
    });

    it('a cap of 0 reclaims nothing (every workspace stays, for a caller choosing to defer entirely)', () => {
      const d = mkRun('wf', 'old-1', 10_000);
      const reclaimed = reclaimStaleWorkspaces(root, 5_000, () => st('completed'), NOW, undefined, undefined, 0);
      expect(reclaimed).toEqual([]);
      expect(existsSync(d)).toBe(true);
    });
  });

  // Issue #121 (owner decision, 2026-10-10): the TTL ages from the run's own recorded END time
  // (`endedAt`, the run store's `terminalAt`), NOT the workspace directory's mtime. A directory's
  // mtime can disagree with when the run actually finished in either direction — a long run whose
  // workspace was seeded (and therefore mtime'd) days before it finished, or a terminal run whose
  // directory was touched again afterward — and the TTL must track the run's true end, not that
  // incidental filesystem timestamp.
  describe('TTL ages from endedAt, not directory mtime (issue #121)', () => {
    const TTL = 7 * 24 * 60 * 60 * 1000; // 7 days, the production default (issue #121)

    it('a run that was IN FLIGHT for 8 days and ended just now is NOT reclaimed, even though its workspace directory is 8 days old', () => {
      const d = mkRun('wf', 'long-run', 8 * 24 * 60 * 60 * 1000); // dir mtime: 8 days old
      const reclaimed = reclaimStaleWorkspaces(root, TTL, () => ({ status: 'completed', endedAt: NOW }), NOW);
      expect(reclaimed).toEqual([]);
      expect(existsSync(d)).toBe(true);
    });

    it('a run that ENDED 7+ days ago IS reclaimed even though its workspace directory mtime is recent', () => {
      const d = mkRun('wf', 'recently-touched', 1_000); // dir mtime: 1 second old
      const endedAt = NOW - (TTL + 1_000); // ended just over 7 days ago
      const reclaimed = reclaimStaleWorkspaces(root, TTL, () => ({ status: 'completed', endedAt }), NOW);
      expect(reclaimed).toEqual(['recently-touched']);
      expect(existsSync(d)).toBe(false);
    });

    it('a LEGACY run with no recorded endedAt (null) falls back to the directory mtime, old or young', () => {
      const oldDir = mkRun('wf', 'legacy-old', 10_000);
      const youngDir = mkRun('wf', 'legacy-young', 1_000);
      const reclaimed = reclaimStaleWorkspaces(root, 5_000, (id) => ({ status: 'completed', endedAt: id === 'legacy-old' ? null : undefined }), NOW);
      expect(reclaimed).toEqual(['legacy-old']);
      expect(existsSync(oldDir)).toBe(false);
      expect(existsSync(youngDir)).toBe(true);
    });

    // A `NaN` `endedAt` (a malformed `terminalAt`, should never happen in practice — it is
    // engine-written ISO — but this is the one branch where "uncertain" must resolve to "fall back
    // to mtime", never to "delete regardless of age": `nowMs - NaN < ttlMs` is `false` under a bare
    // `??` fallback, which skips the retention-window `continue` and reaches `rmSync` unconditionally.
    it('a NaN endedAt (malformed terminalAt) falls back to the directory mtime, exactly like null — never deletes regardless of age', () => {
      const oldDir = mkRun('wf', 'nan-old', 10_000);
      const youngDir = mkRun('wf', 'nan-young', 1_000);
      const reclaimed = reclaimStaleWorkspaces(root, 5_000, () => ({ status: 'completed', endedAt: NaN }), NOW);
      expect(reclaimed).toEqual(['nan-old']);
      expect(existsSync(oldDir)).toBe(false);
      expect(existsSync(youngDir)).toBe(true);
    });
  });

  // Issue #121: `server.ts`'s sweep builds its `statusOf` lookup from `gcStatusFromSummary(r)` for
  // every `RunSummary` `store.listRuns()` returns — this is the ONE mapping, so a composeConfig-
  // class wiring bug (right unit logic, wrong value forwarded at the one real call site — see
  // CLAUDE.md's "composeConfig 佈線 bug class" note) is caught here directly rather than only by a
  // real sweep tick racing the TTL.
  describe('gcStatusFromSummary (issue #121): the ONE RunSummary -> {status, endedAt} mapping', () => {
    it('forwards status and parses terminalAt to epoch ms', () => {
      expect(gcStatusFromSummary({ status: 'completed', terminalAt: '2026-10-10T00:00:00.000Z' }))
        .toEqual({ status: 'completed', endedAt: Date.parse('2026-10-10T00:00:00.000Z') });
    });

    it('an ABSENT terminalAt (legacy row, never terminal-transitioned) maps to endedAt: null', () => {
      expect(gcStatusFromSummary({ status: 'completed', terminalAt: undefined }))
        .toEqual({ status: 'completed', endedAt: null });
    });

    it('a MALFORMED terminalAt (Date.parse -> NaN) also maps to endedAt: null, never NaN', () => {
      expect(gcStatusFromSummary({ status: 'completed', terminalAt: 'garbage' }))
        .toEqual({ status: 'completed', endedAt: null });
    });

    it('a non-terminal status still forwards (reclaimStaleWorkspaces is what gates on TERMINAL, not this mapping)', () => {
      expect(gcStatusFromSummary({ status: 'running', terminalAt: undefined })).toEqual({ status: 'running', endedAt: null });
    });
  });
});
