// v9 — workflow discovery: parseMeta (purpose) + parseWorkflowSkeleton (static DAG). TEST-FIRST (RED).
import { describe, it, expect } from 'vitest';
import { parseMeta, parseWorkflowSkeleton, parseMetaParams } from '../../src/workflow-meta.js';

describe('parseMeta — extract purpose from a workflow script (v9, REQ-061)', () => {
  it('extracts description + phases from an export const meta block', () => {
    const script = `export const meta = {
      name: 'customer-service',
      description: 'drafts a reply then verifies it',
      phases: [{ title: 'Draft' }, { title: 'Verify' }],
    };
    const x = await agent('hi', {}); return x;`;
    const meta = parseMeta(script);
    expect(meta.description).toBe('drafts a reply then verifies it');
    expect(meta.phases.map((p) => p.title)).toEqual(['Draft', 'Verify']);
  });

  it('degrades gracefully: no meta / no description → empty, never throws', () => {
    expect(parseMeta(`return 1;`)).toEqual({ description: '', phases: [] });
    expect(parseMeta(`export const meta = { name: 'x' }; return 1;`).description).toBe('');
    // a description with semicolons/braces inside the string must survive (string-aware scan)
    const tricky = `export const meta = { name:'y', description: 'does a; then b {ok}' }; return 1;`;
    expect(parseMeta(tricky).description).toBe('does a; then b {ok}');
  });
});

describe('parseWorkflowSkeleton — predicted DAG before running (v9, REQ-062)', () => {
  it('captures phase/agent/workflow calls in order, with the sub-workflow name', () => {
    const script = `
      phase('build');
      const a = await agent('do A', {});
      const b = await workflow('reserve-stock', { x: 1 });
      return { a, b };`;
    const nodes = parseWorkflowSkeleton(script);
    expect(nodes.map((n) => n.kind)).toEqual(['phase', 'agent', 'workflow']);
    expect(nodes.find((n) => n.kind === 'workflow')!.workflow).toBe('reserve-stock');
    expect(nodes.find((n) => n.kind === 'phase')!.title).toBe('build');
  });

  it('groups agents inside a parallel([...]) as one parallel group (customer-service shape)', () => {
    const script = `
      const drafts = await parallel([
        () => agent('draft 1', {}),
        () => agent('draft 2', {}),
      ]);
      const final = await agent('verify both', {});
      return final;`;
    const nodes = parseWorkflowSkeleton(script);
    const agents = nodes.filter((n) => n.kind === 'agent');
    expect(agents.length).toBe(3);
    // the two drafting agents share a parallel group; the verify agent does not
    const groups = new Set(agents.slice(0, 2).map((a) => a.parallel));
    expect(groups.size).toBe(1);
    expect([...groups][0]).toBeDefined();
    expect(agents[2]!.parallel).toBeUndefined();
  });

  it('marks nodes inside a loop as dynamic (best-effort) and never throws on odd input', () => {
    const script = `let r=[]; for (let i=0;i<n;i++){ r.push(await agent('step '+i)); } return r;`;
    const nodes = parseWorkflowSkeleton(script);
    const a = nodes.find((n) => n.kind === 'agent')!;
    expect(a.dynamic).toBe(true);
    expect(() => parseWorkflowSkeleton('this is ) not ( valid {{{ js')).not.toThrow();
  });
});

// TASK-159 (DES-144): parseMetaParams's 3 call sites into the v24 3-arg parseParamContract
// (metaParams, scriptLabels, aliasNames) were passing `aliasNames` into the `scriptLabels` slot —
// every registration whose script omits `meta.params` threw AGENT_UNDECLARED naming label
// "undefined", even a script with zero agent() calls at all.
describe('parseMetaParams — scriptLabels reaches parseParamContract, not aliasNames (v24, DES-144)', () => {
  it('a script with no agent() calls and no meta.params registers (zero-label contract)', () => {
    const result = parseMetaParams(`return 1;`, new Set());
    expect(result).toEqual({ ok: true, value: { agents: {}, args: {} } });
  });

  it('a script with an agent() call and no meta.params is refused AGENT_UNDECLARED naming that label', () => {
    const script = `const x = await agent('draft', { model: 'sonnet' }); return x;`;
    const result = parseMetaParams(script, new Set());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('AGENT_UNDECLARED');
      expect(result.detail).toMatchObject({ label: 'draft' });
    }
  });
});
