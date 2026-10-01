// Owner decision 2026-10-02 (per-principal CAS upload quota, cleanup): CasStore records each ref's
// blob size (a guarded migration backfills pre-quota refs from the blob files on disk), answers a
// namespace's LOGICAL usage (a blob shared with another namespace counts fully for each), refuses a
// write that would push a namespace past its limit BEFORE storing (putBlob, putBlobStream — incl. a
// client whose body is larger than it declared — and concurrent streams that each fit alone but not
// together), consults an injected disk guard first, and prunes a namespace's unrooted, unused refs
// (deleting a blob file only when no namespace references it any more).
//
// Mock policy (unit): real CasStore on a temp dir (real fs + real SQLite); fake Readable bodies;
// injected clock. No HTTP.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Readable } from 'node:stream';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { CasStore } from '../../src/cas-store.js';
import { codedError } from '../../src/errors.js';

const sha = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');
const bytesOf = (n: number, fill = 'a'): Buffer => Buffer.alloc(n, fill);
const DAY = 86_400_000;

function tmpFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(d, e.name));
      else if (e.name.endsWith('.tmp')) out.push(e.name);
    }
  };
  walk(dir);
  return out;
}

/** A body that yields its chunks asynchronously, so two concurrent streams interleave. */
function slowBody(buf: Buffer, chunk = 100): Readable {
  const parts: Buffer[] = [];
  for (let i = 0; i < buf.length; i += chunk) parts.push(buf.subarray(i, i + chunk));
  return Readable.from((async function* () {
    for (const p of parts) { await new Promise((r) => setImmediate(r)); yield p; }
  })());
}

let dir: string;
let now: number;
const clock = (): number => now;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'rwe-cas-quota-')); now = Date.UTC(2026, 9, 2); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('refs.size migration', () => {
  it('backfills the size of every pre-quota ref from its blob file; a ref with no blob file counts 0', () => {
    // Build the PRE-quota layout by hand: refs(namespace, sha) only, blobs under blobs/<sha[0:2]>/<sha>.
    const a = bytesOf(300, 'a'); const b = bytesOf(700, 'b');
    mkdirSync(join(dir, 'blobs'), { recursive: true });
    for (const buf of [a, b]) {
      const s = sha(buf);
      mkdirSync(join(dir, 'blobs', s.slice(0, 2)), { recursive: true });
      writeFileSync(join(dir, 'blobs', s.slice(0, 2), s), buf);
    }
    const db = new Database(join(dir, 'refs.db'));
    db.exec('CREATE TABLE refs (namespace TEXT NOT NULL, sha TEXT NOT NULL, PRIMARY KEY (namespace, sha))');
    const ins = db.prepare('INSERT INTO refs (namespace, sha) VALUES (?, ?)');
    ins.run('alice', sha(a)); ins.run('alice', sha(b)); ins.run('bob', sha(b)); ins.run('bob', 'f'.repeat(64));
    db.close();

    const cas = new CasStore(dir, { clock });
    expect(cas.usage('alice')).toBe(1000);
    expect(cas.usage('bob')).toBe(700); // the dangling ref (no blob file) counts 0
    expect(cas.usage('nobody')).toBe(0);
    // Re-opening is idempotent (the migration is guarded, never re-run destructively).
    const again = new CasStore(dir, { clock });
    expect(again.usage('alice')).toBe(1000);
  });
});

