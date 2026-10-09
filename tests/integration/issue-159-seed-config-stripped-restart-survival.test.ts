// issue #159 (5th reverification, reverify-3 defect "lost after an engine restart"):
// `seedConfigStripped` lives ONLY on the in-memory `RunEntry`, overlaid onto `RunStatusView` by
// `RunManager._mergeLive` (run-manager.ts) — never persisted anywhere. The authoring guide (and
// docs/AUTHORING.md:247) calls it "the ONLY place this shows up", with no restart caveat, and a
// production self-update restarts the engine often — so after one, a run that genuinely had a
// `.claude/settings.json`/hook stripped at seed time reports NOTHING, even though the strip itself
// (never writing the file to disk) is permanent and real.
//
// Fix target: the terminal `RunDagSnapshot` (run-store.ts) a getRun() already restores
// phases/agents/workflowNodes/usage from after a restart is the natural place for this — it is
// written once, at the SAME authoritative terminal transition `entry.seedConfigStripped` is set
// from (run-manager.ts, issue #159's original fix).
//
// Mock policy (integration, mirrors dag-restart-survival.test.ts): real RunManager + real on-disk
// SqliteRunStore + real WorkflowCatalog; only the GatewayClient faked (this run never calls agent()
// at all, so the fake is never even invoked) — "restart" is fresh instances on the SAME data dir.
//
// Red reason: run-store.ts's `RunDagSnapshot` has no `seedConfigStripped` field, and neither
// save-site in run-manager.ts (`_transition`'s terminal write, `_maybeRefoldLateUsage`'s late-settle
// write) includes it — `after.seedConfigStripped` is `undefined` post-restart even though it was
// `['.claude/settings.json']` before.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FixedClock } from '../../src/clock.js';
import { RunManager } from '../../src/run-manager.js';
import { startScript } from '../helpers/workflow-fixtures.js';
import { SqliteRunStore } from '../../src/store/sqlite-run-store.js';
import { WorkflowCatalog } from '../../src/workflow-catalog.js';
import type { GatewayClient } from '../../src/gateway/client.js';

const CLOCK = new FixedClock(new Date('2024-01-01T00:00:00Z'));
const gateway: GatewayClient = {
  invoke: async (req) => ({ ok: true, provider: 'fake', model: 'fake-model', tokens: { input: 1, output: 1 }, content: req.prompt }),
};

async function settled(mgr: RunManager, runId: string) {
  let v = await mgr.status(runId);
  for (let i = 0; i < 300 && (v.status === 'running' || v.status === 'queued'); i++) {
    await new Promise((r) => setTimeout(r, 25));
    v = await mgr.status(runId);
  }
  return v;
}

describe('issue #159: seedConfigStripped survives a restart (reverify-3)', () => {
  it('a run with a stripped seed path still reports seedConfigStripped via run_status after a restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-seedstrip-restart-'));
    try {
      const store1 = new SqliteRunStore(join(dir, 'store'), CLOCK);
      const catalog1 = new WorkflowCatalog(join(dir, 'wf'), CLOCK);
      const mgr1 = new RunManager({ store: store1, clock: CLOCK, workRoot: dir, catalog: catalog1, gateway });

      const runId = await startScript(mgr1, `return 'ok';`, {
        seed: [
          { path: '.claude/settings.json', contentB64: Buffer.from('{"hooks":{}}').toString('base64') },
          { path: 'real.txt', contentB64: Buffer.from('hello').toString('base64') },
        ],
      });
      const before = await settled(mgr1, runId);
      expect(before.status).toBe('completed');
      expect(before.seedConfigStripped).toEqual(['.claude/settings.json']);

      // --- restart: fresh instances on the SAME data dir ---
      const store2 = new SqliteRunStore(join(dir, 'store'), CLOCK);
      await store2.hydrateAll();
      const mgr2 = new RunManager({ store: store2, clock: CLOCK, workRoot: dir, catalog: new WorkflowCatalog(join(dir, 'wf'), CLOCK), gateway });

      const after = await mgr2.status(runId);
      expect(after.status).toBe('completed');
      // RED today: this is undefined post-restart.
      expect(after.seedConfigStripped).toEqual(['.claude/settings.json']);

      // The raw store read (what run_result's fallback view is built from) must carry it too.
      const rawView = await store2.getRun(runId);
      expect(rawView?.seedConfigStripped).toEqual(['.claude/settings.json']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20000);

  it('a run with nothing stripped still omits seedConfigStripped after a restart (never [])', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-seedstrip-restart-none-'));
    try {
      const store1 = new SqliteRunStore(join(dir, 'store'), CLOCK);
      const catalog1 = new WorkflowCatalog(join(dir, 'wf'), CLOCK);
      const mgr1 = new RunManager({ store: store1, clock: CLOCK, workRoot: dir, catalog: catalog1, gateway });
      const runId = await startScript(mgr1, `return 'ok';`, {
        seed: [{ path: 'real.txt', contentB64: Buffer.from('hello').toString('base64') }],
      });
      await settled(mgr1, runId);

      const store2 = new SqliteRunStore(join(dir, 'store'), CLOCK);
      await store2.hydrateAll();
      const mgr2 = new RunManager({ store: store2, clock: CLOCK, workRoot: dir, catalog: new WorkflowCatalog(join(dir, 'wf'), CLOCK), gateway });
      const after = await mgr2.status(runId);
      expect('seedConfigStripped' in after).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20000);
});
