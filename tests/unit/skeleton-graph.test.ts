// UT-173 (DES-174, ARCH-113, TASK-185, v26): `deriveExpectedGraph(nodes, scan) → {ok, ...}` — the
// ONE pure derivation consumed by both the registration checker (DES-184) and the run-DAG layout
// (DES-176). Every fixture in the shared corpus (tests/fixtures/expected-graph-fixtures.ts) must
// produce its literal expected graph; the function must NEVER throw for any input. Written
// test-first (Gate 5, RED): `src/skeleton-graph.ts` does not exist yet — whole-file import failure.
// Mock policy (unit): pure function, no I/O — real parseWorkflowSkeleton + scanAgentCalls feed it,
// hand-written expected literals from the shared fixture corpus are the oracle.
import { describe, it, expect } from 'vitest';
import { deriveExpectedGraph } from '../../src/skeleton-graph.js';
import type { DeriveResult } from '../../src/skeleton-graph.js';
import { parseWorkflowSkeleton } from '../../src/workflow-meta.js';
import { scanAgentCalls } from '../../src/workflow-meta.js';
import { GRAPH_FIXTURES } from '../fixtures/expected-graph-fixtures.js';
import { TOOL_SPECS } from '../../src/tool-specs.js';

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

  // M-3 send-back repair (INV-V26-3, ARCH-113 "one derivation, two consumers"): the retired
  // `v1FallbackGraph` never read `call.group` — every scanned call became a chained `single` slot,
  // so a v1 (phase-less) script's `parallel([a,b,c])` rendered THREE chained slots, asserting a
  // sequential dependency the script never had. `contract:'v1'` re-derives with the SAME S1–S4/T1/E1
  // logic a `'v2'` script gets, past the lane-selection point — this is the discriminating case.
  describe('contract:\'v1\' (M-3 repair) — the read path\'s permissive half honours call.group', () => {
    const v1ParallelScript = `
export const meta = { name: 'par3v1', params: { agents: { a: {}, b: {}, c: {} } } };
await parallel([
  () => agent('a', { prompt: 'p' }),
  () => agent('b', { prompt: 'p' }),
  () => agent('c', { prompt: 'p' }),
]);
`;

    it('a v1 script with parallel([a,b,c]) lays out ONE parallel slot (not three chained single slots)', () => {
      const nodes = parseWorkflowSkeleton(v1ParallelScript);
      const scan = scanAgentCalls(v1ParallelScript);
      // First confirm the v2 (registration) contract still refuses this phase-less script.
      const v2Result = deriveExpectedGraph(nodes as any, scan as any) as any;
      expect(v2Result.ok).toBe(false);
      expect(v2Result.rule).toBe('AGENT_BEFORE_PHASE');

      // The read path's own re-derivation, exactly as server.ts now calls it.
      const v1Result = deriveExpectedGraph(nodes as any, scan as any, 'v1') as any;
      expect(v1Result.ok).toBe(true);
      expect(v1Result.graph.slots).toHaveLength(1);
      expect(v1Result.graph.slots[0]).toMatchObject({ kind: 'parallel', labels: ['a', 'b', 'c'] });
      // No edges at all — a single slot has no consecutive sibling to chain against.
      expect(v1Result.graph.edges).toEqual([]);
      // One implicit lane holds it — title null, never dynamic, matching the retired
      // v1FallbackGraph's own shape (so the layout raises no warning).
      expect(v1Result.graph.lanes).toEqual([{ index: 0, title: null, dynamic: false, slots: [0] }]);
    });

    it('a v1 script with three SEQUENTIAL agent() calls still chains them (S1, unchanged from before)', () => {
      const script = `await agent('a', {});\nawait agent('b', {});\nawait agent('c', {});`;
      const nodes = parseWorkflowSkeleton(script);
      const scan = scanAgentCalls(script);
      const result = deriveExpectedGraph(nodes as any, scan as any, 'v1') as any;
      expect(result.ok).toBe(true);
      expect(result.graph.slots.map((s: any) => s.kind)).toEqual(['single', 'single', 'single']);
      expect(result.graph.edges).toEqual([{ from: 0, to: 1 }, { from: 1, to: 2 }]);
    });

    it('never refuses — contract:\'v1\' is total (no AGENT_BEFORE_PHASE)', () => {
      const script = `await agent('a', {});`;
      const nodes = parseWorkflowSkeleton(script);
      const scan = scanAgentCalls(script);
      const result = deriveExpectedGraph(nodes as any, scan as any, 'v1') as any;
      expect(result.ok).toBe(true);
    });
  });
});

