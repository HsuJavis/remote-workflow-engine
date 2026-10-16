// UT-362 (DES-271 v40 Gate 6 delta, ruling R-12, REQ-224, TASK-268): a `decide`/`generateImage`
// label may appear in the author's mermaid as a stadium node — accepted, never required — and is
// invisible to the derived skeleton: `deriveExpectedGraph` never gives it a slot, never refuses it
// `AGENT_BEFORE_PHASE`, and `checkMermaid`'s edge rule treats it as a NON-agent intermediate (a
// path `a → gate → b` realises the expected `a → b` edge). `checkMermaid` learns the labels through
// `v2.primitiveLabels` (optional; absent = today's behaviour exactly).
//
// Red reason: `checkMermaid` has no notion of primitive labels — a stadium node `gate` is
// `onlyInDiagram` and the registration refuses `DIAGRAM_SCRIPT_MISMATCH` (and, past that, the
// stadium intermediate would block the a→b path as `EDGE_MISMATCH`). The skeleton cases are GREEN
// today (characterization: `parseWorkflowSkeleton`'s CALL_RE never matches `decide`/`generateImage`),
// each guarded by a perturbation that proves the assertion can fail.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkMermaid } from '../../src/check-mermaid.js';
import { deriveExpectedGraph } from '../../src/skeleton-graph.js';
import { parseWorkflowSkeleton } from '../../src/workflow-meta.js';
import { scanAgentCalls } from '../../src/scan-agent-calls.js';
import { WorkflowCatalog } from '../../src/workflow-catalog.js';
import { FixedClock } from '../../src/clock.js';

const LIMITS = { maxBytes: 16_384, maxLines: 400 };
const Q = `{ ok: { type: 'bool', instructions: 'i', criteria: { true: 't', false: 'f' } } }`;
const BODY = `phase('Main');
const a = await agent('a', { prompt: 'p' });
const d = await decide('gate', { state: {}, questions: ${Q} });
return await agent('b', { prompt: 'q' });`;

const WITH_GATE = `graph LR
subgraph "Main"
n0(["a"])
g(["gate"])
n1(["b"])
end
n0 --> g
g --> n1`;

const WITHOUT_GATE = `graph LR
subgraph "Main"
n0(["a"])
n1(["b"])
end
n0 --> n1`;

function expectedFor(script: string) {
  const derived = deriveExpectedGraph(parseWorkflowSkeleton(script), scanAgentCalls(script));
  if (!derived.ok) throw new Error(`derive refused: ${derived.rule}`);
  return derived.graph;
}

describe('UT-362: checkMermaid accepts primitive labels as nodes, never requires them (R-12)', () => {
  it('a stadium node carrying the decide label, on the a→b path, is accepted when the label is declared primitive', () => {
    const r = checkMermaid(WITH_GATE, ['a', 'b'], {}, LIMITS, { expected: expectedFor(BODY), primitiveLabels: ['gate'] } as never);
    expect(r).toEqual({ ok: true });
  });

  it('perturbation guard: WITHOUT primitiveLabels the same diagram is refused DIAGRAM_SCRIPT_MISMATCH naming gate', () => {
    const r = checkMermaid(WITH_GATE, ['a', 'b'], {}, LIMITS, { expected: expectedFor(BODY) });
    expect(r.ok).toBe(false);
    expect(r.rule).toBe('DIAGRAM_SCRIPT_MISMATCH');
    expect(r.onlyInDiagram).toEqual(['gate']);
  });

  it('never required: the diagram may omit the primitive label entirely', () => {
    const r = checkMermaid(WITHOUT_GATE, ['a', 'b'], {}, LIMITS, { expected: expectedFor(BODY), primitiveLabels: ['gate'] } as never);
    expect(r).toEqual({ ok: true });
  });
});

describe('UT-362: the derived skeleton excludes primitives (R-12; characterization)', () => {
  it('a decide() before the first phase() is NOT AGENT_BEFORE_PHASE', () => {
    const script = `await decide('gate', { state: {}, questions: ${Q} });\nphase('Main');\nreturn await agent('a', { prompt: 'p' });`;
    const r = deriveExpectedGraph(parseWorkflowSkeleton(script), scanAgentCalls(script));
    expect(r.ok).toBe(true);
  });

  it('perturbation guard: an agent() in the same position IS refused AGENT_BEFORE_PHASE', () => {
    const script = `await agent('z', { prompt: 'p' });\nphase('Main');\nreturn await agent('a', { prompt: 'p' });`;
    const r = deriveExpectedGraph(parseWorkflowSkeleton(script), scanAgentCalls(script));
    expect(r).toMatchObject({ ok: false, rule: 'AGENT_BEFORE_PHASE' });
  });

  it('no slot ever carries a primitive label (and the agent slots are still there)', () => {
    const g = expectedFor(BODY);
    const labels = g.slots.flatMap((s) => s.labels);
    expect(labels).toEqual(['a', 'b']);
    expect(labels).not.toContain('gate');
  });
});

describe('UT-362: registration accepts a diagram that draws the decide label (R-12)', () => {
  const dirs: string[] = [];
  afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
  const AGENT = `{ model: { type: 'string', default: 'anthropic/claude-haiku-4-5-20251001' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } }`;
  const PRIM = `{ model: { type: 'string', default: 'openrouter/typesafe/jev-1.13' }, timeoutMs: { type: 'number', default: 5000 }, retries: { type: 'number', default: 0 } }`;
  const SCRIPT = `export const meta = { phases: [{ title: 'Main' }], params: { agents: { a: ${AGENT}, b: ${AGENT} }, decisions: { gate: ${PRIM} } } };\n${BODY}`;
  async function register(mermaid: string): Promise<string | undefined> {
    const d = mkdtempSync(join(tmpdir(), 'rwe-ut362-'));
    dirs.push(d);
    const catalog = new WorkflowCatalog(d, new FixedClock(new Date('2026-10-16T00:00:00Z')));
    try { await catalog.register({ name: 'ut362', script: SCRIPT, mermaid, principal: null }); return undefined; }
    catch (e) { return (e as { code?: string }).code; }
  }

  it('perturbation guard: the diagram without the gate node registers', async () => {
    expect(await register(WITHOUT_GATE)).toBeUndefined();
  });

  it('the diagram WITH the gate node (a → gate → b) registers too', async () => {
    expect(await register(WITH_GATE)).toBeUndefined();
  });
});
