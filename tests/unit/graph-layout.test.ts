// UT-068: pure `layoutGraph` topology — the master UT seam (DES-064, ARCH-042, TASK-067)
//
// `layoutGraph` is a PURE function (no DOM, no browser, no side effects). v26 (DES-176, ARCH-114,
// TASK-187) changed its INPUT, not one of its properties:
//   was:  layoutGraph(skeletonNodes, liveAgents, opts?)
//   now:  layoutGraph(expected: ExpectedGraph, liveAgents, phases: PhaseView[], opts?)
// The lane join is by ORDINAL (`record.phaseIndex`, else `inferPhase(record, phases)`), never by
// re-matching the phase-title string — which is why 100% of pre-v26 runs were frame-grouped. Every
// case below keeps the property it always pinned; only the fixture it states the predicted topology
// in has moved from `SkeletonNode[]` to a hand-written `ExpectedGraph`. Hand-written on purpose:
// UT-068 is the LAYOUT's unit test and must stay independent of `deriveExpectedGraph`, which has
// its own (UT-173, tests/unit/skeleton-graph.test.ts).
//
// Boundary conditions from DES-064 (unchanged):
//   - Lane→parallel-slot→ordered-set join (tie-order by startedAt); same label+different startedAt → TWO cells
//   - Unmatched live agent (dynamic/conditional) → frame-grouped fallback + warnings[] entry (never dropped)
//   - Unmatched predicted slot → renders inert (predicted, not-yet-run)
//   - Empty run → trigger node only
//   - MaxNodes=200 cap → truncated:true + warning entry; never throws
//   - Node ids are STABLE across re-layout of a grown topology (same node → same id on each call)
//   - `cells` carry logical {col,row,laneSpan} — never pixel coordinates
//   - `edges` connect cells in lane order
//
// Mock policy (unit): pure function, no I/O, no seams needed.
import { describe, it, expect } from 'vitest';
import { layoutGraph } from '../../src/dashboard.js';
import type { ExpectedGraph, ExpectedSlot } from '../../src/skeleton-graph.js';
import type { AgentRecord } from '../../src/types.js';

const EMPTY_GRAPH: ExpectedGraph = { lanes: [], slots: [], edges: [] };
const NO_PHASES: never[] = [];

function slot(index: number, lane: number, labels: string[], kind: ExpectedSlot['kind'] = 'single'): ExpectedSlot {
  return { index, lane, labels, kind, tools: {} };
}

/** One static lane holding the given slots, in slot-index order. */
function oneLane(title: string | null, slots: ExpectedSlot[]): ExpectedGraph {
  return {
    lanes: [{ index: 0, title, dynamic: false, slots: slots.map((s) => s.index) }],
    slots,
    edges: [],
  };
}

function agent(agentId: string, label: string, phase: string, startedAt?: string, phaseIndex = 0): AgentRecord {
  return { agentId, label, phase, phaseIndex, state: 'done', provider: 'p', model: 'm', tokens: { input: 1, output: 1 }, startedAt };
}

