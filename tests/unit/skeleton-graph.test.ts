// UT-173 (DES-174, ARCH-113, TASK-185, v26): `deriveExpectedGraph(nodes, scan) → {ok, ...}` — the
// ONE pure derivation consumed by both the registration checker (DES-184) and the run-DAG layout
// (DES-176). Every fixture in the shared corpus (tests/fixtures/expected-graph-fixtures.ts) must
// produce its literal expected graph; the function must NEVER throw for any input. Written
// test-first (Gate 5, RED): `src/skeleton-graph.ts` does not exist yet — whole-file import failure.
// Mock policy (unit): pure function, no I/O — real parseWorkflowSkeleton + scanAgentCalls feed it,
// hand-written expected literals from the shared fixture corpus are the oracle.
import { describe, it, expect } from 'vitest';
import { deriveExpectedGraph } from '../../src/skeleton-graph.js';
import { parseWorkflowSkeleton } from '../../src/workflow-meta.js';
import { scanAgentCalls } from '../../src/workflow-meta.js';
import { GRAPH_FIXTURES } from '../fixtures/expected-graph-fixtures.js';

describe('deriveExpectedGraph — total, discriminated, one derivation (UT-173, DES-174)', () => {
  it.each(GRAPH_FIXTURES)('produces the literal expected graph: $name', ({ script, expected }) => {
    const nodes = parseWorkflowSkeleton(script);
    const scan = scanAgentCalls(script);
    const result = deriveExpectedGraph(nodes as any, scan as any);
    expect(result).toEqual(expected);
  });

  it('never throws on null input', () => {
    expect(() => deriveExpectedGraph(null as any, null as any)).not.toThrow();
  });

  it('never throws on an empty script', () => {
    const nodes = parseWorkflowSkeleton('');
    const scan = scanAgentCalls('');
    expect(() => deriveExpectedGraph(nodes as any, scan as any)).not.toThrow();
  });

  it('never throws on a truncated/garbage scan shape', () => {
    expect(() => deriveExpectedGraph([{ kind: 'phase', title: 'x' }] as any, { labels: [], calls: [], violations: [] } as any)).not.toThrow();
  });

  it('an agent() before the first phase() returns the AGENT_BEFORE_PHASE refusal with a line', () => {
    const script = `agent('a', { prompt: 'p' });\nphase('one');`;
    const nodes = parseWorkflowSkeleton(script);
    const scan = scanAgentCalls(script);
    const result = deriveExpectedGraph(nodes as any, scan as any) as any;
    expect(result.ok).toBe(false);
    expect(result.rule).toBe('AGENT_BEFORE_PHASE');
    expect(typeof result.line).toBe('number');
  });
});
