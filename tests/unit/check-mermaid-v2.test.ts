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
    // issue #155 DOC: `expected` carries human-readable labels, not bare slot indices.
    expect(result.expected).toEqual({ from: { index: 0, labels: ['a'] }, to: { index: 1, labels: ['b'] } });
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
    // issue #155 DOC: `expected` carries human-readable labels, not bare slot indices.
    expect(result.expected).toEqual({ from: { index: 0, labels: ['a'] }, to: { index: 2, labels: ['c'] } });
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

  // issue #155 B1: if/else arms that each open their own phase() land in different lanes, so they
  // are two DIFFERENT slots sharing `altGroup` — rule (c) must refuse a direct edge between them the
  // same way it already refuses one between two labels of the SAME (same-lane) alt slot.
  describe('no direct edge between two arms of a split alt group (B1)', () => {
    // a non-agent diamond `d` between the anchor and both arms, as the authoring guide's own
    // "ternary/if→diamond with a labelled edge per arm" pattern does — a DIRECT a-->b/a-->c would
    // separately trip rule (b)'s non-consecutive-agent-edge-needs-a-label check.
    const src = (extra: string) =>
      [
        'graph LR', 'subgraph "p1"', 'a(["a"])', 'd{"branch"}', 'end',
        'subgraph "hot"', 'b(["b"])', 'end', 'subgraph "cold"', 'c(["c"])', 'end',
        'a-->d', 'd-->|hot|b', 'd-->|cold|c', extra,
      ].filter(Boolean).join('\n');
    const expected = {
      lanes: [
        { index: 0, title: 'p1', dynamic: false, slots: [0] },
        { index: 1, title: 'hot', dynamic: false, slots: [1] },
        { index: 2, title: 'cold', dynamic: false, slots: [2] },
      ],
      slots: [
        { index: 0, lane: 0, labels: ['a'], kind: 'single' as const, tools: { a: 'default' as const } },
        { index: 1, lane: 1, labels: ['b'], kind: 'alt' as const, tools: { b: 'default' as const }, altGroup: 1 },
        { index: 2, lane: 2, labels: ['c'], kind: 'alt' as const, tools: { c: 'default' as const }, altGroup: 1 },
      ],
      edges: [{ from: 0, to: 1 }, { from: 0, to: 2 }],
    };

    it('the anchor fanning out to both arms, with no arm-to-arm edge, registers ok', () => {
      const result = checkMermaid(src(''), ['a', 'b', 'c'], {}, { maxBytes: 100000, maxLines: 1000 }, { expected } as any) as any;
      expect(result.ok).toBe(true);
    });

    it('adding a direct b-->c (arm-to-arm) edge is refused EDGE_MISMATCH, even though both slots have a single label', () => {
      const result = checkMermaid(src('b-->c'), ['a', 'b', 'c'], {}, { maxBytes: 100000, maxLines: 1000 }, { expected } as any) as any;
      expect(result.ok).toBe(false);
      expect(result.rule).toBe('EDGE_MISMATCH');
    });

    // issue #155 B1 follow-up: rule (b)'s "non-consecutive" test used to be `|fromSlot-toSlot|!==1`,
    // an exact proxy for E1's old `{i,i+1}`-only edge set. B1 made the expected edge set non-linear
    // (`{0,1},{0,2}`, or `{1,3},{2,3}` on the fan-in side) — a DIRECT agent→agent edge that the
    // expected graph actually asks for (e.g. anchor-->arm) must NOT be penalized just because its
    // slot indices aren't adjacent integers.
    it('a direct anchor-->arm edge (no diamond, slots 0 and 2) needs no |label| — it IS an expected edge', () => {
      const directSrc = [
        'graph LR', 'subgraph "p1"', 'a(["a"])', 'end',
        'subgraph "hot"', 'b(["b"])', 'end', 'subgraph "cold"', 'c(["c"])', 'end',
        'a-->b', 'a-->c',
      ].join('\n');
      const result = checkMermaid(directSrc, ['a', 'b', 'c'], {}, { maxBytes: 100000, maxLines: 1000 }, { expected } as any) as any;
      expect(result.ok).toBe(true);
    });

    it('both fan-in arms (slots 1 and 2, both to slot 3) need no |label| — neither is penalized over the other', () => {
      const fanInExpected = {
        lanes: [
          { index: 0, title: 'p1', dynamic: false, slots: [0] },
          { index: 1, title: 'hot', dynamic: false, slots: [1] },
          { index: 2, title: 'cold', dynamic: false, slots: [2] },
          { index: 3, title: 'done', dynamic: false, slots: [3] },
        ],
        slots: [
          { index: 0, lane: 0, labels: ['a'], kind: 'single' as const, tools: { a: 'default' as const } },
          { index: 1, lane: 1, labels: ['b'], kind: 'alt' as const, tools: { b: 'default' as const }, altGroup: 1 },
          { index: 2, lane: 2, labels: ['c'], kind: 'alt' as const, tools: { c: 'default' as const }, altGroup: 1 },
          { index: 3, lane: 3, labels: ['d'], kind: 'single' as const, tools: { d: 'default' as const } },
        ],
        edges: [{ from: 0, to: 1 }, { from: 0, to: 2 }, { from: 1, to: 3 }, { from: 2, to: 3 }],
      };
      const fanInSrc = [
        'graph LR', 'subgraph "p1"', 'a(["a"])', 'end',
        'subgraph "hot"', 'b(["b"])', 'end', 'subgraph "cold"', 'c(["c"])', 'end',
        'subgraph "done"', 'd(["d"])', 'end',
        'a-->b', 'a-->c', 'b-->d', 'c-->d',
      ].join('\n');
      const result = checkMermaid(fanInSrc, ['a', 'b', 'c', 'd'], {}, { maxBytes: 100000, maxLines: 1000 }, { expected: fanInExpected } as any) as any;
      expect(result.ok).toBe(true);
    });

    it('a direct a-->c edge inside a plain linear 3-slot chain, skipping slot 1, still needs a |label| (regression guard)', () => {
      const linearExpected = {
        lanes: [0, 1, 2].map((i) => ({ index: i, title: ['one', 'two', 'three'][i]!, dynamic: false, slots: [i] })),
        slots: [
          { index: 0, lane: 0, labels: ['a'], kind: 'single' as const, tools: { a: 'default' as const } },
          { index: 1, lane: 1, labels: ['b'], kind: 'single' as const, tools: { b: 'default' as const } },
          { index: 2, lane: 2, labels: ['c'], kind: 'single' as const, tools: { c: 'default' as const } },
        ],
        edges: [{ from: 0, to: 1 }, { from: 1, to: 2 }],
      };
      const linearSrc = [
        'graph LR', 'subgraph "one"', 'a(["a"])', 'end', 'subgraph "two"', 'b(["b"])', 'end',
        'subgraph "three"', 'c(["c"])', 'end', 'a-->b', 'b-->c', 'a-->c',
      ].join('\n');
      const result = checkMermaid(linearSrc, ['a', 'b', 'c'], {}, { maxBytes: 100000, maxLines: 1000 }, { expected: linearExpected } as any) as any;
      expect(result.ok).toBe(false);
      expect(result.rule).toBe('EDGE_MISMATCH');
    });
  });

  // issue #155 B3/TOOLS-DOC: an agent() dispatched inside a loop/switch body got NO ExpectedSlot at
  // all, so neither checkLanes nor checkTools ever looked at it — its diagram placement (and, when
  // it carries a literal allowedTools, its `tools:` text) was unconstrained.
  describe('dynamic lanes are still lane/tools-checked (B3/TOOLS-DOC)', () => {
    it('a dynamic-lane agent drawn in the WRONG lane is LANE_MISMATCH', () => {
      const src = 'graph LR\nsubgraph "pre"\nb(["b"])\na(["a"])\nend\nsubgraph "loop"\nend';
      const expected = {
        lanes: [
          { index: 0, title: 'pre', dynamic: false, slots: [0] },
          { index: 1, title: 'loop', dynamic: true, slots: [], dynamicLabels: [{ label: 'a' }] },
        ],
        slots: [{ index: 0, lane: 0, labels: ['b'], kind: 'single' as const, tools: { b: 'default' as const } }],
        edges: [],
      };
      const result = checkMermaid(src, ['b', 'a'], {}, { maxBytes: 100000, maxLines: 1000 }, { expected } as any) as any;
      expect(result.ok).toBe(false);
      expect(result.rule).toBe('LANE_MISMATCH');
    });

    it('the same dynamic-lane agent drawn in the CORRECT lane registers ok', () => {
      const src = 'graph LR\nsubgraph "pre"\nb(["b"])\nend\nsubgraph "loop"\na(["a"])\nend';
      const expected = {
        lanes: [
          { index: 0, title: 'pre', dynamic: false, slots: [0] },
          { index: 1, title: 'loop', dynamic: true, slots: [], dynamicLabels: [{ label: 'a' }] },
        ],
        slots: [{ index: 0, lane: 0, labels: ['b'], kind: 'single' as const, tools: { b: 'default' as const } }],
        edges: [],
      };
      const result = checkMermaid(src, ['b', 'a'], {}, { maxBytes: 100000, maxLines: 1000 }, { expected } as any) as any;
      expect(result.ok).toBe(true);
    });

    it('a dynamic-lane agent with no literal allowedTools is NOT tools-checked (documented exemption stays)', () => {
      const src = 'graph LR\nsubgraph "loop"\na(["a<br/>haiku<br/>tools: none"])\nend';
      const expected = {
        lanes: [{ index: 0, title: 'loop', dynamic: true, slots: [], dynamicLabels: [{ label: 'a' }] }],
        slots: [],
        edges: [],
      };
      const result = checkMermaid(src, ['a'], {}, { maxBytes: 100000, maxLines: 1000 }, { expected } as any) as any;
      expect(result.ok).toBe(true);
    });

    it('a dynamic-lane agent WITH a literal allowedTools whose tools: text disagrees is TOOLS_MISMATCH', () => {
      const src = 'graph LR\nsubgraph "loop"\na(["a<br/>haiku<br/>tools: none"])\nend';
      const expected = {
        lanes: [{ index: 0, title: 'loop', dynamic: true, slots: [], dynamicLabels: [{ label: 'a', tools: ['Read'] }] }],
        slots: [],
        edges: [],
      };
      const result = checkMermaid(src, ['a'], {}, { maxBytes: 100000, maxLines: 1000 }, { expected } as any) as any;
      expect(result.ok).toBe(false);
      expect(result.rule).toBe('TOOLS_MISMATCH');
    });

    it('a dynamic-lane agent WITH a literal allowedTools whose tools: text agrees registers ok', () => {
      const src = 'graph LR\nsubgraph "loop"\na(["a<br/>haiku<br/>tools: Read"])\nend';
      const expected = {
        lanes: [{ index: 0, title: 'loop', dynamic: true, slots: [], dynamicLabels: [{ label: 'a', tools: ['Read'] }] }],
        slots: [],
        edges: [],
      };
      const result = checkMermaid(src, ['a'], {}, { maxBytes: 100000, maxLines: 1000 }, { expected } as any) as any;
      expect(result.ok).toBe(true);
    });
  });
});

