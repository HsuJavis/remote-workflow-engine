// IT-086 (ARCH-072, DES-113, DES-112, DES-117, TASK-108): resolve once at admission, pin the
// version on the run, resume/nested/legacy through the pin.
//
// Mock policy (integration, DES-119): real RunManager + real WorkflowCatalog + real SqliteRunStore;
// only GatewayClient (third-party network) is faked, per this repo's crash-resume.test.ts /
// resume-rerun-aborted-call.test.ts precedent (block-then-resolve gateway to catch a run mid-flight).
//
// Red reason (the flagship case): `run-manager.ts:632-636` re-reads `catalog.get(spec.name)` on
// resume — a named run continues WHATEVER IS REGISTERED NOW, not what it started with. This test
// starts v1, suspends mid-flight, registers+publishes v2 to `release`, resumes, and asserts the
// result came from v1's script — RED today (the real bug Gate 7.5 v1 found, now made a durable
// regression test by version history + a churned `beta` channel making it the NORMAL case, not a
// narrow window).
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { RunManager } from '../../src/run-manager.js';
import { WorkflowCatalog } from '../../src/workflow-catalog.js';
import { SqliteRunStore } from '../../src/store/sqlite-run-store.js';
import { FixedClock } from '../../src/clock.js';
import type { GatewayClient } from '../../src/gateway/client.js';

const CLOCK = new FixedClock(new Date('2026-01-01T00:00:00Z'));

async function pollUntilSettled(mgr: RunManager, runId: string, maxIters = 100) {
  let view = await mgr.status(runId);
  for (let i = 0; i < maxIters && (view.status === 'running' || view.status === 'queued'); i++) {
    await new Promise((r) => setTimeout(r, 30));
    view = await mgr.status(runId);
  }
  return view;
}

