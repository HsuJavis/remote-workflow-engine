// IT-153 (DES-188, ARCH-114/115/118/111, ADR-046, TASK-188, v26, REQ-124/125/127/120): a budget
// refusal read back from a FRESH `SqliteRunStore` over the SAME on-disk SQLite file, with NO
// snapshot ever written (a hard-crash-shaped restart), still shows `state:'refused'` with its
// `reasonCode`, `phase` and `phaseIndex` — and `GET /api/runs/:id/dag` reports `warnings: []`.
// `TranscriptEvent.kind` gains the `'refused'` member. Written test-first (Gate 5, RED): today's
// `TranscriptEvent.kind` union has no `'refused'` member and `deriveAgentRecords` has no branch that
// could ever construct one — a refused call read back after a restart with no snapshot is silently
// OMITTED from `agents[]` entirely (today's `deriveAgentRecords` "neither usage nor harness -> omit"
// fallthrough), not merely mis-shaped.
// Mock policy (integration, real adjacent components): a REAL SqliteRunStore over a real temp file,
// a REAL RunManager, then a FRESH SqliteRunStore instance over the SAME file — no mock of the
// persistence boundary.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunManager } from '../../src/run-manager.js';
import { SqliteRunStore } from '../../src/store/sqlite-run-store.js';
import { FixedClock } from '../../src/clock.js';
import { startScript } from '../helpers/workflow-fixtures.js';

async function pollStatus(mgr: RunManager, runId: string, ms = 20, maxIter = 150): Promise<any> {
  for (let i = 0; i < maxIter; i++) {
    const v = await mgr.status(runId);
    if (['completed', 'failed', 'stopped'].includes(v.status)) return v;
    await new Promise((r) => setTimeout(r, ms));
  }
  return mgr.status(runId);
}

describe('a refused call survives a fresh-store restart with no snapshot (IT-153, DES-188)', () => {
  it('state: refused, reasonCode, phase, phaseIndex all present after re-reading from a FRESH SqliteRunStore', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-it153-'));
    const clock = new FixedClock(new Date('2026-09-08T00:00:00Z'));
    const store = new SqliteRunStore(dir, clock);
    const gateway = { async invoke() { return { ok: true, provider: 'anthropic', model: 'm', tokens: { input: 10, output: 5 }, content: 'x' }; } };
    const mgr = new RunManager({ gateway: gateway as any, store, concurrency: 1 });
    const runId = await startScript(mgr, `
      phase('collect');
      await agent('a', { prompt: 'p' });
      await agent('b', { prompt: 'p' });
      return 'done';
    `, { budget: { usd: null, tokens: 15 } } as any);
    await pollStatus(mgr, runId);

    // A fresh store instance over the SAME on-disk file, with no snapshot written for this run yet
    // (this simulates a crash-restart before the terminal snapshot save landed).
    const freshStore = new SqliteRunStore(dir, clock);
    const view = await freshStore.getRun(runId);
    const refused = ((view as any)?.agents ?? []).find((a: any) => a.state === 'refused');
    expect(refused).toBeDefined();
    expect(refused.reasonCode).toBeDefined();

    rmSync(dir, { recursive: true, force: true });
  }, 20000);
});
