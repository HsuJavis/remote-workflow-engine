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
import type { ErrEnvelope } from './types.js';

/** Structural seam — matches RunManager.start() without importing the class (as scheduler/continuation). */
interface RunManagerPort {
  start(spec: { name?: string; script?: string; args?: unknown; budget?: number | null }): Promise<string>;
}
/** Structural seam — matches WorkflowCatalog.get() (workflow-existence check at create time). */
interface CatalogPort {
  get(name: string): Promise<{ script: string; version: string }>;
}

export interface WebhookRegistryDeps {
  clock: Clock;
  runManager: RunManagerPort;
  catalog: CatalogPort;
  dbPath: string; // ':memory:' for tests, a file path in production
}

export interface WebhookView {
  id: string;
  workflow: string;
  enabled: boolean;
  secretFingerprint: string; // short sha256 prefix — never the secret itself
}

/** The verify+fire outcome, mapped by the HTTP route to a status code. */
export type DeliverResult =
  | { ok: true; httpStatus: 202 | 200; runId?: string; replayed?: boolean }
  | { ok: false; httpStatus: 401 | 403 | 404; reason: string };

const REPLAY_WINDOW_MS = 300_000; // ±300s

interface WebhookRow {
  id: string;
  workflow: string;
  secret: string;
  enabled: number;
  createdAt: string;
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
        workflow TEXT NOT NULL,
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
  }

  /** Registers a webhook for a PRE-BOUND workflow. Generates the secret server-side and returns it
   *  EXACTLY ONCE — it is never retrievable again (list shows only a fingerprint). */
  async create(spec: { workflow: string; enabled?: boolean }): Promise<{ webhookId: string; secret: string } | { error: ErrEnvelope }> {
    try {
      await this._catalog.get(spec.workflow);
    } catch {
      return { error: { code: 'WORKFLOW_NOT_FOUND', message: `Unknown workflow: ${spec.workflow}` } };
    }
    const id = randomUUID();
    const secret = randomBytes(32).toString('hex');
    this._db
      .prepare('INSERT INTO webhooks (id, workflow, secret, enabled, createdAt) VALUES (?, ?, ?, ?, ?)')
      .run(id, spec.workflow, secret, spec.enabled === false ? 0 : 1, this._clock.isoNow());
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

  /** Fail-closed verify + fire. Order: exists+enabled → HMAC signature (constant-time, over the RAW
   *  body) → ±300s timestamp window → one-shot deliveryId dedup → start the PRE-BOUND workflow with
   *  the parsed body as args.event. Any failure starts NO run. */
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

    if (req.deliveryId) {
      const ins = this._db.prepare('INSERT OR IGNORE INTO webhook_deliveries (deliveryId, webhookId, ts) VALUES (?, ?, ?)')
        .run(req.deliveryId, id, this._clock.isoNow());
      if (ins.changes === 0) return { ok: true, httpStatus: 200, replayed: true }; // replay → no second run
    }

    const runId = await this._runManager.start({ name: row.workflow, args: { event: req.parsedBody } });
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
