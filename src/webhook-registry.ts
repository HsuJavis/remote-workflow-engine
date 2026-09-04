// WebhookRegistry (v8 Defer B, REQ-057/058): durable external-ingress registry. SQLite-persisted,
// engine-owned side table (mirrors SqliteSchedulerPort / ContinuationStore). A webhook binds an id →
// {workflow, secret}; POST /hooks/:id fires the PRE-BOUND workflow (name from the stored row, NEVER
// from the request body — no workflow-selection injection) after fail-closed verification: HMAC-SHA256
// (constant-time) over the raw body, a ±300s timestamp window, and a one-shot deliveryId dedup.
//
// Secret model (as HMAC requires): the secret IS the HMAC key, so verification needs it — it is
// generated server-side, stored server-side, and returned to the client EXACTLY ONCE at creation;
// it is never retrievable again (list exposes only a short sha256 fingerprint, never the secret).
// This is the same model GitHub/Stripe webhooks use — a one-way hash can't verify an HMAC.
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID, randomBytes, createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { Clock } from './clock.js';
import type { ErrEnvelope, RefusalReason } from './types.js';
import { catalogResolveErrorEnvelope } from './errors.js';

/** Structural seam — matches RunManager.start() without importing the class (as scheduler/continuation). */
interface RunManagerPort {
  start(spec: { name?: string; script?: string; args?: unknown; budget?: number | null; startedBy?: { type: string; id?: string } }): Promise<string>;
}
/** Structural seam — matches WorkflowCatalog's own resolve() signature without importing the class.
 *  Widened for H4's second site (07-review.md §4.2/§8.1, ARCH-072 note 1): `create()` needs the SAME
 *  channel-resolution check `workflow_run`/`Scheduler.create()` use, not just "the name exists" —
 *  a registered-but-unpublished draft (REQ-097's normal author-loop state) must be refused
 *  CHANNEL_UNPUBLISHED here, not accepted and left to fail at every subsequent delivery. `exists()`
 *  is dropped — `create()` was its only caller in this file. */
interface CatalogPort {
  resolve(name: string, sel: { channel?: string }): Promise<unknown>;
}

export interface WebhookRegistryDeps {
  clock: Clock;
  runManager: RunManagerPort;
  catalog: CatalogPort;
  dbPath: string; // ':memory:' for tests, a file path in production
}

export interface WebhookView {
  id: string;
  /** v24 (DES-149): null = created unclaimed (`create({})`) — not yet bound to any workflow. */
  workflow: string | null;
  enabled: boolean;
  secretFingerprint: string; // short sha256 prefix — never the secret itself
}

/** The verify+fire outcome, mapped by the HTTP route to a status code. v24 (DES-150) adds 409 for
 *  a claim-model refusal, carrying the machine-readable `code` alongside the existing `reason` text. */
export type DeliverResult =
  | { ok: true; httpStatus: 202 | 200; runId?: string; replayed?: boolean }
  | { ok: false; httpStatus: 401 | 403 | 404; reason: string }
  | { ok: false; httpStatus: 409; reason: string; code: RefusalReason };

const REPLAY_WINDOW_MS = 300_000; // ±300s

interface WebhookRow {
  id: string;
  workflow: string | null;
  secret: string;
  enabled: number;
  createdAt: string;
  refusalCount: number;
}

export class WebhookRegistry {
  private readonly _db: Database.Database;
  private readonly _clock: Clock;
  private readonly _runManager: RunManagerPort;
  private readonly _catalog: CatalogPort;

