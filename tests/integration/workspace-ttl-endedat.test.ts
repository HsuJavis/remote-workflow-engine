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
  // ONE test, not two independently-timed ones: polling until `stale-run` is reclaimed IS the
  // observation that a real sweep tick has fired (event-driven — no sleep constant to tune, no
  // margin to lose on a loaded runner). The REMOVING tick is always the first tick after both rows
  // were seeded (both seeded together, right after boot — see the timing note above), so at that
  // exact moment `long-run`'s age is `< TTL` for ANY boot/seed delay (it is seeded no later than
  // `stale-run`, and `stale-run` was already `TTL_MS * 5` old at seed time, so the TTL loop reaches
  // `long-run` — alphabetically and by iteration order, whichever runs first — well within the SAME
  // tick, long before a second tick (one more full TTL away) could possibly find `long-run` aged
  // out too). Checking `long-run` immediately after observing `stale-run`'s removal, rather than on
  // a fixed sleep, is what makes this robust regardless of how long `createServer()` itself took.
  it('a run that ended just now is KEPT, and one that ended well past the TTL IS reclaimed, even though their workspace directory mtimes say the opposite', async () => {
    const staleDir = join(tmpDir, 'workflows', 'wf', 'runs', 'stale-run');
    const longDir = join(tmpDir, 'workflows', 'wf', 'runs', 'long-run');
    const deadline = Date.now() + 10_000;
    let staleGone = false;
    while (Date.now() < deadline) {
      if (!existsSync(staleDir)) { staleGone = true; break; }
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(staleGone, 'a run that genuinely ended past the TTL must be reclaimed even though its workspace directory mtime looks fresh').toBe(true);
    expect(existsSync(longDir), 'a run that ended just now must not be reclaimed merely because its workspace directory is old').toBe(true);
  });
});
