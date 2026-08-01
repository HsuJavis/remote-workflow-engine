// CasStore (v10 Slice 2, REQ-064): a content-addressed blob store for efficient workspace seeding.
// Blobs live on disk keyed by the sha256 of their RAW bytes (cas/<sha[0:2]>/<sha>); a per-namespace
// refset (SQLite) records which blobs a namespace has proven possession of. See
// docs/seed-sync-architecture.md for the security invariants this enforces:
//   • byte-verify + store-under-COMPUTED-hash (never the claimed one) → poisoning + confused-deputy safe
//   • `missing`/`hasRef` are PER-NAMESPACE, never global existence → no cross-tenant dedup oracle
//   • immutable pool (a written blob is never mutated) → concurrent assemble reads are safe
import Database from 'better-sqlite3';
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { codedError } from './errors.js';

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

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
}
