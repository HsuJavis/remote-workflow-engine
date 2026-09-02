// UT-113 (TASK-118, DES-125, ARCH-081): pure `projectWorkflowDescribe` + `WorkflowDescribeView` +
// `EXPECTED_DESCRIBE_KEYS` — the one explain projection, no `script` field in the TYPE, live trigger
// bindings, and the `diagramStale`/`diagramGeneratedAt` honest-absence rules (DES-127 B3).
//
// Mock policy (unit, DES-119): pure module — plain object fixtures, no I/O, no clock, no auth.
//
// Anti-vacuity rule (04-design.md v23 "per-tier mock policy"): EXPECTED_DESCRIBE_KEYS below is a
// LITERAL array transcribed from DES-125's own field list, never derived from the module under test.
//
// Red reason: `projectWorkflowDescribe`/`EXPECTED_DESCRIBE_KEYS` are not yet exported from
// `src/workflow-view.ts` -> ESM SyntaxError "does not provide an export named '...'" at collect time
// (same precedent as UT-069/morandi-renderer.test.ts for a not-yet-exported member of an EXISTING
// module).
import { describe, it, expect } from 'vitest';
import { projectWorkflowDescribe, EXPECTED_DESCRIBE_KEYS, type WorkflowOwnerView } from '../../src/workflow-view.js';

function deepFlatten(obj: unknown, prefix = ''): Record<string, unknown> {
  if (obj === null || obj === undefined || typeof obj !== 'object' || Array.isArray(obj)) {
    return prefix ? { [prefix]: obj } : {};
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    out[path] = v;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) Object.assign(out, deepFlatten(v, path));
  }
  return out;
}

const FULL: WorkflowOwnerView = {
  name: 'describe-fixture', version: 'v3',
  channels: { release: 'v2', beta: 'v3' },
  versions: ['v1', 'v2', 'v3'],
  description: 'a fixture workflow',
  phases: [{ title: 'Draft' }, { title: 'Verify' }],
  params: { knobs: {} } as unknown as WorkflowOwnerView['params'],
  owner: 'owner@example.com',
  createdAt: '2026-01-01T00:00:00.000Z',
  reportProblem: 'call issue_report({workflow:"describe-fixture"})',
  validation: { ok: true, errors: [] },
  script: 'return "the actual script bytes";',
};

// Transcribed LITERALLY from DES-125's own `WorkflowDescribeView` field list — `phases`, `versions`,
// `triggers` each contribute exactly ONE top-level key (deepFlatten does not recurse into arrays).
const EXPECTED_DESCRIBE_KEYS_LITERAL = [
  'name', 'version', 'resolvedBy',
  'channels', 'channels.release', 'channels.beta',
  'versions', 'description', 'phases',
  'params', 'params.knobs',
  'lockedKeys', 'owner', 'reportProblem', 'triggers',
  'diagram', 'diagramStatus', 'diagramNote', 'diagramGeneratedAt', 'diagramStale',
].sort();

describe('projectWorkflowDescribe — the two-sided key oracle (UT-113, DES-125)', () => {
  it('a ready diagram: the flattened key set is EXACTLY EXPECTED_DESCRIBE_KEYS_LITERAL — a leaked field OR a dropped one both fail', () => {
    const view = projectWorkflowDescribe(FULL, {
      diagram: { status: 'ready', diagram: '╭─Draft─╮', noteCode: null, generatedAt: '2026-09-02T10:00:00.000Z', bindingsFp: 'fp-1' } as any,
      bindings: [{ kind: 'cron', cron: '0 3 * * *', enabled: true }] as any,
      bindingsFp: 'fp-1', analyzerEnabled: true,
    });
    expect(Object.keys(deepFlatten(view)).sort()).toEqual(EXPECTED_DESCRIBE_KEYS_LITERAL);
  });

  it('EXPECTED_DESCRIBE_KEYS (the module\'s own advertised constant) names exactly the response\'s top-level keys', () => {
    const view = projectWorkflowDescribe(FULL, {
      diagram: null, bindings: [], bindingsFp: 'fp-empty', analyzerEnabled: true,
    });
    const advertisedTopLevel = [...EXPECTED_DESCRIBE_KEYS].filter((k) => !k.includes('.'));
    expect(Object.keys(view as unknown as Record<string, unknown>).sort()).toEqual(advertisedTopLevel.sort());
  });

  it('there is no `script` field on the response for ANY input, including the owner-view fixture that carries one', () => {
    const view = projectWorkflowDescribe(FULL, { diagram: null, bindings: [], bindingsFp: 'fp', analyzerEnabled: true }) as unknown as Record<string, unknown>;
    expect('script' in view).toBe(false);
  });
});

