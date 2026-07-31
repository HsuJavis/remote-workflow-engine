// ContinuationStore (v8 Slice 4, REQ-053): durable on-completion chaining — "run A completes → start
// run B". SQLite-persisted, engine-owned SIDE TABLE (mirrors SqliteSchedulerPort / run_origins; zero
// change to RunSpec/RunStore, the same "don't touch v1 core" stance as the scheduler). Subscribes to
// RunManager.onTerminal (REQ-052): completed → fire B once; failed/stopped → skip. Firing is idempotent
// via an atomic `WHERE status='pending'` claim, so a stop→resume→complete cycle starts B at most once.
// Durable across restart: rearmAtBoot() reconciles any still-pending continuation whose target already
// terminated (hydrateAll marks a cross-restart running run failed, so the target is always terminal on
// boot if it finished/died while down).
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Clock } from './clock.js';
import type { RunStatus, RunStatusView, ErrEnvelope } from './types.js';

/** Structural seam — matches RunManager.start() without importing the class (same as the scheduler). */
interface RunManagerPort {
  start(spec: { name?: string; script?: string; args?: unknown; budget?: number | null }): Promise<string>;
}
/** Structural seam — the one RunStore read the boot reconcile needs (the target's terminal status). */
interface RunStorePort {
  getRun(runId: string): Promise<RunStatusView | null>;
}

export interface ContinuationStoreDeps {
  clock: Clock;
  runManager: RunManagerPort;
  store: RunStorePort;
  dbPath: string; // ':memory:' for tests, a file path in production
}

export interface ChainSpec {
  afterRunId: string;
  run: { workflow: string; args?: unknown; budget?: number | null };
}
export type ChainStatus = 'pending' | 'fired' | 'skipped';
export interface ChainView {
  chainId: string;
  afterRunId: string;
  workflow: string;
  rootRunId: string;
  status: ChainStatus;
  spawnedRunId?: string;
  createdAt: string;
}

const TERMINAL: RunStatus[] = ['completed', 'failed', 'stopped'];

interface ChainRow {
  id: string;
  afterRunId: string;
  workflow: string;
  argsJson: string | null;
  budget: number | null;
  rootRunId: string;
  status: ChainStatus;
  spawnedRunId: string | null;
  createdAt: string;
}

export class ContinuationStore {
  private readonly _db: Database.Database;
  private readonly _clock: Clock;
  private readonly _runManager: RunManagerPort;
  private readonly _store: RunStorePort;

  constructor(deps: ContinuationStoreDeps) {
    this._clock = deps.clock;
    this._runManager = deps.runManager;
    this._store = deps.store;
    if (deps.dbPath !== ':memory:') mkdirSync(dirname(deps.dbPath), { recursive: true });
    this._db = new Database(deps.dbPath);
    this._db.pragma('journal_mode = WAL');
    this._db.exec(`
      CREATE TABLE IF NOT EXISTS continuations (
        id TEXT PRIMARY KEY,
        afterRunId TEXT NOT NULL,
        workflow TEXT NOT NULL,
        argsJson TEXT,
        budget INTEGER,
        rootRunId TEXT NOT NULL,
        status TEXT NOT NULL,
        spawnedRunId TEXT,
        createdAt TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_continuations_after ON continuations(afterRunId);
    `);
  }