// M-5 send-back repair (ARCH-119/121's error-catalog drift-lock): the CONVERSE direction of the
// existing lock (`error-catalog-closed.test.ts`/`rule-code-map.test.ts` check "every code a
// producer emits is catalogued") — every code `deriveExpectedGraph`'s own `DeriveResult` failure
// arm can hold is advertised on `workflow_register.errors[]`, AND every `deriveExpectedGraph`-
// sourced code advertised there has a REAL producer. `UNDECIDABLE_SHAPE` violated the second half:
// declared in three places, constructed in none. Scoped to `deriveExpectedGraph`'s own rule set
// (where the orphan actually lived) — the four check-mermaid v2 codes have their own equivalent
// lock in `rule-code-map.test.ts`.
describe('deriveExpectedGraph\'s advertised rule codes all have a real producer (M-5 catalog drift-lock)', () => {
  // The literal set `DeriveResult`'s failure arm allows TODAY — kept in sync with
  // `src/skeleton-graph.ts` by review discipline, same convention as `rule-code-map.test.ts`'s
  // `V2_CODES`. A future union arm added here with no matching entry below is the exact drift this
  // test exists to catch.
  const DERIVE_RESULT_RULES: ReadonlyArray<Extract<DeriveResult, { ok: false }>['rule']> = ['AGENT_BEFORE_PHASE'];

  it('every rule in DERIVE_RESULT_RULES is a REAL producer — deriveExpectedGraph can actually emit it', () => {
    // AGENT_BEFORE_PHASE: an agent() before any phase(), under the strict v2 contract.
    const script = `agent('a', { prompt: 'p' });\nphase('one');`;
    const nodes = parseWorkflowSkeleton(script);
    const scan = scanAgentCalls(script);
    const result = deriveExpectedGraph(nodes as any, scan as any) as any;
    expect(DERIVE_RESULT_RULES).toContain(result.rule);
  });

  it('workflow_register.errors[] advertises EXACTLY DERIVE_RESULT_RULES\'s codes from this source (not more, not fewer)', () => {
    const spec = TOOL_SPECS.find((s) => s.name === 'workflow_register')!;
    expect(spec).toBeDefined();
    // Every deriveExpectedGraph-sourced code advertised must be a real, producible rule.
    const advertised = new Set(spec.errors as readonly string[]);
    // UNDECIDABLE_SHAPE (deleted) is the exact shape of drift this asserts against: it must never
    // reappear on the advertised surface without reappearing in DERIVE_RESULT_RULES too.
    expect(advertised.has('UNDECIDABLE_SHAPE')).toBe(false);
    for (const rule of DERIVE_RESULT_RULES) expect(advertised.has(rule)).toBe(true);
  });

  it('type-level: \'UNDECIDABLE_SHAPE\' is no longer assignable to DeriveResult\'s rule field', () => {
    // @ts-expect-error — proves the union arm is really gone at the type level, not just absent
    // from the runtime literal above; this directive itself goes RED (unused) if the arm returns.
    const bad: DeriveResult = { ok: false, rule: 'UNDECIDABLE_SHAPE', line: 1, label: null, message: 'x' };
    expect(bad).toBeDefined();
  });
});
