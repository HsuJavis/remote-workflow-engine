// Dashboard auth spec §A2 (2026-09-30): `principals_list` / `principal_set_role` — admin-only MCP
// tools over ONE backend (PrincipalAdmin), which the dashboard admin page also calls. A role
// change is visible to the very next role resolution (no restart), config admins are locked, the
// last admin cannot be demoted, and every change is audited (updatedBy/updatedAt + a log line).
import { describe, it, expect, vi } from 'vitest';
import Database from 'better-sqlite3';
import { callTool, type ToolDeps } from '../../src/call-tool.js';
import { TOOL_SPECS } from '../../src/tool-specs.js';
import { ERROR_CATALOG } from '../../src/errors.js';
import { RoleStore } from '../../src/auth/role-store.js';
import { PrincipalAdmin } from '../../src/auth/principal-admin.js';
import type { Principal, Role } from '../../src/authz.js';

const NOOP_LOOKUP = { runOwner: () => undefined, workflowOwner: () => undefined, triggerOwner: () => undefined };

function setup(principals: Record<string, { role: Role }> = { 'root@x.com': { role: 'admin' }, 'alice@x.com': { role: 'author' } }) {
  const store = new RoleStore(new Database(':memory:'), { clock: () => Date.UTC(2026, 8, 30) });
  const admin = new PrincipalAdmin({ store, principals, authEnabled: true });
  const deps = { lookup: NOOP_LOOKUP, principals: admin } as unknown as ToolDeps;
  return { store, admin, deps };
}
const ROOT: Principal = { kind: 'admin', id: 'root@x.com' };
const parse = (r: unknown) => r as { status?: string; code?: string; error?: { code?: string; message?: string }; result?: any };

describe('principals_list / principal_set_role specs', () => {
  it('both rows exist, are admin-only with no ownership, and every declared error code is catalogued', () => {
    for (const name of ['principals_list', 'principal_set_role']) {
      const spec = TOOL_SPECS.find((s) => s.name === name);
      expect(spec, name).toBeDefined();
      expect(spec!.authz).toEqual({ minRole: 'admin', ownership: 'none' });
      for (const code of spec!.errors) expect(code in ERROR_CATALOG, code).toBe(true);
    }
    expect('ROLE_LOCKED' in ERROR_CATALOG).toBe(true);
    expect('LAST_ADMIN' in ERROR_CATALOG).toBe(true);
  });

  it('principal_set_role.role is the closed enum admin|author|user|none or null', () => {
    const spec = TOOL_SPECS.find((s) => s.name === 'principal_set_role')!;
    const role = (spec.inputSchema as unknown as { properties: Record<string, { enum?: unknown[] }> }).properties['role']!;
    expect(role.enum).toEqual(['admin', 'author', 'user', 'none', null]);
  });
});

describe('principals_list / principal_set_role behaviour', () => {
  it('a non-admin is refused FORBIDDEN_ROLE on both tools', async () => {
    const { deps } = setup();
    const author: Principal = { kind: 'author', id: 'alice@x.com' };
    expect(parse(await callTool(deps, 'principals_list', {}, author)).code).toBe('FORBIDDEN_ROLE');
    expect(parse(await callTool(deps, 'principal_set_role', { id: 'bob@x.com', role: 'admin' }, author)).code).toBe('FORBIDDEN_ROLE');
  });

  it('lists config principals with their sources, plus seen principals', async () => {
    const { deps, store } = setup({ 'root@x.com': { role: 'admin' }, 'alice@x.com': { role: 'author' }, '*': { role: 'user' } });
    store.markSeen('bob@x.com');
    const r = parse(await callTool(deps, 'principals_list', {}, ROOT));
    expect(r.result.authEnabled).toBe(true);
    const byId: Record<string, any> = Object.fromEntries((r.result.principals as Array<{ id: string }>).map((p) => [p.id, p]));
    expect(Object.keys(byId).sort()).toEqual(['alice@x.com', 'bob@x.com', 'root@x.com']);
    expect(byId['root@x.com']).toMatchObject({ role: 'admin', source: 'config-locked', lastSeenAt: null });
    expect(byId['alice@x.com']).toMatchObject({ role: 'author', source: 'config' });
    expect(byId['bob@x.com']).toMatchObject({ role: 'user', source: 'default' });
    expect(typeof byId['bob@x.com'].lastSeenAt).toBe('string');
  });

  it('a role change takes effect on the next resolution, is audited, and null removes the override', async () => {
    const { deps, admin } = setup();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      expect(admin.resolve('bob@x.com')).toBe('none');
      const r = parse(await callTool(deps, 'principal_set_role', { id: 'bob@x.com', role: 'author' }, ROOT));
      expect(r.status).toBe('completed');
      expect(r.result).toMatchObject({ id: 'bob@x.com', role: 'author', source: 'db', updatedBy: 'root@x.com' });
      expect(admin.resolve('bob@x.com')).toBe('author');
      expect(log.mock.calls.map((c) => String(c[0])).some((l) => l.includes('principal_role_changed') && l.includes('bob@x.com'))).toBe(true);
      const cleared = parse(await callTool(deps, 'principal_set_role', { id: 'bob@x.com', role: null }, ROOT));
      expect(cleared.result).toMatchObject({ id: 'bob@x.com', role: 'none', source: 'default' });
      expect(admin.resolve('bob@x.com')).toBe('none');
    } finally {
      log.mockRestore();
    }
  });

  it('refuses ROLE_LOCKED for a config admin and LAST_ADMIN for the last DB admin', async () => {
    const { deps } = setup({});
    const r1 = parse(await callTool(setup().deps, 'principal_set_role', { id: 'root@x.com', role: 'user' }, ROOT));
    expect(r1.code).toBe('ROLE_LOCKED');
    // a deployment with no config admin: bob is made admin, then bob tries to step down alone
    await callTool(deps, 'principal_set_role', { id: 'bob@x.com', role: 'admin' }, { kind: 'auth-disabled' });
    const bob: Principal = { kind: 'admin', id: 'bob@x.com' };
    const r2 = parse(await callTool(deps, 'principal_set_role', { id: 'bob@x.com', role: 'user' }, bob));
    expect(r2.code).toBe('LAST_ADMIN');
  });

  it('an out-of-enum role is refused INVALID_ARGUMENT by the schema', async () => {
    const { deps } = setup();
    expect(parse(await callTool(deps, 'principal_set_role', { id: 'bob@x.com', role: 'owner' }, ROOT)).code).toBe('INVALID_ARGUMENT');
  });
});