  /** Registers "when afterRunId completes, start run.workflow". Returns {chainId} or a typed error
   *  ({code:'CHAIN_TARGET_NOT_FOUND'}) when afterRunId is unknown. If afterRunId ALREADY terminated at
   *  create time, reconciles immediately (fire/skip) so a late chain_create still behaves. */
  async chainCreate(spec: ChainSpec): Promise<{ chainId: string; error?: ErrEnvelope }> {
    const target = await this._store.getRun(spec.afterRunId);
    if (!target) {
      return { chainId: '', error: { code: 'CHAIN_TARGET_NOT_FOUND', message: `Unknown afterRunId: ${spec.afterRunId}` } };
    }
    const chainId = randomUUID();
    const rootRunId = this._rootOf(spec.afterRunId);
    this._db
      .prepare('INSERT INTO continuations (id, afterRunId, workflow, argsJson, budget, rootRunId, status, spawnedRunId, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(chainId, spec.afterRunId, spec.run.workflow, spec.run.args != null ? JSON.stringify(spec.run.args) : null, spec.run.budget ?? null, rootRunId, 'pending', null, this._clock.isoNow());
    // Late create: the target may already be terminal.
    if (TERMINAL.includes(target.status)) await this._reconcile(chainId, target.status);
    return { chainId };
  }

  /** RunManager.onTerminal subscriber (REQ-052 → REQ-053): fire/skip every pending continuation whose
   *  target is this run. Safe to call more than once per runId (the claim is idempotent). */
  async onTerminal(runId: string, status: RunStatus): Promise<void> {
    if (!TERMINAL.includes(status)) return;
    const rows = this._db.prepare("SELECT id FROM continuations WHERE afterRunId = ? AND status = 'pending'").all(runId) as Array<{ id: string }>;
    for (const r of rows) await this._reconcile(r.id, status);
  }

  /** Boot reconcile (REQ-053 durability): for every still-pending continuation whose target already
   *  terminated (e.g. it finished/died while the engine was down), fire or skip it exactly once. */
  async rearmAtBoot(): Promise<void> {
    const rows = this._db.prepare("SELECT id, afterRunId FROM continuations WHERE status = 'pending'").all() as Array<{ id: string; afterRunId: string }>;
    for (const r of rows) {
      const target = await this._store.getRun(r.afterRunId);
      if (target && TERMINAL.includes(target.status)) await this._reconcile(r.id, target.status);
    }
  }

  async list(): Promise<ChainView[]> {
    const rows = this._db.prepare('SELECT * FROM continuations ORDER BY createdAt').all() as ChainRow[];
    return rows.map((r) => ({
      chainId: r.id, afterRunId: r.afterRunId, workflow: r.workflow, rootRunId: r.rootRunId,
      status: r.status, spawnedRunId: r.spawnedRunId ?? undefined, createdAt: r.createdAt,
    }));
  }

  /** Atomically claims a pending continuation and either starts run B (target completed) or marks it
   *  skipped (target failed/stopped). The `WHERE status='pending'` claim makes fire/skip idempotent —
   *  a concurrent onTerminal + boot reconcile can each attempt it but only one wins the row. */
  private async _reconcile(chainId: string, targetStatus: RunStatus): Promise<void> {
    if (targetStatus !== 'completed') {
      this._db.prepare("UPDATE continuations SET status = 'skipped' WHERE id = ? AND status = 'pending'").run(chainId);
      return;
    }
    // completed → claim, then start B. Claim to 'fired' up-front so no other caller double-starts;
    // if start() throws, mark 'skipped' (never leave a claimed row that silently started nothing).
    const claim = this._db.prepare("UPDATE continuations SET status = 'fired' WHERE id = ? AND status = 'pending'").run(chainId);
    if (claim.changes !== 1) return; // someone else already handled it
    const row = this._db.prepare('SELECT * FROM continuations WHERE id = ?').get(chainId) as ChainRow;
    try {
      const spawnedRunId = await this._runManager.start({
        name: row.workflow,
        args: row.argsJson != null ? (JSON.parse(row.argsJson) as unknown) : undefined,
        budget: row.budget,
      });
      this._db.prepare('UPDATE continuations SET spawnedRunId = ? WHERE id = ?').run(spawnedRunId, chainId);
    } catch (err) {
      this._db.prepare("UPDATE continuations SET status = 'skipped' WHERE id = ?").run(chainId);
      // eslint-disable-next-line no-console
      console.error(`[ContinuationStore] chain ${chainId} failed to start ${row.workflow}:`, err);
    }
  }

  /** The lineage root of a run: if it was itself spawned by a continuation, inherit that continuation's
   *  rootRunId; otherwise the run is its own root. Keeps a chain-of-chains anchored to the original run. */
  private _rootOf(runId: string): string {
    const parent = this._db.prepare('SELECT rootRunId FROM continuations WHERE spawnedRunId = ? LIMIT 1').get(runId) as { rootRunId: string } | undefined;
    return parent?.rootRunId ?? runId;
  }
}
