// Dashboard auth spec §A2 (2026-09-30): runtime-editable roles. `resolveRole` precedence is
// config admin (LOCKED) > DB override > config principals[id] > config '*' > 'user', and
// `checkRoleChange` refuses the two lockout shapes: demoting a config admin (ROLE_LOCKED) and a
// change that would leave zero admins (LAST_ADMIN). Pure — no store, no clock.
import { describe, it, expect } from 'vitest';
import { resolveRole, roleWithSource, checkRoleChange, type Role } from '../../src/authz.js';

const CFG = {
  'root@x.com': { role: 'admin' as Role },
  'alice@x.com': { role: 'author' as Role },
};

describe('resolveRole precedence (spec §A2)', () => {
  it('keeps the 2-argument form: config entry, then "*", then user', () => {
    expect(resolveRole(CFG, 'alice@x.com')).toBe('author');
    expect(resolveRole({ '*': { role: 'author' } }, 'bob@x.com')).toBe('author');
    expect(resolveRole(CFG, 'bob@x.com')).toBe('user');
    expect(resolveRole(undefined, 'bob@x.com')).toBe('user');
  });

  it('a DB override beats config principals[id] and "*"', () => {
    expect(resolveRole(CFG, 'alice@x.com', 'user')).toBe('user');
    expect(resolveRole({ '*': { role: 'author' } }, 'bob@x.com', 'admin')).toBe('admin');
    expect(resolveRole(undefined, 'bob@x.com', 'author')).toBe('author');
  });

  it('a config admin is LOCKED: a DB override can never demote it', () => {
    expect(resolveRole(CFG, 'root@x.com', 'user')).toBe('admin');
  });

  it('roleWithSource names where the answer came from', () => {
    expect(roleWithSource(CFG, 'root@x.com', 'user')).toEqual({ role: 'admin', source: 'config-locked' });
    expect(roleWithSource(CFG, 'alice@x.com', 'admin')).toEqual({ role: 'admin', source: 'db' });
    expect(roleWithSource(CFG, 'alice@x.com')).toEqual({ role: 'author', source: 'config' });
    expect(roleWithSource({ '*': { role: 'author' } }, 'bob@x.com')).toEqual({ role: 'author', source: 'default' });
    expect(roleWithSource(undefined, 'bob@x.com')).toEqual({ role: 'user', source: 'default' });
  });
});

describe('checkRoleChange lockout rules (spec §A2)', () => {
  const none = new Map<string, Role>();

  it('refuses any change to a config admin with ROLE_LOCKED', () => {
    const v = checkRoleChange({ principals: CFG, overrides: none, known: ['root@x.com'], id: 'root@x.com', role: 'user' });
    expect(v).toMatchObject({ ok: false, code: 'ROLE_LOCKED' });
    const v2 = checkRoleChange({ principals: CFG, overrides: none, known: ['root@x.com'], id: 'root@x.com', role: null });
    expect(v2).toMatchObject({ ok: false, code: 'ROLE_LOCKED' });
  });

  it('refuses demoting the last (DB-granted) admin with LAST_ADMIN', () => {
    const overrides = new Map<string, Role>([['bob@x.com', 'admin']]);
    const v = checkRoleChange({ principals: { 'alice@x.com': { role: 'author' } }, overrides, known: ['alice@x.com', 'bob@x.com'], id: 'bob@x.com', role: 'author' });
    expect(v).toMatchObject({ ok: false, code: 'LAST_ADMIN' });
    // removing the override is also a demotion (bob falls back to 'user')
    const v2 = checkRoleChange({ principals: {}, overrides, known: ['bob@x.com'], id: 'bob@x.com', role: null });
    expect(v2).toMatchObject({ ok: false, code: 'LAST_ADMIN' });
  });

  it('allows demoting an admin while another admin remains (a config admin counts)', () => {
    const overrides = new Map<string, Role>([['bob@x.com', 'admin']]);
    expect(checkRoleChange({ principals: CFG, overrides, known: ['root@x.com', 'bob@x.com'], id: 'bob@x.com', role: 'user' })).toEqual({ ok: true });
  });

  it('allows promotions and changes to non-admins even when there are no admins at all', () => {
    expect(checkRoleChange({ principals: {}, overrides: none, known: ['a@x.com'], id: 'a@x.com', role: 'author' })).toEqual({ ok: true });
    expect(checkRoleChange({ principals: {}, overrides: none, known: [], id: 'new@x.com', role: 'admin' })).toEqual({ ok: true });
  });

  it('refuses the wildcard id "*" (it is a config default, not a principal)', () => {
    expect(checkRoleChange({ principals: {}, overrides: none, known: [], id: '*', role: 'admin' })).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT' });
  });
});
