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
// tests/integration/describe-mermaid-roundtrip.test.ts (IT-126); do not read this file as evidence
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

// UT-268 (DES-223): a minimal agent spec, overridable per key, for the unit/ceiling asymmetry rows.
function baseSpecWithAppend(overrides: Record<string, unknown> = {}) {
  return {
    model: { type: 'string' as const, default: 'claude' },
    effort: { type: 'enum' as const, default: 'medium', enum: ['low', 'medium', 'high'] },
    timeoutMs: { type: 'number' as const, default: 60_000 },
    ...overrides,
  };
}

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

// UT-268 (DES-223, ARCH-136, TASK-228, REQ-202): `DescribeAgentParamKey` stops discarding the
// `unit`/`ceiling` attribution `effectiveAgentBounds` already computes. Red reason:
// `projectAgentParams` (`workflow-view.ts:145-165`) only ever emits {type, default, range} today —
// neither field exists on any projected key yet.
describe('projectWorkflowDescribe — params.agents.<label> unit + ceiling (DES-223, UT-268)', () => {
  it('appendPrompt carries unit:"bytes"; model/effort/timeoutMs never carry unit (the deliberate asymmetry)', () => {
    const params = {
      agents: {
        reviewer: baseSpecWithAppend({ appendPrompt: { type: 'string' as const, default: '' } }),
      },
      args: {},
    };
    const view = projectWorkflowDescribe(fixture({ params: params as unknown as WorkflowOwnerView['params'] }), { triggers: [], ceilings: CEILINGS });
    const reviewer = view.params.agents['reviewer']!;
    expect((reviewer['appendPrompt'] as unknown as { unit?: string })['unit']).toBe('bytes');
    // REQ-202's own headline scenario (ARCH-136 scenario i): an unbounded declared appendPrompt is
    // ALSO the case where the engine ceiling wins, so this one fixture must carry BOTH `unit` and
    // `ceiling` together — a cold client reads the bound's unit and its attribution off one key.
    expect((reviewer['appendPrompt'] as unknown as { ceiling?: string })['ceiling']).toBe('maxAppendPromptBytes');
    expect('unit' in reviewer['model']!).toBe(false);
    expect('unit' in reviewer['effort']!).toBe(false);
    expect('unit' in reviewer['timeoutMs']!).toBe(false);
  });

  // Five `boundMax` rows (DES-223 boundary) fixing `ceiling`'s presence on `timeoutMs`.
  const rows: Array<{ label: string; authorMax: number | undefined | 'poisoned'; ceilingWon: boolean }> = [
    { label: '(a) author max < ceiling → no ceiling', authorMax: 100_000, ceilingWon: false },
    { label: '(b) author max > ceiling → ceiling present', authorMax: 900_000, ceilingWon: true },
    { label: '(c) author max === ceiling exactly → ceiling STILL present', authorMax: CEILINGS.maxTimeoutMs, ceilingWon: true },
    { label: '(d) author declares no max → ceiling present', authorMax: undefined, ceilingWon: true },
    { label: '(e) a stored non-number max → same as (d), ceiling present', authorMax: 'poisoned', ceilingWon: true },
  ];

  for (const row of rows) {
    it(`ceiling generic on timeoutMs — ${row.label}`, () => {
      const timeoutMs = row.authorMax === undefined
        ? { type: 'number' as const, default: 60_000 }
        : { type: 'number' as const, default: 60_000, max: row.authorMax === 'poisoned' ? ('nope' as unknown as number) : row.authorMax };
      const params = { agents: { reviewer: baseSpecWithAppend({ timeoutMs }) }, args: {} };
      const view = projectWorkflowDescribe(fixture({ params: params as unknown as WorkflowOwnerView['params'] }), { triggers: [], ceilings: CEILINGS });
      const key = view.params.agents['reviewer']!['timeoutMs'] as unknown as { ceiling?: string };
      expect('ceiling' in key).toBe(row.ceilingWon);
      if (row.ceilingWon) expect(key.ceiling).toBe('maxTimeoutMs');
    });
  }
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

// v35 (DES-239, ARCH-147, TASK-237, REQ-207): `timeoutMs` gains `attempts`/`worstCaseMs` —
// COMPUTED from an injected `ctx.attempts` (the deployed gateway's `1 + max(0,retries)`), never a
// hard-coded number. Written test-first (Gate 5, RED) — `projectAgentParams`'s `timeoutMs` entry
// carries no `attempts`/`worstCaseMs` field today, and `projectWorkflowDescribe`'s `ctx` type has
// no `attempts` slot to accept one.
describe('projectWorkflowDescribe — timeoutMs.attempts/worstCaseMs (DES-239, v35, REQ-207)', () => {
  it('worstCaseMs === timeoutMs * attempts, with attempts taken from the injected ctx', () => {
    const view = projectWorkflowDescribe(fixture(), { triggers: [], ceilings: CEILINGS, attempts: 3 } as never);
    const timeoutMs = view.params.agents['reviewer']!['timeoutMs'] as unknown as { attempts?: number; worstCaseMs?: number; default: number };
    expect(timeoutMs.attempts).toBe(3);
    expect(timeoutMs.worstCaseMs).toBe(timeoutMs.default * 3);
  });

  it('a DIFFERENT injected attempts changes worstCaseMs — proves it is computed, not transcribed', () => {
    const view1 = projectWorkflowDescribe(fixture(), { triggers: [], ceilings: CEILINGS, attempts: 1 } as never);
    const view2 = projectWorkflowDescribe(fixture(), { triggers: [], ceilings: CEILINGS, attempts: 4 } as never);
    const t1 = view1.params.agents['reviewer']!['timeoutMs'] as unknown as { worstCaseMs?: number };
    const t2 = view2.params.agents['reviewer']!['timeoutMs'] as unknown as { worstCaseMs?: number };
    expect(t1.worstCaseMs).not.toBe(t2.worstCaseMs);
  });

  it('an absent ctx.attempts defaults to the deployed default (1 + 1 = 2) rather than throwing or omitting the field', () => {
    const view = projectWorkflowDescribe(fixture(), { triggers: [], ceilings: CEILINGS });
    const timeoutMs = view.params.agents['reviewer']!['timeoutMs'] as unknown as { attempts?: number };
    expect(timeoutMs.attempts).toBe(2);
  });
});

// v35 (DES-235, ARCH-145, TASK-231, REQ-206): `EffectiveCallParams` must OMIT `args` — the
// describe projection must NEVER grow an `args` key inside a `params.agents.<label>` entry (Gate-2
// constraint 2's leak). Regression pin: even if a future `agents.<label>` value structurally
// carries an `args` key (a future EffectiveCallParams shape), the projection must not surface it —
// `projectAgentParams`'s hard-coded key loop (`['model','effort','timeoutMs','appendPrompt']`)
// must never be silently widened to include it.
describe('projectWorkflowDescribe — params.agents.<label> never leaks an `args` key (DES-235, v35, REQ-206)', () => {
  it('an agents.<label> value carrying an (illegal, future-shaped) args field is NOT surfaced in the projection', () => {
    const params = {
      agents: {
        reviewer: {
          model: { type: 'string' as const, default: 'claude' },
          effort: { type: 'enum' as const, default: 'medium' },
          timeoutMs: { type: 'number' as const, default: 60_000 },
          args: { url: { type: 'string' as const, default: 'https://x' } },
        },
      },
      args: {},
    };
    const view = projectWorkflowDescribe(fixture({ params: params as unknown as WorkflowOwnerView['params'] }), { triggers: [] });
    expect(Object.keys(view.params.agents['reviewer']!)).not.toContain('args');
  });
});
