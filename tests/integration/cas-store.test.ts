// v10 Slice 2 — content-addressed blob store (REQ-064). TEST-FIRST (RED).
// Pins the security invariants: byte-verify + store-under-COMPUTED-hash (poisoning/confused-deputy),
// per-namespace `missing` (cross-tenant dedup oracle), idempotent, durable.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { CasStore } from '../../src/cas-store.js';

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

describe('CasStore — content-addressed blob store (v10 Slice 2, REQ-064)', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'rwe-cas-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('stores a blob under its COMPUTED hash and reads it back', async () => {
    const cas = new CasStore(join(dir, 'cas'));
    const bytes = Buffer.from('hello world');
    const r = await cas.putBlob('tenantA', sha(bytes), bytes);
    expect(r.sha256).toBe(sha(bytes));
    expect((await cas.readBlob(sha(bytes)))!.equals(bytes)).toBe(true);
  });

  it('REJECTS a claim/upload mismatch (byte-verify) — cannot poison the store', async () => {
    const cas = new CasStore(join(dir, 'cas'));
    const bytes = Buffer.from('real bytes');
    const lie = sha(Buffer.from('different'));
    await expect(cas.putBlob('tenantA', lie, bytes)).rejects.toMatchObject({ code: 'BLOB_HASH_MISMATCH' });
    // nothing stored under the lied hash:
    expect(await cas.readBlob(lie)).toBeNull();
  });

  it('`missing` is PER-NAMESPACE — a blob tenant A uploaded is still "missing" for tenant B (no dedup oracle)', async () => {
    const cas = new CasStore(join(dir, 'cas'));
    const bytes = Buffer.from('shared content');
    const h = sha(bytes);
    await cas.putBlob('tenantA', h, bytes);
    // A has it, B does not — even though the bytes physically exist in the pool.
    expect(await cas.missing('tenantA', [h])).toEqual([]);
    expect(await cas.missing('tenantB', [h])).toEqual([h]);
    expect(await cas.hasRef('tenantB', h)).toBe(false);
    // B must upload the bytes to claim it (proof-of-ownership) — then it's no longer missing for B.
    await cas.putBlob('tenantB', h, bytes);
    expect(await cas.missing('tenantB', [h])).toEqual([]);
  });

  it('is idempotent + durable: re-put is a no-op; a fresh instance on the same dir still has the ref', async () => {
    const path = join(dir, 'cas');
    const cas1 = new CasStore(path);
    const bytes = Buffer.from('durable');
    const h = sha(bytes);
    await cas1.putBlob('t', h, bytes);
    await cas1.putBlob('t', h, bytes); // idempotent
    const cas2 = new CasStore(path); // "restart"
    expect(await cas2.hasRef('t', h)).toBe(true);
    expect((await cas2.readBlob(h))!.equals(bytes)).toBe(true);
  });
});
