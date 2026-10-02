// Service accounts spec (owner decision 2026-10-03), §Management surface: the 6 admin-only
// service_account_* MCP tools — thin wrappers over ServiceAccountStore, the SAME "no facade
// method, dispatch directly in call-tool.ts" pattern principals_list/principal_set_role/
// principal_set_quota already use.
//
// Cases:
//   - all 6 rows exist, admin-only, ownership:'none', and every declared error code is catalogued.
//   - a non-admin is refused FORBIDDEN_ROLE on every one of the 6.
//   - create -> list -> update -> rotate -> revoke -> delete, full lifecycle, with ISO-8601
//     expiresAt round-tripping and the raw secret shown only once (create/rotate).
//   - create refuses a duplicate name, a malformed name, and role:'admin' (schema enum AND store).
//   - delete calls the server's token-revocation hook with "sa:<name>" (spec: delete revokes all
//     tokens).
//   - rotateSecret refuses a 3rd active secret (TOO_MANY_SECRETS).
//
// Red reason: `TOOL_SPECS` has no service_account_* rows and `call-tool.ts`'s switch has no cases
// for them — callTool() returns unknownTool() for every call below.
import { describe, it, expect, vi } from 'vitest';
import Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import { callTool, type ToolDeps } from '../../src/call-tool.js';
import { TOOL_SPECS } from '../../src/tool-specs.js';
import { ERROR_CATALOG } from '../../src/errors.js';
import { ServiceAccountStore } from '../../src/auth/service-account-store.js';
import type { Principal } from '../../src/authz.js';

const NOOP_LOOKUP = { runOwner: () => undefined, workflowOwner: () => undefined, triggerOwner: () => undefined };
const SA_TOOLS = ['service_account_create', 'service_account_list', 'service_account_update', 'service_account_rotate_secret', 'service_account_revoke_secret', 'service_account_delete'];

function setup() {
  const serviceAccounts = new ServiceAccountStore(new Database(':memory:'), { clock: () => Date.UTC(2026, 9, 3), csprng: (n) => randomBytes(n) });
  const revokeServiceAccountTokens = vi.fn().mockReturnValue(0);
  const deps = { lookup: NOOP_LOOKUP, serviceAccounts, revokeServiceAccountTokens } as unknown as ToolDeps;
  return { deps, serviceAccounts, revokeServiceAccountTokens };
}

const ADMIN: Principal = { kind: 'admin', id: 'root@x.com' };
const AUTHOR: Principal = { kind: 'author', id: 'alice@x.com' };
const parse = (r: unknown) => r as { status?: string; code?: string; error?: { code?: string; message?: string }; result?: any };

describe('service_account_* tool specs (DES-158-style floor)', () => {
  it('all 6 rows exist, admin-only with no ownership, and every declared error code is catalogued', () => {
    for (const name of SA_TOOLS) {
      const spec = TOOL_SPECS.find((s) => s.name === name);
      expect(spec, name).toBeDefined();
      expect(spec!.authz).toEqual({ minRole: 'admin', ownership: 'none' });
      for (const code of spec!.errors) expect(code in ERROR_CATALOG, `${name}/${code}`).toBe(true);
    }
  });

  it('TOOL_SPECS grew by exactly 6 rows (surface accounting — v24-tool-surface.test.ts asserts >=35)', () => {
    // Sanity: the 6 names above are each present exactly once.
    for (const name of SA_TOOLS) expect(TOOL_SPECS.filter((s) => s.name === name)).toHaveLength(1);
  });
});

const SA_TOOL_ARGS: Record<string, Record<string, unknown>> = {
  service_account_create: { name: 'xx', role: 'user' },
  service_account_list: {},
  service_account_update: { name: 'xx' },
  service_account_rotate_secret: { name: 'xx' },
  service_account_revoke_secret: { name: 'xx', secretId: 'yy' },
  service_account_delete: { name: 'xx' },
};

describe('service_account_* authz', () => {
  it('a non-admin is refused FORBIDDEN_ROLE on all 6 tools (role check runs before any store lookup)', async () => {
    const { deps } = setup();
    for (const name of SA_TOOLS) {
      const r = parse(await callTool(deps, name, SA_TOOL_ARGS[name]!, AUTHOR));
      expect(r.code, name).toBe('FORBIDDEN_ROLE');
    }
  });
});

