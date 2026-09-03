// UT-068: pure `layoutGraph` topology — the master UT seam (DES-064, ARCH-042, TASK-067)
//
// `layoutGraph` is a PURE function (no DOM, no browser, no side effects):
//   layoutGraph(skeletonNodes, liveAgents, opts?) → { cells:LayoutCell[]; edges:LayoutEdge[]; warnings:string[]; truncated? }
//
// Boundary conditions from DES-064:
//   - Phase→parallel-group→ordered-set join (tie-order by startedAt); same label+different startedAt → TWO cells
//   - Unmatched live agent (dynamic/conditional) → frame-grouped fallback + warnings[] entry (never dropped)
//   - Unmatched skeleton node → renders inert (predicted, not-yet-run)
//   - Empty run → trigger node only
//   - MaxNodes=200 cap → truncated:true + warning entry; never throws
//   - Node ids are STABLE across re-layout of a grown topology (same node → same id on each call)
//   - `cells` carry logical {col,row,laneSpan} — never pixel coordinates
//   - `edges` connect cells in phase→group→nesting order
//
// Mock policy (unit): pure function, no I/O, no seams needed.
// Red reason: `layoutGraph` is not yet exported from `src/dashboard.ts`
//   → ESM SyntaxError "does not provide an export named 'layoutGraph'" at collect time.
import { describe, it, expect } from 'vitest';
import { layoutGraph } from '../../src/dashboard.js';
import type { SkeletonNode } from '../../src/workflow-meta.js';
import type { AgentRecord } from '../../src/types.js';

function agent(agentId: string, label: string, phase: string, startedAt?: string): AgentRecord {
  return { agentId, label, phase, state: 'done', provider: 'p', model: 'm', tokens: { input: 1, output: 1 }, startedAt };
}