describe('resume determinism: a suspended run continues the version it PINNED, not whatever is registered now (ADR-010, IT-086)', () => {
  it('start v1 (blocked mid-agent-call) → suspend → register+publish v2 → resume → result is from v1', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-it086-'));
    try {
      let invokeCount = 0;
      let firstInvokeStarted!: () => void;
      const firstInvokeStartedPromise = new Promise<void>((resolve) => { firstInvokeStarted = resolve; });
      const gateway: GatewayClient = {
        invoke: async () => {
          invokeCount += 1;
          if (invokeCount === 1) {
            firstInvokeStarted();
            return await new Promise<never>(() => {}); // blocks forever (aborted by suspend)
          }
          // The live re-run after resume — content unambiguously distinguishable per D-F13.
          return { ok: true, provider: 'fake', model: 'm', tokens: { input: 1, output: 1 }, content: 'v1-agent-result' };
        },
      };

      const catalog = new WorkflowCatalog(join(dir, 'catalog'), CLOCK);
      const store = new SqliteRunStore(join(dir, 'store'), CLOCK);
      const runManager = new RunManager({ store, clock: CLOCK, workRoot: dir, catalog, gateway });

      const { version: v1 } = await catalog.register('rvp-flow', `const a = await agent('slow'); return 'V1:' + a;`);
      await catalog.publish('rvp-flow', v1, 'release', null);

      const runId = await runManager.start({ name: 'rvp-flow' });
      await firstInvokeStartedPromise;
      await runManager.suspend(runId);
      await new Promise((r) => setTimeout(r, 300)); // let the post-abort journal write land

      const suspended = await runManager.status(runId);
      expect(suspended.status).toBe('suspended'); // sanity: suspend itself already works, unchanged

      // Register+publish a DIFFERENT script under the SAME name while the run is suspended.
      const { version: v2 } = await catalog.register('rvp-flow', `return 'V2-ENTIRELY-DIFFERENT';`);
      await catalog.publish('rvp-flow', v2, 'release', null);
      expect(v2).not.toBe(v1);

      await runManager.resume(runId);
      const finalView = await pollUntilSettled(runManager, runId);
      expect(finalView.status).toBe('completed');

      const outcome = await runManager.result(runId);
      expect(outcome.ok).toBe(true);
      if (outcome.ok) expect(outcome.value).toBe('V1:v1-agent-result'); // v1's script, NOT v2's

      // The pin is asserted literally (v22 Rule 1) — the run reports the version it ACTUALLY ran,
      // not "some version that isn't v2".
      expect((finalView as unknown as { scriptVersion: string }).scriptVersion).toBe(v1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 20000);

  it('workflow_status keeps reporting the pinned version after a THIRD version is registered (REQ-096)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-it086b-'));
    try {
      const catalog = new WorkflowCatalog(join(dir, 'catalog'), CLOCK);
      const store = new SqliteRunStore(join(dir, 'store'), CLOCK);
      const runManager = new RunManager({ store, clock: CLOCK, workRoot: dir, catalog });

      const { version: v1 } = await catalog.register('rvp-third', `return 'one';`);
      await catalog.publish('rvp-third', v1, 'release', null);
      const runId = await runManager.start({ name: 'rvp-third' });
      const settled = await pollUntilSettled(runManager, runId);
      expect(settled.status).toBe('completed');

      const { version: v2 } = await catalog.register('rvp-third', `return 'two';`);
      await catalog.publish('rvp-third', v2, 'release', null);
      const { version: v3 } = await catalog.register('rvp-third', `return 'three';`);
      await catalog.publish('rvp-third', v3, 'release', null);
      expect([v1, v2, v3]).toEqual(['v1', 'v2', 'v3']);

      const stillView = await runManager.status(runId);
      expect((stillView as unknown as { scriptVersion: string }).scriptVersion).toBe('v1'); // literal, not "not v3"
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('RunManager.start(spec) with spec.script set refuses INLINE_SCRIPT_CLOSED even off the wire (REQ-098 ingress ban)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-it086c-'));
    try {
      const catalog = new WorkflowCatalog(join(dir, 'catalog'), CLOCK);
      const runManager = new RunManager({ store: new SqliteRunStore(join(dir, 'store'), CLOCK), clock: CLOCK, workRoot: dir, catalog });
      await expect(runManager.start({ script: `return 1;` })).rejects.toMatchObject({ code: 'INLINE_SCRIPT_CLOSED' });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('legacy-cohort fallback: a run whose pin is absent from workflow_versions resumes via `release` (DES-113, IT-086)', () => {
  it('resolves through `release`, records legacySubstitution, and does not crash', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-it086d-'));
    try {
      const catalog = new WorkflowCatalog(join(dir, 'catalog'), CLOCK);
      const store = new SqliteRunStore(join(dir, 'store'), CLOCK);
      const runManager = new RunManager({ store, clock: CLOCK, workRoot: dir, catalog });

      const { version } = await catalog.register('legacy-cohort-flow', `return 'release-script';`);
      await catalog.publish('legacy-cohort-flow', version, 'release', null);

      // Hand-seed a run whose pin ('v-gone') was never a real workflow_versions row (DES-109's own
      // fixture rule: hand-written, never produced by the code under test) and whose status is
      // `suspended` so resume() is legal — models a run created before a deregister/re-register
      // restarted the name's version lineage.
      const runId = await store.createRun({ name: 'legacy-cohort-flow', args: undefined }, 'v-gone');
      const raw = new Database(join(dir, 'store', 'index.db'));
      raw.prepare('UPDATE runs SET status = ? WHERE runId = ?').run('suspended', runId);
      raw.close();

      await runManager.resume(runId);
      const finalView = await pollUntilSettled(runManager, runId);
      expect(finalView.status).toBe('completed');
      const outcome = await runManager.result(runId);
      expect(outcome.ok).toBe(true);
      if (outcome.ok) expect(outcome.value).toBe('release-script');

      const legacySub = (finalView as unknown as { legacySubstitution?: { pinned: string; resolved: string } }).legacySubstitution;
      expect(legacySub).toEqual({ pinned: 'v-gone', resolved: version });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 20000);
});