// UT-208 (DES-184, ARCH-119, TASK-189, v26, REQ-128): the two LANE_MISMATCH arms `checkLanes` opens
// BEFORE the per-slot node lookup UT-196 already covers — a lane COUNT mismatch (the author drew
// fewer/more swimlanes than the script has `phase()` calls) and a lane TITLE mismatch (the right
// number of lanes, in the wrong order or under the wrong names). Both were unreached by any test:
// coverage showed `checkLanes`' first two `return err(...)` lines dead, which means a diagram with
// the wrong number of lanes could have registered as conformant.
// Mock policy (unit): pure function, no I/O.
describe('checkLanes — count and title (UT-208, DES-184)', () => {
  const lane = (index: number, title: string | null) => ({ index, title, dynamic: false, slots: [] as number[] });

  it('too FEW subgraphs for the expected lanes is LANE_MISMATCH, reported at line 1 with every expected lane', () => {
    const src = 'graph LR\nsubgraph "draft"\nend';
    const expected = { lanes: [lane(0, 'draft'), lane(1, 'revise')], slots: [], edges: [] };
    const result = checkMermaid(src, [], {}, { maxBytes: 100000, maxLines: 1000 }, { expected } as any) as any;
    expect(result.ok).toBe(false);
    expect(result.rule).toBe('LANE_MISMATCH');
    expect(result.line).toBe(1);
    expect(result.expected).toHaveLength(2);
  });

  it('too MANY subgraphs is the same refusal (a lane the script never phases into)', () => {
    const src = 'graph LR\nsubgraph "draft"\nend\nsubgraph "extra"\nend';
    const expected = { lanes: [lane(0, 'draft')], slots: [], edges: [] };
    const result = checkMermaid(src, [], {}, { maxBytes: 100000, maxLines: 1000 }, { expected } as any) as any;
    expect(result.ok).toBe(false);
    expect(result.rule).toBe('LANE_MISMATCH');
  });

  it('the right COUNT under the wrong TITLE is LANE_MISMATCH, reported at that subgraph\'s own line', () => {
    const src = 'graph LR\nsubgraph "draft"\nend\nsubgraph "polish"\nend';
    const expected = { lanes: [lane(0, 'draft'), lane(1, 'revise')], slots: [], edges: [] };
    const result = checkMermaid(src, [], {}, { maxBytes: 100000, maxLines: 1000 }, { expected } as any) as any;
    expect(result.ok).toBe(false);
    expect(result.rule).toBe('LANE_MISMATCH');
    expect(result.line).toBeGreaterThan(1);
    expect(result.expected).toMatchObject({ index: 1, title: 'revise' });
  });

  it('a null (dynamic) expected title accepts whatever the author named that lane', () => {
    const src = 'graph LR\nsubgraph "draft"\nend\nsubgraph "whatever the loop computed"\nend';
    const expected = { lanes: [lane(0, 'draft'), lane(1, null)], slots: [], edges: [] };
    const result = checkMermaid(src, [], {}, { maxBytes: 100000, maxLines: 1000 }, { expected } as any) as any;
    expect(result.rule).not.toBe('LANE_MISMATCH');
  });
});
