// Service accounts spec (owner decision 2026-10-03), §Model: "Role resolution: service accounts
// resolve their role from their own row (not principal_roles/config)". PrincipalAdmin is the ONE
// place `server.ts`'s `principalFor(id)` reads a role from, so a `sa:<name>` id must be
// special-cased here rather than falling into `roleWithSource`'s config/db precedence.
//
// Cases:
//   resolve(id) for a live sa: id returns the service account's OWN role, never roleWithSource's.
//   resolve(id) for a disabled/unknown sa: id returns 'none' (the bearer-layer re-check in
//     server.ts is what actually refuses a disabled SA with SERVICE_ACCOUNT_DISABLED before this is
//     ever reached in production — this is the safe fallback if it somehow is).
//   workflowsFor(id) returns the account's non-empty allowlist, undefined otherwise (unset,
//     not-a-service-account, or empty array — "empty/absent = no restriction").
//   list()/principals_list include service accounts with kind:'service' (human principals keep
//     kind:'human'), even one that has never authenticated yet (pre-provisioning, like a human
//     principal pre-listed in rwe.config.json).
//   setRole/setQuota refuse a sa: id with INVALID_ARGUMENT pointing at the dedicated SA tools —
//     mutating a service account's role/quota through the human principal tools would silently not
//     take effect (resolve()/quotaFor() never consult the override for an sa: id) and must not
//     look like it worked.
//
// Red reason: PrincipalAdmin has no `serviceAccounts` constructor dependency, no `workflowsFor`
// method, and `resolve()`/`list()`/`setRole()`/`setQuota()` are unaware of `sa:` ids — every case
// below either throws (no such method) or exercises the WRONG (roleWithSource) code path.
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { RoleStore } from '../../src/auth/role-store.js';
import { PrincipalAdmin } from '../../src/auth/principal-admin.js';
import { ServiceAccountStore } from '../../src/auth/service-account-store.js';

function makeFakeCsprng(seed = 0) {
  let counter = seed;
  return (n: number) => {
    const buf = Buffer.alloc(n);
    for (let i = 0; i < n; i++) buf[i] = (counter++ + i) & 0xff;
    return buf;
  };
}

function setup() {
  const db = new Database(':memory:');
  const clock = () => Date.UTC(2026, 9, 3);
  const roleStore = new RoleStore(db, { clock });
  const serviceAccounts = new ServiceAccountStore(db, { clock, csprng: makeFakeCsprng() });
  const admin = new PrincipalAdmin({ store: roleStore, principals: { 'root@x.com': { role: 'admin' } }, authEnabled: true, serviceAccounts });
  return { admin, serviceAccounts };
}

describe('PrincipalAdmin — service account awareness (service accounts spec §Model)', () => {
  it('resolve() reads a live sa: id\'s OWN role, never principal_roles/config precedence', () => {
    const { admin, serviceAccounts } = setup();
    serviceAccounts.create({ name: 'ci-bot', role: 'author', createdBy: 'root@x.com' });
    expect(admin.resolve('sa:ci-bot')).toBe('author');
  });

  it('resolve() for an unknown/disabled sa: id falls back to \'none\' (production refuses it earlier, at the bearer layer)', () => {
    const { admin, serviceAccounts } = setup();
    expect(admin.resolve('sa:nope')).toBe('none');
    serviceAccounts.create({ name: 'ci-bot', role: 'user', createdBy: 'root@x.com' });
    serviceAccounts.update('ci-bot', { disabled: true }, 'root@x.com');
    expect(admin.resolve('sa:ci-bot')).toBe('none');
  });

  it('workflowsFor() returns the allowlist, or undefined when unset/empty/not-a-service-account', () => {
    const { admin, serviceAccounts } = setup();
    serviceAccounts.create({ name: 'scoped', role: 'author', workflows: ['foo', 'bar'], createdBy: 'root@x.com' });
    serviceAccounts.create({ name: 'unscoped', role: 'user', createdBy: 'root@x.com' });
    expect(admin.workflowsFor('sa:scoped')).toEqual(['foo', 'bar']);
    expect(admin.workflowsFor('sa:unscoped')).toBeUndefined();
    expect(admin.workflowsFor('root@x.com')).toBeUndefined();
  });

  it('list() shows a human principal as kind:\'human\' and a service account as kind:\'service\', including one never yet exchanged', () => {
    const { admin, serviceAccounts } = setup();
    serviceAccounts.create({ name: 'ci-bot', role: 'user', createdBy: 'root@x.com' });
    const { principals } = admin.list();
    const byId = Object.fromEntries(principals.map((p) => [p.id, p]));
    expect(byId['root@x.com']?.kind).toBe('human');
    expect(byId['sa:ci-bot']?.kind).toBe('service');
    expect(byId['sa:ci-bot']?.role).toBe('user');
  });

  it('setRole refuses a sa: id with INVALID_ARGUMENT pointing at service_account_update', () => {
    const { admin, serviceAccounts } = setup();
    serviceAccounts.create({ name: 'ci-bot', role: 'user', createdBy: 'root@x.com' });
    const out = admin.setRole('sa:ci-bot', 'author', 'root@x.com');
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe('INVALID_ARGUMENT');
    expect(out.reason).toMatch(/service_account_update/);
    // and it really had no effect:
    expect(admin.resolve('sa:ci-bot')).toBe('user');
  });

  it('setQuota still works normally for a sa: id — CAS quota is a separate, per-id override with no service_account_* equivalent', () => {
    const { admin, serviceAccounts } = setup();
    serviceAccounts.create({ name: 'ci-bot', role: 'user', createdBy: 'root@x.com' });
    const out = admin.setQuota('sa:ci-bot', '5GiB', 'root@x.com');
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.entry.quota.limitBytes).toBe(5 * 1024 ** 3);
  });

  // Send-back D2: a quota staged for a never-created (or deleted) sa: id would otherwise sit ready
  // to apply the moment that name could be reused — closed alongside the SERVICE_ACCOUNT_NAME_
  // RETIRED tombstone (service-account-store.test.ts), here for the id that never existed at all.
  it('setQuota refuses an sa: id that was never created', () => {
    const { admin } = setup();
    const out = admin.setQuota('sa:never-existed', '5GiB', 'root@x.com');
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe('SERVICE_ACCOUNT_NOT_FOUND');
  });

  it('setQuota refuses an sa: id that was deleted', () => {
    const { admin, serviceAccounts } = setup();
    serviceAccounts.create({ name: 'ci-bot', role: 'user', createdBy: 'root@x.com' });
    serviceAccounts.delete('ci-bot', 'root@x.com');
    const out = admin.setQuota('sa:ci-bot', '5GiB', 'root@x.com');
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe('SERVICE_ACCOUNT_NOT_FOUND');
  });
});
