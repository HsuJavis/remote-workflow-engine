// CasStore (v10 Slice 2, REQ-064): a content-addressed blob store for efficient workspace seeding.
// Blobs live on disk keyed by the sha256 of their RAW bytes (cas/<sha[0:2]>/<sha>); a per-namespace
// refset (SQLite) records which blobs a namespace has proven possession of. See
// docs/seed-sync-architecture.md for the security invariants this enforces:
//   • byte-verify + store-under-COMPUTED-hash (never the claimed one) → poisoning + confused-deputy safe
//   • `missing`/`hasRef` are PER-NAMESPACE, never global existence → no cross-tenant dedup oracle
//   • immutable pool (a written blob is never mutated) → concurrent assemble reads are safe
import Database from 'better-sqlite3';
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync, unlinkSync, createWriteStream } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { type Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { codedError } from './errors.js';

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

// Retention (issue #82): this store never deletes a blob or a refs row — there is no CAS GC. If
// one is ever added, `workflow_versions.seed_manifest_ref` (with its `seed_namespace`) and every
// sha named inside that manifest are LIVE roots for as long as the version row exists: every
// future run of that version (scheduled/webhook-fired ones included) re-reads them at start.
export class CasStore {
  private readonly _db: Database.Database;
  private readonly _blobDir: string;

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    this._blobDir = join(dir, 'blobs');
    mkdirSync(this._blobDir, { recursive: true });
    this._db = new Database(join(dir, 'refs.db'));
    this._db.pragma('journal_mode = WAL');
    // Per-namespace reference set: (namespace, sha) means "this namespace has proven possession of sha".
    this._db.exec(`
      CREATE TABLE IF NOT EXISTS refs (
        namespace TEXT NOT NULL,
        sha TEXT NOT NULL,
        PRIMARY KEY (namespace, sha)
      );
    `);
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
    const abs = this._blobPath(computed);
    if (!existsSync(abs)) {
      mkdirSync(dirname(abs), { recursive: true });
      // write-tmp + atomic-rename so a concurrent reader never sees a partial blob.
      const tmp = `${abs}.${randomUUID()}.tmp`;
      writeFileSync(tmp, bytes);
      renameSync(tmp, abs);
    }
    this._db.prepare('INSERT OR IGNORE INTO refs (namespace, sha) VALUES (?, ?)').run(namespace, computed);
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
    const blobPath = this._blobPath(computed);
    mkdirSync(dirname(blobPath), { recursive: true });
    renameSync(tmpPath, blobPath);

    this._db.prepare('INSERT OR IGNORE INTO refs (namespace, sha) VALUES (?, ?)').run(namespace, computed);
    return { sha256: computed, bytes };
  }
}
