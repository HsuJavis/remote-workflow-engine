// Service accounts spec (owner decision 2026-10-03), §Authorization: a service account created
// with a `workflows` allowlist is restricted to those names on every workflow-scoped tool. The
// allowlist rides `Principal.workflows` (set only for a service-account-resolved principal —
// server.ts's principalFor) so `authorize()` stays pure/sync exactly as DES-139 already is: no new
// store dependency, just one more optional field on the existing `user`/`author` Principal variants.
//
// Mechanical rule (decided here, documented in authz.ts): a row is "workflow-scoped" iff it
// declares `workflowArg` (the create-time tools, which have no ownership subject of their own —
// workflow_register/describe/source, run_start, …) OR its ownership is 'workflow' (the subject is
// `args[spec.key]`, or `args.workflow` for a moded row with `key:null`) OR its ownership is 'asset'
// with `scope !== 'global'` (subject `args.workflow`). 'run'/'trigger' ownership rows are NOT
// re-checked here — by the time a principal can act on an existing run/trigger it is already that
// principal's OWN (ownership already enforces that), and it could only have been created for an
// allowlisted workflow in the first place; re-deriving the workflow name from a runId/triggerId
// would need a new OwnerLookup method for no additional safety.
//
// Red reason: `AuthzRow` carries no `workflowArg` field and `authorize()` applies no allowlist
// check yet — every case below currently returns `{ok:true}` regardless of `principal.workflows`.
import { describe, it, expect } from 'vitest';
import { authorize, type OwnerLookup, type Principal } from '../../src/authz.js';

const NOOP_LOOKUP: OwnerLookup = { runOwner: () => undefined, workflowOwner: () => undefined, triggerOwner: () => undefined };

function sa(workflows: string[] | undefined): Principal {
  return { kind: 'author', id: 'sa:ci-bot', ...(workflows ? { workflows } : {}) };
}

describe('authz — service-account workflow allowlist (service accounts spec §Authorization)', () => {
  it('a workflowArg-declared row (e.g. workflow_register) refuses a name outside the allowlist', () => {
    const spec = { name: 'workflow_register', key: null, authz: { minRole: 'author' as const, ownership: 'none' as const, workflowArg: 'name' } };
    const verdict = authorize(sa(['foo']), spec, { name: 'bar' }, NOOP_LOOKUP);
    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe('WORKFLOW_NOT_ALLOWED');
  });

  it('a workflowArg-declared row allows a name inside the allowlist', () => {
    const spec = { name: 'workflow_register', key: null, authz: { minRole: 'author' as const, ownership: 'none' as const, workflowArg: 'name' } };
    const verdict = authorize(sa(['foo']), spec, { name: 'foo' }, NOOP_LOOKUP);
    expect(verdict.ok).toBe(true);
  });

  it('no workflows field at all (ordinary human / unrestricted SA) is never checked', () => {
    const spec = { name: 'workflow_register', key: null, authz: { minRole: 'author' as const, ownership: 'none' as const, workflowArg: 'name' } };
    const verdict = authorize(sa(undefined), spec, { name: 'anything' }, NOOP_LOOKUP);
    expect(verdict.ok).toBe(true);
  });

  it('an empty workflows array means unrestricted (spec: "empty/absent = no restriction")', () => {
    const spec = { name: 'workflow_register', key: null, authz: { minRole: 'author' as const, ownership: 'none' as const, workflowArg: 'name' } };
    const verdict = authorize(sa([]), spec, { name: 'anything' }, NOOP_LOOKUP);
    expect(verdict.ok).toBe(true);
  });

  it('ownership:"workflow" rows (e.g. workflow_deregister) key the allowlist off args[key], before the ownership lookup even runs', () => {
    const spec = { name: 'workflow_deregister', key: 'name' as const, authz: { minRole: 'author' as const, ownership: 'workflow' as const } };
    // workflowOwner would say "does not exist" (undefined) -> ok if we ever reached it; the
    // allowlist must refuse FIRST so a disallowed name is never disclosed either way.
    const verdict = authorize(sa(['foo']), spec, { name: 'bar' }, NOOP_LOOKUP);
    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe('WORKFLOW_NOT_ALLOWED');
  });

  it('a moded ownership:"workflow" row (e.g. workspace_list{mode:"workflow"}) keys the allowlist off args.workflow', () => {
    const spec = {
      name: 'workspace_list', key: null,
      authz: { mode: () => 'workflow' as const, rows: { workflow: { minRole: 'author' as const, ownership: 'workflow' as const } } },
    };
    const refused = authorize(sa(['foo']), spec, { mode: 'workflow', workflow: 'bar' }, NOOP_LOOKUP);
    expect(refused.ok).toBe(false);
    expect(refused.code).toBe('WORKFLOW_NOT_ALLOWED');
    const allowed = authorize(sa(['foo']), spec, { mode: 'workflow', workflow: 'foo' }, NOOP_LOOKUP);
    expect(allowed.ok).toBe(true);
  });

  it('ownership:"asset" rows key the allowlist off args.workflow unless scope is "global"', () => {
    const spec = {
      name: 'workspace_push', key: null,
      authz: { mode: () => 'asset' as const, rows: { asset: { minRole: 'author' as const, ownership: 'asset' as const } } },
    };
    const refused = authorize(sa(['foo']), spec, { mode: 'asset', workflow: 'bar', kind: 'skill', name: 'x' }, NOOP_LOOKUP);
    expect(refused.ok).toBe(false);
    expect(refused.code).toBe('WORKFLOW_NOT_ALLOWED');
  });

  it('ownership:"run"/"trigger" rows are NOT re-checked against the allowlist (already scoped by ownership at creation time)', () => {
    const runSpec = { name: 'run_status', key: 'runId' as const, authz: { minRole: 'user' as const, ownership: 'run' as const } };
    const lookup: OwnerLookup = { ...NOOP_LOOKUP, runOwner: () => 'sa:ci-bot' };
    const verdict = authorize(sa(['foo']), runSpec, { runId: 'r1' }, lookup);
    expect(verdict.ok).toBe(true);
  });

  it('WORKFLOW_NOT_ALLOWED refusal points the caller at the authoring guide, like every other authz refusal', () => {
    const spec = { name: 'run_start', key: null, authz: { minRole: 'user' as const, ownership: 'none' as const, workflowArg: 'name' } };
    const verdict = authorize(sa(['foo']), spec, { name: 'bar' }, NOOP_LOOKUP);
    expect(verdict.see).toBe('workflow_authoring_guide');
  });
});
