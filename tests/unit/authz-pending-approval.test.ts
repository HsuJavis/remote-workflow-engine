// Owner decision 2026-09-30 (verify-i MEDIUM-1): an authenticated principal with no configured or
// DB role resolves to 'none' = pending approval, and EVERY tool refuses it
// ACCOUNT_PENDING_APPROVAL (no role check, no ownership lookup, no data). Config '*' and DB
// overrides still apply; config admins stay locked; 'none' is a grantable/revocable role.
import { describe, it, expect } from 'vitest';
import { resolveRole, roleWithSource, checkRoleChange, authorize, AUTHZ_ERROR_CODES, type Principal, type PrincipalRole } from '../../src/authz.js';
import { TOOL_SPECS } from '../../src/tool-specs.js';
import { ERROR_CATALOG } from '../../src/errors.js';

const NOOP = { runOwner: () => undefined, workflowOwner: () => undefined, triggerOwner: () => undefined };

describe("role 'none' (pending approval)", () => {
  it('an unlisted id with no "*" resolves to none, source default', () => {
    expect(resolveRole({ 'a@x': { role: 'admin' } }, 'stranger@x')).toBe('none');
    expect(resolveRole(undefined, 'stranger@x')).toBe('none');
    expect(roleWithSource(undefined, 'stranger@x')).toEqual({ role: 'none', source: 'default' });
  });

  it('"*" and DB overrides still apply; config admins stay locked', () => {
    expect(resolveRole({ '*': { role: 'user' } }, 'stranger@x')).toBe('user');
    expect(resolveRole(undefined, 'stranger@x', 'author')).toBe('author');
    expect(resolveRole({ 'r@x': { role: 'admin' } }, 'r@x', 'none')).toBe('admin');
    expect(resolveRole({ 'u@x': { role: 'user' } }, 'u@x', 'none' as PrincipalRole)).toBe('none');
  });

  it('every tool refuses a none principal with ACCOUNT_PENDING_APPROVAL (catalogued)', () => {
    const p: Principal = { kind: 'none', id: 'stranger@x' };
    for (const spec of TOOL_SPECS) {
      const v = authorize(p, spec, { runId: 'r', name: 'w', id: 'i', workflow: 'w', scope: 'global' }, NOOP);
      expect(v.ok, spec.name).toBe(false);
      expect(v.code, spec.name).toBe('ACCOUNT_PENDING_APPROVAL');
      expect(v.reason).toMatch(/administrator/i);
    }
    expect((AUTHZ_ERROR_CODES as readonly string[]).includes('ACCOUNT_PENDING_APPROVAL')).toBe(true);
    expect('ACCOUNT_PENDING_APPROVAL' in ERROR_CATALOG).toBe(true);
  });

  it("checkRoleChange: 'none' is a valid target; demoting the last admin to none is LAST_ADMIN", () => {
    const none = new Map<string, PrincipalRole>();
    expect(checkRoleChange({ principals: {}, overrides: new Map([['u@x', 'user']]), known: ['u@x'], id: 'u@x', role: 'none' })).toEqual({ ok: true });
    expect(checkRoleChange({ principals: {}, overrides: new Map([['b@x', 'admin']]), known: ['b@x'], id: 'b@x', role: 'none' })).toMatchObject({ ok: false, code: 'LAST_ADMIN' });
    expect(checkRoleChange({ principals: { 'r@x': { role: 'admin' } }, overrides: none, known: ['r@x'], id: 'r@x', role: 'none' })).toMatchObject({ ok: false, code: 'ROLE_LOCKED' });
  });

  it("principal_set_role accepts role 'none'", () => {
    const spec = TOOL_SPECS.find((s) => s.name === 'principal_set_role')!;
    const role = (spec.inputSchema as unknown as { properties: Record<string, { enum?: unknown[] }> }).properties['role']!;
    expect(role.enum).toEqual(['admin', 'author', 'user', 'none', null]);
    expect(spec.description).toContain('ACCOUNT_PENDING_APPROVAL');
  });
});
