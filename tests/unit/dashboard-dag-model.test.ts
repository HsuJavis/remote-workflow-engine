// v8 Slice 3 — buildDagModel reconstructs a run's call tree (REQ-048). TEST-FIRST (RED).
//
// The dashboard renders a run's DAG from its RunStatusView (Slice-2 frame-tagged agents +
// workflowNodes). buildDagModel is the PURE reconstruction: group agents by frame, nest composite
// frames by parentFrame — so the page (and the /api/runs/:id/dag endpoint) share one tested model.
import { describe, it, expect } from 'vitest';
import { buildDagModel } from '../../src/dashboard.js';
import type { RunStatusView } from '../../src/types.js';

function agent(agentId: string, label: string, frame: string, state: RunStatusView['agents'][number]['state'], model: string) {
  return { agentId, label, frame, state, provider: 'p', model, tokens: { input: 1, output: 2 } };
}

const NESTED: RunStatusView = {
  runId: 'r1', status: 'completed', phases: [], scriptVersion: 'v1',
  agents: [
    agent('a1', 'T', '', 'done', 'm-T'),
    agent('a2', 'M', '.0', 'running', 'm-M'),
    agent('a3', 'L', '.0.0', 'queued', 'm-L'),
  ],
  workflowNodes: [
    { frame: '.0', name: 'mid', parentFrame: '', depth: 1 },
    { frame: '.0.0', name: 'leaf', parentFrame: '.0', depth: 2 },
  ],
};

describe('buildDagModel — call-tree reconstruction (v8 Slice 3, REQ-048)', () => {
  it('nests composite frames by parentFrame and groups agents by frame', () => {
    const root = buildDagModel(NESTED);

    // ROOT holds the top-level agent(s) + one child per top-level workflowNode.
    expect(root.agents.map((a) => a.label)).toEqual(['T']);
    expect(root.agents[0]).toMatchObject({ agentId: 'a1', state: 'done', model: 'm-T' });
    expect(root.children.length).toBe(1);

    // mid (depth 1) — its own agent + the leaf child.
    const mid = root.children[0]!;
    expect(mid).toMatchObject({ frame: '.0', name: 'mid', depth: 1 });
    expect(mid.agents.map((a) => a.label)).toEqual(['M']);
    expect(mid.agents[0]!.state).toBe('running');
    expect(mid.children.length).toBe(1);

    // leaf (depth 2) — its own agent, no further children.
    const leaf = mid.children[0]!;
    expect(leaf).toMatchObject({ frame: '.0.0', name: 'leaf', depth: 2 });
    expect(leaf.agents.map((a) => a.label)).toEqual(['L']);
    expect(leaf.agents[0]!.state).toBe('queued');
    expect(leaf.children.length).toBe(0);
  });

  it('a diamond (two top-level workflowNodes) yields two root children; no agent is dropped', () => {
    const diamond: RunStatusView = {
      runId: 'r2', status: 'completed', phases: [], scriptVersion: 'v1',
      agents: [agent('d1', 'D1', '.0', 'done', 'm'), agent('d2', 'D2', '.1', 'done', 'm')],
      workflowNodes: [
        { frame: '.0', name: 'd', parentFrame: '', depth: 1 },
        { frame: '.1', name: 'd', parentFrame: '', depth: 1 },
      ],
    };
    const root = buildDagModel(diamond);
    expect(root.children.length).toBe(2);
    expect(root.children.map((c) => c.frame).sort()).toEqual(['.0', '.1']);

    // every agent in the input appears exactly once somewhere in the tree.
    const count = (n: ReturnType<typeof buildDagModel>): number => n.agents.length + n.children.reduce((s, c) => s + count(c), 0);
    expect(count(root)).toBe(2);
  });

  it('REQ-051 exposes per-agent timing + derived durationMs on the dag node', () => {
    const view: RunStatusView = {
      runId: 'r5', status: 'completed', phases: [], scriptVersion: 'v1', workflowNodes: [],
      agents: [
        { ...agent('t1', 'done-agent', '', 'done', 'm'), startedAt: '2024-01-01T00:00:00.000Z', endedAt: '2024-01-01T00:00:02.000Z' },
        { ...agent('t2', 'live-agent', '', 'running', 'm'), startedAt: '2024-01-01T00:00:05.000Z' }, // no endedAt
      ] as RunStatusView['agents'],
    };
    const root = buildDagModel(view);
    const done = root.agents.find((a) => a.label === 'done-agent')!;
    expect(done.startedAt).toBe('2024-01-01T00:00:00.000Z');
    expect(done.endedAt).toBe('2024-01-01T00:00:02.000Z');
    expect(done.durationMs).toBe(2000); // endedAt − startedAt
    const live = root.agents.find((a) => a.label === 'live-agent')!;
    expect(live.startedAt).toBe('2024-01-01T00:00:05.000Z');
    expect(live.durationMs).toBeUndefined(); // unfinished → no duration
  });

  it('is pure + total: an empty run yields a bare root, an unknown-frame agent is not dropped', () => {
    const empty = buildDagModel({ runId: 'r3', status: 'queued', phases: [], scriptVersion: 'v1', agents: [], workflowNodes: [] });
    expect(empty.agents).toEqual([]);
    expect(empty.children).toEqual([]);

    const orphan = buildDagModel({
      runId: 'r4', status: 'running', phases: [], scriptVersion: 'v1',
      agents: [agent('x', 'X', '.99', 'running', 'm')], // frame has no workflowNode
      workflowNodes: [],
    });
    const count = (n: ReturnType<typeof buildDagModel>): number => n.agents.length + n.children.reduce((s, c) => s + count(c), 0);
    expect(count(orphan)).toBe(1); // attached to root, never lost
  });
});
