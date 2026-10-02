// Service accounts spec (owner decision 2026-10-03), §Authorization: authz.ts's generic allowlist
// mechanism (workflowNameSubject/`workflowArg`) is USELESS unless the create-shaped tool rows that
// have no ownership subject of their own actually declare it. Found by real verification (a live
// throwaway-engine run_start against a non-allowlisted workflow was NOT refused — only
// workflow_list's separate result-filter engaged) — this test pins the TOOL_SPECS data itself, not
// just authz.ts's own already-covered mechanism (authz-workflow-allowlist.test.ts).
//
// Red reason: none of these 4 rows carry `workflowArg` yet.
import { describe, it, expect } from 'vitest';
import { TOOL_SPECS } from '../../src/tool-specs.js';
import { authorize, type OwnerLookup, type Principal } from '../../src/authz.js';

const NOOP_LOOKUP: OwnerLookup = { runOwner: () => undefined, workflowOwner: () => undefined, triggerOwner: () => undefined };
const SA: Principal = { kind: 'user', id: 'sa:ci-bot', workflows: ['foo'] };

function spec(name: string) {
  const s = TOOL_SPECS.find((t) => t.name === name);
  if (!s) throw new Error(`no such tool: ${name}`);
  return s;
}

describe('service_account workflow allowlist is actually wired into TOOL_SPECS rows', () => {
  it('run_start refuses a non-allowlisted workflow name (WORKFLOW_NOT_ALLOWED)', () => {
    const verdict = authorize(SA, spec('run_start'), { name: 'bar' }, NOOP_LOOKUP);
    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe('WORKFLOW_NOT_ALLOWED');
  });

  it('run_start allows the allowlisted name', () => {
    const verdict = authorize(SA, spec('run_start'), { name: 'foo' }, NOOP_LOOKUP);
    expect(verdict.ok).toBe(true);
  });

  it('workflow_register refuses a non-allowlisted name', () => {
    const verdict = authorize({ kind: 'author', id: 'sa:ci-bot', workflows: ['foo'] }, spec('workflow_register'), { name: 'bar' }, NOOP_LOOKUP);
    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe('WORKFLOW_NOT_ALLOWED');
  });

  it('workflow_describe refuses a non-allowlisted name', () => {
    const verdict = authorize(SA, spec('workflow_describe'), { name: 'bar' }, NOOP_LOOKUP);
    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe('WORKFLOW_NOT_ALLOWED');
  });

  it('workflow_source refuses a non-allowlisted name', () => {
    const verdict = authorize({ kind: 'author', id: 'sa:ci-bot', workflows: ['foo'] }, spec('workflow_source'), { name: 'bar' }, NOOP_LOOKUP);
    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe('WORKFLOW_NOT_ALLOWED');
  });
});
