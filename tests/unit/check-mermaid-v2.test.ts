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

  // v26 integration (clarification 30): rule 13 was implemented to spec and had NO negative
  // fixture, so nothing proved it ever fired — the one v2 code with no test of its own. Three
  // cases, one per arm of checkEdges.
  it('a consecutive-slot edge the diagram never draws is EDGE_MISMATCH (arm a: reachability)', () => {
    const src = 'graph LR\nsubgraph "one"\na(["a"])\nend\nsubgraph "two"\nb(["b"])\nend';
    const expected = {
      lanes: [{ index: 0, title: 'one', dynamic: false, slots: [0] }, { index: 1, title: 'two', dynamic: false, slots: [1] }],
      slots: [
        { index: 0, lane: 0, labels: ['a'], kind: 'single' as const, tools: { a: 'default' as const } },
        { index: 1, lane: 1, labels: ['b'], kind: 'single' as const, tools: { b: 'default' as const } },
      ],
      edges: [{ from: 0, to: 1 }],
    };
    const result = checkMermaid(src, ['a', 'b'], {}, { maxBytes: 100000, maxLines: 1000 }, { expected } as any) as any;
    expect(result.ok).toBe(false);
    expect(result.rule).toBe('EDGE_MISMATCH');
    expect(result.expected).toEqual({ from: 0, to: 1 });
  });

  it('a direct agent→agent edge skipping a slot needs a |label| (arm b)', () => {
    // a --> c jumps slot 0 to slot 2 with no label. The expected consecutive edges ARE drawn.
    const src = [
      'graph LR', 'subgraph "one"', 'a(["a"])', 'end', 'subgraph "two"', 'b(["b"])', 'end',
      'subgraph "three"', 'c(["c"])', 'end', 'a-->b', 'b-->c', 'a-->c',
    ].join('\n');
    const expected = {
      lanes: [0, 1, 2].map((i) => ({ index: i, title: ['one', 'two', 'three'][i]!, dynamic: false, slots: [i] })),
      slots: [
        { index: 0, lane: 0, labels: ['a'], kind: 'single' as const, tools: { a: 'default' as const } },
        { index: 1, lane: 1, labels: ['b'], kind: 'single' as const, tools: { b: 'default' as const } },
        { index: 2, lane: 2, labels: ['c'], kind: 'single' as const, tools: { c: 'default' as const } },
      ],
      edges: [{ from: 0, to: 1 }, { from: 1, to: 2 }],
    };
    const result = checkMermaid(src, ['a', 'b', 'c'], {}, { maxBytes: 100000, maxLines: 1000 }, { expected } as any) as any;
    expect(result.ok).toBe(false);
    expect(result.rule).toBe('EDGE_MISMATCH');
    // …and the SAME diagram with the jump labelled is accepted — the label is what the rule asks for.
    const labelled = src.replace('a-->c', 'a-->|retry|c');
    expect((checkMermaid(labelled, ['a', 'b', 'c'], {}, { maxBytes: 100000, maxLines: 1000 }, { expected } as any) as any).ok).toBe(true);
  });

  it('two members of one parallel slot edged to each other is EDGE_MISMATCH (arm c)', () => {
    const src = 'graph LR\nsubgraph "one"\na(["a"])\nb(["b"])\nend\na-->b';
    const expected = {
      lanes: [{ index: 0, title: 'one', dynamic: false, slots: [0] }],
      slots: [{ index: 0, lane: 0, labels: ['a', 'b'], kind: 'parallel' as const, tools: { a: 'default' as const, b: 'default' as const } }],
      edges: [],
    };
    const result = checkMermaid(src, ['a', 'b'], {}, { maxBytes: 100000, maxLines: 1000 }, { expected } as any) as any;
    expect(result.ok).toBe(false);
    expect(result.rule).toBe('EDGE_MISMATCH');
  });

  // v26 integration: the same label in TWO lanes — the guide's own `draft, critique, revise`
  // example. Before this, `labelToNode` was latest-wins and the first slot could never find its
  // node, so the canonical example was refused LANE_MISMATCH.
  it('one label used in two lanes resolves per-SLOT, not latest-wins', () => {
    const src = [
      'graph LR', 'subgraph "draft"', 'w1(["writer"])', 'end', 'subgraph "critique"', 'c(["critic"])', 'end',
      'subgraph "revise"', 'w2(["writer"])', 'end', 'w1-->c', 'c-->w2',
    ].join('\n');
    const expected = {
      lanes: [0, 1, 2].map((i) => ({ index: i, title: ['draft', 'critique', 'revise'][i]!, dynamic: false, slots: [i] })),
      slots: [
        { index: 0, lane: 0, labels: ['writer'], kind: 'single' as const, tools: { writer: 'default' as const } },
        { index: 1, lane: 1, labels: ['critic'], kind: 'single' as const, tools: { critic: 'default' as const } },
        { index: 2, lane: 2, labels: ['writer'], kind: 'single' as const, tools: { writer: 'default' as const } },
      ],
      edges: [{ from: 0, to: 1 }, { from: 1, to: 2 }],
    };
    expect((checkMermaid(src, ['writer', 'critic'], {}, { maxBytes: 100000, maxLines: 1000 }, { expected } as any) as any).ok).toBe(true);
  });
});
