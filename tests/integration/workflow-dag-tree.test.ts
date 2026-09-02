// v8 Slice 2 — call-tree + composite linkage (REQ-045..047). TEST-FIRST (RED).
//
// The dashboard renders a run's DAG (composites as sub-cards, click a node → its log). Slice 1 gave
// each nested workflow() call a deterministic frame path; Slice 2 SURFACES that structure:
//   REQ-045  every agent() record carries `frame` (root = "", a nested agent's frame has its parent
//            frame as a strict prefix) — so agents group + nest by frame with no other data.
//   REQ-046  every nested workflow(name) call is a `workflowNodes` entry {frame,name,parentFrame,depth}
//            — the composite linkage that makes sub-cards.
//   REQ-047  workflow_status returns BOTH, live, + each agentId drills to its transcript.
//
// Mock policy (integration tier): real RunManager + real on-disk WorkflowCatalog + real sandbox child
// processes/IPC/node:vm; only the GatewayClient is faked (so agent records/transcripts are produced
// via the real AgentExecutor sink, same seam as IT-019 / the Slice-1 budget case).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunManager } from '../../src/run-manager.js';
import { registerPublished, startScript } from '../helpers/workflow-fixtures.js';
import { WorkflowCatalog } from '../../src/workflow-catalog.js';
import { InMemoryRunStore } from '../../src/run-store.js';
import { FixedClock } from '../../src/clock.js';
import type { GatewayClient } from '../../src/gateway/client.js';

const CLOCK = new FixedClock(new Date('2024-01-01T00:00:00Z'));

function echoGateway(): GatewayClient {
  return {
    async invoke(req) {
      return { ok: true, provider: 'fake', model: `fake-${req.prompt}`, tokens: { input: 1, output: 1 }, content: req.prompt };
    },
  };
}

async function settled(mgr: RunManager, runId: string) {
  let v = await mgr.status(runId);
  for (let i = 0; i < 300 && (v.status === 'running' || v.status === 'queued'); i++) {
    await new Promise((r) => setTimeout(r, 25));
    v = await mgr.status(runId);
  }
  return v;
}

describe('call-tree + composite linkage (v8 Slice 2, REQ-045..047)', () => {
  let workRoot: string;
  beforeEach(() => { workRoot = mkdtempSync(join(tmpdir(), 'rwe-dag-')); });
  afterEach(() => { rmSync(workRoot, { recursive: true, force: true }); });

  it('REQ-045/046/047 tags agents with frames + records nested workflow() boundary nodes', async () => {
    const catalog = new WorkflowCatalog(workRoot, CLOCK);
    await registerPublished(catalog, 'leaf', `const l = await agent('do-L', { label: 'L' }); return l;`);
    await registerPublished(catalog, 'mid', `const m = await agent('do-M', { label: 'M' }); const x = await workflow('leaf', {}); return { m, x };`);
    const store = new InMemoryRunStore(CLOCK);
    const mgr = new RunManager({ store, clock: CLOCK, catalog, gateway: echoGateway(), maxWorkflowDepth: 3 });

    const runId = await startScript(mgr, `const t = await agent('do-T', { label: 'T' }); const w = await workflow('mid', {}); return { t, w };`);
    const view = await settled(mgr, runId);
    expect(view.status).toBe('completed');

    // REQ-045 — agents carry frames; root = "", nested frames strictly extend their parent.
    const byLabel = new Map((view.agents as Array<{ label?: string; frame?: string; agentId: string }>).map((a) => [a.label, a]));
    const T = byLabel.get('T')!, M = byLabel.get('M')!, L = byLabel.get('L')!;
    expect(T).toBeDefined(); expect(M).toBeDefined(); expect(L).toBeDefined();
    expect(T.frame).toBe('');                       // top-level → ROOT frame
    expect(M.frame).not.toBe('');                   // one level in
    expect(L.frame).not.toBe('');
    expect(L.frame!.startsWith(M.frame!)).toBe(true); // leaf frame descends mid frame …
    expect(L.frame).not.toBe(M.frame);                // … strictly.

    // REQ-046 — one workflowNodes entry per nested workflow() call, with the composite linkage.
    const nodes = (view as unknown as { workflowNodes: Array<{ frame: string; name: string; parentFrame: string; depth: number }> }).workflowNodes;
    expect(Array.isArray(nodes)).toBe(true);
    const midNode = nodes.find((n) => n.name === 'mid')!;
    const leafNode = nodes.find((n) => n.name === 'leaf')!;
    expect(midNode).toMatchObject({ parentFrame: '', depth: 1 });
    expect(midNode.frame).toBe(M.frame);            // node.frame == its inner agents' frame
    expect(leafNode).toMatchObject({ parentFrame: M.frame, depth: 2 });
    expect(leafNode.frame).toBe(L.frame);

    // REQ-047 — every agent node's agentId drills to its transcript (node → log).
    const evT = await store.getTranscript(runId, T.agentId);
    expect(evT.length).toBeGreaterThan(0);
    const evL = await store.getTranscript(runId, L.agentId);
    expect(evL.length).toBeGreaterThan(0);
  }, 20000);

  it('REQ-046 a diamond (same workflow called twice) yields two distinct boundary nodes', async () => {
    const catalog = new WorkflowCatalog(workRoot, CLOCK);
    await registerPublished(catalog, 'd', `const x = await agent('do-D', { label: 'D' }); return x;`);
    const store = new InMemoryRunStore(CLOCK);
    const mgr = new RunManager({ store, clock: CLOCK, catalog, gateway: echoGateway(), maxWorkflowDepth: 2 });

    const runId = await startScript(mgr, `const [a, b] = await parallel([() => workflow('d', {}), () => workflow('d', {})]); return a + b;`);
    const view = await settled(mgr, runId);
    expect(view.status).toBe('completed');

    const nodes = (view as unknown as { workflowNodes: Array<{ frame: string; name: string; parentFrame: string; depth: number }> }).workflowNodes;
    const dNodes = nodes.filter((n) => n.name === 'd');
    expect(dNodes.length).toBe(2);                            // two independent invocations …
    expect(new Set(dNodes.map((n) => n.frame)).size).toBe(2); // … with distinct frames.
    for (const n of dNodes) expect(n).toMatchObject({ parentFrame: '', depth: 1 });
  }, 20000);
});
