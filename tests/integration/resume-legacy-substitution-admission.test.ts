// IT-307 — v37 Gate 8 round-4 finding F5 (ADR-086's third owner ruling, P1, DES-263 第三次修訂).
//
// `resume()` has exactly ONE admission stage and it lives in the legacy-substitution branch only.
// The distinction this file pins is the reason for that, because the reason is what a future reader
// will get wrong:
//
//   resume, pinned path      -> resolves view.scriptVersion: the SAME code the run started with,
//                               which already passed admission at start(). The owner-accepted
//                               resume exclusion (INV-V37-5(c)) protects exactly this.
//   resume, fallback path    -> the pin is GONE (deregister/re-register restarted the lineage), so
//                               it resolves the CURRENT `release` — a DIFFERENT version the run
//                               never carried and no admission check ever saw. The exclusion's
//                               reason does not reach this; without a check, a local run_resume of
//                               an old suspended run silently executes a remotely-registered script.
//
// Fixture rule follows the existing IT-086 legacy-cohort case in run-version-pin.test.ts: the
// absent pin is hand-seeded, never produced by the code under test.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { RunManager } from '../../src/run-manager.js';
import { WorkflowCatalog } from '../../src/workflow-catalog.js';
import { SqliteRunStore } from '../../src/store/sqlite-run-store.js';
import { FixedClock } from '../../src/clock.js';

const CLOCK = new FixedClock(new Date('2026-09-25T00:00:00Z'));

async function seedSuspendedRunWithMissingPin(dir: string, name: string, registeredRemote: boolean) {
  const catalog = new WorkflowCatalog(join(dir, 'catalog'), CLOCK);
  const store = new SqliteRunStore(join(dir, 'store'), CLOCK);
  const runManager = new RunManager({ store, clock: CLOCK, workRoot: dir, catalog, confinementPosture: 'unconfined' });
  const { version } = await catalog.register({ name, script: `return 'substituted-script';`, mermaid: 'graph LR', registeredRemote });
  await catalog.publish(name, version, 'release', null);
  const runId = await store.createRun({ origin: 'local', name, args: undefined }, 'v-gone');
  const raw = new Database(join(dir, 'store', 'index.db'));
  raw.prepare('UPDATE runs SET status = ? WHERE runId = ?').run('suspended', runId);
  raw.close();
  return { runManager, runId, version };
}

describe("IT-307 — resume()'s legacy substitution is admission-checked; its pinned path is not (P1)", () => {
  it('[LOAD-BEARING] a LOCAL resume whose pin is gone and whose substituted `release` version was registered REMOTELY is refused', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-it307a-'));
    try {
      const { runManager, runId } = await seedSuspendedRunWithMissingPin(dir, 'it307-remote-sub', true);
      // Nothing about this resume is remote: a loopback operator, a locally-created run
      // (`origin:'local'`). The refusal comes from the SUBSTITUTED version's own provenance.
      await expect(runManager.resume(runId)).rejects.toMatchObject({ code: 'CONFINEMENT_UNAVAILABLE' });
      // The message must name both halves so an operator can act: the missing pin AND the version
      // that would have been substituted.
      await expect(runManager.resume(runId)).rejects.toThrow(/v-gone/);
      await expect(runManager.resume(runId)).rejects.toThrow(/registered remotely/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 20000);

  it('mirror: the same substitution with a LOCALLY registered `release` version still resumes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-it307b-'));
    try {
      const { runManager, runId } = await seedSuspendedRunWithMissingPin(dir, 'it307-local-sub', false);
      // Without this case, a fallback that threw unconditionally would also pass the case above.
      await expect(runManager.resume(runId)).resolves.not.toThrow();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 20000);
});
