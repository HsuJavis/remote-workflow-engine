// UT-140 (DES-139, v24): Principal, resolveRole, authorize() — total over kind x role x ownership x mode.
// Written test-first (Gate 5, RED) — src/authz.ts does not exist yet.
import { describe, it, expect } from 'vitest';
import { resolveRole, authorize, type OwnerLookup, type Principal } from '../../src/authz.js';

// DES-139 boundary: OwnerLookup's three methods are REQUIRED, not optional — a fixture exercising
// only one branch supplies the other two as `() => undefined` rather than an incomplete object.
const NOOP_LOOKUP: OwnerLookup = { runOwner: () => undefined, workflowOwner: () => undefined, triggerOwner: () => undefined };

describe('authz — Principal/resolveRole/authorize (UT-140, DES-139)', () => {
  it('resolveRole(undefined, id) with auth enabled defaults to \'user\' (owner Gate-1 decision)', () => {
    expect(resolveRole({ 'alice@x.com': { role: 'admin' } }, 'bob@x.com')).toBe('user');
  });

  it('principals["*"] supplies the role for any unlisted principal', () => {
    expect(resolveRole({ '*': { role: 'author' } }, 'bob@x.com')).toBe('author');
  });

  it('an OwnerLookup returning undefined (does not exist) never leaks existence — authorize ok, handler answers *_NOT_FOUND downstream', () => {
    const lookup: OwnerLookup = { ...NOOP_LOOKUP, runOwner: () => undefined };
    const verdict = authorize(
      { kind: 'user', id: 'bob' },
      { name: 'run_status', key: 'runId', authz: { minRole: 'user', ownership: 'run' } },
      { runId: 'missing' },
      lookup,
    );
    expect(verdict.ok).toBe(true);
  });

  it('an OwnerLookup returning null (ownerless) is admin-only', () => {
    const lookup: OwnerLookup = { ...NOOP_LOOKUP, runOwner: () => null };
    const verdict = authorize(
      { kind: 'user', id: 'bob' },
      { name: 'run_status', key: 'runId', authz: { minRole: 'user', ownership: 'run' } },
      { runId: 'legacy-run' },
      lookup,
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe('NOT_RUN_OWNER');
  });

  it('auth-disabled kind is always ok and never emits a crossPrincipalRead audit signal', () => {
    const lookup: OwnerLookup = { ...NOOP_LOOKUP, runOwner: () => 'someone-else' };
    const verdict = authorize(
      { kind: 'auth-disabled' },
      { name: 'run_status', key: 'runId', authz: { minRole: 'user', ownership: 'run' } },
      { runId: 'r1' },
      lookup,
    );
    expect(verdict.ok).toBe(true);
    expect(verdict.crossPrincipalRead).toBeUndefined();
  });

  it('admin bypasses ownership AND the read is flagged for audit (crossPrincipalRead)', () => {
    const lookup: OwnerLookup = { ...NOOP_LOOKUP, runOwner: () => 'owner-x' };
    const verdict = authorize(
      { kind: 'admin', id: 'root' },
      { name: 'run_status', key: 'runId', authz: { minRole: 'user', ownership: 'run', adminCrossRead: true } },
      { runId: 'r1' },
      lookup,
    );
    expect(verdict.ok).toBe(true);
    expect(verdict.crossPrincipalRead).toBe(true);
  });

  it('a mode()-resolved authz row is used, and the resolved mode rides detail.mode on refusal', () => {
    const spec = {
      name: 'workspace_push',
      key: null,
      authz: {
        mode: () => 'global' as const,
        rows: { global: { minRole: 'admin' as const, ownership: 'none' as const } },
      },
    };
    const verdict = authorize({ kind: 'user', id: 'bob' }, spec, {}, NOOP_LOOKUP);
    expect(verdict.ok).toBe(false);
    expect(verdict.detail?.mode).toBe('global');
  });

  it('loopback-exempt is ok only for {minRole:user, ownership:none}, else PRINCIPAL_REQUIRED', () => {
    const okVerdict = authorize(
      { kind: 'loopback-exempt' },
      { name: 'workflow_list', key: null, authz: { minRole: 'user', ownership: 'none' } },
      {},
      NOOP_LOOKUP,
    );
    expect(okVerdict.ok).toBe(true);
    const refused = authorize(
      { kind: 'loopback-exempt' },
      { name: 'run_start', key: null, authz: { minRole: 'user', ownership: 'workflow' } },
      {},
      NOOP_LOOKUP,
    );
    expect(refused.ok).toBe(false);
    expect(refused.code).toBe('PRINCIPAL_REQUIRED');
  });
});

// ---------------------------------------------------------------------------
// UT-140 [T1] — the generated matrix (TASK-133 dod: >=40 rows + a `cases.length === N` pin so a
// partially-written table is RED, not green). Added at Gate 6.5+7 (verifier): the shipped file
// carried 8 hand-written cases, which is not "total over kind x role x ownership x mode".
// Every `expected` below is written from DES-139's rule text, never from running the code.
// ---------------------------------------------------------------------------

type Row = { minRole: 'user' | 'author' | 'admin'; ownership: 'none' | 'run' | 'workflow' | 'trigger' | 'asset'; adminCrossRead?: true };
type Spec = { name: string; key: 'runId' | 'name' | 'id' | null; authz: unknown };

const NONE_USER: Spec = { name: 't', key: null, authz: { minRole: 'user', ownership: 'none' } as Row };
const NONE_AUTHOR: Spec = { name: 't', key: null, authz: { minRole: 'author', ownership: 'none' } as Row };
const NONE_ADMIN: Spec = { name: 't', key: null, authz: { minRole: 'admin', ownership: 'none' } as Row };
const RUN: Spec = { name: 'run_status', key: 'runId', authz: { minRole: 'user', ownership: 'run', adminCrossRead: true } as Row };
const RUN_NOCROSS: Spec = { name: 'run_stop', key: 'runId', authz: { minRole: 'user', ownership: 'run' } as Row };
const WF: Spec = { name: 'workflow_deregister', key: 'name', authz: { minRole: 'author', ownership: 'workflow' } as Row };
const TRIG: Spec = { name: 'schedule_delete', key: 'id', authz: { minRole: 'author', ownership: 'trigger' } as Row };
const ASSET: Spec = { name: 'workspace_push', key: null, authz: { minRole: 'author', ownership: 'asset' } as Row };
const MODED: Spec = {
  name: 'workspace_push', key: null,
  authz: {
    mode: (a: { mode?: string }) => a.mode ?? 'read',
    rows: {
      read: { minRole: 'user', ownership: 'none' } as Row,
      write: { minRole: 'author', ownership: 'workflow' } as Row,
      admin: { minRole: 'admin', ownership: 'none' } as Row,
    },
  },
};

const ALICE: Principal = { kind: 'user', id: 'alice' };
const ALICE_AUTHOR: Principal = { kind: 'author', id: 'alice' };
const ADMIN: Principal = { kind: 'admin', id: 'root' };
const DISABLED: Principal = { kind: 'auth-disabled' };
const LOOPBACK: Principal = { kind: 'loopback-exempt' };

const runOwner = (v: string | null | undefined): OwnerLookup => ({ ...NOOP_LOOKUP, runOwner: () => v });
const wfOwner = (v: string | null | undefined): OwnerLookup => ({ ...NOOP_LOOKUP, workflowOwner: () => v });
const trigOwner = (v: string | null | undefined): OwnerLookup => ({ ...NOOP_LOOKUP, triggerOwner: () => v });

interface Case {
  n: string;
  p: Principal;
  spec: Spec;
  args: Record<string, unknown>;
  lookup: OwnerLookup;
  expected: { ok: boolean; code?: string; mode?: string; cross?: true };
}

const cases: Case[] = [
  // ---- auth-disabled short-circuits FIRST: ok for every row, and never a crossPrincipalRead ----
  { n: 'disabled/none', p: DISABLED, spec: NONE_ADMIN, args: {}, lookup: NOOP_LOOKUP, expected: { ok: true } },
  { n: 'disabled/run owned by another', p: DISABLED, spec: RUN, args: { runId: 'r' }, lookup: runOwner('bob'), expected: { ok: true } },
  { n: 'disabled/workflow owned by another', p: DISABLED, spec: WF, args: { name: 'w' }, lookup: wfOwner('bob'), expected: { ok: true } },
  { n: 'disabled/ownerless trigger', p: DISABLED, spec: TRIG, args: { id: 'i' }, lookup: trigOwner(null), expected: { ok: true } },
  { n: 'disabled/moded write owned by another', p: DISABLED, spec: MODED, args: { mode: 'write', name: 'w' }, lookup: wfOwner('bob'), expected: { ok: true } },

  // ---- loopback-exempt: ok ONLY for {minRole:user, ownership:none}; the mode still rides detail ----
  { n: 'loopback/user+none', p: LOOPBACK, spec: NONE_USER, args: {}, lookup: NOOP_LOOKUP, expected: { ok: true } },
  { n: 'loopback/author+none', p: LOOPBACK, spec: NONE_AUTHOR, args: {}, lookup: NOOP_LOOKUP, expected: { ok: false, code: 'PRINCIPAL_REQUIRED' } },
  { n: 'loopback/admin+none', p: LOOPBACK, spec: NONE_ADMIN, args: {}, lookup: NOOP_LOOKUP, expected: { ok: false, code: 'PRINCIPAL_REQUIRED' } },
  { n: 'loopback/user+run', p: LOOPBACK, spec: RUN, args: { runId: 'r' }, lookup: runOwner(undefined), expected: { ok: false, code: 'PRINCIPAL_REQUIRED' } },
  { n: 'loopback/moded read', p: LOOPBACK, spec: MODED, args: { mode: 'read' }, lookup: NOOP_LOOKUP, expected: { ok: true } },
  { n: 'loopback/moded write carries detail.mode', p: LOOPBACK, spec: MODED, args: { mode: 'write' }, lookup: NOOP_LOOKUP, expected: { ok: false, code: 'PRINCIPAL_REQUIRED', mode: 'write' } },

  // ---- role rank: the full 3x3 ----
  { n: 'user@user', p: ALICE, spec: NONE_USER, args: {}, lookup: NOOP_LOOKUP, expected: { ok: true } },
  { n: 'user@author', p: ALICE, spec: NONE_AUTHOR, args: {}, lookup: NOOP_LOOKUP, expected: { ok: false, code: 'FORBIDDEN_ROLE' } },
  { n: 'user@admin', p: ALICE, spec: NONE_ADMIN, args: {}, lookup: NOOP_LOOKUP, expected: { ok: false, code: 'FORBIDDEN_ROLE' } },
  { n: 'author@user', p: ALICE_AUTHOR, spec: NONE_USER, args: {}, lookup: NOOP_LOOKUP, expected: { ok: true } },
  { n: 'author@author', p: ALICE_AUTHOR, spec: NONE_AUTHOR, args: {}, lookup: NOOP_LOOKUP, expected: { ok: true } },
  { n: 'author@admin', p: ALICE_AUTHOR, spec: NONE_ADMIN, args: {}, lookup: NOOP_LOOKUP, expected: { ok: false, code: 'FORBIDDEN_ROLE' } },
  { n: 'admin@user', p: ADMIN, spec: NONE_USER, args: {}, lookup: NOOP_LOOKUP, expected: { ok: true } },
  { n: 'admin@author', p: ADMIN, spec: NONE_AUTHOR, args: {}, lookup: NOOP_LOOKUP, expected: { ok: true } },
  { n: 'admin@admin', p: ADMIN, spec: NONE_ADMIN, args: {}, lookup: NOOP_LOOKUP, expected: { ok: true } },

  // ---- ownership: run ----
  { n: 'run/absent (undefined) never leaks existence', p: ALICE, spec: RUN, args: { runId: 'r' }, lookup: runOwner(undefined), expected: { ok: true } },
  { n: 'run/ownerless (null) is admin-only', p: ALICE, spec: RUN, args: { runId: 'r' }, lookup: runOwner(null), expected: { ok: false, code: 'NOT_RUN_OWNER' } },
  { n: 'run/self', p: ALICE, spec: RUN, args: { runId: 'r' }, lookup: runOwner('alice'), expected: { ok: true } },
  { n: 'run/other', p: ALICE, spec: RUN, args: { runId: 'r' }, lookup: runOwner('bob'), expected: { ok: false, code: 'NOT_RUN_OWNER' } },
  { n: 'run/admin over ownerless', p: ADMIN, spec: RUN, args: { runId: 'r' }, lookup: runOwner(null), expected: { ok: true } },
  { n: 'run/admin cross-read is FLAGGED', p: ADMIN, spec: RUN, args: { runId: 'r' }, lookup: runOwner('bob'), expected: { ok: true, cross: true } },
  { n: 'run/admin cross-read on a row without adminCrossRead is NOT flagged', p: ADMIN, spec: RUN_NOCROSS, args: { runId: 'r' }, lookup: runOwner('bob'), expected: { ok: true } },

  // ---- ownership: workflow ----
  { n: 'workflow/absent', p: ALICE_AUTHOR, spec: WF, args: { name: 'w' }, lookup: wfOwner(undefined), expected: { ok: true } },
  { n: 'workflow/ownerless', p: ALICE_AUTHOR, spec: WF, args: { name: 'w' }, lookup: wfOwner(null), expected: { ok: false, code: 'NOT_WORKFLOW_OWNER' } },
  { n: 'workflow/self', p: ALICE_AUTHOR, spec: WF, args: { name: 'w' }, lookup: wfOwner('alice'), expected: { ok: true } },
  { n: 'workflow/other', p: ALICE_AUTHOR, spec: WF, args: { name: 'w' }, lookup: wfOwner('bob'), expected: { ok: false, code: 'NOT_WORKFLOW_OWNER' } },
  { n: 'workflow/admin over another owner, unflagged', p: ADMIN, spec: WF, args: { name: 'w' }, lookup: wfOwner('bob'), expected: { ok: true } },

  // ---- ownership: trigger (ONE lookup method over both stores) ----
  { n: 'trigger/absent', p: ALICE_AUTHOR, spec: TRIG, args: { id: 'i' }, lookup: trigOwner(undefined), expected: { ok: true } },
  { n: 'trigger/ownerless', p: ALICE_AUTHOR, spec: TRIG, args: { id: 'i' }, lookup: trigOwner(null), expected: { ok: false, code: 'NOT_TRIGGER_OWNER' } },
  { n: 'trigger/self', p: ALICE_AUTHOR, spec: TRIG, args: { id: 'i' }, lookup: trigOwner('alice'), expected: { ok: true } },
  { n: 'trigger/other', p: ALICE_AUTHOR, spec: TRIG, args: { id: 'i' }, lookup: trigOwner('bob'), expected: { ok: false, code: 'NOT_TRIGGER_OWNER' } },
  { n: 'trigger/admin over ownerless', p: ADMIN, spec: TRIG, args: { id: 'i' }, lookup: trigOwner(null), expected: { ok: true } },

  // ---- ownership: asset (subject is args.workflow; scope 'global' is role-only) ----
  { n: 'asset/global scope is role-only', p: ALICE_AUTHOR, spec: ASSET, args: { scope: 'global', workflow: 'w' }, lookup: wfOwner('bob'), expected: { ok: true } },
  { n: 'asset/workflow scope, self', p: ALICE_AUTHOR, spec: ASSET, args: { scope: 'workflow', workflow: 'w' }, lookup: wfOwner('alice'), expected: { ok: true } },
  { n: 'asset/workflow scope, other', p: ALICE_AUTHOR, spec: ASSET, args: { scope: 'workflow', workflow: 'w' }, lookup: wfOwner('bob'), expected: { ok: false, code: 'NOT_WORKFLOW_OWNER' } },
  { n: 'asset/workflow scope, absent', p: ALICE_AUTHOR, spec: ASSET, args: { scope: 'workflow', workflow: 'w' }, lookup: wfOwner(undefined), expected: { ok: true } },
  { n: 'asset/workflow scope, ownerless', p: ALICE_AUTHOR, spec: ASSET, args: { scope: 'workflow', workflow: 'w' }, lookup: wfOwner(null), expected: { ok: false, code: 'NOT_WORKFLOW_OWNER' } },
  { n: 'asset/admin over another owner', p: ADMIN, spec: ASSET, args: { scope: 'workflow', workflow: 'w' }, lookup: wfOwner('bob'), expected: { ok: true } },
  { n: 'asset/role floor still applies below the ownership check', p: ALICE, spec: ASSET, args: { scope: 'global' }, lookup: NOOP_LOOKUP, expected: { ok: false, code: 'FORBIDDEN_ROLE' } },

  // ---- mode resolution: the resolved row decides, and rides detail.mode on refusal ----
  { n: 'moded/read is user+none', p: ALICE, spec: MODED, args: { mode: 'read' }, lookup: NOOP_LOOKUP, expected: { ok: true } },
  { n: 'moded/write refuses a user by role, naming the mode', p: ALICE, spec: MODED, args: { mode: 'write', name: 'w' }, lookup: wfOwner('alice'), expected: { ok: false, code: 'FORBIDDEN_ROLE', mode: 'write' } },
  { n: 'moded/write, author owns it', p: ALICE_AUTHOR, spec: MODED, args: { mode: 'write', workflow: 'w' }, lookup: wfOwner('alice'), expected: { ok: true } },
  { n: 'moded/write, author does not own it', p: ALICE_AUTHOR, spec: MODED, args: { mode: 'write', workflow: 'w' }, lookup: wfOwner('bob'), expected: { ok: false, code: 'NOT_WORKFLOW_OWNER', mode: 'write' } },
  { n: 'moded/admin row refuses an author', p: ALICE_AUTHOR, spec: MODED, args: { mode: 'admin' }, lookup: NOOP_LOOKUP, expected: { ok: false, code: 'FORBIDDEN_ROLE', mode: 'admin' } },
  { n: 'moded/admin row admits an admin', p: ADMIN, spec: MODED, args: { mode: 'admin' }, lookup: NOOP_LOOKUP, expected: { ok: true } },
];

describe('authz — the generated kind x role x ownership x mode matrix (UT-140 [T1], DES-139)', () => {
  it('the table is COMPLETE — a partially-written matrix is red, not green', () => {
    expect(cases.length).toBe(50);
  });

  it.each(cases.map((c) => [c.n, c] as const))('%s', (_n, c) => {
    const verdict = authorize(c.p, c.spec as never, c.args, c.lookup);
    expect(verdict.ok).toBe(c.expected.ok);
    if (c.expected.ok) {
      expect(verdict.code).toBeUndefined();
      expect(verdict.crossPrincipalRead).toBe(c.expected.cross);
    } else {
      expect(verdict.code).toBe(c.expected.code);
      // Every refusal points at the one guide (DES-139's refusal shape).
      expect(verdict.see).toBe('workflow_authoring_guide');
      expect(typeof verdict.reason).toBe('string');
      expect(verdict.detail?.mode).toBe(c.expected.mode);
    }
  });
});

// Issue #90: a NOT_*_OWNER refusal's `reason` reaches the CALLER verbatim — `authorize()` is called
// from exactly one place, `call-tool.ts:232`, whose `refusalEnvelope(verdict.code ?? 'FORBIDDEN_ROLE',
// verdict.reason ?? 'refused', ...)` (line 234) puts it straight on the wire — so it must never name
// the resource's owner — a non-owner caller (bob) must not learn who owns alice's run/workflow/
// trigger just by being refused. `principal.id` (the CALLER's own, already-known id) staying out is
// unnecessary rather than dangerous, but this asserts that too, since neither belongs in a message
// answered to the caller who triggered the refusal.
describe('issue #90: a NOT_*_OWNER refusal never discloses the owner identity to the refused caller', () => {
  const OWNER_CASES: Array<{ n: string; p: Principal; spec: Spec; args: Record<string, unknown>; lookup: OwnerLookup; code: string }> = [
    { n: 'run', p: ALICE, spec: RUN, args: { runId: 'r' }, lookup: runOwner('owner-secret@example.com'), code: 'NOT_RUN_OWNER' },
    { n: 'workflow', p: ALICE_AUTHOR, spec: WF, args: { name: 'w' }, lookup: wfOwner('owner-secret@example.com'), code: 'NOT_WORKFLOW_OWNER' },
    { n: 'trigger', p: ALICE_AUTHOR, spec: TRIG, args: { id: 'i' }, lookup: trigOwner('owner-secret@example.com'), code: 'NOT_TRIGGER_OWNER' },
    { n: 'asset (workflow scope)', p: ALICE_AUTHOR, spec: ASSET, args: { scope: 'workflow', workflow: 'w' }, lookup: wfOwner('owner-secret@example.com'), code: 'NOT_WORKFLOW_OWNER' },
    { n: 'moded write', p: ALICE_AUTHOR, spec: MODED, args: { mode: 'write', workflow: 'w' }, lookup: wfOwner('owner-secret@example.com'), code: 'NOT_WORKFLOW_OWNER' },
  ];

  it.each(OWNER_CASES.map((c) => [c.n, c] as const))('%s refusal reason names neither the owner nor the caller', (_n, c) => {
    const verdict = authorize(c.p, c.spec as never, c.args, c.lookup);
    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe(c.code);
    expect(verdict.reason).toBeDefined();
    expect(verdict.reason).not.toContain('owner-secret@example.com');
    expect(verdict.reason).not.toContain('alice');
    expect(JSON.stringify(verdict.detail ?? {})).not.toContain('owner-secret@example.com');
  });
});