describe('projectWorkflowDescribe — diagram fields (UT-113, DES-125, DES-127 B3)', () => {
  it('a ready row: diagramStatus="ready", diagram is the stored string, diagramGeneratedAt is the stamp', () => {
    const view = projectWorkflowDescribe(FULL, {
      diagram: { status: 'ready', diagram: '╭─Draft─╮', noteCode: null, generatedAt: '2026-09-02T10:00:00.000Z', bindingsFp: 'fp-1' } as any,
      bindings: [], bindingsFp: 'fp-1', analyzerEnabled: true,
    });
    expect(view.diagramStatus).toBe('ready');
    expect(view.diagram).toBe('╭─Draft─╮');
    expect(view.diagramGeneratedAt).toBe('2026-09-02T10:00:00.000Z');
  });

  it('no row at all: diagramStatus="unavailable", diagram is null, diagramGeneratedAt is null (never a lie about when it was drawn)', () => {
    const view = projectWorkflowDescribe(FULL, { diagram: null, bindings: [], bindingsFp: 'fp', analyzerEnabled: true });
    expect(view.diagramStatus).toBe('unavailable');
    expect(view.diagram).toBeNull();
    expect(view.diagramGeneratedAt).toBeNull();
  });

  it('a SWEPT pending row (generated_at IS stamped but status is still "pending") still projects diagramGeneratedAt: null — B3\'s honest-absence rule, only "ready" gets a stamp', () => {
    const view = projectWorkflowDescribe(FULL, {
      diagram: { status: 'pending', diagram: null, noteCode: null, generatedAt: '2026-09-02T09:00:00.000Z', bindingsFp: 'fp' } as any,
      bindings: [], bindingsFp: 'fp', analyzerEnabled: true,
    });
    expect(view.diagramStatus).toBe('pending');
    expect(view.diagramGeneratedAt).toBeNull();
  });

  it('diagramStale is true ONLY for a ready row whose bindingsFp differs from the live fp', () => {
    const staleView = projectWorkflowDescribe(FULL, {
      diagram: { status: 'ready', diagram: 'x', noteCode: null, generatedAt: 'now', bindingsFp: 'fp-old' } as any,
      bindings: [], bindingsFp: 'fp-new', analyzerEnabled: true,
    });
    const freshView = projectWorkflowDescribe(FULL, {
      diagram: { status: 'ready', diagram: 'x', noteCode: null, generatedAt: 'now', bindingsFp: 'fp-same' } as any,
      bindings: [], bindingsFp: 'fp-same', analyzerEnabled: true,
    });
    const noRowView = projectWorkflowDescribe(FULL, { diagram: null, bindings: [], bindingsFp: 'fp-new', analyzerEnabled: true });
    expect(staleView.diagramStale).toBe(true);
    expect(freshView.diagramStale).toBe(false);
    expect(noRowView.diagramStale).toBe(false); // never "stale" when there is nothing to be stale against
  });
});

describe('projectWorkflowDescribe — B1/B2 boundary states (UT-113, DES-127)', () => {
  it('B2: analyzerEnabled:false + no row -> unavailable, with a note distinct from the enabled+no-row case (DISABLED vs NOT_GENERATED)', () => {
    const disabledView = projectWorkflowDescribe(FULL, { diagram: null, bindings: [], bindingsFp: 'fp', analyzerEnabled: false });
    const notGeneratedView = projectWorkflowDescribe(FULL, { diagram: null, bindings: [], bindingsFp: 'fp', analyzerEnabled: true });
    expect(disabledView.diagramStatus).toBe('unavailable');
    expect(notGeneratedView.diagramStatus).toBe('unavailable');
    expect(disabledView.diagramNote).not.toBe(notGeneratedView.diagramNote); // DISABLED reads differently from NOT_GENERATED
    expect(disabledView.diagramNote.length).toBeGreaterThan(0);
    expect(notGeneratedView.diagramNote.length).toBeGreaterThan(0);
  });
});

describe('projectWorkflowDescribe — triggers are ALWAYS the live snapshot (UT-113, DES-125, ARCH-078)', () => {
  it('triggers reflects the `bindings` argument verbatim, independent of the stored diagram row', () => {
    const bindings = [{ kind: 'webhook', enabled: true }] as any;
    const view = projectWorkflowDescribe(FULL, { diagram: null, bindings, bindingsFp: 'fp', analyzerEnabled: true });
    expect(view.triggers).toEqual(bindings);
  });
});

describe('projectWorkflowDescribe — lockedKeys and owner (UT-113, DES-125)', () => {
  it('lockedKeys is present and non-empty (imported from the params contract, never re-typed)', () => {
    const view = projectWorkflowDescribe(FULL, { diagram: null, bindings: [], bindingsFp: 'fp', analyzerEnabled: true });
    expect(Array.isArray(view.lockedKeys)).toBe(true);
    expect(view.lockedKeys.length).toBeGreaterThan(0);
  });

  it('owner is served to every principal (no viewerIsOwner parameter — the function is 2-ary)', () => {
    expect(projectWorkflowDescribe.length).toBe(2);
    const view = projectWorkflowDescribe(FULL, { diagram: null, bindings: [], bindingsFp: 'fp', analyzerEnabled: true });
    expect(view.owner).toBe('owner@example.com');
  });
});
