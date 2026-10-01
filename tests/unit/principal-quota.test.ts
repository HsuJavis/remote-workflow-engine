// Owner decision 2026-10-02 (per-principal CAS quota, admin surface): the effective quota is a
// per-principal OVERRIDE (auth DB, next to the role overrides) else the role default from
// `casQuota`; principals_list rows carry {usedBytes, limitBytes, source}; `principal_set_quota`
// (admin only, audited like role changes) sets or clears the override.
import { describe, it, expect, vi } from 'vitest';
import Database from 'better-sqlite3';
import { callTool, type ToolDeps } from '../../src/call-tool.js';
import { TOOL_SPECS } from '../../src/tool-specs.js';
import { ERROR_CATALOG } from '../../src/errors.js';
import { RoleStore } from '../../src/auth/role-store.js';
import { PrincipalAdmin } from '../../src/auth/principal-admin.js';
import type { Principal, Role } from '../../src/authz.js';

const GiB = 1024 ** 3;
const NOOP_LOOKUP = { runOwner: () => undefined, workflowOwner: () => undefined, triggerOwner: () => undefined };
const usage: Record<string, number> = { 'alice@x.com': 123, 'bob@x.com': 7 };

function setup(principals: Record<string, { role: Role }> = { 'root@x.com': { role: 'admin' }, 'alice@x.com': { role: 'author' }, 'bob@x.com': { role: 'user' } }) {
  const store = new RoleStore(new Database(':memory:'), { clock: () => Date.UTC(2026, 9, 2) });
  const admin = new PrincipalAdmin({ store, principals, authEnabled: true, quota: { defaults: { user: GiB, author: 5 * GiB, admin: null }, usage: (id) => usage[id] ?? 0 } });
  const deps = { lookup: NOOP_LOOKUP, principals: admin } as unknown as ToolDeps;
  return { store, admin, deps };
}
const ROOT: Principal = { kind: 'admin', id: 'root@x.com' };
const parse = (r: unknown) => r as { status?: string; code?: string; error?: { code?: string; message?: string }; result?: any };

describe('quota resolution', () => {
  it('role default per role; none = 0; an override wins and can be unlimited', () => {
    const { admin, store } = setup();
    expect(admin.quotaFor('root@x.com')).toEqual({ limitBytes: null, source: 'role-default' });
    expect(admin.quotaFor('alice@x.com')).toEqual({ limitBytes: 5 * GiB, source: 'role-default' });
    expect(admin.quotaFor('bob@x.com')).toEqual({ limitBytes: GiB, source: 'role-default' });
    expect(admin.quotaFor('stranger@x.com')).toEqual({ limitBytes: 0, source: 'role-default' }); // pending
    store.setQuotaOverride('bob@x.com', 10 * GiB, 'root@x.com');
    expect(admin.quotaFor('bob@x.com')).toEqual({ limitBytes: 10 * GiB, source: 'override' });
    store.setQuotaOverride('bob@x.com', 'unlimited', 'root@x.com');
    expect(admin.quotaFor('bob@x.com')).toEqual({ limitBytes: null, source: 'override' });
    store.setQuotaOverride('bob@x.com', null, 'root@x.com');
    expect(admin.quotaFor('bob@x.com')).toEqual({ limitBytes: GiB, source: 'role-default' });
  });

  it('principals_list rows carry quota {usedBytes, limitBytes, source}', async () => {
    const { deps, store } = setup();
    store.setQuotaOverride('alice@x.com', 2 * GiB, 'root@x.com');
    const r = parse(await callTool(deps, 'principals_list', {}, ROOT));
    const byId: Record<string, any> = Object.fromEntries((r.result.principals as Array<{ id: string }>).map((p) => [p.id, p]));
    expect(byId['alice@x.com'].quota).toMatchObject({ usedBytes: 123, limitBytes: 2 * GiB, source: 'override', updatedBy: 'root@x.com' });
    expect(byId['bob@x.com'].quota).toEqual({ usedBytes: 7, limitBytes: GiB, source: 'role-default' });
    expect(byId['root@x.com'].quota).toEqual({ usedBytes: 0, limitBytes: null, source: 'role-default' });
  });
});

describe('principal_set_quota', () => {
  it('spec: admin-only, no ownership, every declared error catalogued; QUOTA_EXCEEDED and DISK_LOW are catalogued', () => {
    const spec = TOOL_SPECS.find((s) => s.name === 'principal_set_quota');
    expect(spec).toBeDefined();
    expect(spec!.authz).toEqual({ minRole: 'admin', ownership: 'none' });
    for (const code of spec!.errors) expect(code in ERROR_CATALOG, code).toBe(true);
    expect('QUOTA_EXCEEDED' in ERROR_CATALOG).toBe(true);
    expect('DISK_LOW' in ERROR_CATALOG).toBe(true);
  });

  it('a non-admin is refused FORBIDDEN_ROLE', async () => {
    const { deps } = setup();
    const author: Principal = { kind: 'author', id: 'alice@x.com' };
    expect(parse(await callTool(deps, 'principal_set_quota', { id: 'alice@x.com', limit: '100GiB' }, author)).code).toBe('FORBIDDEN_ROLE');
  });

  it('sets bytes / a human size / unlimited, clears with null, and logs an audit line', async () => {
    const { deps, admin } = setup();
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      let r = parse(await callTool(deps, 'principal_set_quota', { id: 'bob@x.com', limit: '2GiB' }, ROOT));
      expect(r.status).toBe('completed');
      expect(r.result.quota).toMatchObject({ limitBytes: 2 * GiB, source: 'override', updatedBy: 'root@x.com' });
      r = parse(await callTool(deps, 'principal_set_quota', { id: 'bob@x.com', limit: 4096 }, ROOT));
      expect(admin.quotaFor('bob@x.com').limitBytes).toBe(4096);
      r = parse(await callTool(deps, 'principal_set_quota', { id: 'bob@x.com', limit: 'unlimited' }, ROOT));
      expect(admin.quotaFor('bob@x.com')).toEqual({ limitBytes: null, source: 'override' });
      r = parse(await callTool(deps, 'principal_set_quota', { id: 'bob@x.com', limit: null }, ROOT));
      expect(r.result.quota).toEqual({ usedBytes: 7, limitBytes: GiB, source: 'role-default' });
      const lines = log.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('principal_quota_changed'));
      expect(lines).toHaveLength(4);
      expect(JSON.parse(lines[0]!)).toMatchObject({ event: 'principal_quota_changed', id: 'bob@x.com', previous: GiB, limitBytes: 2 * GiB, by: 'root@x.com' });
    } finally { log.mockRestore(); }
  });

  it("refuses INVALID_ARGUMENT for '*' and for an unparseable size", async () => {
    const { deps } = setup();
    expect(parse(await callTool(deps, 'principal_set_quota', { id: '*', limit: 10 }, ROOT)).code).toBe('INVALID_ARGUMENT');
    expect(parse(await callTool(deps, 'principal_set_quota', { id: 'bob@x.com', limit: 'loads' }, ROOT)).code).toBe('INVALID_ARGUMENT');
  });
});
