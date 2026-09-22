// IT-300 (REQ-217, ARCH-172/ADR-080, DES-250): real, end-to-end proof of the owner's K5 ruling —
// `/api/runs`'s list path is paginated (the cliff is genuinely gone, not documentation-carried) AND
// `/api/home`'s avgCostUSD/successRate/terminalCount keep FULL-HISTORY semantics over the SAME
// workflow name, computed by a store-side SQL aggregate rather than folded over the (now-paginated)
// list. Seeded through the port only (createRun/recordTransition/saveSnapshot) directly against the
// SAME on-disk SqliteRunStore directory `createServer` opens — no real agent dispatch needed to get
// 60 terminal rows, so this stays fast.
//
// Mock policy (integration): real createServer + real SqliteRunStore + real HTTP — no mock of the
// store or either read surface (same tier justification as IT-068/home-api.test.ts).
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import { SqliteRunStore } from '../../src/store/sqlite-run-store.js';
import { FixedClock } from '../../src/clock.js';

const NAME = 'v36-req217-pagination';

describe('IT-300: /api/runs paginates while /api/home keeps full-history metrics (REQ-217)', () => {
  it('60 completed runs on one workflow name: /api/runs returns at most 50 of them, /api/home\'s card metrics reflect all 60', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'rwe-it300-'));
    const clock = new FixedClock(new Date('2026-09-22T00:00:00.000Z'));
    // Seed directly against the SAME store directory createServer will open below — better-sqlite3
    // (WAL mode) makes committed rows visible to a second Database handle on the same file
    // immediately, so no explicit hand-off is needed.
    const seedStore = new SqliteRunStore(join(tmpDir, 'store'), clock);
    for (let i = 0; i < 60; i++) {
      const runId = await seedStore.createRun({ origin: 'local', name: NAME, args: {} });
      const ts = `2026-09-22T${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00.000Z`;
      await seedStore.recordTransition(runId, 'running', 'completed', ts);
      await seedStore.saveSnapshot(runId, {
        phases: [], workflowNodes: [],
        agents: [{ agentId: 'a', state: 'done', provider: 'anthropic', model: 'x' }],
        usage: { tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, costUSD: 1, unpricedCalls: 0, unmappedMessages: {} },
      });
    }

    const server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir });
    try {
      // The list path: genuinely paginated, not just documented as unbounded.
      const runsRes = await fetch(`http://127.0.0.1:${server.port}/api/runs`);
      expect(runsRes.status).toBe(200);
      const runs = await runsRes.json() as Array<{ runId: string; name?: string }>;
      const thisWorkflow = runs.filter((r) => r.name === NAME);
      expect(thisWorkflow.length).toBeLessThanOrEqual(50);
      expect(thisWorkflow.length).toBeGreaterThan(0);

      // The aggregate path: full-history, unaffected by the page above.
      const homeRes = await fetch(`http://127.0.0.1:${server.port}/api/home`);
      expect(homeRes.status).toBe(200);
      const home = await homeRes.json() as {
        other: Array<{ name: string; metrics: { terminalCount: number; successRate: number | null; avgCostUSD: number | null } }>;
      };
      const card = home.other.find((c) => c.name === NAME);
      expect(card).toBeDefined();
      expect(card!.metrics.terminalCount).toBe(60); // NOT 50 — the list page never leaks into this number
      expect(card!.metrics.successRate).toBeCloseTo(1.0);
      expect(card!.metrics.avgCostUSD).toBeCloseTo(1.0);
    } finally {
      await server.close();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 20000);
});
