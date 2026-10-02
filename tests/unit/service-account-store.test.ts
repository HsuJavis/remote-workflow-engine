// Service accounts spec (owner decision 2026-10-03): `ServiceAccountStore` — the storage layer
// behind the 6 `service_account_*` MCP tools and the /token client_credentials grant.
//
// Cases:
//   create: mints clientId `sa:<name>`, a raw secret `rwe_sa_<...>` (shown once), stores only its
//     sha256; refuses a bad name, an 'admin' role, and a duplicate name.
//   get/list: never return a secret's raw value or hash, only {id, createdAt, expiresAt, lastUsedAt}.
//   update: role/workflows/description/disabled/expiresAt patch; refuses an unknown name and an
//     'admin' role.
//   rotateSecret: mints a second active secret (up to 2); refuses a 3rd (TOO_MANY_SECRETS) and an
//     unknown name.
//   revokeSecret: removes one secret by id; refuses an unknown secretId/name.
//   delete: removes the account + its secrets.
//   verifyCredentials: constant-time; returns the live row for a correct id+secret, null for an
//     unknown client, a wrong secret, a disabled account, or an expired account/secret.
//   isLive: the per-request re-check an already-issued bearer needs (disabled/expired/deleted).
//
// Red reason: `src/auth/service-account-store.ts` does not exist → MODULE NOT FOUND → all tests
//   fail at collect time. Correct red for an unimplemented module.
//
// Mock policy (unit): in-memory SQLite (:memory:), injected deterministic clock + csprng — same
// seam convention as token-store.test.ts / TokenStoreSeams.

import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { ServiceAccountStore } from '../../src/auth/service-account-store.js';

function makeFakeCsprng(seed = 0) {
  let counter = seed;
  return (n: number) => {
    const buf = Buffer.alloc(n);
    for (let i = 0; i < n; i++) buf[i] = (counter++ + i) & 0xff;
    return buf;
  };
}

const BASE_MS = Date.UTC(2026, 0, 1);
const DAY_MS = 86_400_000;

function makeStore(nowMs: number = BASE_MS) {
  const db = new Database(':memory:');
  let now = nowMs;
  const clock = () => now;
  const csprng = makeFakeCsprng();
  const store = new ServiceAccountStore(db, { clock, csprng });
  return { store, db, setNow: (t: number) => { now = t; } };
}

describe('ServiceAccountStore.create (service accounts spec)', () => {
  it('mints clientId sa:<name> and a raw secret shown once, storing only its sha256', () => {
    const { store, db } = makeStore();
    const out = store.create({ name: 'ci-bot', role: 'user', createdBy: 'admin@x.com' });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.clientId).toBe('sa:ci-bot');
    expect(out.clientSecret.startsWith('rwe_sa_')).toBe(true);
    const row = db.prepare('SELECT secret_hash FROM service_account_secrets WHERE name = ?').get('ci-bot') as { secret_hash: string };
    expect(row.secret_hash).toBe(createHash('sha256').update(out.clientSecret).digest('hex'));
    expect(row.secret_hash).not.toContain(out.clientSecret);
  });

  it('refuses a malformed name', () => {
    const { store } = makeStore();
    const out = store.create({ name: 'CI_Bot!', role: 'user', createdBy: 'admin@x.com' });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe('INVALID_ARGUMENT');
  });

  it('refuses role admin', () => {
    const { store } = makeStore();
    const out = store.create({ name: 'ci-bot', role: 'admin' as never, createdBy: 'admin@x.com' });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe('INVALID_ARGUMENT');
  });

  it('refuses a duplicate name', () => {
    const { store } = makeStore();
    store.create({ name: 'ci-bot', role: 'user', createdBy: 'admin@x.com' });
    const out = store.create({ name: 'ci-bot', role: 'author', createdBy: 'admin@x.com' });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe('SERVICE_ACCOUNT_EXISTS');
  });

  it('stores an optional workflows allowlist and expiresAt', () => {
    const { store } = makeStore();
    const out = store.create({ name: 'ci-bot', role: 'author', workflows: ['foo', 'bar'], expiresAt: BASE_MS + DAY_MS, createdBy: 'admin@x.com' });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.account.workflows).toEqual(['foo', 'bar']);
    expect(out.account.expiresAt).toBe(BASE_MS + DAY_MS);
    expect(out.account.disabled).toBe(false);
    expect(out.account.secrets).toHaveLength(1);
    expect(out.account.secrets[0]!.id).toBeTruthy();
  });
});

