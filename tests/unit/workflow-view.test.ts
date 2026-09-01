// UT-104 (DES-115, ARCH-075, TASK-110): pure `src/workflow-view.ts` — `projectWorkflowForRead`,
// the two view types, `EXPECTED_NON_OWNER_KEYS`. Pure, no I/O, no auth, no clock.
//
// Mock policy (unit, DES-119): pure module — the test constructs a plain WorkflowOwnerView fixture,
// no DB/HTTP.
//
// Red reason: `src/workflow-view.ts` does not exist yet → MODULE NOT FOUND, all cases fail at
// collect time. Correct red for an unimplemented module.
//
// v22 Rule 1 (01-requirements.md Round v22): a test whose oracle is the code under test cannot fail
// when the code is wrong — `expect(resp).not.toContain(scriptText)` is explicitly REFUSED by DES-115
// (it passes while `result.script` leaks, v21's fragment-leak defect verbatim). This file uses the
// two-sided literal key-set oracle DES-115 mandates instead.
import { describe, it, expect } from 'vitest';
// Value import — module-not-found RED when absent.
import { projectWorkflowForRead, EXPECTED_NON_OWNER_KEYS, type WorkflowOwnerView } from '../../src/workflow-view.js';

/** Per DES-115's own oracle text: `Object.keys(deepFlatten(resp)).sort()`. Recurses into every
 *  plain-object field (never arrays), recording BOTH the parent path and each child leaf path — the
 *  property that makes a nested `errors[]` inside `validation` visible to a TOP-LEVEL key check. */
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
  name: 'wv-fixture',
  version: 'v3',
  channels: { release: 'v2', beta: 'v3' },
  versions: ['v1', 'v2', 'v3'],
  description: 'a fixture workflow',
  phases: ['phase-one'],
  skeleton: { nodes: [] } as unknown as WorkflowOwnerView['skeleton'],
  params: { knobs: {} } as unknown as WorkflowOwnerView['params'],
  owner: 'owner@example.com',
  createdAt: '2026-01-01T00:00:00.000Z',
  reportProblem: 'call issue_report({workflow:"wv-fixture"})',
  validation: { ok: false, errors: [{ code: 'UNKNOWN_ALIAS', message: 'stale alias', detail: {} }] },
  script: 'return "the actual script bytes";',
};

describe('projectWorkflowForRead — non-owner branch (DES-115, UT-104, v22 Rule 1)', () => {
  it('the flattened key set is EXACTLY EXPECTED_NON_OWNER_KEYS — a new leaked field OR a missing scriptWithheld both fail', () => {
    const resp = projectWorkflowForRead(FULL, false);
    expect(Object.keys(deepFlatten(resp)).sort()).toEqual([...EXPECTED_NON_OWNER_KEYS].sort());
  });

  it('validation.errors is ABSENT for a non-owner (owner-only detail); validation.ok is present', () => {
    const resp = projectWorkflowForRead(FULL, false) as Record<string, unknown>;
    const validation = resp['validation'] as Record<string, unknown>;
    expect(validation).toEqual({ ok: false });
    expect('errors' in validation).toBe(false);
  });

  it('scriptWithheld:true is a DISTINCT key — the response never carries a `script` key of any shape', () => {
    const resp = projectWorkflowForRead(FULL, false) as Record<string, unknown>;
    expect(resp['scriptWithheld']).toBe(true);
    expect('script' in resp).toBe(false);
  });

  it('phases/skeleton are script-derived and are NOT on the non-owner allowlist', () => {
    const resp = projectWorkflowForRead(FULL, false) as Record<string, unknown>;
    expect('phases' in resp).toBe(false);
    expect('skeleton' in resp).toBe(false);
  });

  it('owner/reportProblem/params ARE on the non-owner allowlist (REQ-100 legitimate-need clauses)', () => {
    const resp = projectWorkflowForRead(FULL, false) as Record<string, unknown>;
    expect(resp['owner']).toBe('owner@example.com');
    expect(resp['reportProblem']).toBeTruthy();
    expect(resp['params']).toBeDefined();
  });
});

describe('projectWorkflowForRead — owner branch (DES-115, UT-104)', () => {
  it('the owner gets the script back byte-identically, plus validation.errors', () => {
    const resp = projectWorkflowForRead(FULL, true) as Record<string, unknown>;
    expect(resp['script']).toBe(FULL.script);
    expect((resp['validation'] as Record<string, unknown>)['errors']).toEqual(FULL.validation.errors);
  });
});
