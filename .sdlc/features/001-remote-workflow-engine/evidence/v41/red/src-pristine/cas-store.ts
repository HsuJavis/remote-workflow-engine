// CasStore (v10 Slice 2, REQ-064): a content-addressed blob store for efficient workspace seeding.
// Blobs live on disk keyed by the sha256 of their RAW bytes (cas/<sha[0:2]>/<sha>); a per-namespace
// refset (SQLite) records which blobs a namespace has proven possession of. See
// docs/seed-sync-architecture.md for the security invariants this enforces:
//   • byte-verify + store-under-COMPUTED-hash (never the claimed one) → poisoning + confused-deputy safe
//   • `missing`/`hasRef` are PER-NAMESPACE, never global existence → no cross-tenant dedup oracle
//   • immutable pool (a written blob is never mutated) → concurrent assemble reads are safe
import Database from 'better-sqlite3';
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync, unlinkSync, createWriteStream, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { type Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { codedError } from './errors.js';
import { formatBytes, type ByteLimit } from './cas-quota.js';

/** Pure path-traversal gate (DES-086): exactly 64 lowercase hex chars — REJECT not normalize. Runs
 *  BEFORE any fd opens on the POST /assets/blob/:sha route; must be exported for the route handler. */
export function isValidSha256Hex(s: string): boolean {
  return /^[0-9a-f]{64}$/.test(s);
}

/** Pure namespace gate (DES-086): non-empty, bounded charset ([A-Za-z0-9._-]), no leading '.',
 *  no '..' run (path-traversal defense). Runs BEFORE any fd opens; must be exported for the route handler. */
export function isValidNamespace(ns: string): boolean {
  if (!ns || !/^[A-Za-z0-9._-]+$/.test(ns)) return false;
  if (ns.startsWith('.')) return false;
  if (/\.\./.test(ns)) return false;
  return true;
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** v24 (integrator; ADR-028, DES-142): THE CAS namespace expression, in one place. ADR-028 says the
 *  namespace "appears once" and is DERIVED from the caller's own identity — `run_start.seedNamespace`
 *  was removed from the tool schema for exactly that reason. But only the WRITE side ever derived
 *  it: `mcp-facade`'s `nsOf` stored blobs under `local` (or the principal id) while `run-manager`
 *  read them back under a pre-v24 `'_default'` literal, a pool no writer has used since. Every
 *  seeded run therefore failed `MISSING_BLOBS` naming a sha the engine had just accepted. Both
 *  sides now call this. `null`/`undefined` (auth disabled, or a loopback-exempt caller with no id)
 *  is `'local'`, matching what the write side already stored under.
 *  Found by the Batch-D executor, 2026-09-04. */
export function casNamespaceFor(principal: string | null | undefined): string {
  return principal ?? 'local';
}

// Retention (issue #82; owner decision 2026-10-02 adds the cleanup): `workflow_versions.
// seed_manifest_ref` (with its `seed_namespace`) and every sha named inside that manifest are LIVE
// roots for as long as the version row exists: every future run of that version (scheduled/
// webhook-fired ones included) re-reads them at start. `prune()` below never removes a ref the
// caller marks protected (the facade passes exactly those roots), never one used inside the grace
// window (`last_used_at`, refreshed by every upload of the sha and every `missing()` check — i.e.
// every manifest registration, workflow_register, workspace_diff and seeded run admission), and
// deletes a blob FILE only once no namespace holds a ref to it any more.

/** Owner decision 2026-10-02: the QUOTA_EXCEEDED refusal — always carries the numbers and the way out. */
function quotaExceeded(usedBytes: number, limitBytes: number, requestedBytes: number): Error {
  const hint = 'free space with workspace_prune_blobs (run it with dryRun:true first to see what would go) or ask an administrator to raise your quota (principal_set_quota)';
  return codedError(
    'QUOTA_EXCEEDED',
    `QUOTA_EXCEEDED: this upload needs ${formatBytes(requestedBytes)} but your content store holds ${formatBytes(usedBytes)} of your ${formatBytes(limitBytes)} quota — ${hint}`,
    { usedBytes, limitBytes, requestedBytes, hint },
  );
}

export interface PruneResult {
  /** The refs removed (or, on a dry run, that would be removed). */
  refs: Array<{ sha256: string; bytes: number; lastUsedAt: string }>;
  /** Reduction of the namespace's quota usage. */
  freedBytes: number;
  /** Blob files physically deleted (no namespace references them any more); 0 on a dry run. */
  blobFilesDeleted: number;
  diskBytesFreed: number;
}

export class CasStore {
  private readonly _db: Database.Database;
  private readonly _blobDir: string;
  private readonly _clock: () => number;
  private _quota: ((namespace: string) => ByteLimit) | undefined;
  private _diskGuard: (() => void) | undefined;

  constructor(dir: string, opts: { clock?: () => number } = {}) {
    this._clock = opts.clock ?? (() => Date.now()); // det:allow — last-use bookkeeping for the prune grace window
    mkdirSync(dir, { recursive: true });
    this._blobDir = join(dir, 'blobs');
    mkdirSync(this._blobDir, { recursive: true });
    this._db = new Database(join(dir, 'refs.db'));
    this._db.pragma('journal_mode = WAL');
    // Per-namespace reference set: (namespace, sha) means "this namespace has proven possession of sha".
    // `size` (the blob's byte length) makes per-namespace usage a SUM; `last_used_at` (epoch ms) is
    // the prune grace-window clock.
    this._db.exec(`
      CREATE TABLE IF NOT EXISTS refs (
        namespace TEXT NOT NULL,
        sha TEXT NOT NULL,
        size INTEGER NOT NULL DEFAULT 0,
        last_used_at INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (namespace, sha)
      );
    `);
    // Owner decision 2026-10-02: guarded migration of a pre-quota refs table — sizes backfilled from
    // the blob files on disk (a ref whose blob file is gone counts 0), last use = now (conservative:
    // nothing becomes prunable the moment the engine upgrades).
    const cols = (this._db.prepare('PRAGMA table_info(refs)').all() as Array<{ name: string }>).map((c) => c.name);
    if (!cols.includes('size')) {
      this._db.transaction(() => {
        this._db.exec('ALTER TABLE refs ADD COLUMN size INTEGER NOT NULL DEFAULT 0');
        const upd = this._db.prepare('UPDATE refs SET size = ? WHERE sha = ?');
        for (const { sha } of this._db.prepare('SELECT DISTINCT sha FROM refs').all() as Array<{ sha: string }>) {
          let size = 0;
          try { size = statSync(this._blobPath(sha)).size; } catch { /* dangling ref: counts 0 */ }
          upd.run(size, sha);
        }
      })();
    }
    if (!cols.includes('last_used_at')) {
      this._db.exec('ALTER TABLE refs ADD COLUMN last_used_at INTEGER NOT NULL DEFAULT 0');
      this._db.prepare('UPDATE refs SET last_used_at = ?').run(this._clock());
    }
    this._db.exec('CREATE INDEX IF NOT EXISTS refs_sha ON refs (sha)');
  }

  /** Owner decision 2026-10-02: the per-namespace byte limit (null = unlimited). Late-bound: the
   *  composition root sets it once the principal/role store exists. Unset = unlimited everywhere. */
  setQuotaResolver(fn: (namespace: string) => ByteLimit): void {
    this._quota = fn;
  }

  /** Owner decision 2026-10-02: called before every write; throws (DISK_LOW) to refuse it. */
  setDiskGuard(fn: () => void): void {
    this._diskGuard = fn;
  }

  /** A namespace's LOGICAL usage: the sum of the sizes of every blob it holds a ref to (a blob
   *  shared with other namespaces counts fully for each). */
  usage(namespace: string): number {
    return (this._db.prepare('SELECT COALESCE(SUM(size), 0) AS n FROM refs WHERE namespace = ?').get(namespace) as { n: number }).n;
  }

  private _hasRefSync(namespace: string, sha: string): boolean {
    return this._db.prepare('SELECT 1 FROM refs WHERE namespace = ? AND sha = ?').get(namespace, sha) !== undefined;
  }

  /** Throws QUOTA_EXCEEDED when adding `requestedBytes` (a sha the namespace does not hold yet —
   *  a held sha is free) would exceed the namespace's limit. Synchronous on purpose: called
   *  immediately before the write+insert in the same synchronous block, so two concurrent uploads
   *  can never both pass it against the same usage (this process is the only writer). */
  private _checkQuota(namespace: string, sha: string | null, requestedBytes: number): void {
    if (sha !== null && this._hasRefSync(namespace, sha)) return;
    const limit = this._quota?.(namespace) ?? null;
    if (limit === null) return;
    const used = this.usage(namespace);
    if (used + requestedBytes > limit) throw quotaExceeded(used, limit, requestedBytes);
  }

  /** Up-front refusal for a declared size (Content-Length) BEFORE any byte is read: the disk floor,
   *  then the quota. `sha` null = unknown yet (a manifest) — charged as new. */
  preflight(namespace: string, sha: string | null, requestedBytes: number): void {
    this._diskGuard?.();
    this._checkQuota(namespace, sha, requestedBytes);
  }

  private _recordRef(namespace: string, sha: string, size: number): void {
    this._db.prepare('INSERT INTO refs (namespace, sha, size, last_used_at) VALUES (?, ?, ?, ?) ON CONFLICT(namespace, sha) DO UPDATE SET last_used_at = excluded.last_used_at')
      .run(namespace, sha, size, this._clock());
  }

  private _blobPath(sha: string): string {
    return join(this._blobDir, sha.slice(0, 2), sha);
  }

  /** Stores a blob after verifying its bytes hash to `declaredSha`; stores under the COMPUTED hash and
   *  records the ref for `namespace`. A claim/upload mismatch throws BLOB_HASH_MISMATCH (nothing stored).
   *  Immutable: an existing blob is never overwritten (same hash ⇒ same bytes). Idempotent. */
  async putBlob(namespace: string, declaredSha: string, bytes: Buffer): Promise<{ sha256: string; accepted: true }> {
    const computed = sha256(bytes);
    if (declaredSha && declaredSha !== computed) {
      throw codedError('BLOB_HASH_MISMATCH', `declared sha256 ${declaredSha} != computed ${computed}`);
    }
    // Owner decision 2026-10-02: disk floor + quota refuse BEFORE anything is stored. Everything
    // from here to the ref insert is synchronous, so no other upload interleaves with the check.
    this._diskGuard?.();
    this._checkQuota(namespace, computed, bytes.length);
    const abs = this._blobPath(computed);
    if (!existsSync(abs)) {
      mkdirSync(dirname(abs), { recursive: true });
      // write-tmp + atomic-rename so a concurrent reader never sees a partial blob.
      const tmp = `${abs}.${randomUUID()}.tmp`;
      writeFileSync(tmp, bytes);
      renameSync(tmp, abs);
    }
    this._recordRef(namespace, computed, bytes.length);
    return { sha256: computed, accepted: true };
  }

  /** The subset of `shas` this NAMESPACE must still upload (not in its refset). Per-namespace, never
   *  global — a blob another tenant uploaded is still "missing" here until this namespace proves it.
   *  One batched `IN (…)` query per SQLite-variable-limit chunk (not one round-trip per sha). */
  async missing(namespace: string, shas: string[]): Promise<string[]> {
    if (shas.length === 0) return [];
    const present = new Set<string>();
    const CHUNK = 800; // well under SQLite's default 999 bound-variable limit (+1 for namespace)
    for (let i = 0; i < shas.length; i += CHUNK) {
      const batch = shas.slice(i, i + CHUNK);
      const rows = this._db
        .prepare(`SELECT sha FROM refs WHERE namespace = ? AND sha IN (${batch.map(() => '?').join(',')})`)
        .all(namespace, ...batch) as Array<{ sha: string }>;
      for (const r of rows) present.add(r.sha);
      // A checked-and-present ref counts as USED (prune grace window): this is the call every
      // manifest registration, workflow_register, workspace_diff and seeded run admission makes.
      this._db
        .prepare(`UPDATE refs SET last_used_at = ? WHERE namespace = ? AND sha IN (${batch.map(() => '?').join(',')})`)
        .run(this._clock(), namespace, ...batch);
    }
    return shas.filter((s) => !present.has(s));
  }

  async hasRef(namespace: string, sha: string): Promise<boolean> {
    return this._db.prepare('SELECT 1 FROM refs WHERE namespace = ? AND sha = ?').get(namespace, sha) !== undefined;
  }

  /** Reads a blob's raw bytes by content hash, or null if the pool doesn't have it. (Pool read is
   *  namespace-agnostic — the caller must have already checked hasRef for its namespace.) */
  async readBlob(sha: string): Promise<Buffer | null> {
    return this.readBlobSync(sha);
  }

  /** Synchronous blob read for the seed-assemble path (materializeManifest is sync). One syscall:
   *  read directly, treat a missing blob (ENOENT) as null rather than a preceding existsSync stat. */
  readBlobSync(sha: string): Buffer | null {
    try {
      return readFileSync(this._blobPath(sha));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  /** DES-086 (TASK-080): streaming blob ingest seam. Reads the raw request body (Readable) into a
   *  temp file, hash-verifies against `declaredSha`, then atomic-renames under the COMPUTED hash.
   *  opts.timer is the ONLY clock injection point (CasStore has no wall-clock); defaults to the
   *  global setTimeout/clearTimeout for the production path.
   *  Error taxonomy (HTTP status pinned by route handler):
   *    BLOB_TOO_LARGE (413): bytes > maxBytes before stream end.
   *    BLOB_UPLOAD_TIMEOUT (408): idle timer fires (no data chunk for readTimeoutMs).
   *    BLOB_SHA_MISMATCH (409): computed hash != declaredSha at end.
   *  BE-2: no-exists shortcut — fully consume + verify even when blob already exists (possession proof).
   *  BE-4: 0-byte body with correct sha256(empty) succeeds (maxBytes is an upper bound, not lower). */
  async putBlobStream(
    namespace: string,
    declaredSha: string,
    body: Readable,
    opts: {
      maxBytes: number;
      readTimeoutMs: number;
      timer?: {
        set(fn: () => void, ms: number): ReturnType<typeof setTimeout>;
        clear(t: ReturnType<typeof setTimeout>): void;
      };
    },
  ): Promise<{ sha256: string; bytes: number }> {
    const timerImpl = opts.timer ?? { set: (fn, ms) => setTimeout(fn, ms), clear: clearTimeout };
    // Owner decision 2026-10-02: disk floor first (before any fd opens), then the quota allowance
    // this stream may consume — a body larger than it (whatever Content-Length claimed) is cut off
    // mid-stream. A sha this namespace already holds is free (re-upload = possession re-proof).
    this._diskGuard?.();
    const limit = this._hasRefSync(namespace, declaredSha) ? null : (this._quota?.(namespace) ?? null);
    const usedAtStart = limit === null ? 0 : this.usage(namespace);
    const allowance = limit === null ? Infinity : limit - usedAtStart;
    const tmpPath = join(this._blobDir, `${randomUUID()}.tmp`);
    mkdirSync(this._blobDir, { recursive: true });

    let bytes = 0;
    let timerHandle: ReturnType<typeof setTimeout> | undefined;
    const ac = new AbortController();
    const hash = createHash('sha256');

    const resetTimer = (): void => {
      if (timerHandle !== undefined) timerImpl.clear(timerHandle);
      timerHandle = timerImpl.set(() => {
        ac.abort(codedError('BLOB_UPLOAD_TIMEOUT', `blob upload idle timeout after ${opts.readTimeoutMs}ms`));
      }, opts.readTimeoutMs);
    };

    const sizeCheck = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        resetTimer(); // reset idle timer on each chunk
        bytes += chunk.length;
        if (bytes > opts.maxBytes) {
          cb(codedError('BLOB_TOO_LARGE', `blob exceeds maxBlobBytes=${opts.maxBytes}`));
          return;
        }
        if (bytes > allowance) {
          cb(quotaExceeded(usedAtStart, limit!, bytes));
          return;
        }
        hash.update(chunk);
        cb(null, chunk);
      },
    });

    resetTimer(); // arm BEFORE any await (synchronous — fake timer fires after one microtask tick)

    const fd = createWriteStream(tmpPath);

    try {
      await pipeline(body, sizeCheck, fd, { signal: ac.signal });
    } catch (err) {
      if (timerHandle !== undefined) { timerImpl.clear(timerHandle); timerHandle = undefined; }
      try { unlinkSync(tmpPath); } catch { /* already gone or never written */ }
      // Timeout: pipeline was aborted; throw the coded abort reason instead of a bare AbortError
      if (ac.signal.aborted) throw (ac.signal.reason ?? err) as Error;
      throw err;
    }

    if (timerHandle !== undefined) { timerImpl.clear(timerHandle); timerHandle = undefined; }

    const computed = hash.digest('hex');
    if (computed !== declaredSha) {
      try { unlinkSync(tmpPath); } catch { /* already gone */ }
      throw codedError('BLOB_SHA_MISMATCH', `declared ${declaredSha} !== computed ${computed}`);
    }

    // BE-2: atomic rename regardless of whether the blob already exists — a repeat upload verifies
    // possession again (no shortcut that skips verification). renameSync over an existing file is
    // atomic on POSIX; on Windows it would fail but the engine targets Linux.
    // Owner decision 2026-10-02: the commit-time quota re-check — the correctness point for
    // concurrent uploads (each passed the allowance above against the SAME starting usage). Check,
    // rename and insert are one synchronous block, so a second stream finishing later sees the first
    // one's ref and is refused here, its temp file removed.
    try {
      this._checkQuota(namespace, computed, bytes);
    } catch (err) {
      try { unlinkSync(tmpPath); } catch { /* already gone */ }
      throw err;
    }
    const blobPath = this._blobPath(computed);
    mkdirSync(dirname(blobPath), { recursive: true });
    renameSync(tmpPath, blobPath);

    this._recordRef(namespace, computed, bytes);
    return { sha256: computed, bytes };
  }

  /** Owner decision 2026-10-02 (cleanup): remove `namespace`'s refs that are neither in `protect`
   *  (the caller's live roots) nor used since `keepUsedSinceMs`; delete a blob file once no namespace
   *  references it and it is not in `keepFiles`. `dryRun` reports the same refs and deletes nothing.
   *  Fully synchronous (one transaction + unlinks): no upload interleaves with it — an upload of the
   *  same sha either lands before (its ref keeps the file) or after (it re-creates the file). */
  prune(namespace: string, opts: { protect: Set<string>; keepUsedSinceMs: number; dryRun: boolean; keepFiles?: Set<string> }): PruneResult {
    const rows = (this._db.prepare('SELECT sha, size, last_used_at FROM refs WHERE namespace = ? AND last_used_at < ? ORDER BY sha')
      .all(namespace, opts.keepUsedSinceMs) as Array<{ sha: string; size: number; last_used_at: number }>)
      .filter((r) => !opts.protect.has(r.sha));
    const refs = rows.map((r) => ({ sha256: r.sha, bytes: r.size, lastUsedAt: new Date(r.last_used_at).toISOString() }));
    const freedBytes = rows.reduce((n, r) => n + r.size, 0);
    if (opts.dryRun || rows.length === 0) return { refs, freedBytes, blobFilesDeleted: 0, diskBytesFreed: 0 };
    const del = this._db.prepare('DELETE FROM refs WHERE namespace = ? AND sha = ?');
    this._db.transaction(() => { for (const r of rows) del.run(namespace, r.sha); })();
    let blobFilesDeleted = 0; let diskBytesFreed = 0;
    const stillRef = this._db.prepare('SELECT 1 FROM refs WHERE sha = ? LIMIT 1');
    for (const r of rows) {
      if (opts.keepFiles?.has(r.sha) || stillRef.get(r.sha) !== undefined) continue;
      try {
        const p = this._blobPath(r.sha);
        const size = statSync(p).size;
        unlinkSync(p);
        blobFilesDeleted++; diskBytesFreed += size;
      } catch { /* already gone */ }
    }
    return { refs, freedBytes, blobFilesDeleted, diskBytesFreed };
  }
}
