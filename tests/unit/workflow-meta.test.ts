// v9 — workflow discovery: parseMeta (purpose) + parseWorkflowSkeleton (static DAG). TEST-FIRST (RED).
import { describe, it, expect } from 'vitest';
import { parseMeta, parseWorkflowSkeleton, parseMetaParams, MAX_META_LITERAL_BYTES } from '../../src/workflow-meta.js';

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

// Gate 6.5+7 round 2 (verifier): `parseMetaParams`' two guard arms — the source-size bound and the
// eval-throw fallback — were unexercised (12/26 lines). Both are refusal/degradation paths, so a
// happy-path test can never reach them.
describe('parseMetaParams guard arms (v24, Gate 6.5+7 round 2)', () => {
  it('a meta literal over MAX_META_LITERAL_BYTES is refused PARAM_CONTRACT_INVALID before it is evaluated', () => {
    const filler = 'x'.repeat(MAX_META_LITERAL_BYTES + 100);
    const result = parseMetaParams(`export const meta = { description: '${filler}' };\nreturn 1;`, new Set());
    expect(result.ok).toBe(false);
    expect((result as { code?: string }).code).toBe('PARAM_CONTRACT_INVALID');
    expect((result as { detail?: { reason?: string } }).detail?.reason).toBe('source too large');
  });

  it('a meta literal V8 refuses to evaluate degrades to the no-contract result, it does not throw', () => {
    // Pure by `checkMeta`'s syntactic grammar, but `SyntaxError: Duplicate __proto__ fields are
    // not allowed in object literals` at evaluation — the one reachable input for the catch arm.
    const result = parseMetaParams(`export const meta = { __proto__: {}, __proto__: {} };\nreturn 1;`, new Set());
    expect(result.ok).toBe(true);
    expect((result as { value: { agents: unknown } }).value.agents).toEqual({});
  });

  it('a script with NO meta at all takes the same no-contract path', () => {
    const result = parseMetaParams('return 1;', new Set());
    expect(result.ok).toBe(true);
  });
});

