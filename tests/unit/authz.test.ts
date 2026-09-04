// UT-140 (DES-139, v24): Principal, resolveRole, authorize() — total over kind x role x ownership x mode.
// Written test-first (Gate 5, RED) — src/authz.ts does not exist yet.
import { describe, it, expect } from 'vitest';
import { resolveRole, authorize, type OwnerLookup } from '../../src/authz.js';

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
