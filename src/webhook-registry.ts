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

/** Structural seam — matches RunManager.start() without importing the class (as scheduler/continuation). */
interface RunManagerPort {
  // v26 (DES-181, ARCH-118, TASK-181): `budget` widened to match `RunSpec` — a fire-path caller
  // never sets it (undefined), but the port's inline shape must stay a superset of `RunSpec`'s or
  // `RunManager` stops structurally satisfying this seam.
  start(spec: { name?: string; script?: string; args?: unknown; budget?: number | { usd?: number; tokens?: number } | null; startedBy?: { type: string; id?: string } }): Promise<string>;
}
/** Structural seam — matches WorkflowCatalog's own resolve() signature without importing the class.
 *  Widened for H4's second site (07-review.md §4.2/§8.1, ARCH-072 note 1): `create()` needs the SAME
 *  channel-resolution check `workflow_run`/`Scheduler.create()` use, not just "the name exists" —
 *  a registered-but-unpublished draft (REQ-097's normal author-loop state) must be refused
 *  CHANNEL_UNPUBLISHED here, not accepted and left to fail at every subsequent delivery. `exists()`
 *  is dropped — `create()` was its only caller in this file. */
interface CatalogPort {
  resolve(name: string, sel: { channel?: string }): Promise<{ triggers?: string[] } | unknown>;
  /** v24 Gate 8 (AF-2, TASK-161): "has this workflow EVER declared this trigger id, in any version?"
   *  REQUIRED, not optional (ADR-028 fail-closed reasoning applied to a port): a fake that omits it
   *  must be a compile error, not a silent `undefined` that turns the membership check below into
   *  whatever `undefined` happens to mean that day. */
  declaresTrigger(name: string, triggerId: string): boolean;
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
  /** v24 (DES-139/DES-149): the CREATING PRINCIPAL — the owner authz checks. `null` = a migrated
   *  pre-v24 row with no recorded creator (admin-only, per DES-139's tri-state). */
  createdBy: string | null;
  enabled: boolean;
  secretFingerprint: string; // short sha256 prefix — never the secret itself
  // v24 (DES-150, TASK-142): same coalesced fire-path refusal accounting as the scheduler's
  // ScheduleStatus (scheduler.ts) — mirrors that shape rather than declaring its own.
  refusalCount: number;
  lastRefusedAt?: string;
  lastRefusalReason?: RefusalReason;
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
  createdBy: string | null;
  secret: string;
  enabled: number;
  createdAt: string;
  refusalCount: number;
  lastRefusedAt: string | null;
  lastRefusalReason: string | null;
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
        createdBy TEXT,
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
    // v24 (DES-150, TASK-156): a pre-v24 on-disk `webhooks.db` still carries `workflow TEXT NOT
    // NULL` (created before the unclaimed-webhook shape existed). SQLite cannot drop a NOT NULL
    // constraint via ALTER, so a NOT NULL `workflow` column is rebuilt: create the v24 shape under
    // a temp name, copy every row across, drop the old table, rename. Idempotent — a fresh/already
    // -migrated db has `workflow` nullable already, so this block is skipped entirely.
    const workflowIsNotNull = (this._db.prepare('PRAGMA table_info(webhooks)').all() as Array<{ name: string; notnull: number }>)
      .some((c) => c.name === 'workflow' && c.notnull === 1);
    if (workflowIsNotNull) {
      // Transactional (SQLite DDL is transactional): a crash mid-rebuild leaves the original
      // `webhooks` table untouched — the next boot's PRAGMA check redoes the rebuild from
      // scratch rather than silently stranding rows in a half-renamed table.
      this._db.transaction(() => {
        this._db.exec(`
          CREATE TABLE webhooks__v24_rebuild (
            id TEXT PRIMARY KEY,
            workflow TEXT,
            createdBy TEXT,
            secret TEXT NOT NULL,
            enabled INTEGER NOT NULL,
            createdAt TEXT NOT NULL,
            refusalCount INTEGER NOT NULL DEFAULT 0,
            lastRefusedAt TEXT,
            lastRefusalReason TEXT
          );
          INSERT INTO webhooks__v24_rebuild (id, workflow, secret, enabled, createdAt)
            SELECT id, workflow, secret, enabled, createdAt FROM webhooks;
          DROP TABLE webhooks;
          ALTER TABLE webhooks__v24_rebuild RENAME TO webhooks;
        `);
      })();
    }
    // v24 (DES-149/150, TASK-142): additive migration — the claim-model refusal accounting columns.
    // A no-op after the rebuild above (those columns already exist on the rebuilt table).
    try { this._db.exec('ALTER TABLE webhooks ADD COLUMN createdBy TEXT'); } catch { /* already exists */ }
    try { this._db.exec('ALTER TABLE webhooks ADD COLUMN refusalCount INTEGER NOT NULL DEFAULT 0'); } catch { /* already exists */ }
    try { this._db.exec('ALTER TABLE webhooks ADD COLUMN lastRefusedAt TEXT'); } catch { /* already exists */ }
    try { this._db.exec('ALTER TABLE webhooks ADD COLUMN lastRefusalReason TEXT'); } catch { /* already exists */ }
  }

  /** Registers a webhook. v24 (DES-149): `workflow` is now OPTIONAL — omitted, the webhook is
   *  created UNCLAIMED (fires nothing until `claim()`, typically via a workflow's registration
   *  `triggers[]`); supplied, it is claimed immediately (this is a brand-new row, so no other
   *  claimant can race it). Generates the secret server-side and returns it EXACTLY ONCE — it is
   *  never retrievable again (list shows only a fingerprint).
   *
   *  v24 Gate 7.5 (D-1): the H4 create-time catalog-resolve check is GONE here for the same reason
   *  it is gone from `Scheduler.create()` — REQ-115's last clause moves it. An unclaimed webhook
   *  that is delivered to is refused at DELIVERY (`UNCLAIMED` / `CLAIMED_WORKFLOW_MISSING` /
   *  `CHANNEL_UNPUBLISHED`) and the refusal is recorded on the row, which is where the answer is
   *  still true when it matters. */
  async create(spec: { workflow?: string; enabled?: boolean; createdBy?: string }): Promise<{ webhookId: string; secret: string } | { error: ErrEnvelope }> {
    const id = randomUUID();
    const secret = randomBytes(32).toString('hex');
    this._db
      .prepare('INSERT INTO webhooks (id, workflow, createdBy, secret, enabled, createdAt) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, spec.workflow ?? null, spec.createdBy ?? null, secret, spec.enabled === false ? 0 : 1, this._clock.isoNow());
    return { webhookId: id, secret };
  }

  /** v24 (integrator; DES-156/REQ-103): the by-id reader `workflow_describe.triggers[]` needs —
   *  same reason as `SqliteSchedulerPort.get`. */
  get(id: string): WebhookView | null {
    return this.list().find((w) => w.id === id) ?? null;
  }

  /** v24 (integrator; DES-156/REQ-103) — see `SqliteSchedulerPort.claimedIdsFor` for why ids only. */
  claimedIdsFor(workflow: string): string[] {
    const rows = this._db.prepare('SELECT id FROM webhooks WHERE workflow = ?').all(workflow) as Array<{ id: string }>;
    return rows.map((r) => r.id);
  }

  list(): WebhookView[] {
    const rows = this._db.prepare('SELECT * FROM webhooks ORDER BY createdAt').all() as WebhookRow[];
    return rows.map((r) => ({
      id: r.id, workflow: r.workflow, createdBy: r.createdBy ?? null, enabled: r.enabled === 1,
      secretFingerprint: createHash('sha256').update(r.secret).digest('hex').slice(0, 16),
      refusalCount: r.refusalCount ?? 0,
      ...(r.lastRefusedAt ? { lastRefusedAt: r.lastRefusedAt } : {}),
      ...(r.lastRefusalReason ? { lastRefusalReason: r.lastRefusalReason as RefusalReason } : {}),
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

  /** DES-139/DES-149 step 2: the OWNER is the CREATING PRINCIPAL (`createdBy`), never the claiming
   *  workflow — claiming a trigger for a workflow does not transfer its ownership. Tri-state:
   *  `undefined` = no such webhook id in this store; `null` = exists with no recorded creator
   *  (a migrated pre-v24 row, admin-only per DES-139); a string = the creator's principal id. */
  ownerOf(id: string): string | null | undefined {
    const row = this._db.prepare('SELECT createdBy FROM webhooks WHERE id = ?').get(id) as { createdBy: string | null } | undefined;
    return row ? row.createdBy : undefined;
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

    // v24 (integrator; DES-150): the OTHER three refusal reasons. `RefusalReason` is declared once
    // in types.ts as a vocabulary SHARED by the scheduler and this registry, and this path only
    // ever produced one of its four members — a webhook whose claimed workflow had been
    // deregistered, unpublished, or dropped from the released version's `triggers[]` fired anyway
    // (or failed at dispatch and was recorded as `lastError`, which the docblock says means
    // something else entirely). Same order and same codes as the scheduler driver's gate.
    let released: { triggers?: string[] };
    try {
      released = (await this._catalog.resolve(row.workflow, { channel: 'release' })) as { triggers?: string[] };
    } catch (err) {
      const code = (err as { code?: unknown } | null)?.code;
      const reason: RefusalReason = code === 'CHANNEL_UNPUBLISHED' ? 'CHANNEL_UNPUBLISHED' : 'CLAIMED_WORKFLOW_MISSING';
      this._recordRefusal(id, reason);
      return { ok: false, httpStatus: 409, reason: `claimed workflow '${row.workflow}' cannot be fired: ${reason}`, code: reason };
    }
    // Membership, with BOTH guards (v24 Gate 8, AF-2 / TASK-161):
    //   - `triggers !== undefined` still covers a genuine PRE-v24 version row, whose column did not
    //     exist and therefore says nothing;
    //   - `declaresTrigger` covers the create-time binding door (`webhook_create({workflow})`):
    //     such a webhook never entered ANY version's `triggers[]`, so the released version's list
    //     has no jurisdiction over it and refusing it would silently stop every webhook bound that
    //     way. v24 adjudication #8 (H-2, issue #56) closed that door on the tool surface (AF-5
    //     fixed), so this guard now protects PRE-v24 legacy rows — which still exist and still fire.
    // The first guard used to carry both jobs by proxy, because an empty declaration was stored as
    // NULL — which is the very conflation AF-2 is about, and why fixing the storage without fixing
    // this line trades one silent failure for another.
    if (released?.triggers !== undefined && !released.triggers.includes(id) && this._catalog.declaresTrigger(row.workflow, id)) {
      this._recordRefusal(id, 'NOT_IN_RELEASE');
      return { ok: false, httpStatus: 409, reason: `webhook ${id} is not in workflow '${row.workflow}'s released version`, code: 'NOT_IN_RELEASE' };
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
