// UT-149 (DES-147, v24): checkMermaid(src, scriptLabels, agentDefaults, limits) — tokenizer, node
// table, edge table, bidirectional label diff, value triple, cycles. Written test-first (Gate 5,
// RED) — src/check-mermaid.ts (the repurposed diagram-gate.ts) does not exist yet.
import { describe, it, expect } from 'vitest';
import { checkMermaid } from '../../src/check-mermaid.js';

const limits = { maxBytes: 8192, maxLines: 200 };

// v35 (DES-238, TASK-234): the 5th `v2` parameter is now REQUIRED. Every pre-v35 call below gets
// this trivial expected graph (no subgraphs/slots/edges) so it exercises exactly the v1 rule it
// always did — steps (1)-(9) return before the v2 checks run for every error case here, and the
// three `ok:true` cases below were converted to a `graph LR` header (the v2 DIAGRAM_DIRECTION
// check is unconditional now, so an `ok:true` case must satisfy it too).
const NO_V2: { expected: { lanes: []; slots: []; edges: [] } } = { expected: { lanes: [], slots: [], edges: [] } };

describe('checkMermaid (UT-149, DES-147)', () => {
  it('a diagram over maxBytes ⇒ SIZE, checked FIRST', () => {
    const huge = 'graph TD\n' + 'x'.repeat(10000);
    const result = checkMermaid(huge, [], {}, limits, NO_V2);
    expect(result.ok).toBe(false);
    expect(result.rule).toBe('SIZE');
  });

  it('an edge referencing an undeclared node id ⇒ UNDECLARED_NODE', () => {
    const src = 'graph TD\n  A --> B';
    const result = checkMermaid(src, [], {}, limits, NO_V2);
    expect(result.ok).toBe(false);
    expect(result.rule).toBe('UNDECLARED_NODE');
  });

  it('a node declared twice ⇒ DUPLICATE_NODE', () => {
    const src = 'graph TD\n  A(["plan"])\n  A(["plan2"])';
    const result = checkMermaid(src, ['plan'], {}, limits, NO_V2);
    expect(result.ok).toBe(false);
    expect(result.rule).toBe('DUPLICATE_NODE');
  });

  it('a collapsed fan-out edge (A --> B & C) ⇒ COLLAPSED_EDGE', () => {
    const src = 'graph TD\n  A(["plan"])\n  B(["do"])\n  C(["do2"])\n  A --> B & C';
    const result = checkMermaid(src, ['plan', 'do', 'do2'], {}, limits, NO_V2);
    expect(result.ok).toBe(false);
    expect(result.rule).toBe('COLLAPSED_EDGE');
  });

  it('every script label without a matching agent node ⇒ DIAGRAM_SCRIPT_MISMATCH, onlyInScript lists it', () => {
    const src = 'graph TD\n  header[/"trigger"/]';
    const result = checkMermaid(src, ['plan'], {}, limits, NO_V2);
    expect(result.ok).toBe(false);
    expect(result.rule).toBe('DIAGRAM_SCRIPT_MISMATCH');
    expect(result.onlyInScript).toEqual(['plan']);
  });

  it('a value-triple mismatch (model/effort/timeoutMs on the node label vs the contract default) is refused', () => {
    const src = 'graph TD\n  plan(["plan<br/>haiku · low · 60s"])';
    const result = checkMermaid(src, ['plan'], { plan: { model: 'sonnet-5', effort: 'low', timeoutMs: 60000 } }, limits, NO_V2);
    expect(result.ok).toBe(false);
  });

  it('120s and 120000 are equivalent timeout representations (no false mismatch)', () => {
    const src = 'graph LR\n  plan(["plan<br/>sonnet-5 · low · 120s"])';
    const result = checkMermaid(src, ['plan'], { plan: { model: 'sonnet-5', effort: 'low', timeoutMs: 120000 } }, limits, NO_V2);
    expect(result.ok).toBe(true);
  });

  it('a self-loop cycle without a |label| edge ⇒ LOOP_LABEL', () => {
    const src = 'graph TD\n  plan(["plan"])\n  plan --> plan';
    const result = checkMermaid(src, ['plan'], {}, limits, NO_V2);
    expect(result.ok).toBe(false);
    expect(result.rule).toBe('LOOP_LABEL');
  });

  it('a <--> debate edge is EXCLUDED from cycle detection', () => {
    const src = 'graph LR\n  a(["a"])\n  b(["b"])\n  a <--> b';
    const result = checkMermaid(src, ['a', 'b'], {}, limits, NO_V2);
    expect(result.ok).toBe(true);
  });

  it('an empty subgraph title ⇒ SUBGRAPH_TITLE', () => {
    const src = 'graph TD\n  subgraph ""\n  end';
    const result = checkMermaid(src, [], {}, limits, NO_V2);
    expect(result.ok).toBe(false);
    expect(result.rule).toBe('SUBGRAPH_TITLE');
  });

  it('the black-box rectangle ["…"] is excluded from the bidirectional label diff, its text free', () => {
    const src = 'graph LR\n  plan(["plan"])\n  other["another workflow entirely"]';
    const result = checkMermaid(src, ['plan'], {}, limits, NO_V2);
    expect(result.ok).toBe(true);
  });

  it('CRLF is normalized to LF before classification (no spurious MERMAID_INVALID)', () => {
    const src = 'graph LR\r\n  plan(["plan"])\r\n';
    const result = checkMermaid(src, ['plan'], {}, limits, NO_V2);
    expect(result.ok).toBe(true);
  });

  // Gate 6.5+7 round 2 (verifier): the three node-classifier arms the coverage measurement found
  // unexercised — the `aggregation` and `diamond` shapes, and the "unrecognized shape" catch-all
  // whose own comment said it was "not exercised by this task's test scope".
  it('an aggregation node (id{{"text"}}) and a diamond node (id{"text"}) are both recognised shapes', () => {
    const src = 'graph LR\n  A(["plan"])\n  agg{{"fan-in"}}\n  gate{"choose?"}\n  A --> agg\n  agg --> gate';
    const result = checkMermaid(src, ['plan'], {}, limits, NO_V2);
    expect(result.ok).toBe(true);
  });

  it('a line matching NO node shape and no arrow ⇒ MERMAID_INVALID, with the 1-based line number', () => {
    const src = 'graph TD\n  A(["plan"])\n  this is not a node';
    const result = checkMermaid(src, ['plan'], {}, limits, NO_V2);
    expect(result.ok).toBe(false);
    expect(result.rule).toBe('MERMAID_INVALID');
    expect(result.line).toBe(3);
  });

  // v35 (DES-238, TASK-234, R6 trap): the conversion must not rubber-stamp `expected` objects —
  // at least one converted case asserts a v2 rule FIRING on a diagram that is v1-clean. A `graph
  // TD` header (every v1 check above passes) is refused DIAGRAM_DIRECTION now that step (10) is
  // unconditional, which is exactly the false-green the required 5th parameter exists to close.
  it('a v1-clean diagram with a TD header fires DIAGRAM_DIRECTION (v2 rule) — the R6 firing case', () => {
    const src = 'graph TD\n  plan(["plan"])';
    const result = checkMermaid(src, ['plan'], {}, limits, NO_V2);
    expect(result.ok).toBe(false);
    expect(result.rule).toBe('DIAGRAM_DIRECTION');
  });

  // v35 (DES-238, ARCH-150, ADR-069, TASK-234, REQ-209): the 5th `v2` parameter becomes REQUIRED —
  // no opt-out, no runtime branch skipping the v2 rules. Pinned as a COMPILE-time guarantee: a
  // 4-argument call must be a `tsc` error, or a caller who forgets the 5th argument gets a
  // structurally-silent pass on DIAGRAM_DIRECTION/LANE_MISMATCH/TOOLS_MISMATCH/EDGE_MISMATCH — the
  // exact v34 false-green this REQ exists to close. Red reason (today): the 5th parameter is still
  // optional, so this 4-argument call type-checks fine and the `@ts-expect-error` directive itself
  // is an ERROR under `tsc --noEmit` ("Unused '@ts-expect-error' directive", TS2578) — vitest alone
  // cannot observe this row; confirm red via `npx tsc --noEmit` (see 05-tests.md's Gate 5 note).
  it('[TS2578 pin, tsc-only] a 4-argument call is a compile error once the 5th `v2` parameter is required', () => {
    expect(() => {
      // @ts-expect-error — v35 (DES-238): checkMermaid's 5th `v2` parameter is required; this
      // 4-arg call must fail to type-check. The compile-time arity check is the guarantee this
      // pin exists for; at runtime the call now throws (the required `v2.expected` is read
      // unconditionally), which is why this executable statement is wrapped and caught rather
      // than asserted on its return value.
      checkMermaid('graph LR', [], {}, limits);
    }).toThrow();
  });
});
