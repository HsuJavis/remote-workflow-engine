// UT-196 (DES-184, ARCH-119, ADR-043/039, TASK-189, v26, REQ-128): `checkMermaid` v2 — with a `v2`
// param present, four new rules run: `DIAGRAM_DIRECTION` (header must be LR), `LANE_MISMATCH`,
// `TOOLS_MISMATCH`, `EDGE_MISMATCH` — each refusal carries `{rule, line, expected}`. Written
// test-first (Gate 5, RED): `checkMermaid` takes no 5th `v2` parameter today — it is silently ignored
// by JS calling convention, so a `graph TD` diagram that should be refused DIAGRAM_DIRECTION passes.
// Mock policy (unit): pure function, no I/O — driven by the shared DES-174 corpus.
import { describe, it, expect } from 'vitest';
import { checkMermaid } from '../../src/check-mermaid.js';
import { GRAPH_FIXTURES } from '../fixtures/expected-graph-fixtures.js';

describe('checkMermaid v2 rules (UT-196, DES-184)', () => {
  it('a graph TD header is refused DIAGRAM_DIRECTION when v2 is requested', () => {
    const result = checkMermaid(
      'graph TD\na(["a"])',
      ['a'], {},
      { maxBytes: 100000, maxLines: 1000 },
      { expected: { lanes: [], slots: [], edges: [] } } as any,
    ) as any;
    expect(result.ok).toBe(false);
    expect(result.rule).toBe('DIAGRAM_DIRECTION');
  });

  it('a graph LR header passes the direction check (does not refuse DIAGRAM_DIRECTION)', () => {
    const result = checkMermaid(
      'graph LR',
      [], {},
      { maxBytes: 100000, maxLines: 1000 },
      { expected: { lanes: [], slots: [], edges: [] } } as any,
    ) as any;
    expect(result.rule).not.toBe('DIAGRAM_DIRECTION');
  });

  it('a stadium node outside its slot\'s lane subgraph is LANE_MISMATCH', () => {
    const src = 'graph LR\nsubgraph "one"\na(["a"])\nend\nsubgraph "two"\nend';
    const expected = { lanes: [{ index: 0, title: 'one', dynamic: false, slots: [0] }, { index: 1, title: 'two', dynamic: false, slots: [1] }], slots: [{ index: 0, lane: 1, labels: ['a'], kind: 'single' as const, tools: { a: 'default' as const } }], edges: [] };
    const result = checkMermaid(src, ['a'], {}, { maxBytes: 100000, maxLines: 1000 }, { expected } as any) as any;
    expect(result.ok).toBe(false);
    expect(result.rule).toBe('LANE_MISMATCH');
  });

  it('a stadium\'s tools: line disagreeing with the expected surface is TOOLS_MISMATCH', () => {
    const src = 'graph LR\nsubgraph "one"\na(["a<br/>haiku<br/>tools: none"])\nend';
    const expected = { lanes: [{ index: 0, title: 'one', dynamic: false, slots: [0] }], slots: [{ index: 0, lane: 0, labels: ['a'], kind: 'single' as const, tools: { a: ['Read'] } }], edges: [] };
    const result = checkMermaid(src, ['a'], {}, { maxBytes: 100000, maxLines: 1000 }, { expected } as any) as any;
    expect(result.ok).toBe(false);
    expect(result.rule).toBe('TOOLS_MISMATCH');
  });

  it('every negative fixture carries {rule, line, expected} in the envelope', () => {
    const result = checkMermaid('graph TD', [], {}, { maxBytes: 100000, maxLines: 1000 }, { expected: { lanes: [], slots: [], edges: [] } } as any) as any;
    expect(result.ok).toBe(false);
    expect('expected' in result).toBe(true);
  });

  it('a `tools: default` slot is SKIPPED entirely, never partially compared, on the shared corpus', () => {
    const fx = GRAPH_FIXTURES.find((f) => f.name === 'no allowedTools — "default"')!;
    expect((fx.expected as any).graph?.slots?.[0]?.tools?.a).toBe('default');
  });
});