  constructor(deps: WebhookRegistryDeps) {
    this._clock = deps.clock;
    this._runManager = deps.runManager;
    this._catalog = deps.catalog;
    if (deps.dbPath !== ':memory:') mkdirSync(dirname(deps.dbPath), { recursive: true });
    this._db = new Database(deps.dbPath);
    this._db.pragma('journal_mode = WAL');
    this._db.exec(`
      CREATE TABLE IF NOT EXISTS webhooks (
        id TEXT PRIMARY KEY,
        workflow TEXT,
        secret TEXT NOT NULL,
        enabled INTEGER NOT NULL,
        createdAt TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS webhook_deliveries (
        deliveryId TEXT PRIMARY KEY,
        webhookId TEXT NOT NULL,
        ts TEXT NOT NULL
      );
    `);
    // v24 (DES-149/150, TASK-142): additive migration — the claim-model refusal accounting columns.
    // NOTE (needs_clarification, TASK-142): `workflow` above is only nullable for a FRESH db — a
    // pre-v24 on-disk `webhooks.db` still carries `workflow TEXT NOT NULL` (SQLite cannot drop a
    // NOT NULL constraint without a table rebuild, which this task does not attempt untested); an
    // old db therefore still requires `workflow` at creation. No test in this slice exercises a
    // pre-v24 db, so this is flagged rather than silently patched.
    try { this._db.exec('ALTER TABLE webhooks ADD COLUMN refusalCount INTEGER NOT NULL DEFAULT 0'); } catch { /* already exists */ }
    try { this._db.exec('ALTER TABLE webhooks ADD COLUMN lastRefusedAt TEXT'); } catch { /* already exists */ }
    try { this._db.exec('ALTER TABLE webhooks ADD COLUMN lastRefusalReason TEXT'); } catch { /* already exists */ }
  }

  /** Registers a webhook. v24 (DES-149): `workflow` is now OPTIONAL — omitted, the webhook is
   *  created UNCLAIMED (fires nothing until `claim()`, typically via a workflow's registration
   *  `triggers[]`); supplied, it is claimed immediately (this is a brand-new row, so no other
   *  claimant can race it — the same H4 catalog-resolve check runs either way). Generates the
   *  secret server-side and returns it EXACTLY ONCE — it is never retrievable again (list shows
   *  only a fingerprint). */
  async create(spec: { workflow?: string; enabled?: boolean }): Promise<{ webhookId: string; secret: string } | { error: ErrEnvelope }> {
    if (spec.workflow !== undefined) {
      // H4 second site (07-review.md §8.1): upgraded from "the name exists" to "the name resolves on
      // `release`" — same check Scheduler.create() uses (scheduler.ts:157-175).
      try {
        await this._catalog.resolve(spec.workflow, { channel: 'release' });
      } catch (err) {
        return { error: catalogResolveErrorEnvelope(err, spec.workflow) };
      }
    }
    const id = randomUUID();
    const secret = randomBytes(32).toString('hex');
    this._db
      .prepare('INSERT INTO webhooks (id, workflow, secret, enabled, createdAt) VALUES (?, ?, ?, ?, ?)')
      .run(id, spec.workflow ?? null, secret, spec.enabled === false ? 0 : 1, this._clock.isoNow());
    return { webhookId: id, secret };
  }

  list(): WebhookView[] {
    const rows = this._db.prepare('SELECT * FROM webhooks ORDER BY createdAt').all() as WebhookRow[];
    return rows.map((r) => ({
      id: r.id, workflow: r.workflow, enabled: r.enabled === 1,
      secretFingerprint: createHash('sha256').update(r.secret).digest('hex').slice(0, 16),
    }));
  }

  delete(id: string): { deleted: boolean } {
    const info = this._db.prepare('DELETE FROM webhooks WHERE id = ?').run(id);
    return { deleted: info.changes > 0 };
  }

  /** v24 (DES-149): claims an unclaimed webhook for `workflow` inside one transaction — the same
   *  claim model the trigger stores share. `'held'` (already claimed BY this workflow) is never
   *  released by compensation; `'ALREADY_CLAIMED'` (claimed by someone else) leaves the row untouched. */
  claim(id: string, workflow: string): 'claimed' | 'held' | 'NOT_FOUND' | 'ALREADY_CLAIMED' {
    return this._db.transaction((): 'claimed' | 'held' | 'NOT_FOUND' | 'ALREADY_CLAIMED' => {
      const row = this._db.prepare('SELECT workflow FROM webhooks WHERE id = ?').get(id) as { workflow: string | null } | undefined;
      if (!row) return 'NOT_FOUND';
      if (row.workflow === workflow) return 'held';
      if (row.workflow !== null) return 'ALREADY_CLAIMED';
      const info = this._db.prepare('UPDATE webhooks SET workflow = ? WHERE id = ? AND workflow IS NULL').run(workflow, id);
      return info.changes === 1 ? 'claimed' : 'ALREADY_CLAIMED'; // lost a race between the SELECT and the UPDATE
    })();
  }

