// UT-113/UT-157 (TASK-149, DES-156, ARCH-105/106): pure `projectWorkflowDescribe` +
// `WorkflowDescribeView` + `EXPECTED_DESCRIBE_KEYS` — the one explain projection, no `script`
// field in the TYPE, a by-id live `triggers` snapshot, `mermaid`/`mermaidNote` (verbatim stored
// string, honest-null note) replacing the retired `diagram*` family, `runnable`/`runnableReason`,
// and `params.agents.<label>` ceiling-bounded projection.
//
// Mock policy (unit, DES-119): pure module — plain object fixtures, no I/O, no clock, no auth.
//
// v24 Gate 7.5 (D-8) BOUNDARY: every case below feeds `projectWorkflowDescribe` a HAND-BUILT
// `WorkflowOwnerView`, so it can only ever prove the projection is faithful to the object it is
// handed — it stayed green for the whole iteration while the catalog read never selected the
// `mermaid` column and the facade never forwarded it, i.e. while EVERY real
// `workflow_describe(...).mermaid` was null. The register→SQLite→describe round trip is pinned by
// tests/integration/describe-mermaid-roundtrip.test.ts (IT-167); do not read this file as evidence
// that a registered diagram is served.
//
// v24 [T3] REWRITE (DES-156's own `tests:` line — "today pins diagramStatus"): the whole file is
// rebuilt against the v24 shape; the pre-v24 diagram*/note-precedence/bindings-fp machinery this
// file used to pin is gone along with the analyzer/trigger-bindings ports it read (TASK-139).
import { describe, it, expect } from 'vitest';
import { projectWorkflowDescribe, EXPECTED_DESCRIBE_KEYS, type WorkflowOwnerView } from '../../src/workflow-view.js';
import type { Ceilings } from '../../src/params/contract.js';

const CEILINGS: Ceilings = { maxTimeoutMs: 300_000, maxAppendPromptBytes: 512, maxEffort: 'high' };

const V24_PARAMS = {
  agents: {
    reviewer: {
      model: { type: 'string' as const, default: 'claude', enum: ['claude', 'gpt'] },
      effort: { type: 'enum' as const, default: 'medium', enum: ['low', 'medium', 'high', 'xhigh', 'max'] },
      timeoutMs: { type: 'number' as const, default: 60_000, min: 1000, max: 900_000 },
    },
  },
  args: {},
};

const LEGACY_PARAMS = { knobs: {} };

function fixture(overrides: Partial<WorkflowOwnerView> = {}): WorkflowOwnerView {
  return {
    name: 'describe-fixture', version: 'v3',
    channels: { release: 'v2', beta: 'v3' },
    versions: ['v1', 'v2', 'v3'],
    description: 'a fixture workflow',
    phases: [{ title: 'Draft' }, { title: 'Verify' }],
    params: V24_PARAMS as unknown as WorkflowOwnerView['params'],
    owner: 'owner@example.com',
    createdAt: '2026-01-01T00:00:00.000Z',
    reportProblem: 'call issue_report({workflow:"describe-fixture"})',
    validation: { ok: true, errors: [] },
    script: 'return "the actual script bytes";',
    mermaid: 'graph TD; A-->B;',
    ...overrides,
  };
}

describe('projectWorkflowDescribe — EXPECTED_DESCRIBE_KEYS (UT-113/UT-157, DES-156)', () => {
  it('the top-level key set is EXACTLY EXPECTED_DESCRIBE_KEYS — a leaked field OR a dropped one both fail', () => {
    const view = projectWorkflowDescribe(fixture(), { triggers: [] });
    expect(Object.keys(view).sort()).toEqual([...EXPECTED_DESCRIBE_KEYS].sort());
  });

  it('there is no `script` field on the response for ANY input, including the owner-view fixture that carries one', () => {
    const view = projectWorkflowDescribe(fixture(), { triggers: [] }) as unknown as Record<string, unknown>;
    expect('script' in view).toBe(false);
  });

  it('the response has NO diagramStatus/diagramNote/diagramGeneratedAt/diagramStale keys (retired v23 family)', () => {
    const view = projectWorkflowDescribe(fixture(), { triggers: [] }) as unknown as Record<string, unknown>;
    for (const retired of ['diagram', 'diagramStatus', 'diagramNote', 'diagramGeneratedAt', 'diagramStale']) {
      expect(retired in view).toBe(false);
    }
  });
});

