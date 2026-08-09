/**
 * DES-059 / TASK-062 — engine-side self-update wiring.
 * Contains:
 *  - assertUpdatePathsOutsideWorkRoot (boot guard — DES-059)
 *  - writeUpdateFlag (atomic flag write, 0600 — DES-059)
 *  - SelfUpdateDb (delivery dedup + outcome upsert — DES-059)
 *  - readUpdateResult (DES-061 tolerant reader, lives here because UT-066 imports from this module)
 */
import Database from 'better-sqlite3';
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isPathContained } from './path-containment.js';
import type { UpdateOutcome, UpdateStatus } from './update-types.js';
import type { Clock } from './clock.js';

// ─── Boot guard ───────────────────────────────────────────────────────────────

/**
 * Boot guard (DES-059): refuses to start when any configured flag/result path resolves inside
 * any workRoot directory. Throws an Error whose message contains 'UPDATE_FLAG_INSIDE_WORKROOT'.
 * Guard runs ONLY on configured (non-undefined) paths. Reuses the shared realpath-based
 * containment check (path-containment.ts) so the "inside" test matches every other jail in the
 * engine (symlink-resolved, os.sep-correct) rather than a hand-rolled string prefix.
 */
export function assertUpdatePathsOutsideWorkRoot(
  paths: Array<string | undefined>,
  workRoots: string[],
): void {
  for (const p of paths) {
    if (!p) continue;
    for (const root of workRoots) {
      if (isPathContained(p, root)) {
        throw new Error(
          `UPDATE_FLAG_INSIDE_WORKROOT: update path "${p}" resolves inside workRoot "${root}". ` +
          'Place update flag/result files outside every workRoot (RCE-prevention).',
        );
      }
    }
  }
}

// ─── Flag writer ──────────────────────────────────────────────────────────────

/**
 * Atomically write the update flag file.
 * Writes to a temp file in the same directory (same device → atomic rename), then renames
 * into place. Mode 0600 — engine-user-owned, not world-readable.
 * Content is exactly `tag + '\n'`.
 */
export function writeUpdateFlag(tag: string, flagPath: string): void {
  const dir = dirname(flagPath);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.update-flag-tmp-${process.pid}`);
  writeFileSync(tmp, tag + '\n', { mode: 0o600 });
  renameSync(tmp, flagPath);
}

// ─── SQLite delivery dedup + outcome store ────────────────────────────────────

export class SelfUpdateDb {
  private readonly _db: Database.Database;
  private readonly _clock: Clock;

  constructor(dbPath: string, clock: Clock) {
    this._clock = clock;
    if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
    this._db = new Database(dbPath);
    this._db.pragma('journal_mode = WAL');
    this._db.exec(`
      CREATE TABLE IF NOT EXISTS update_deliveries (
        deliveryId TEXT PRIMARY KEY,
        ts TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS update_outcome (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        json TEXT NOT NULL
      );
    `);
  }

  /**
   * Returns true if this deliveryId was already seen (duplicate).
   * When deliveryId is absent → returns false (skip dedup; process anyway — the idempotent
   * helper covers a double-arm per DES-059).
   * Uses INSERT OR IGNORE: changes === 0 means the row already existed.
   */
  isDuplicate(deliveryId: string | undefined): boolean {
    if (!deliveryId) return false;
    const result = this._db
      .prepare('INSERT OR IGNORE INTO update_deliveries (deliveryId, ts) VALUES (?, ?)')
      .run(deliveryId, this._clock.isoNow());
    return result.changes === 0;
  }

  /**
   * INSERT OR REPLACE the single update_outcome row with status='pending'.
   * Called on every arm, before the flag write (DES-059 ordering).
   */
  upsertPending(tag: string): void {
    // Same single-row INSERT OR REPLACE as overwriteOutcome — delegate so the SQL lives in one place.
    this.overwriteOutcome({ tag, status: 'pending', ts: this._clock.isoNow() });
  }

  /**
   * Read the current update_outcome row (null if no row or malformed).
   * Used by the stale-result guard in DES-061 to avoid clobbering a fresh pending row.
   */
  readOutcome(): UpdateOutcome | null {
    const row = this._db
      .prepare('SELECT json FROM update_outcome WHERE id = 1')
      .get() as { json: string } | undefined;
    if (!row) return null;
    try { return JSON.parse(row.json) as UpdateOutcome; } catch { return null; }
  }

  /**
   * Overwrite the current update_outcome row with a new outcome.
   * Used by the ingest path (DES-061) to record the helper's result.
   */
  overwriteOutcome(outcome: UpdateOutcome): void {
    this._db
      .prepare('INSERT OR REPLACE INTO update_outcome (id, json) VALUES (1, ?)')
      .run(JSON.stringify(outcome));
  }

  close(): void {
    this._db.close();
  }
}

// ─── Tolerant result reader (DES-061) ─────────────────────────────────────────
//
// Lives in this module because UT-066 imports `readUpdateResult` from `src/self-update.ts`.
// TASK-064 consumes it from here (no circular dep: self-update.ts does not import server.ts).

const VALID_STATUSES = new Set<UpdateStatus>(['pending', 'applied', 'failed', 'skipped']);
const MAX_DETAIL_BYTES = 4096;

/**
 * Tolerant reader (DES-061): returns null for any bad/absent/unknown input.
 * Never throws. `detail` is capped at MAX_DETAIL_BYTES via head+tail truncation.
 * Injectable `readFileImpl` for tests that supply in-memory content.
 */
export function readUpdateResult(
  path: string,
  readFileImpl: (p: string) => string = (p) => readFileSync(p, 'utf-8'),
): UpdateOutcome | null {
  let text: string;
  try {
    text = readFileImpl(path);
  } catch {
    return null; // absent file
  }
  if (!text || !text.trim()) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null; // malformed JSON
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;

  if (typeof obj['tag'] !== 'string' || typeof obj['ts'] !== 'string') return null;
  if (!VALID_STATUSES.has(obj['status'] as UpdateStatus)) return null;

  let detail: string | undefined;
  if (typeof obj['detail'] === 'string') {
    const d = obj['detail'];
    if (d.length > MAX_DETAIL_BYTES) {
      const half = Math.floor(MAX_DETAIL_BYTES / 2);
      detail = d.slice(0, half) + '\n...[truncated]...\n' + d.slice(d.length - half);
    } else {
      detail = d;
    }
  }

  const outcome: UpdateOutcome = {
    tag: obj['tag'] as string,
    status: obj['status'] as UpdateStatus,
    ts: obj['ts'] as string,
  };
  if (detail !== undefined) outcome.detail = detail;
  return outcome;
}