describe('layoutGraph — pure topology (UT-068, DES-064)', () => {
  it('empty run → produces a trigger cell only, no edges', () => {
    const result = layoutGraph(EMPTY_GRAPH, [], NO_PHASES, { startedByType: 'client' });
    expect(result.cells.length).toBe(1);
    expect(result.cells[0]!.kind).toBe('trigger');
    expect(result.edges.length).toBe(0);
    expect(result.warnings).toEqual([]);
  });

  it('lane→parallel-slot join: two same-label agents in the same parallel slot → TWO cells (not collapsed)', () => {
    // This is the critical case: a label+phase lookup WOULD collapse them to 1. Ordered-set join keeps both.
    const expected = oneLane('Draft', [slot(0, 0, ['draft'], 'parallel')]);
    const agents: AgentRecord[] = [
      agent('a1', 'draft', 'Draft', '2024-01-01T00:00:01Z'),
      agent('a2', 'draft', 'Draft', '2024-01-01T00:00:02Z'), // same label, later startedAt
    ];
    const result = layoutGraph(expected, agents, NO_PHASES, { startedByType: 'client' });
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
    // A lane the analysis predicted, with NO slot the runtime label can match.
    const expected = oneLane('A', []);
    const liveAgents: AgentRecord[] = [
      agent('dyn-1', 'loop-iteration', 'A', '2024-01-01T00:00:00Z'),
    ];
    const result = layoutGraph(expected, liveAgents, NO_PHASES, { startedByType: 'client' });
    // The agent MUST appear in cells — never silently dropped.
    const cellIds = result.cells.filter((c) => c.kind === 'agent').map((c) => c.agentId);
    expect(cellIds).toContain('dyn-1');
    // A warning entry must name the unmatched agent.
    expect(result.warnings.some((w) => w.includes('dyn-1') || w.includes('unmatched'))).toBe(true);
  });

  it('unmatched predicted slot (predicted, not yet run) → inert cell, no agent data', () => {
    // predicted but no live agent dispatched yet
    const expected = oneLane('Draft', [slot(0, 0, ['draft'])]);
    const result = layoutGraph(expected, [], NO_PHASES, { startedByType: 'client' });
    const agentCells = result.cells.filter((c) => c.kind === 'agent');
    // The inert cell exists (skeleton node rendered) but carries no agentId/state
    expect(agentCells.length).toBe(1);
    expect(agentCells[0]!.agentId).toBeUndefined();
  });

  it('maxNodes cap → truncated:true and a warnings[] entry when cell count exceeds 200', () => {
    // Build 205 predicted slots in one lane (past the cap).
    const expected = oneLane('P', Array.from({ length: 205 }, (_, i) => slot(i, 0, [`s${i}`])));
    const result = layoutGraph(expected, [], NO_PHASES, { startedByType: 'client', maxNodes: 200 });
    expect(result.truncated).toBe(true);
    expect(result.warnings.some((w) => w.includes('truncated') || w.includes('200'))).toBe(true);
    // Cell count must not exceed the cap.
    expect(result.cells.length).toBeLessThanOrEqual(201); // cap + possibly trigger
  });

  it('node ids are stable: re-running layoutGraph on identical input gives identical cell ids', () => {
    const expected = oneLane('P', [slot(0, 0, ['draft'], 'parallel')]);
    const agents: AgentRecord[] = [
      agent('x', 'draft', 'P', '2024-01-01T00:00:00Z'),
      agent('y', 'draft', 'P', '2024-01-01T00:00:01Z'),
    ];
    const r1 = layoutGraph(expected, agents, NO_PHASES, { startedByType: 'client' });
    const r2 = layoutGraph(expected, agents, NO_PHASES, { startedByType: 'client' });
    expect(r1.cells.map((c) => c.id)).toEqual(r2.cells.map((c) => c.id));
  });

  it('cells carry logical {col,row,laneSpan} — no pixel coordinates', () => {
    const expected = oneLane(null, [slot(0, 0, ['single'])]);
    const agents: AgentRecord[] = [agent('a1', 'single', '', '2024-01-01T00:00:00Z')];
    const result = layoutGraph(expected, agents, NO_PHASES, { startedByType: 'client' });
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
    expect(() => layoutGraph(EMPTY_GRAPH, [], NO_PHASES, {})).not.toThrow();
    // Deliberately NOT an ExpectedGraph: the function's own totality guard (`Array.isArray(
    // expected?.lanes) ? … : []`) is what a dashboard read path depends on to never 500, so the
    // wrong-shaped input is the point of this case, not an oversight.
    expect(() => layoutGraph([] as unknown as ExpectedGraph, [], NO_PHASES, {})).not.toThrow();
    expect(() => layoutGraph(undefined as unknown as ExpectedGraph, [], undefined as unknown as never[], { startedByType: 'unknown' })).not.toThrow();
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
    const expected = oneLane('A', []);
    const liveAgents: AgentRecord[] = [
      agent('dyn-1', 'loop-iteration', 'A', '2024-01-01T00:00:00Z'),
    ];
    const result = layoutGraph(expected, liveAgents, NO_PHASES, { startedByType: 'client' });
    expect(result.warnings.some((w) => w.toLowerCase().includes('skeleton'))).toBe(false);
  });
});
