// Issue #116 (owner decision, 2026-10-10): the workspace-reclaim TTL sweep (server.ts's `sweep()`,
// workspace-gc.ts's `reclaimStaleWorkspaces`) ages a terminal run's workspace from the run's OWN
// recorded end time (`RunSummary.terminalAt`, sourced from the `transitions` table's first
// completed/failed/stopped row) — never the workspace directory's mtime. This is the end-to-end
// wiring check: a real `createServer()`, a real SQLite run store, a real sweep timer. The unit-level
// behaviour (`reclaimStaleWorkspaces` given an injected `statusOf`, and `gcStatusFromSummary`'s own
// `RunSummary -> {status, endedAt}` mapping) is covered by tests/unit/workspace-gc.test.ts; this
// file exists because a composeConfig-class wiring bug (the right unit logic, called with the wrong
// value at the one real call site) is caught ONLY by a real run through server.ts.
//
// Timing note: the sweep's interval EQUALS the TTL itself (server.ts: `Math.min(_gcTtl, 1h)`), so a
// row stamped `terminalAt` BEFORE the server boots would, by the time the first tick can possibly
// fire, already be at least one full TTL old (tick fires at `armTime + TTL`, and `armTime` is itself
// after the stamp) — there is no wall-clock window in which such a row is both "evaluated by a real
// tick" and "provably still younger than the TTL". So the "kept" row is seeded AFTER the server (and
// its sweep timer) is already up, and checked in the window between the tick that correctly finds it
// still young and the NEXT tick (one TTL later) that would correctly find it aged out.
//
// Mock policy (integration): real createServer() over a real work root and real SQLite — no mock of
// workspace-gc.ts or the run store. The run row + its terminal transition are seeded directly into
// the store's own `index.db` by raw SQL (same technique auth-routes-integration.test.ts already
// uses against auth-tokens.db for the SAME kind of "real sweep, synthetic seed data" check) —
// seeding a run end-to-end through run_start/agent()/completion just to get one row into
// `transitions` would make this test's own setup far slower and no more faithful.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

let server: Server;
let tmpDir: string;

// The sweep's own interval EQUALS this (server.ts: `Math.min(_gcTtl, 1h)`) — see the timing note
// above for why both rows are seeded only after the server is already up.
const TTL_MS = 1_000;

function seedTerminalRun(dbPath: string, runId: string, name: string, terminalAtIso: string): void {
  const db = new Database(dbPath);
  try {
    db.prepare('INSERT INTO runs (runId, name, status, scriptVersion, createdAt) VALUES (?, ?, ?, ?, ?)')
      .run(runId, name, 'completed', '1.0.0', terminalAtIso);
    db.prepare("INSERT INTO transitions (runId, from_status, to_status, ts) VALUES (?, 'running', 'completed', ?)")
      .run(runId, terminalAtIso);
  } finally {
    db.close();
  }
}

function seedWorkspaceDir(workRoot: string, name: string, runId: string, mtimeMsAgo: number): string {
  const dir = join(workRoot, 'workflows', name, 'runs', runId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'f.txt'), 'x');
  const t = (Date.now() - mtimeMsAgo) / 1000;
  utimesSync(dir, t, t);
  return dir;
}

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-it116-'));
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir, workspaceTtlMs: TTL_MS });
  // Seeded AFTER boot (see the timing note above) — `store` is `new SqliteRunStore(join(workRoot,
  // 'store'), clock)` (server.ts), so its schema already exists at `<workRoot>/store/index.db`.
  const dbPath = join(tmpDir, 'store', 'index.db');

  seedTerminalRun(dbPath, 'long-run', 'wf', new Date().toISOString()); // ended just now (post-boot)
  seedWorkspaceDir(tmpDir, 'wf', 'long-run', 8 * 24 * 60 * 60 * 1000); // dir mtime: 8 days old (pre-existing, seeded workspace)

  seedTerminalRun(dbPath, 'stale-run', 'wf', new Date(Date.now() - (TTL_MS * 5)).toISOString()); // ended well past the TTL
  seedWorkspaceDir(tmpDir, 'wf', 'stale-run', 0); // dir mtime: fresh (just written above)
});

afterAll(async () => {
  await server?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('workspace TTL sweep ages from the run\'s own end time, not directory mtime (issue #116, real server)', () => {
  it('a run that ended just now is KEPT even though its workspace directory mtime is 8 days old', async () => {
    const dir = join(tmpDir, 'workflows', 'wf', 'runs', 'long-run');
    // Checked inside the window after the tick that correctly finds it still young (fires ~TTL_MS
    // after boot) and before the NEXT tick (one more TTL_MS later) that would correctly reclaim it
    // once it has genuinely aged past the TTL — see the timing note at the top of this file.
    await new Promise((r) => setTimeout(r, TTL_MS * 1.5));
    expect(existsSync(dir), 'a run that ended just now must not be reclaimed merely because its workspace directory is old').toBe(true);
  });

  it('a run that ended well past the TTL IS reclaimed even though its workspace directory mtime is fresh', async () => {
    const dir = join(tmpDir, 'workflows', 'wf', 'runs', 'stale-run');
    const deadline = Date.now() + 10_000;
    let gone = false;
    while (Date.now() < deadline) {
      if (!existsSync(dir)) { gone = true; break; }
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(gone, 'a run that genuinely ended past the TTL must be reclaimed even though its workspace directory mtime looks fresh').toBe(true);
  });
});