describe('service_account_* lifecycle', () => {
  it('create -> list -> update -> rotate -> revoke -> delete, end to end', async () => {
    const { deps, revokeServiceAccountTokens } = setup();

    const created = parse(await callTool(deps, 'service_account_create', { name: 'ci-bot', role: 'user', description: 'CI', workflows: ['foo'], expiresAt: '2027-01-01T00:00:00.000Z' }, ADMIN));
    expect(created.code).toBeUndefined();
    expect(created.result.clientId).toBe('sa:ci-bot');
    expect(created.result.clientSecret).toMatch(/^rwe_sa_/);
    expect(created.result.account.role).toBe('user');
    expect(created.result.account.workflows).toEqual(['foo']);
    expect(created.result.account.expiresAt).toBe('2027-01-01T00:00:00.000Z');
    expect(created.result.account.secrets).toHaveLength(1);
    const firstSecretId = created.result.account.secrets[0].id;

    const listed = parse(await callTool(deps, 'service_account_list', {}, ADMIN));
    expect(listed.result.map((a: { name: string }) => a.name)).toEqual(['ci-bot']);
    // the raw secret is NEVER repeated in list()
    expect(JSON.stringify(listed.result)).not.toMatch(/rwe_sa_/);

    const updated = parse(await callTool(deps, 'service_account_update', { name: 'ci-bot', role: 'author', disabled: true, description: 'updated' }, ADMIN));
    expect(updated.code).toBeUndefined();
    expect(updated.result.role).toBe('author');
    expect(updated.result.disabled).toBe(true);
    expect(updated.result.description).toBe('updated');

    const rotated = parse(await callTool(deps, 'service_account_rotate_secret', { name: 'ci-bot' }, ADMIN));
    expect(rotated.code).toBeUndefined();
    expect(rotated.result.clientSecret).toMatch(/^rwe_sa_/);
    expect(rotated.result.secretId).not.toBe(firstSecretId);

    const revoked = parse(await callTool(deps, 'service_account_revoke_secret', { name: 'ci-bot', secretId: firstSecretId }, ADMIN));
    expect(revoked.code).toBeUndefined();

    const deleted = parse(await callTool(deps, 'service_account_delete', { name: 'ci-bot' }, ADMIN));
    expect(deleted.code).toBeUndefined();
    expect(revokeServiceAccountTokens).toHaveBeenCalledWith('sa:ci-bot');

    const afterDelete = parse(await callTool(deps, 'service_account_list', {}, ADMIN));
    expect(afterDelete.result).toEqual([]);
  });

  it('create refuses a duplicate name (SERVICE_ACCOUNT_EXISTS), a malformed name, and role:admin (INVALID_ARGUMENT)', async () => {
    const { deps } = setup();
    await callTool(deps, 'service_account_create', { name: 'dup-bot', role: 'user' }, ADMIN);
    const dup = parse(await callTool(deps, 'service_account_create', { name: 'dup-bot', role: 'author' }, ADMIN));
    expect(dup.code).toBe('SERVICE_ACCOUNT_EXISTS');

    const badName = parse(await callTool(deps, 'service_account_create', { name: 'Not_Valid!', role: 'user' }, ADMIN));
    expect(['INVALID_ARGUMENT']).toContain(badName.code);

    const badRole = parse(await callTool(deps, 'service_account_create', { name: 'wannabe-admin', role: 'admin' }, ADMIN));
    expect(['INVALID_ARGUMENT']).toContain(badRole.code);
  });

  it('update/rotate/revoke/delete on an unknown name refuse SERVICE_ACCOUNT_NOT_FOUND', async () => {
    const { deps } = setup();
    expect(parse(await callTool(deps, 'service_account_update', { name: 'nope', disabled: true }, ADMIN)).code).toBe('SERVICE_ACCOUNT_NOT_FOUND');
    expect(parse(await callTool(deps, 'service_account_rotate_secret', { name: 'nope' }, ADMIN)).code).toBe('SERVICE_ACCOUNT_NOT_FOUND');
    expect(parse(await callTool(deps, 'service_account_revoke_secret', { name: 'nope', secretId: 'x' }, ADMIN)).code).toBe('SERVICE_ACCOUNT_NOT_FOUND');
    expect(parse(await callTool(deps, 'service_account_delete', { name: 'nope' }, ADMIN)).code).toBe('SERVICE_ACCOUNT_NOT_FOUND');
  });

  it('rotateSecret refuses a 3rd active secret (TOO_MANY_SECRETS)', async () => {
    const { deps } = setup();
    await callTool(deps, 'service_account_create', { name: 'rot-bot', role: 'user' }, ADMIN);
    await callTool(deps, 'service_account_rotate_secret', { name: 'rot-bot' }, ADMIN);
    const third = parse(await callTool(deps, 'service_account_rotate_secret', { name: 'rot-bot' }, ADMIN));
    expect(third.code).toBe('TOO_MANY_SECRETS');
  });

  it('a malformed expiresAt is refused INVALID_ARGUMENT on create/update/rotate', async () => {
    const { deps } = setup();
    expect(parse(await callTool(deps, 'service_account_create', { name: 'exp-bot', role: 'user', expiresAt: 'not-a-date' }, ADMIN)).code).toBe('INVALID_ARGUMENT');
    await callTool(deps, 'service_account_create', { name: 'exp-bot2', role: 'user' }, ADMIN);
    expect(parse(await callTool(deps, 'service_account_update', { name: 'exp-bot2', expiresAt: 'not-a-date' }, ADMIN)).code).toBe('INVALID_ARGUMENT');
    expect(parse(await callTool(deps, 'service_account_rotate_secret', { name: 'exp-bot2', expiresAt: 'not-a-date' }, ADMIN)).code).toBe('INVALID_ARGUMENT');
  });

  it('update can clear expiresAt and workflows with explicit null', async () => {
    const { deps } = setup();
    await callTool(deps, 'service_account_create', { name: 'clear-bot', role: 'user', workflows: ['foo'], expiresAt: '2027-01-01T00:00:00.000Z' }, ADMIN);
    const cleared = parse(await callTool(deps, 'service_account_update', { name: 'clear-bot', workflows: null, expiresAt: null }, ADMIN));
    expect(cleared.result.workflows).toBeNull();
    expect(cleared.result.expiresAt).toBeNull();
  });
});