  /** v24 (DES-149): idempotent — releasing an id not claimed by `workflow` (including one already
   *  unclaimed) is a no-op, never an error. */
  release(id: string, workflow: string): void {
    this._db.prepare('UPDATE webhooks SET workflow = NULL WHERE id = ? AND workflow = ?').run(id, workflow);
  }

  /** v24 (DES-149): tri-state — `undefined` = no such webhook id in this store; `null` = exists,
   *  unclaimed; a string = the claiming workflow's name. */
  ownerOf(id: string): string | null | undefined {
    const row = this._db.prepare('SELECT workflow FROM webhooks WHERE id = ?').get(id) as { workflow: string | null } | undefined;
    return row ? row.workflow : undefined;
  }

  /** v24 (DES-150): shares `markFailed`'s advance-and-record shape — increments `refusalCount`,
   *  records `lastRefusedAt`/`lastRefusalReason`, never touches `lastError` (the two are mutually
   *  exclusive: dispatch failure vs policy refusal, stated once here). */
  private _recordRefusal(id: string, reason: RefusalReason): void {
    this._db.prepare('UPDATE webhooks SET refusalCount = refusalCount + 1, lastRefusedAt = ?, lastRefusalReason = ? WHERE id = ?')
      .run(this._clock.isoNow(), reason, id);
  }

  /** Fail-closed verify + fire. Order (v24, DES-150): exists+enabled → HMAC signature (constant-time,
   *  over the RAW body) → ±300s timestamp window → one-shot deliveryId dedup CHECK (before the claim
   *  checks — a caller must not learn claim state without a valid signature) → claim checks → dedup
   *  RECORD (written only for an ADMITTED delivery, so a retry after the author claims still fires
   *  for real) → start the claimed workflow with the parsed body as args.event. Any failure starts
   *  NO run. */
  async deliver(id: string, req: { signature?: string; timestamp?: string; deliveryId?: string; rawBody: string; parsedBody: unknown }): Promise<DeliverResult> {
    const row = this._db.prepare('SELECT * FROM webhooks WHERE id = ?').get(id) as WebhookRow | undefined;
    if (!row) return { ok: false, httpStatus: 404, reason: 'unknown webhook' };
    if (row.enabled !== 1) return { ok: false, httpStatus: 403, reason: 'webhook disabled' };

    const expected = createHmac('sha256', row.secret).update(req.rawBody).digest('hex');
    const provided = (req.signature ?? '').replace(/^sha256=/, '');
    if (!signatureEquals(provided, expected)) return { ok: false, httpStatus: 401, reason: 'bad signature' };

    const tsMs = req.timestamp ? Date.parse(req.timestamp) : NaN;
    if (!Number.isFinite(tsMs) || Math.abs(this._clock.now() - tsMs) > REPLAY_WINDOW_MS) {
      return { ok: false, httpStatus: 401, reason: 'stale or missing timestamp' };
    }

    // Dedup CHECK — before the claim checks, never writes a record (that happens only below, on
    // admission). A replay of a delivery that was refused (unclaimed) is therefore NOT a replay —
    // no record was ever written for it — and fires for real once the webhook is claimed.
    if (req.deliveryId) {
      const existing = this._db.prepare('SELECT 1 FROM webhook_deliveries WHERE deliveryId = ?').get(req.deliveryId);
      if (existing) return { ok: true, httpStatus: 200, replayed: true };
    }

    if (row.workflow === null) {
      this._recordRefusal(id, 'UNCLAIMED');
      return { ok: false, httpStatus: 409, reason: 'webhook is not claimed by any workflow', code: 'UNCLAIMED' };
    }

    if (req.deliveryId) {
      this._db.prepare('INSERT OR IGNORE INTO webhook_deliveries (deliveryId, webhookId, ts) VALUES (?, ?, ?)')
        .run(req.deliveryId, id, this._clock.isoNow());
    }

    const runId = await this._runManager.start({ name: row.workflow, args: { event: req.parsedBody }, startedBy: { type: 'webhook', id } });
    return { ok: true, httpStatus: 202, runId };
  }
}

/** Constant-time hex-string compare (length-safe: unequal lengths short-circuit to false). */
function signatureEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