describe('ServiceAccountStore.get/list', () => {
  it('never exposes a secret hash or raw value', () => {
    const { store } = makeStore();
    store.create({ name: 'ci-bot', role: 'user', createdBy: 'admin@x.com' });
    const got = store.get('ci-bot')!;
    expect(got.secrets[0]).not.toHaveProperty('secretHash');
    expect(JSON.stringify(got)).not.toMatch(/rwe_sa_/);
  });

  it('get() returns undefined for an unknown name', () => {
    const { store } = makeStore();
    expect(store.get('nope')).toBeUndefined();
  });

  it('list() returns every account', () => {
    const { store } = makeStore();
    store.create({ name: 'aa', role: 'user', createdBy: 'x' });
    store.create({ name: 'bb', role: 'author', createdBy: 'x' });
    expect(store.list().map((a) => a.name).sort()).toEqual(['aa', 'bb']);
  });
});

describe('ServiceAccountStore.update', () => {
  it('patches role/workflows/description/disabled/expiresAt', () => {
    const { store } = makeStore();
    store.create({ name: 'ci-bot', role: 'user', createdBy: 'admin@x.com' });
    const out = store.update('ci-bot', { role: 'author', workflows: ['foo'], description: 'bot', disabled: true, expiresAt: BASE_MS + DAY_MS }, 'admin@x.com');
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.account.role).toBe('author');
    expect(out.account.workflows).toEqual(['foo']);
    expect(out.account.description).toBe('bot');
    expect(out.account.disabled).toBe(true);
    expect(out.account.expiresAt).toBe(BASE_MS + DAY_MS);
  });

  it('refuses an unknown name', () => {
    const { store } = makeStore();
    const out = store.update('nope', { disabled: true }, 'admin@x.com');
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe('SERVICE_ACCOUNT_NOT_FOUND');
  });

  it('refuses role admin', () => {
    const { store } = makeStore();
    store.create({ name: 'ci-bot', role: 'user', createdBy: 'x' });
    const out = store.update('ci-bot', { role: 'admin' as never }, 'admin@x.com');
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe('INVALID_ARGUMENT');
  });
});

describe('ServiceAccountStore.rotateSecret / revokeSecret', () => {
  it('mints a second active secret, up to 2', () => {
    const { store } = makeStore();
    const created = store.create({ name: 'ci-bot', role: 'user', createdBy: 'x' });
    expect(created.ok).toBe(true);
    const rotated = store.rotateSecret('ci-bot', undefined, 'admin@x.com');
    expect(rotated.ok).toBe(true);
    if (!rotated.ok) return;
    expect(rotated.clientSecret.startsWith('rwe_sa_')).toBe(true);
    expect(store.get('ci-bot')!.secrets).toHaveLength(2);
  });

  it('refuses a 3rd active secret (TOO_MANY_SECRETS)', () => {
    const { store } = makeStore();
    store.create({ name: 'ci-bot', role: 'user', createdBy: 'x' });
    store.rotateSecret('ci-bot', undefined, 'admin@x.com');
    const out = store.rotateSecret('ci-bot', undefined, 'admin@x.com');
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe('TOO_MANY_SECRETS');
  });

  it('refuses rotate on an unknown name', () => {
    const { store } = makeStore();
    const out = store.rotateSecret('nope', undefined, 'admin@x.com');
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe('SERVICE_ACCOUNT_NOT_FOUND');
  });

  it('revokeSecret removes exactly that secret', () => {
    const { store } = makeStore();
    const created = store.create({ name: 'ci-bot', role: 'user', createdBy: 'x' });
    if (!created.ok) throw new Error('setup');
    const originalId = created.account.secrets[0]!.id;
    store.rotateSecret('ci-bot', undefined, 'admin@x.com');
    const out = store.revokeSecret('ci-bot', originalId, 'admin@x.com');
    expect(out.ok).toBe(true);
    expect(store.get('ci-bot')!.secrets).toHaveLength(1);
    expect(store.get('ci-bot')!.secrets[0]!.id).not.toBe(originalId);
  });

  it('refuses revokeSecret for an unknown secretId', () => {
    const { store } = makeStore();
    store.create({ name: 'ci-bot', role: 'user', createdBy: 'x' });
    const out = store.revokeSecret('ci-bot', 'nope', 'admin@x.com');
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe('SERVICE_ACCOUNT_SECRET_NOT_FOUND');
  });
});

describe('ServiceAccountStore.delete', () => {
  it('removes the account and its secrets', () => {
    const { store } = makeStore();
    store.create({ name: 'ci-bot', role: 'user', createdBy: 'x' });
    const out = store.delete('ci-bot', 'admin@x.com');
    expect(out.ok).toBe(true);
    expect(store.get('ci-bot')).toBeUndefined();
  });

  it('refuses an unknown name', () => {
    const { store } = makeStore();
    const out = store.delete('nope', 'admin@x.com');
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe('SERVICE_ACCOUNT_NOT_FOUND');
  });
});