describe('projectWorkflowDescribe — mermaid/mermaidNote (UT-157, DES-156)', () => {
  it('mermaid is the stored string VERBATIM, mermaidNote is null', () => {
    const view = projectWorkflowDescribe(fixture({ mermaid: 'graph TD; X-->Y;' }), { triggers: [] });
    expect(view.mermaid).toBe('graph TD; X-->Y;');
    expect(view.mermaidNote).toBeNull();
  });

  it('a legacy row with no stored mermaid: mermaid is null and mermaidNote is LEGACY_NO_DIAGRAM', () => {
    const view = projectWorkflowDescribe(fixture({ mermaid: null }), { triggers: [] });
    expect(view.mermaid).toBeNull();
    expect(view.mermaidNote).toBe('LEGACY_NO_DIAGRAM');
  });

  it('mermaid absent on the owner view (never set) is treated the same as null', () => {
    const { mermaid: _drop, ...rest } = fixture();
    const view = projectWorkflowDescribe(rest as WorkflowOwnerView, { triggers: [] });
    expect(view.mermaid).toBeNull();
    expect(view.mermaidNote).toBe('LEGACY_NO_DIAGRAM');
  });
});

describe('projectWorkflowDescribe — triggers is the live by-id snapshot verbatim (UT-113, ARCH-078)', () => {
  it('triggers reflects the ctx.triggers argument verbatim', () => {
    const triggers = [{ id: 'trg-1', kind: 'webhook' }, { id: 'trg-2', kind: 'cron', cron: '0 3 * * *' }];
    const view = projectWorkflowDescribe(fixture(), { triggers });
    expect(view.triggers).toEqual(triggers);
  });
});

describe('projectWorkflowDescribe — lockedKeys and owner (UT-113)', () => {
  it('lockedKeys is present and non-empty (imported from the params contract, never re-typed)', () => {
    const view = projectWorkflowDescribe(fixture(), { triggers: [] });
    expect(Array.isArray(view.lockedKeys)).toBe(true);
    expect(view.lockedKeys.length).toBeGreaterThan(0);
  });

  it('owner is served to every principal (no viewerIsOwner parameter — the function is 2-ary)', () => {
    expect(projectWorkflowDescribe.length).toBe(2);
    const view = projectWorkflowDescribe(fixture(), { triggers: [] });
    expect(view.owner).toBe('owner@example.com');
  });
});

describe('projectWorkflowDescribe — params.agents.<label> = author ∩ ceiling (UT-157, DES-156)', () => {
  it('reports {type, default, range} per key, with range NARROWED by the ceiling (never the raw author range)', () => {
    const view = projectWorkflowDescribe(fixture(), { triggers: [], ceilings: CEILINGS });
    const reviewer = view.params.agents['reviewer'];
    expect(reviewer).toBeDefined();
    expect(reviewer!['timeoutMs']).toMatchObject({ type: 'number', default: 60_000, range: { min: 1000, max: 300_000 } }); // author max 900_000, ceiling 300_000
    expect((reviewer!['effort']!.range as string[])).not.toContain('xhigh'); // ceiling maxEffort:'high' strips xhigh/max
  });

  it('a legacy-contract workflow projects an empty params.agents (nothing to bound)', () => {
    const view = projectWorkflowDescribe(fixture({ params: LEGACY_PARAMS as unknown as WorkflowOwnerView['params'] }), { triggers: [] });
    expect(view.params.agents).toEqual({});
  });

  it('an absent ceilings ctx defaults to DEFAULT_CEILINGS rather than throwing', () => {
    expect(() => projectWorkflowDescribe(fixture(), { triggers: [] })).not.toThrow();
  });
});

// DES-156: "a ≥6-row runnable truth table (release set × legacy)" — release channel / beta
// channel / neither, crossed with legacy-contract yes/no. LEGACY_REREGISTER takes precedence over
// CHANNEL_UNPUBLISHED (a legacy contract can never be run regardless of publication state).
describe('projectWorkflowDescribe — runnable/runnableReason truth table (DES-156)', () => {
  const rows: Array<{ label: string; channels: Record<string, string>; legacy: boolean; runnable: boolean; reason: 'CHANNEL_UNPUBLISHED' | 'LEGACY_REREGISTER' | null }> = [
    { label: 'release set, current contract', channels: { release: 'v2' }, legacy: false, runnable: true, reason: null },
    { label: 'beta set (no release), current contract', channels: { beta: 'v3' }, legacy: false, runnable: true, reason: null },
    { label: 'neither channel set, current contract', channels: {}, legacy: false, runnable: false, reason: 'CHANNEL_UNPUBLISHED' },
    { label: 'release set, legacy contract', channels: { release: 'v2' }, legacy: true, runnable: false, reason: 'LEGACY_REREGISTER' },
    { label: 'beta set, legacy contract', channels: { beta: 'v3' }, legacy: true, runnable: false, reason: 'LEGACY_REREGISTER' },
    { label: 'neither channel set, legacy contract', channels: {}, legacy: true, runnable: false, reason: 'LEGACY_REREGISTER' },
  ];

  for (const row of rows) {
    it(row.label, () => {
      const view = projectWorkflowDescribe(
        fixture({ channels: row.channels, params: (row.legacy ? LEGACY_PARAMS : V24_PARAMS) as unknown as WorkflowOwnerView['params'] }),
        { triggers: [] },
      );
      expect(view.runnable).toBe(row.runnable);
      expect(view.runnableReason).toBe(row.reason);
    });
  }
});