describe('quota enforcement', () => {
  it('usage is logical: a blob held by two namespaces counts fully for each', async () => {
    const cas = new CasStore(dir, { clock });
    const buf = bytesOf(400);
    await cas.putBlob('alice', sha(buf), buf);
    await cas.putBlob('bob', sha(buf), buf);
    expect(cas.usage('alice')).toBe(400);
    expect(cas.usage('bob')).toBe(400);
  });

  it('putBlob over the limit is refused QUOTA_EXCEEDED {usedBytes, limitBytes, requestedBytes, hint} and nothing is stored', async () => {
    const cas = new CasStore(dir, { clock });
    cas.setQuotaResolver((ns) => (ns === 'alice' ? 1000 : null));
    const first = bytesOf(600, 'x'); const second = bytesOf(500, 'y');
    await cas.putBlob('alice', sha(first), first);
    const err = await cas.putBlob('alice', sha(second), second).catch((e: unknown) => e) as { code?: string; detail?: Record<string, unknown> };
    expect(err.code).toBe('QUOTA_EXCEEDED');
    expect(err.detail).toMatchObject({ usedBytes: 600, limitBytes: 1000, requestedBytes: 500 });
    expect(String(err.detail?.['hint'])).toContain('workspace_prune_blobs');
    expect(cas.readBlobSync(sha(second))).toBeNull();
    expect(await cas.hasRef('alice', sha(second))).toBe(false);
    expect(cas.usage('alice')).toBe(600);
    // Unlimited namespace (resolver null) is never refused.
    await expect(cas.putBlob('bob', sha(second), second)).resolves.toMatchObject({ accepted: true });
  });

  it('re-uploading a blob this namespace already holds charges nothing, even at the limit', async () => {
    const cas = new CasStore(dir, { clock });
    cas.setQuotaResolver(() => 600);
    const buf = bytesOf(600);
    await cas.putBlob('alice', sha(buf), buf);
    await expect(cas.putBlob('alice', sha(buf), buf)).resolves.toMatchObject({ accepted: true });
    await expect(cas.putBlobStream('alice', sha(buf), Readable.from([buf]), { maxBytes: 10_000, readTimeoutMs: 60_000 })).resolves.toMatchObject({ bytes: 600 });
    expect(cas.usage('alice')).toBe(600);
  });

  it('a blob already in the pool (another namespace) is charged fully to a namespace that newly claims it', async () => {
    const cas = new CasStore(dir, { clock });
    cas.setQuotaResolver((ns) => (ns === 'alice' ? 500 : null));
    const buf = bytesOf(600);
    await cas.putBlob('bob', sha(buf), buf);
    await expect(cas.putBlob('alice', sha(buf), buf)).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' });
    expect(await cas.hasRef('alice', sha(buf))).toBe(false);
    expect(cas.readBlobSync(sha(buf))).not.toBeNull(); // bob's copy untouched
  });

  it('preflight refuses a declared size over the remaining quota before any byte is read; 0 extra for a held sha', async () => {
    const cas = new CasStore(dir, { clock });
    cas.setQuotaResolver(() => 1000);
    const held = bytesOf(900);
    await cas.putBlob('alice', sha(held), held);
    expect(() => cas.preflight('alice', 'e'.repeat(64), 200)).toThrow(expect.objectContaining({ code: 'QUOTA_EXCEEDED' }));
    expect(() => cas.preflight('alice', null, 200)).toThrow(expect.objectContaining({ code: 'QUOTA_EXCEEDED' }));
    expect(() => cas.preflight('alice', 'e'.repeat(64), 100)).not.toThrow();
    expect(() => cas.preflight('alice', sha(held), 900)).not.toThrow();
  });

  it('a lying client (body larger than its quota allows) is cut off mid-stream: QUOTA_EXCEEDED, temp file removed, no ref', async () => {
    const cas = new CasStore(dir, { clock });
    cas.setQuotaResolver(() => 1000);
    const big = bytesOf(5000, 'z');
    const err = await cas.putBlobStream('alice', sha(big), slowBody(big), { maxBytes: 1_000_000, readTimeoutMs: 60_000 }).catch((e: unknown) => e) as { code?: string; detail?: Record<string, unknown> };
    expect(err.code).toBe('QUOTA_EXCEEDED');
    expect(err.detail).toMatchObject({ usedBytes: 0, limitBytes: 1000 });
    expect(tmpFiles(dir)).toEqual([]);
    expect(await cas.hasRef('alice', sha(big))).toBe(false);
    expect(cas.readBlobSync(sha(big))).toBeNull();
  });

  it('concurrent uploads that each fit alone cannot jointly exceed the limit (exactly one wins)', async () => {
    const cas = new CasStore(dir, { clock });
    cas.setQuotaResolver(() => 1000);
    const a = bytesOf(600, 'p'); const b = bytesOf(600, 'q');
    const results = await Promise.allSettled([
      cas.putBlobStream('alice', sha(a), slowBody(a), { maxBytes: 1_000_000, readTimeoutMs: 60_000 }),
      cas.putBlobStream('alice', sha(b), slowBody(b), { maxBytes: 1_000_000, readTimeoutMs: 60_000 }),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const refused = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect((refused[0]!.reason as { code?: string }).code).toBe('QUOTA_EXCEEDED');
    expect(cas.usage('alice')).toBe(600);
    expect(tmpFiles(dir)).toEqual([]);
  });

  it('the disk guard is consulted before storing on every write path', async () => {
    const cas = new CasStore(dir, { clock });
    cas.setDiskGuard(() => { throw codedError('DISK_LOW', 'DISK_LOW: test', { freeBytes: 1, floorBytes: 2 }); });
    const buf = bytesOf(10);
    await expect(cas.putBlob('alice', sha(buf), buf)).rejects.toMatchObject({ code: 'DISK_LOW' });
    await expect(cas.putBlobStream('alice', sha(buf), Readable.from([buf]), { maxBytes: 100, readTimeoutMs: 60_000 })).rejects.toMatchObject({ code: 'DISK_LOW' });
    expect(() => cas.preflight('alice', sha(buf), 10)).toThrow(expect.objectContaining({ code: 'DISK_LOW' }));
    expect(cas.readBlobSync(sha(buf))).toBeNull();
    expect(tmpFiles(dir)).toEqual([]);
  });
});

describe('prune', () => {
  async function seeded() {
    const cas = new CasStore(dir, { clock });
    const root = bytesOf(100, 'r'); const junk = bytesOf(200, 'j'); const shared = bytesOf(300, 's'); const fresh = bytesOf(50, 'f');
    await cas.putBlob('alice', sha(root), root);
    await cas.putBlob('alice', sha(junk), junk);
    await cas.putBlob('alice', sha(shared), shared);
    await cas.putBlob('bob', sha(shared), shared);
    now += 40 * DAY;
    await cas.putBlob('alice', sha(fresh), fresh); // uploaded "today"
    return { cas, root, junk, shared, fresh };
  }

  it('dry run lists unrooted refs unused for the window, deletes nothing', async () => {
    const { cas, root, junk, shared } = await seeded();
    const r = cas.prune('alice', { protect: new Set([sha(root)]), keepUsedSinceMs: now - 30 * DAY, dryRun: true });
    expect(r.refs.map((x) => x.sha256).sort()).toEqual([sha(junk), sha(shared)].sort());
    expect(r.freedBytes).toBe(500);
    expect(r.blobFilesDeleted).toBe(0);
    expect(cas.usage('alice')).toBe(650);
    expect(cas.readBlobSync(sha(junk))).not.toBeNull();
  });

  it('a real prune removes the refs; a blob file goes only when no namespace still references it', async () => {
    const { cas, root, junk, shared, fresh } = await seeded();
    const r = cas.prune('alice', { protect: new Set([sha(root)]), keepUsedSinceMs: now - 30 * DAY, dryRun: false });
    expect(r.freedBytes).toBe(500);
    expect(r.blobFilesDeleted).toBe(1);
    expect(r.diskBytesFreed).toBe(200);
    expect(cas.usage('alice')).toBe(150); // root + fresh
    expect(cas.readBlobSync(sha(junk))).toBeNull();
    expect(cas.readBlobSync(sha(shared))).not.toBeNull(); // bob still holds it
    expect(await cas.hasRef('bob', sha(shared))).toBe(true);
    expect(await cas.hasRef('alice', sha(fresh))).toBe(true);
    expect(await cas.hasRef('alice', sha(root))).toBe(true);
  });

  it('a blob in the global protect set keeps its file even when its last ref is pruned', async () => {
    const { cas, junk } = await seeded();
    const r = cas.prune('alice', { protect: new Set(), keepUsedSinceMs: now - 30 * DAY, dryRun: false, keepFiles: new Set([sha(junk)]) });
    expect(r.refs.map((x) => x.sha256)).toContain(sha(junk));
    expect(cas.readBlobSync(sha(junk))).not.toBeNull();
  });

  it('missing() marks the refs it finds as used (a run admission or manifest check keeps them alive)', async () => {
    const { cas, junk } = await seeded();
    expect(await cas.missing('alice', [sha(junk)])).toEqual([]);
    const r = cas.prune('alice', { protect: new Set(), keepUsedSinceMs: now - 30 * DAY, dryRun: true });
    expect(r.refs.map((x) => x.sha256)).not.toContain(sha(junk));
  });
});