// Send-back D2 (MEDIUM-HIGH, owner decision: tombstone deleted names): `sa:<name>` is the bare
// ownership string in the catalog/runs/webhooks/schedules/CAS namespace/known-principals ledger —
// re-creating a deleted name would silently inherit everything the old account ever touched.
describe('ServiceAccountStore tombstoning deleted names (send-back D2)', () => {
  it('delete() records a tombstone; create() with the same name is refused SERVICE_ACCOUNT_NAME_RETIRED', () => {
    const { store } = makeStore();
    store.create({ name: 'ci-bot', role: 'user', createdBy: 'x' });
    store.delete('ci-bot', 'admin@x.com');
    const out = store.create({ name: 'ci-bot', role: 'user', createdBy: 'admin@x.com' });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe('SERVICE_ACCOUNT_NAME_RETIRED');
  });

  it('a name that was never created (no tombstone) still creates normally', () => {
    const { store } = makeStore();
    const out = store.create({ name: 'never-used', role: 'user', createdBy: 'x' });
    expect(out.ok).toBe(true);
  });

  it('isNameRetired() reports the tombstone with who/when', () => {
    const { store, setNow } = makeStore();
    store.create({ name: 'ci-bot', role: 'user', createdBy: 'x' });
    setNow(BASE_MS + DAY_MS);
    store.delete('ci-bot', 'admin@x.com');
    const t = store.isNameRetired('ci-bot');
    expect(t).toMatchObject({ retired: true, deletedBy: 'admin@x.com', deletedAt: BASE_MS + DAY_MS });
  });

  it('isNameRetired() reports false for a name never deleted', () => {
    const { store } = makeStore();
    expect(store.isNameRetired('never-used')).toEqual({ retired: false });
  });
});

// Send-back L2 (MEDIUM): an expired secret must not occupy a cap slot forever.
describe('ServiceAccountStore.rotateSecret excludes expired secrets from the 2-secret cap (send-back L2)', () => {
  it('a rotate whose only other secret is EXPIRED succeeds (does not count toward the cap)', () => {
    const { store, setNow } = makeStore();
    const created = store.create({ name: 'ci-bot', role: 'user', expiresAt: BASE_MS + 1000, createdBy: 'x' });
    if (!created.ok) throw new Error('setup');
    setNow(BASE_MS + 2000); // the create-time secret is now expired
    const rotated = store.rotateSecret('ci-bot', undefined, 'admin@x.com');
    expect(rotated.ok).toBe(true);
  });

  it('TOO_MANY_SECRETS still fires with 2 genuinely active secrets, and the message says "active (non-expired)"', () => {
    const { store } = makeStore();
    store.create({ name: 'ci-bot', role: 'user', createdBy: 'x' });
    store.rotateSecret('ci-bot', undefined, 'admin@x.com');
    const out = store.rotateSecret('ci-bot', undefined, 'admin@x.com');
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe('TOO_MANY_SECRETS');
    expect(out.reason).toMatch(/active \(non-expired\)/);
  });
});

// Send-back L3 (LOW): a past expiresAt creates/updates/rotates something dead on arrival.
describe('ServiceAccountStore refuses a past expiresAt on create/update/rotateSecret (send-back L3)', () => {
  it('create() refuses a past expiresAt', () => {
    const { store } = makeStore();
    const out = store.create({ name: 'exp-bot', role: 'user', expiresAt: BASE_MS - 1000, createdBy: 'x' });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe('INVALID_ARGUMENT');
    expect(out.reason).toMatch(/future/);
  });

  it('create() accepts a future expiresAt and omitted expiresAt (never expires)', () => {
    const { store } = makeStore();
    expect(store.create({ name: 'future-bot', role: 'user', expiresAt: BASE_MS + DAY_MS, createdBy: 'x' }).ok).toBe(true);
    expect(store.create({ name: 'forever-bot', role: 'user', createdBy: 'x' }).ok).toBe(true);
  });

  it('update() refuses a past expiresAt but accepts null (clear) and a future one', () => {
    const { store } = makeStore();
    store.create({ name: 'ci-bot', role: 'user', createdBy: 'x' });
    const past = store.update('ci-bot', { expiresAt: BASE_MS - 1000 }, 'admin@x.com');
    expect(past.ok).toBe(false);
    if (!past.ok) expect(past.reason).toMatch(/future/);
    expect(store.update('ci-bot', { expiresAt: null }, 'admin@x.com').ok).toBe(true);
    expect(store.update('ci-bot', { expiresAt: BASE_MS + DAY_MS }, 'admin@x.com').ok).toBe(true);
  });

  it('rotateSecret() refuses a past expiresAt but accepts an omitted one', () => {
    const { store } = makeStore();
    store.create({ name: 'ci-bot', role: 'user', createdBy: 'x' });
    const past = store.rotateSecret('ci-bot', BASE_MS - 1000, 'admin@x.com');
    expect(past.ok).toBe(false);
    if (!past.ok) expect(past.reason).toMatch(/future/);
    expect(store.rotateSecret('ci-bot', undefined, 'admin@x.com').ok).toBe(true);
  });
});