describe('layoutGraph — pure topology (UT-068, DES-064)', () => {
  it('empty run → produces a trigger cell only, no edges', () => {
    const result = layoutGraph([], [], { startedByType: 'client' });
    expect(result.cells.length).toBe(1);
    expect(result.cells[0]!.kind).toBe('trigger');
    expect(result.edges.length).toBe(0);
    expect(result.warnings).toEqual([]);
  });

  it('phase→parallel-group join: two same-label agents in the same parallel group → TWO cells (not collapsed)', () => {
    // This is the critical case: a label+phase lookup WOULD collapse them to 1. Ordered-set join keeps both.
    const skeleton: SkeletonNode[] = [
      { kind: 'phase', title: 'Draft' },
      { kind: 'agent', parallel: 1 }, // parallel group 1
      { kind: 'agent', parallel: 1 }, // parallel group 1 — same group, two positions
    ];
    const agents: AgentRecord[] = [
      agent('a1', 'draft', 'Draft', '2024-01-01T00:00:01Z'),
      agent('a2', 'draft', 'Draft', '2024-01-01T00:00:02Z'), // same label, later startedAt
    ];
    const result = layoutGraph(skeleton, agents, { startedByType: 'client' });
    const agentCells = result.cells.filter((c) => c.kind === 'agent');
    // MUST have 2 agent cells — never collapse two parallel agents into one
    expect(agentCells.length).toBe(2);
    // The two cells must occupy different rows (laned side by side)
    const rows = agentCells.map((c) => c.row);
    expect(rows[0]).not.toBe(rows[1]);
    // Both reference distinct agent ids
    expect(new Set(agentCells.map((c) => c.agentId)).size).toBe(2);
  });

  it('unmatched live agent (not in skeleton) → frame-grouped cell + warnings entry; never dropped', () => {
    // An agent that appeared at runtime but whose call was dynamic/conditional (skeleton missed it).
    const skeleton: SkeletonNode[] = [{ kind: 'phase', title: 'A' }];
    const liveAgents: AgentRecord[] = [
      agent('dyn-1', 'loop-iteration', 'A', '2024-01-01T00:00:00Z'),
    ];
    const result = layoutGraph(skeleton, liveAgents, { startedByType: 'client' });
    // The agent MUST appear in cells — never silently dropped.
    const cellIds = result.cells.filter((c) => c.kind === 'agent').map((c) => c.agentId);
    expect(cellIds).toContain('dyn-1');
    // A warning entry must name the unmatched agent.
    expect(result.warnings.some((w) => w.includes('dyn-1') || w.includes('unmatched'))).toBe(true);
  });

  it('unmatched skeleton node (predicted, not yet run) → inert cell, no agent data', () => {
    const skeleton: SkeletonNode[] = [
      { kind: 'phase', title: 'Draft' },
      { kind: 'agent' }, // predicted but no live agent dispatched yet
    ];
    const result = layoutGraph(skeleton, [], { startedByType: 'client' });
    const agentCells = result.cells.filter((c) => c.kind === 'agent');
    // The inert cell exists (skeleton node rendered) but carries no agentId/state
    expect(agentCells.length).toBe(1);
    expect(agentCells[0]!.agentId).toBeUndefined();
  });

  it('maxNodes cap → truncated:true and a warnings[] entry when cell count exceeds 200', () => {
    // Build 205 skeleton agent nodes (past the cap).
    const skeleton: SkeletonNode[] = Array.from({ length: 205 }, () => ({ kind: 'agent' as const }));
    const result = layoutGraph(skeleton, [], { startedByType: 'client', maxNodes: 200 });
    expect(result.truncated).toBe(true);
    expect(result.warnings.some((w) => w.includes('truncated') || w.includes('200'))).toBe(true);
    // Cell count must not exceed the cap.
    expect(result.cells.length).toBeLessThanOrEqual(201); // cap + possibly trigger
  });

  it('node ids are stable: re-running layoutGraph on identical input gives identical cell ids', () => {
    const skeleton: SkeletonNode[] = [
      { kind: 'phase', title: 'P' },
      { kind: 'agent', parallel: 1 },
      { kind: 'agent', parallel: 1 },
    ];
    const agents: AgentRecord[] = [
      agent('x', 'draft', 'P', '2024-01-01T00:00:00Z'),
      agent('y', 'draft', 'P', '2024-01-01T00:00:01Z'),
    ];
    const r1 = layoutGraph(skeleton, agents, { startedByType: 'client' });
    const r2 = layoutGraph(skeleton, agents, { startedByType: 'client' });
    expect(r1.cells.map((c) => c.id)).toEqual(r2.cells.map((c) => c.id));
  });

  it('cells carry logical {col,row,laneSpan} — no pixel coordinates', () => {
    const skeleton: SkeletonNode[] = [{ kind: 'agent' }];
    const agents: AgentRecord[] = [agent('a1', 'single', '', '2024-01-01T00:00:00Z')];
    const result = layoutGraph(skeleton, agents, { startedByType: 'client' });
    const cell = result.cells.find((c) => c.kind === 'agent')!;
    // Must have logical grid coords
    expect(typeof cell.col).toBe('number');
    expect(typeof cell.row).toBe('number');
    expect(typeof cell.laneSpan).toBe('number');
    // Must NOT have pixel coords (no x/y/width/height from the old DagNode model)
    expect((cell as unknown as Record<string, unknown>).x).toBeUndefined();
    expect((cell as unknown as Record<string, unknown>).y).toBeUndefined();
  });

  it('is pure — never throws on garbage input', () => {
    expect(() => layoutGraph([], [], {})).not.toThrow();
    expect(() => layoutGraph([{ kind: 'phase' } as SkeletonNode], [], { startedByType: 'unknown' })).not.toThrow();
  });

  // UT-120 (v23 orchestrator adjudication #6, V-4 — REQ-105, DES-064): the retired 'skeleton'
  // concept must not reach a live client through ANY channel, not just source-grep-visible ones.
  // `layoutGraph`'s unmatched-agent warning is served verbatim on `GET /api/runs/:id/dag`
  // (server.ts:1242) and today literally reads `"agent <id> unmatched to skeleton: frame-grouped"`
  // (dashboard.ts:342) — a live client-facing string still names the deleted surface, which is
  // exactly REQ-105's own text: "no ... still tells a reader the skeleton is a surface available
  // to them". `dashboard.ts` is on the source-grep guard's internal-use allowlist (it is the
  // layout spine's positional consumer), so that guard does not — and must not be asked to — catch
  // a wording choice in a string it is allowed to contain the word for; this is a separate,
  // narrower pin on the actual live wire content.
  //
  // Red reason: verified by reading dashboard.ts:342 before writing this assertion — the warning
  // literal is `` `agent ${a.agentId} unmatched to skeleton: frame-grouped` ``.
  it('the unmatched-agent warning names the layout fallback, never the retired "skeleton" word (UT-120, DES-064, REQ-105)', () => {
    const skeleton: SkeletonNode[] = [{ kind: 'phase', title: 'A' }];
    const liveAgents: AgentRecord[] = [
      agent('dyn-1', 'loop-iteration', 'A', '2024-01-01T00:00:00Z'),
    ];
    const result = layoutGraph(skeleton, liveAgents, { startedByType: 'client' });
    expect(result.warnings.some((w) => w.toLowerCase().includes('skeleton'))).toBe(false);
  });
});
