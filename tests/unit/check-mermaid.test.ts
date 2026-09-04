// UT-149 (DES-147, v24): checkMermaid(src, scriptLabels, agentDefaults, limits) — tokenizer, node
// table, edge table, bidirectional label diff, value triple, cycles. Written test-first (Gate 5,
// RED) — src/check-mermaid.ts (the repurposed diagram-gate.ts) does not exist yet.
import { describe, it, expect } from 'vitest';
import { checkMermaid } from '../../src/check-mermaid.js';

const limits = { maxBytes: 8192, maxLines: 200 };

describe('checkMermaid (UT-149, DES-147)', () => {
  it('a diagram over maxBytes ⇒ SIZE, checked FIRST', () => {
    const huge = 'graph TD\n' + 'x'.repeat(10000);
    const result = checkMermaid(huge, [], {}, limits);
    expect(result.ok).toBe(false);
    expect(result.rule).toBe('SIZE');
  });

  it('an edge referencing an undeclared node id ⇒ UNDECLARED_NODE', () => {
    const src = 'graph TD\n  A --> B';
    const result = checkMermaid(src, [], {}, limits);
    expect(result.ok).toBe(false);
    expect(result.rule).toBe('UNDECLARED_NODE');
  });

  it('a node declared twice ⇒ DUPLICATE_NODE', () => {
    const src = 'graph TD\n  A(["plan"])\n  A(["plan2"])';
    const result = checkMermaid(src, ['plan'], {}, limits);
    expect(result.ok).toBe(false);
    expect(result.rule).toBe('DUPLICATE_NODE');
  });

  it('a collapsed fan-out edge (A --> B & C) ⇒ COLLAPSED_EDGE', () => {
    const src = 'graph TD\n  A(["plan"])\n  B(["do"])\n  C(["do2"])\n  A --> B & C';
    const result = checkMermaid(src, ['plan', 'do', 'do2'], {}, limits);
    expect(result.ok).toBe(false);
    expect(result.rule).toBe('COLLAPSED_EDGE');
  });

  it('every script label without a matching agent node ⇒ DIAGRAM_SCRIPT_MISMATCH, onlyInScript lists it', () => {
    const src = 'graph TD\n  header[/"trigger"/]';
    const result = checkMermaid(src, ['plan'], {}, limits);
    expect(result.ok).toBe(false);
    expect(result.rule).toBe('DIAGRAM_SCRIPT_MISMATCH');
    expect(result.onlyInScript).toEqual(['plan']);
  });

  it('a value-triple mismatch (model/effort/timeoutMs on the node label vs the contract default) is refused', () => {
    const src = 'graph TD\n  plan(["plan<br/>haiku · low · 60s"])';
    const result = checkMermaid(src, ['plan'], { plan: { model: 'sonnet-5', effort: 'low', timeoutMs: 60000 } }, limits);
    expect(result.ok).toBe(false);
  });

  it('120s and 120000 are equivalent timeout representations (no false mismatch)', () => {
    const src = 'graph TD\n  plan(["plan<br/>sonnet-5 · low · 120s"])';
    const result = checkMermaid(src, ['plan'], { plan: { model: 'sonnet-5', effort: 'low', timeoutMs: 120000 } }, limits);
    expect(result.ok).toBe(true);
  });

  it('a self-loop cycle without a |label| edge ⇒ LOOP_LABEL', () => {
    const src = 'graph TD\n  plan(["plan"])\n  plan --> plan';
    const result = checkMermaid(src, ['plan'], {}, limits);
    expect(result.ok).toBe(false);
    expect(result.rule).toBe('LOOP_LABEL');
  });

  it('a <--> debate edge is EXCLUDED from cycle detection', () => {
    const src = 'graph TD\n  a(["a"])\n  b(["b"])\n  a <--> b';
    const result = checkMermaid(src, ['a', 'b'], {}, limits);
    expect(result.ok).toBe(true);
  });

  it('an empty subgraph title ⇒ SUBGRAPH_TITLE', () => {
    const src = 'graph TD\n  subgraph ""\n  end';
    const result = checkMermaid(src, [], {}, limits);
    expect(result.ok).toBe(false);
    expect(result.rule).toBe('SUBGRAPH_TITLE');
  });

  it('the black-box rectangle ["…"] is excluded from the bidirectional label diff, its text free', () => {
    const src = 'graph TD\n  plan(["plan"])\n  other["another workflow entirely"]';
    const result = checkMermaid(src, ['plan'], {}, limits);
    expect(result.ok).toBe(true);
  });

  it('CRLF is normalized to LF before classification (no spurious MERMAID_INVALID)', () => {
    const src = 'graph TD\r\n  plan(["plan"])\r\n';
    const result = checkMermaid(src, ['plan'], {}, limits);
    expect(result.ok).toBe(true);
  });
});