describe('ServiceAccountStore.verifyCredentials (constant-time, no oracle)', () => {
  it('returns the live row for a correct id+secret', () => {
    const { store } = makeStore();
    const created = store.create({ name: 'ci-bot', role: 'author', workflows: ['foo'], createdBy: 'x' });
    if (!created.ok) throw new Error('setup');
    const v = store.verifyCredentials('sa:ci-bot', created.clientSecret);
    expect(v).not.toBeNull();
    expect(v?.name).toBe('ci-bot');
    expect(v?.role).toBe('author');
    expect(v?.workflows).toEqual(['foo']);
  });

  it('returns null for an unknown client id', () => {
    const { store } = makeStore();
    expect(store.verifyCredentials('sa:nope', 'whatever')).toBeNull();
  });

  it('returns null for a wrong secret', () => {
    const { store } = makeStore();
    store.create({ name: 'ci-bot', role: 'user', createdBy: 'x' });
    expect(store.verifyCredentials('sa:ci-bot', 'rwe_sa_wrong')).toBeNull();
  });

  it('returns null for a disabled account even with the right secret', () => {
    const { store } = makeStore();
    const created = store.create({ name: 'ci-bot', role: 'user', createdBy: 'x' });
    if (!created.ok) throw new Error('setup');
    store.update('ci-bot', { disabled: true }, 'admin@x.com');
    expect(store.verifyCredentials('sa:ci-bot', created.clientSecret)).toBeNull();
  });

  it('returns null for an expired account', () => {
    const { store, setNow } = makeStore();
    const created = store.create({ name: 'ci-bot', role: 'user', expiresAt: BASE_MS + DAY_MS, createdBy: 'x' });
    if (!created.ok) throw new Error('setup');
    setNow(BASE_MS + DAY_MS + 1);
    expect(store.verifyCredentials('sa:ci-bot', created.clientSecret)).toBeNull();
  });

  it('returns null for a secret past its own expiresAt even if the account is live', () => {
    const { store, setNow } = makeStore();
    store.create({ name: 'ci-bot', role: 'user', createdBy: 'x' });
    const rotated = store.rotateSecret('ci-bot', BASE_MS + DAY_MS, 'admin@x.com');
    if (!rotated.ok) throw new Error('setup');
    setNow(BASE_MS + DAY_MS + 1);
    expect(store.verifyCredentials('sa:ci-bot', rotated.clientSecret)).toBeNull();
  });

  it('a non "sa:" client id is never looked up here', () => {
    const { store } = makeStore();
    expect(store.verifyCredentials('someone@example.com', 'x')).toBeNull();
  });

  it('marks the account + matched secret lastUsedAt on a successful verify', () => {
    const { store, setNow } = makeStore();
    const created = store.create({ name: 'ci-bot', role: 'user', createdBy: 'x' });
    if (!created.ok) throw new Error('setup');
    setNow(BASE_MS + 1000);
    store.verifyCredentials('sa:ci-bot', created.clientSecret);
    const row = store.get('ci-bot')!;
    expect(row.lastUsedAt).toBe(BASE_MS + 1000);
    expect(row.secrets[0]!.lastUsedAt).toBe(BASE_MS + 1000);
  });
});

describe('ServiceAccountStore.isLive (per-request re-check)', () => {
  it('live:true with role+workflows for a normal account', () => {
    const { store } = makeStore();
    store.create({ name: 'ci-bot', role: 'author', workflows: ['foo'], createdBy: 'x' });
    expect(store.isLive('ci-bot')).toEqual({ live: true, role: 'author', workflows: ['foo'] });
  });

  it('live:false for an unknown/deleted account', () => {
    const { store } = makeStore();
    expect(store.isLive('nope')).toEqual({ live: false });
  });

  it('live:false for a disabled account', () => {
    const { store } = makeStore();
    store.create({ name: 'ci-bot', role: 'user', createdBy: 'x' });
    store.update('ci-bot', { disabled: true }, 'admin@x.com');
    expect(store.isLive('ci-bot')).toEqual({ live: false });
  });

  it('live:false for an expired account', () => {
    const { store, setNow } = makeStore();
    store.create({ name: 'ci-bot', role: 'user', expiresAt: BASE_MS + DAY_MS, createdBy: 'x' });
    setNow(BASE_MS + DAY_MS + 1);
    expect(store.isLive('ci-bot')).toEqual({ live: false });
  });
});
