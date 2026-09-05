// IT-122 (v24 integrator; adjudication (v24) #4 C-7 [28], DES-146/DES-156 boundary):
// resuming a run whose PERSISTED admission snapshot predates the per-agent parameter contract must
// answer LEGACY_REREGISTER, not silently continue on the run-wide flat fields.
//
// The defect this pins. Every v24 admission writes an `.agents` slice into `effective_params`
// (`{}` at minimum — `contract.agents` is always passed to defaultRunParams/mergeRunParams), so a
// snapshot with NO `agents` key is, by construction, a pre-v24 row. `_requireLive` read that row
// back and used it verbatim: the resumed run dispatched with no per-label model/effort/timeoutMs at
// all, silently degraded to whatever the run-wide fields happened to be, and the caller was told
// nothing. `LEGACY_REREGISTER` is the code the design already assigns to exactly this condition —
// `workflow_describe`/`workflow_list` report it as `runnableReason` for the same versions — so the
// refusal a resumer meets here now matches what the read surfaces were already saying.
//
// Written RED first against the tree: before the fix, `resume()` resolved and the run continued.
//
// Mock policy (integration): a REAL SqliteRunStore on disk and a REAL RunManager. The gateway is
// replaced by a trivial spawner so the test needs no provider — the subject is the readback
// decision, which happens before any dispatch. The legacy row is produced by WRITING the pre-v24
// column shape directly, because no v24 code path can produce one any more; that is the only
// honest way to fixture a row this version of the engine cannot create.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { RunManager } from '../../src/run-manager.js';
import { SqliteRunStore } from '../../src/store/sqlite-run-store.js';
import { FixedClock } from '../../src/clock.js';
import type { AgentSpawner, AgentOutcome } from '../../src/agent-executor.js';
import { registerPublished } from '../helpers/workflow-fixtures.js';

const clock = new FixedClock(new Date('2024-01-01T00:00:00.000Z'));
const spawner: AgentSpawner = { run: async (): Promise<AgentOutcome> => ({ kind: 'text', value: 'ok' }) };

/** The pre-v24 flat snapshot shape, verbatim: tunable fields at the top level, `provenance`, and —
 *  the discriminator — NO `agents` key. */
const LEGACY_FLAT_PARAMS = JSON.stringify({
  model: 'default',
  effort: 'low',
  timeoutMs: 30_000,
  provenance: { model: 'default', effort: 'default', timeoutMs: 'default', appendPrompt: 'engine' },
});

describe('resume readback of a pre-v24 params snapshot (IT-122, C-7 [28])', () => {
  it('a stored FLAT (pre-v24) effective_params refuses LEGACY_REREGISTER on resume instead of silently degrading', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-it122-'));
    try {
      const store = new SqliteRunStore(join(dir, 'store'), clock);
      const mgr = new RunManager({ store, clock, workRoot: dir, spawner } as never);
      const name = 'it122-legacy-params';
      await registerPublished(mgr.catalog, name, "return await agent('worker', { prompt: 'go' });");
      const runId = await mgr.start({ name });
      await mgr.suspend(runId);

      // Overwrite this run's snapshot with the pre-v24 shape — the state a database written by a
      // v23 engine is actually in after an upgrade.
      const db = new Database(join(dir, 'store', 'index.db'));
      db.prepare('UPDATE runs SET effective_params = ? WHERE runId = ?').run(LEGACY_FLAT_PARAMS, runId);
      db.close();

      // A FRESH RunManager over the same store: no in-process entry for this runId, so resume must
      // go through the readback path (`_requireLive`) — exactly the post-restart case.
      const mgr2 = new RunManager({ store, clock, workRoot: dir, spawner } as never);
      await expect(mgr2.resume(runId)).rejects.toMatchObject({ code: 'LEGACY_REREGISTER' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30000);

  it('a v24 snapshot (an `agents` slice present, even empty) resumes normally — the check keys off the shape, not on "params exist"', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-it122b-'));
    try {
      const store = new SqliteRunStore(join(dir, 'store'), clock);
      const mgr = new RunManager({ store, clock, workRoot: dir, spawner } as never);
      const name = 'it122-v24-params';
      await registerPublished(mgr.catalog, name, "return await agent('worker', { prompt: 'go' });");
      const runId = await mgr.start({ name });
      await mgr.suspend(runId);

      const stored = await store.getEffectiveParams(runId);
      expect(stored?.agents, 'a v24 admission must always persist an agents slice').toBeDefined();

      const mgr2 = new RunManager({ store, clock, workRoot: dir, spawner } as never);
      await expect(mgr2.resume(runId)).resolves.not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30000);
});
