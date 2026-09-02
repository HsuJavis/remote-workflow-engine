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
  // v23 (DES-136, TASK-125): the shape `parseMeta` actually produces (`workflow-meta.ts:10`).
  phases: [{ title: 'phase-one' }],
  params: { knobs: {} } as unknown as WorkflowOwnerView['params'],
  owner: 'owner@example.com',
  createdAt: '2026-01-01T00:00:00.000Z',
  reportProblem: 'call issue_report({workflow:"wv-fixture"})',
  validation: { ok: false, errors: [{ code: 'UNKNOWN_ALIAS', message: 'stale alias', detail: {} }] },
  script: 'return "the actual script bytes";',
};

/** The non-owner key set REQUIREMENT-side, transcribed from REQ-100's acceptance rather than read
 *  back out of the module under test (v22 Rule 1 — and v22 adjudication #2 L-3, which settles that
 *  `channels` and the declared `params` contract ARE non-owner-visible):
 *    "the response omits the script body while still returning everything a user legitimately needs —
 *     name, version, channel, purpose, declared parameter contract (REQ-090), owner, and how to report
 *     a problem against it (REQ-095) … a masked response says the script is withheld".
 *  Mapping, one entry per clause: name→`name`, version→`version`, channel→`channels` (+ this
 *  fixture's own `release`/`beta` pointers), purpose→`description`, parameter contract→`params`
 *  (+ its `knobs` sub-object — the contract IS the knobs, so a `params` that flattened to nothing
 *  would satisfy the letter and not the clause), owner→`owner`, report-a-problem→`reportProblem`,
 *  withheld-not-absent→`scriptWithheld`. `validation.ok` is REQ-099's "staleness visible on every
 *  read" (its `errors` detail is owner-only — the next case pins that). */
// v23 (DES-136, TASK-125, adjudication #1 2026-09-02): `phases` joins the allowlist, ONE entry
// (deepFlatten does not recurse into arrays, `:29` below) — 一律公開, ratified by the owner: serving
// phase titles inside the diagram (REQ-102/A3) while `workflow_get` withheld them would be REQ-100's
// own "cannot be side-stepped by asking a different endpoint" clause violated in mirror image.
const REQ_100_NON_OWNER_KEYS = [
  'channels', 'channels.beta', 'channels.release',
  'description',
  'name',
  'owner',
  'params', 'params.knobs',
  'phases',
  'reportProblem',
  'scriptWithheld',
  'validation', 'validation.ok',
  'version',
];

describe('projectWorkflowForRead — non-owner branch (DES-115, UT-104, v22 Rule 1)', () => {
  it('the flattened key set is EXACTLY what REQ-100 says a non-owner gets — a new leaked field OR a missing scriptWithheld both fail', () => {
    const resp = projectWorkflowForRead(FULL, false);
    expect(Object.keys(deepFlatten(resp)).sort()).toEqual([...REQ_100_NON_OWNER_KEYS].sort());
  });

  it('the module\'s advertised EXPECTED_NON_OWNER_KEYS still names exactly the top-level keys it emits', () => {
    // The src-side constant is the advertised contract; it lists top-level names plus the one nested
    // leaf it cares about (`validation.ok`). Pinning it against the response's OWN top-level keys
    // keeps the advertised list from drifting away from the projection beside it.
    const resp = projectWorkflowForRead(FULL, false);
    const advertisedTopLevel = [...EXPECTED_NON_OWNER_KEYS].filter((k) => !k.includes('.'));
    expect(Object.keys(resp).sort()).toEqual(advertisedTopLevel.sort());
  });

  it('validation.errors is ABSENT for a non-owner (owner-only detail); validation.ok is present', () => {
    const resp = projectWorkflowForRead(FULL, false) as unknown as Record<string, unknown>;
    const validation = resp['validation'] as Record<string, unknown>;
    expect(validation).toEqual({ ok: false });
    expect('errors' in validation).toBe(false);
  });

  it('scriptWithheld:true is a DISTINCT key — the response never carries a `script` key of any shape', () => {
    const resp = projectWorkflowForRead(FULL, false) as unknown as Record<string, unknown>;
    expect(resp['scriptWithheld']).toBe(true);
    expect('script' in resp).toBe(false);
  });

  it('v23 (DES-136): phases IS on the non-owner allowlist (adjudication #1, 一律公開) — skeleton stays OFF it (REQ-105 retires the surface, the function stays internal)', () => {
    const resp = projectWorkflowForRead(FULL, false) as unknown as Record<string, unknown>;
    expect(resp['phases']).toEqual([{ title: 'phase-one' }]);
    expect('skeleton' in resp).toBe(false);
  });

  it('v23 (DES-136): a secret in a PHASE TITLE DOES appear on the non-owner projection, while a secret in the SCRIPT BODY stays absent — two distinct fixtures, not one', () => {
    const secretPhaseFixture: WorkflowOwnerView = { ...FULL, phases: [{ title: 'SEKRIT-9F2A' }], script: 'return "unrelated";' };
    const secretScriptFixture: WorkflowOwnerView = { ...FULL, phases: [{ title: 'ordinary phase' }], script: 'const key = "SEKRIT-9F2A"; return key;' };
    const respPhase = projectWorkflowForRead(secretPhaseFixture, false) as unknown as Record<string, unknown>;
    const respScript = projectWorkflowForRead(secretScriptFixture, false) as unknown as Record<string, unknown>;
    expect(JSON.stringify(respPhase)).toContain('SEKRIT-9F2A'); // phase titles are public (adjudication #1)
    expect(JSON.stringify(respScript)).not.toContain('SEKRIT-9F2A'); // script body stays masked (REQ-100, unchanged)
  });

  it('owner/reportProblem/params ARE on the non-owner allowlist (REQ-100 legitimate-need clauses)', () => {
    const resp = projectWorkflowForRead(FULL, false) as unknown as Record<string, unknown>;
    expect(resp['owner']).toBe('owner@example.com');
    expect(resp['reportProblem']).toBeTruthy();
    expect(resp['params']).toBeDefined();
  });
});

describe('projectWorkflowForRead — owner branch (DES-115, UT-104)', () => {
  it('the owner gets the script back byte-identically, plus validation.errors', () => {
    const resp = projectWorkflowForRead(FULL, true) as unknown as Record<string, unknown>;
    expect(resp['script']).toBe(FULL.script);
    expect((resp['validation'] as Record<string, unknown>)['errors']).toEqual(FULL.validation.errors);
  });
});
