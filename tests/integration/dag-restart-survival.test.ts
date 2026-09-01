// v8 Slice 2c — a terminated run's DAG (frames, phases, per-agent detail) survives a restart (REQ-055).
// TEST-FIRST (RED).
//
// Today after a restart, SqliteRunStore.getRun returns phases:[]/workflowNodes:[] and deriveAgentRecords
// recovers agents from the `usage` transcript event WITHOUT label/phase/frame/timing — so a completed
// composite run's nested DAG flattens (composite groups gone, agents lose their frame). This pins the
// fix: persist a one-shot snapshot of {phases, agents, workflowNodes} at the authoritative terminal
// transition, read back by getRun after a restart.
//
// Mock policy (integration tier, mirrors IT-020 agent-records-restart-survival): real RunManager + real
// on-disk SqliteRunStore + real WorkflowCatalog + real sandbox child; only the GatewayClient faked. The
// "restart" is fresh instances on the SAME data dir.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FixedClock } from '../../src/clock.js';
import { RunManager } from '../../src/run-manager.js';
import { registerPublished, startScript } from '../helpers/workflow-fixtures.js';
import { SqliteRunStore } from '../../src/store/sqlite-run-store.js';
import { WorkflowCatalog } from '../../src/workflow-catalog.js';
import { buildDagModel } from '../../src/dashboard.js';
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

describe("a terminated run's DAG survives a restart (v8 Slice 2c, REQ-055)", () => {
  it('rebuilds the SAME nested tree (phases, workflowNodes, agent frames) after a restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-dag-restart-'));
    try {
      // --- before restart ---
      const store1 = new SqliteRunStore(join(dir, 'store'), CLOCK);
      const catalog1 = new WorkflowCatalog(join(dir, 'wf'), CLOCK);
      await registerPublished(catalog1, 'leaf', `const l = await agent('do-L', { label: 'L' }); return l;`);
      await registerPublished(catalog1, 'mid', `const m = await agent('do-M', { label: 'M' }); const x = await workflow('leaf', {}); return { m, x };`);
      const mgr1 = new RunManager({ store: store1, clock: CLOCK, workRoot: dir, catalog: catalog1, gateway, maxWorkflowDepth: 3 });

      const runId = await startScript(mgr1, `phase('top'); const t = await agent('do-T', { label: 'T' }); const w = await workflow('mid', {}); return { t, w };`);
      const before = await settled(mgr1, runId);
      expect(before.status).toBe('completed');
      // In-process the DAG is rich (Slice 2/2b): frames + phases present.
      const beforeTree = buildDagModel(before);
      expect(beforeTree.children.length).toBe(1);          // mid composite group
      expect(beforeTree.children[0]!.children.length).toBe(1); // leaf nested under mid
      expect(before.phases.map((p) => p.title)).toEqual(['top']);

      // --- restart: fresh instances on the SAME data dir ---
      const store2 = new SqliteRunStore(join(dir, 'store'), CLOCK);
      await store2.hydrateAll();
      const mgr2 = new RunManager({ store: store2, clock: CLOCK, workRoot: dir, catalog: new WorkflowCatalog(join(dir, 'wf'), CLOCK), gateway });

      const after = await mgr2.status(runId);
      expect(after.status).toBe('completed'); // run status already survives today

      // RED today: after restart phases:[]/workflowNodes:[] and agents lose frame → tree flattens.
      expect(after.phases.map((p) => p.title)).toEqual(['top']);            // phases persisted
      expect(after.workflowNodes.map((n) => n.name).sort()).toEqual(['leaf', 'mid']); // composite boundaries persisted
      const afterTree = buildDagModel(after);
      expect(afterTree.children.length).toBe(1);           // mid composite group survives
      expect(afterTree.children[0]!.name).toBe('mid');
      expect(afterTree.children[0]!.children.length).toBe(1); // leaf still nested under mid
      expect(afterTree.children[0]!.children[0]!.name).toBe('leaf');

      // per-agent detail: labels + frames reconstructed (not just tokens).
      const labels = after.agents.map((a) => a.label).filter(Boolean).sort();
      expect(labels).toEqual(['L', 'M', 'T']);
      const L = after.agents.find((a) => a.label === 'L')!;
      const M = after.agents.find((a) => a.label === 'M')!;
      expect(M.frame).not.toBe('');
      expect(L.frame!.startsWith(M.frame!)).toBe(true);     // nested frame relationship survives
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30000);

  it('backward-compatible: a run with no snapshot reconstructs at least as well as today (no crash)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-dag-bc-'));
    try {
      const store = new SqliteRunStore(join(dir, 'store'), CLOCK);
      const mgr = new RunManager({ store, clock: CLOCK, workRoot: dir, gateway });
      const runId = await startScript(mgr, `return 1;`); // no agents, no phases, no composites
      const v = await settled(mgr, runId);
      expect(v.status).toBe('completed');
      // A fresh store on the same dir: getRun must not throw and returns arrays (possibly empty).
      const store2 = new SqliteRunStore(join(dir, 'store'), CLOCK);
      await store2.hydrateAll();
      const after = await store2.getRun(runId);
      expect(after).not.toBeNull();
      expect(Array.isArray(after!.phases)).toBe(true);
      expect(Array.isArray(after!.workflowNodes)).toBe(true);
      expect(Array.isArray(after!.agents)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20000);
});
