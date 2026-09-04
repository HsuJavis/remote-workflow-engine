// SchedulerPort (DES-016 / ARCH-010 / TASK-019): SQLite-persisted Schedule records + CRUD +
// workflow_trigger (resident). Attaches at existing v1 seams (WorkflowCatalog + RunManager) with
// zero v1 rework — run-origin observability is derived by this module's own scheduleId->runId
// join (D-V2a decision), never by modifying RunSpec/RunStore.
//
// Simplification vs the DES-016 illustrative signature: create()/setEnabled()/delete()/trigger()
// return a lightweight `{ result?, error? }` envelope rather than the full v1 `ResultEnvelope`
// (whose `runId`/`status` fields describe a WORKFLOW RUN, not a schedule CRUD operation, and would
// be meaningless noise here) — same error/result shape callers branch on, no forced-irrelevant
// fields (Karpathy simplicity). MCP tool wiring (schedule_create/list/delete/setEnabled +
// workflow_trigger returning the v1 ResultEnvelope shape) happens where this port is composed
// into the server, not in this module.
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Clock } from './clock.js';
import type { ErrEnvelope, RefusalReason } from './types.js';
import { computeNextFire, bootRearm, type StoredSchedule } from './scheduler-engine.js';
import { catalogResolveErrorEnvelope } from './errors.js';

// v24 (DES-149, ARCH-099, TASK-141): `workflow` becomes OPTIONAL — a trigger can now be created
// UNCLAIMED (no bound workflow) and claimed later via `claim()`/`release()`/`ownerOf()`. Additive
// only: a caller that still supplies `workflow` at creation keeps today's H4 catalog-resolve
// behaviour verbatim (TASK-112's regression test depends on this). `claimedBy`/`createdBy` are the
// new per-trigger ownership fields (ARCH-099's "five columns", the other three being the refusal
// trio below).
export type Schedule =
  | { kind: 'cron'; id: string; workflow?: string; claimedBy?: string | null; createdBy?: string; args?: unknown; cron: string; tz?: string; enabled: boolean }
  | { kind: 'once'; id: string; workflow?: string; claimedBy?: string | null; createdBy?: string; args?: unknown; at: string; enabled: boolean }
  | { kind: 'resident'; id: string; workflow?: string; claimedBy?: string | null; createdBy?: string; args?: unknown; enabled: boolean };

// Plain `Omit<Schedule, 'id'>` does NOT distribute over a discriminated union (a known TS gotcha —
// it collapses to only the members' common keys, losing `cron`/`at`) unless the conditional's
// checked type is a naked generic parameter, so `create()`'s input type goes through this
// generic helper to keep each variant's own extra fields.
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
export type NewSchedule = DistributiveOmit<Schedule, 'id'>;

export interface ScheduleStatus {
  id: string;
  kind: Schedule['kind'];
  workflow?: string;
  claimedBy?: string | null;
  createdBy?: string;
  enabled: boolean;
  nextFire?: string;
  lastFire?: string;
  lastRunId?: string;
  lastError?: { code: string; at: string };
  // v24 (DES-150, TASK-141): coalesced fire-path refusal accounting — never touched by a dispatch
  // failure (`lastError`), only by a policy refusal BEFORE dispatch (`markRefused`).
  refusalCount?: number;
  lastRefusedAt?: string;
  lastRefusalReason?: RefusalReason;
}

export interface ScheduleResult<T> {
  result?: T;
  error?: ErrEnvelope;
}

/** Structural seam — matches WorkflowCatalog's own exists()/resolve() signatures without importing
 *  the class. `resolve` widened here for H4 (07-review.md §4.2, ARCH-072 note 1): `create()` needs
 *  the SAME channel-resolution check `workflow_run` uses, not just "the name exists". */
interface CatalogPort {
  exists(name: string): Promise<boolean>;
  resolve(name: string, sel: { channel?: string }): Promise<unknown>;
}
/** Structural seam — matches RunManager's own start() signature without importing the class. */
interface RunManagerPort {
  start(spec: { name?: string; script?: string; args?: unknown; budget?: number | null; startedBy?: { type: string; id?: string } }): Promise<string>;
}

export interface SchedulerPortDeps {
  clock: Clock;
  catalog: CatalogPort;
  runManager: RunManagerPort;
  dbPath: string; // ':memory:' for tests, a file path in production
}

// Minimal 5-field cron syntax check (validation only — computing the next fire time is DES-017's
// job). Accepts '*', a number, a range ('a-b'), a step ('*/n' or 'a-b/n'), and comma lists thereof.
const CRON_FIELD = /^(\*|\d+(-\d+)?)(\/\d+)?(,(\*|\d+(-\d+)?)(\/\d+)?)*$/;

function isValidCron(expr: string): boolean {
  const fields = expr.trim().split(/\s+/);
  return fields.length === 5 && fields.every((f) => CRON_FIELD.test(f));
}

interface ScheduleRow {
  id: string;
  kind: string;
  workflow: string | null;
  claimedBy: string | null;
  createdBy: string | null;
  argsJson: string | null;
  cron: string | null;
  tz: string | null;
  at: string | null;
  enabled: number;
  nextFire: number | null;
  lastFire: string | null;
  lastRunId: string | null;
  lastError: string | null;
  refusalCount: number;
  lastRefusedAt: string | null;
  lastRefusalReason: string | null;
}

function rowToSchedule(r: ScheduleRow): Schedule {
  const args = r.argsJson != null ? (JSON.parse(r.argsJson) as unknown) : undefined;
  const shared = { workflow: r.workflow ?? undefined, claimedBy: r.claimedBy, createdBy: r.createdBy ?? undefined };
  if (r.kind === 'cron') {
    return { kind: 'cron', id: r.id, ...shared, args, cron: r.cron!, tz: r.tz ?? undefined, enabled: r.enabled === 1 };
  }
  if (r.kind === 'once') {
    return { kind: 'once', id: r.id, ...shared, args, at: r.at!, enabled: r.enabled === 1 };
  }
  return { kind: 'resident', id: r.id, ...shared, args, enabled: r.enabled === 1 };
}

function rowToStatus(r: ScheduleRow): ScheduleStatus {
  return {
    id: r.id,
    kind: r.kind as Schedule['kind'],
    workflow: r.workflow ?? undefined,
    claimedBy: r.claimedBy,
    createdBy: r.createdBy ?? undefined,
    enabled: r.enabled === 1,
    nextFire: r.nextFire != null ? new Date(r.nextFire).toISOString() : undefined,
    lastFire: r.lastFire ?? undefined,
    lastRunId: r.lastRunId ?? undefined,
    lastError: r.lastError != null ? (JSON.parse(r.lastError) as { code: string; at: string }) : undefined,
    refusalCount: r.refusalCount ?? 0,
    lastRefusedAt: r.lastRefusedAt ?? undefined,
    lastRefusalReason: (r.lastRefusalReason as RefusalReason | null) ?? undefined,
  };
}

/** SQLite-persisted SchedulerPort (DES-016): CRUD + resident `trigger()` over Catalog+RunManager. */
export class SqliteSchedulerPort {
  private readonly _db: Database.Database;
  private readonly _clock: Clock;
  private readonly _catalog: CatalogPort;
  private readonly _runManager: RunManagerPort;

  constructor(deps: SchedulerPortDeps) {
    this._clock = deps.clock;
    this._catalog = deps.catalog;
    this._runManager = deps.runManager;
    if (deps.dbPath !== ':memory:') mkdirSync(dirname(deps.dbPath), { recursive: true });
    this._db = new Database(deps.dbPath);
    this._db.pragma('journal_mode = WAL');
    this._db.exec(`
      CREATE TABLE IF NOT EXISTS schedules (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        workflow TEXT,
        argsJson TEXT,
        cron TEXT,
        tz TEXT,
        at TEXT,
        enabled INTEGER NOT NULL,
        nextFire INTEGER,
        lastFire TEXT,
        lastRunId TEXT
      );
      CREATE TABLE IF NOT EXISTS run_origins (
        runId TEXT PRIMARY KEY,
        scheduleId TEXT NOT NULL,
        kind TEXT NOT NULL
      );
    `);
    // DES-118: idempotent add-column idiom (this repo's established pattern, e.g.
    // sqlite-run-store.ts:65-71) — a pre-v22 `schedules` table gets `lastError` on next boot; a
    // fresh CREATE TABLE above already has it, so this is a silent no-op there.
    try { this._db.exec('ALTER TABLE schedules ADD COLUMN lastError TEXT'); } catch { /* already present */ }
    // v24 (ARCH-099/DES-149/150, TASK-141): the "five columns" — additive, same idempotent idiom.
    // `workflow` above is also relaxed from NOT NULL for a FRESH table (an unclaimed trigger has no
    // bound workflow yet); an existing pre-v24 file predates this and keeps its NOT NULL constraint
    // (SQLite cannot drop a column constraint via ALTER), which is fine because every pre-v24 row
    // already carries a real workflow value.
    try { this._db.exec('ALTER TABLE schedules ADD COLUMN claimedBy TEXT'); } catch { /* already present */ }
    try { this._db.exec('ALTER TABLE schedules ADD COLUMN createdBy TEXT'); } catch { /* already present */ }
    try { this._db.exec('ALTER TABLE schedules ADD COLUMN refusalCount INTEGER NOT NULL DEFAULT 0'); } catch { /* already present */ }
    try { this._db.exec('ALTER TABLE schedules ADD COLUMN lastRefusedAt TEXT'); } catch { /* already present */ }
    try { this._db.exec('ALTER TABLE schedules ADD COLUMN lastRefusalReason TEXT'); } catch { /* already present */ }
  }

  async create(s: NewSchedule): Promise<ScheduleResult<Schedule>> {
    // v22 send-back (H4, 07-review.md §4.2, ARCH-072 note 1): upgraded from "the name exists" to
    // "the name resolves on `release`" — a registered-but-unpublished draft (REQ-097's normal
    // author-loop state) must be refused CHANNEL_UNPUBLISHED HERE, not accepted and left to fail at
    // every subsequent fire with no operator signal at the point of the actual mistake.
    // v24 (ARCH-099, TASK-141): the H4 catalog-resolve check only applies when a workflow is bound
    // AT CREATION — a trigger created unclaimed (no `workflow`, claimed later via `claim()`) has
    // nothing to resolve yet. Callers that still bind at creation (TASK-112's regression path) keep
    // today's behaviour verbatim.
    if (s.workflow !== undefined) {
      try {
        await this._catalog.resolve(s.workflow, { channel: 'release' });
      } catch (err) {
        // Same coded-error shape every `codedError()` throw carries (errors.ts) — e.g.
        // CHANNEL_UNPUBLISHED/UNKNOWN_VERSION/INVALID_CHANNEL from `resolveVersionRequest`.
        return { error: catalogResolveErrorEnvelope(err, s.workflow, { field: 'workflow' }) };
      }
    }
    if (s.kind === 'cron' && !isValidCron(s.cron)) {
      return { error: { code: 'INVALID_CRON', message: `Not a valid cron expression: ${s.cron}`, field: 'cron' } };
    }
    if (s.kind === 'once' && Number.isNaN(Date.parse(s.at))) {
      return { error: { code: 'INVALID_AT', message: `Not a valid ISO timestamp: ${s.at}`, field: 'at' } };
    }
    const id = randomUUID();
    const argsJson = s.args !== undefined ? JSON.stringify(s.args) : null;
    // DES-017: `nextFire` is computed once at creation (via the injected Clock, never a bare
    // Date.now()) so the firing engine's `tick()` has an immediately-usable due-time for cron/once
    // schedules; `resident` schedules never fire via tick() (trigger-only) and get no nextFire.
    const nextFire: number | null =
      s.kind === 'cron' ? computeNextFire(s.cron, s.tz, this._clock.now() - 1)
      : s.kind === 'once' ? Date.parse(s.at)
      : null;
    this._db
      .prepare(`
        INSERT INTO schedules (id, kind, workflow, claimedBy, createdBy, argsJson, cron, tz, at, enabled, nextFire, lastFire, lastRunId)
        VALUES (@id, @kind, @workflow, @claimedBy, @createdBy, @argsJson, @cron, @tz, @at, @enabled, @nextFire, NULL, NULL)
      `)
      .run({
        id,
        kind: s.kind,
        workflow: s.workflow ?? null,
        // v24: created unclaimed unless a workflow was bound at creation (backward-compat path),
        // in which case it is its own claim from birth (ARCH-099's migration note, applied fresh
        // rather than via a stored-row rewrite).
        claimedBy: s.workflow ?? null,
        createdBy: s.createdBy ?? null,
        argsJson,
        cron: s.kind === 'cron' ? s.cron : null,
        tz: s.kind === 'cron' ? (s.tz ?? null) : null,
        at: s.kind === 'once' ? s.at : null,
        enabled: s.enabled ? 1 : 0,
        nextFire,
      });
    const row = this._db.prepare('SELECT * FROM schedules WHERE id = ?').get(id) as ScheduleRow;
    return { result: rowToSchedule(row) };
  }

  async list(): Promise<ScheduleStatus[]> {
    const rows = this._db.prepare('SELECT * FROM schedules').all() as ScheduleRow[];
    return rows.map(rowToStatus);
  }

  /** v23 (DES-128, ARCH-078, TASK-126): the SYNC cron-only read `TriggerPorts.schedules` composes
   *  (getTriggerBindings/the analyzer both need a live, non-async snapshot). Includes DISABLED rows
   *  (the port's own `enabled` field is how a caller learns that) and excludes `once`/`resident` —
   *  `TriggerBinding`'s `'cron'` variant is the only shape this port ever produces. */
  listByWorkflow(workflow: string): Array<{ cron: string; tz?: string; enabled: boolean }> {
    const rows = this._db
      .prepare("SELECT cron, tz, enabled FROM schedules WHERE workflow = ? AND kind = 'cron'")
      .all(workflow) as Array<{ cron: string; tz: string | null; enabled: number }>;
    return rows.map((r) => ({ cron: r.cron, tz: r.tz ?? undefined, enabled: r.enabled === 1 }));
  }

  async setEnabled(id: string, on: boolean): Promise<ScheduleResult<void>> {
    const info = this._db.prepare('UPDATE schedules SET enabled = ? WHERE id = ?').run(on ? 1 : 0, id);
    if (info.changes === 0) return { error: { code: 'SCHEDULE_NOT_FOUND', message: `Unknown schedule: ${id}` } };
    return { result: undefined };
  }

  async delete(id: string): Promise<ScheduleResult<void>> {
    const info = this._db.prepare('DELETE FROM schedules WHERE id = ?').run(id);
    if (info.changes === 0) return { error: { code: 'SCHEDULE_NOT_FOUND', message: `Unknown schedule: ${id}` } };
    return { result: undefined };
  }

  /** Resident trigger (DES-016): starts a run via the SAME RunManager.start() path as workflow_run.
   *  D-V2I-3: `workflow` must be a catalog-REGISTERED workflow (REQ-014/REQ-015 wording) — an
   *  unknown name never silently starts an ad-hoc run here. */
  async trigger(workflow: string, args?: unknown): Promise<ScheduleResult<{ runId: string }>> {
    if (!(await this._catalog.exists(workflow))) {
      return { error: { code: 'WORKFLOW_NOT_FOUND', message: `Unknown workflow: ${workflow}`, field: 'workflow' } };
    }
    const row = this._db
      .prepare("SELECT * FROM schedules WHERE workflow = ? AND kind = 'resident' ORDER BY rowid DESC LIMIT 1")
      .get(workflow) as ScheduleRow | undefined;
    if (row && row.enabled !== 1) {
      return { error: { code: 'SCHEDULE_DISABLED', message: `Resident schedule for '${workflow}' is disabled` } };
    }
    const runId = await this._runManager.start({ name: workflow, args, startedBy: { type: 'schedule', id: workflow } });
    if (row) {
      const ts = this._clock.isoNow();
      this._db.prepare('UPDATE schedules SET lastFire = ?, lastRunId = ? WHERE id = ?').run(ts, runId, row.id);
      this._db
        .prepare('INSERT OR REPLACE INTO run_origins (runId, scheduleId, kind) VALUES (?, ?, ?)')
        .run(runId, row.id, 'resident');
    }
    return { result: { runId } };
  }

  /** Derives a run's origin by the scheduleId->runId join owned by this store (D-V2a, zero v1 rework). */
  originOf(runId: string): 'manual' | 'cron' | 'once' | 'resident' {
    const row = this._db.prepare('SELECT kind FROM run_origins WHERE runId = ?').get(runId) as
      | { kind: string }
      | undefined;
    return (row?.kind as 'cron' | 'once' | 'resident' | undefined) ?? 'manual';
  }

  /** D-V2I-2: the driver-facing read of every enabled cron/once schedule, shaped exactly as
   *  `scheduler-engine.ts`'s own `StoredSchedule` union so the PURE `tick()` function can run
   *  straight over it — `resident` schedules are excluded (trigger-only, `tick()` never fires
   *  them anyway; DES-016). */
  all(): StoredSchedule[] {
    // v24 (ARCH-099, TASK-141): `workflow IS NOT NULL` — an unclaimed trigger has nothing for the
    // driver to start yet; the fire-path membership/claim check (DES-149/150) lands with the facade
    // wiring in TASK-148, out of this task's scope.
    const rows = this._db
      .prepare("SELECT * FROM schedules WHERE enabled = 1 AND kind IN ('cron','once') AND nextFire IS NOT NULL AND workflow IS NOT NULL")
      .all() as ScheduleRow[];
    return rows.map((r): StoredSchedule =>
      r.kind === 'cron'
        ? { kind: 'cron', id: r.id, workflow: r.workflow!, args: r.argsJson != null ? JSON.parse(r.argsJson) : undefined, cron: r.cron!, tz: r.tz ?? undefined, enabled: true, nextFire: r.nextFire! }
        : { kind: 'once', id: r.id, workflow: r.workflow!, args: r.argsJson != null ? JSON.parse(r.argsJson) : undefined, at: r.at!, enabled: true, nextFire: r.nextFire! },
    );
  }

  /** D-V2I-2: records one `tick()` firing's outcome — the driver's own impure edge, called right
   *  after `RunManager.start()` succeeds for that firing. `once` auto-completes (`enabled:false`,
   *  REQ-015 clause 2); `cron` recomputes a fresh future `nextFire` from `clock.now()` (fire-once-
   *  on-catch-up-then-resume, DES-017 — never re-fires the same instant, never backfills). Also
   *  records the scheduleId->runId join (D-V2a) so `originOf()` reports it, same as `trigger()`. */
  markFired(firing: { id: string; kind: Schedule['kind'] }, runId: string): void {
    const ts = this._clock.isoNow();
    // v24 (DES-150, TASK-141): a successful fire resets the consecutive-refusal counter — the field
    // reads "refusals since the last successful fire", not a lifetime total.
    if (firing.kind === 'once') {
      this._db.prepare('UPDATE schedules SET lastFire = ?, lastRunId = ?, enabled = 0, refusalCount = 0 WHERE id = ?').run(ts, runId, firing.id);
    } else {
      const row = this._db.prepare('SELECT cron, tz FROM schedules WHERE id = ?').get(firing.id) as
        | { cron: string; tz: string | null }
        | undefined;
      const nextFire = row ? computeNextFire(row.cron, row.tz ?? undefined, this._clock.now()) : null;
      this._db.prepare('UPDATE schedules SET lastFire = ?, lastRunId = ?, nextFire = ?, refusalCount = 0 WHERE id = ?').run(ts, runId, nextFire, firing.id);
    }
    this._db
      .prepare('INSERT OR REPLACE INTO run_origins (runId, scheduleId, kind) VALUES (?, ?, ?)')
      .run(runId, firing.id, firing.kind);
  }

  /** v24 (DES-150, TASK-141): a fire-path POLICY refusal — the firing was due but refused BEFORE
   *  dispatch (unclaimed / claimed workflow missing / not in the release version's triggers / the
   *  claimed workflow's release channel is unpublished). Shares `markFailed`'s exact advance (a
   *  refused `once` is CONSUMED, a refused `cron` gets a fresh future `nextFire` — never re-fires
   *  the same due instant) PLUS the refusal trio; unlike `markFailed`, `lastError` is never touched
   *  — `lastError` means "dispatch failed", `lastRefusalReason` means "policy refused before
   *  dispatch", never both for one firing. */
  markRefused(firing: { id: string; kind: Schedule['kind'] }, reason: RefusalReason): void {
    const ts = this._clock.isoNow();
    if (firing.kind === 'once') {
      this._db
        .prepare('UPDATE schedules SET enabled = 0, refusalCount = refusalCount + 1, lastRefusedAt = ?, lastRefusalReason = ? WHERE id = ?')
        .run(ts, reason, firing.id);
    } else {
      const row = this._db.prepare('SELECT cron, tz FROM schedules WHERE id = ?').get(firing.id) as
        | { cron: string; tz: string | null }
        | undefined;
      const nextFire = row ? computeNextFire(row.cron, row.tz ?? undefined, this._clock.now()) : null;
      this._db
        .prepare('UPDATE schedules SET nextFire = ?, refusalCount = refusalCount + 1, lastRefusedAt = ?, lastRefusalReason = ? WHERE id = ?')
        .run(nextFire, ts, reason, firing.id);
    }
  }

  /** v24 (DES-149, TASK-141): per-trigger claim, inside one better-sqlite3 transaction (better-
   *  sqlite3 is synchronous, so the SELECT-then-UPDATE below is already atomic — no explicit
   *  `.transaction()` wrapper needed for a single connection). `'held'` (already claimed by the
   *  SAME workflow) is distinct from `'claimed'` for a reason: compensation on a later failure must
   *  release only ids THIS call newly claimed, never an id that was already a working claim. */
  claim(id: string, workflow: string): 'claimed' | 'held' | 'NOT_FOUND' | 'ALREADY_CLAIMED' {
    const row = this._db.prepare('SELECT claimedBy FROM schedules WHERE id = ?').get(id) as { claimedBy: string | null } | undefined;
    if (!row) return 'NOT_FOUND';
    if (row.claimedBy === workflow) return 'held';
    if (row.claimedBy != null) return 'ALREADY_CLAIMED';
    const info = this._db
      .prepare('UPDATE schedules SET claimedBy = ? WHERE id = ? AND claimedBy IS NULL')
      .run(workflow, id);
    return info.changes === 1 ? 'claimed' : 'ALREADY_CLAIMED';
  }

  /** Idempotent: releasing an id not claimed by `workflow` (including one already unclaimed) is a
   *  no-op, never an error — this is what lets compensation call `release` unconditionally on every
   *  id it attempted. */
  release(id: string, workflow: string): void {
    this._db.prepare('UPDATE schedules SET claimedBy = NULL WHERE id = ? AND claimedBy = ?').run(id, workflow);
  }

  /** `undefined` = no trigger with this id in this store (distinct from `null` = unclaimed). */
  ownerOf(id: string): string | null | undefined {
    const row = this._db.prepare('SELECT claimedBy FROM schedules WHERE id = ?').get(id) as { claimedBy: string | null } | undefined;
    return row ? row.claimedBy : undefined;
  }

  /** DES-118: the driver's `.catch()` gets a writer — exactly what `markFired` does minus `runId`
   *  (a failed dispatch never started a run): `once` auto-disables, `cron` recomputes a fresh future
   *  `nextFire` from `clock.now()`, both record `lastError:{code, at}`. Without this, nothing
   *  advances/disables the schedule after a failed dispatch, so it stays "due" and re-fires at the
   *  driver's tick cadence forever while `schedule_list` shows silence. */
  markFailed(firing: { id: string; kind: Schedule['kind'] }, code: string): void {
    const at = this._clock.isoNow();
    const lastError = JSON.stringify({ code, at });
    if (firing.kind === 'once') {
      this._db.prepare('UPDATE schedules SET enabled = 0, lastError = ? WHERE id = ?').run(lastError, firing.id);
    } else {
      const row = this._db.prepare('SELECT cron, tz FROM schedules WHERE id = ?').get(firing.id) as
        | { cron: string; tz: string | null }
        | undefined;
      const nextFire = row ? computeNextFire(row.cron, row.tz ?? undefined, this._clock.now()) : null;
      this._db.prepare('UPDATE schedules SET nextFire = ?, lastError = ? WHERE id = ?').run(nextFire, lastError, firing.id);
    }
  }

  /** D-V2I-2 (DES-017 "Boot re-arm from persistence using the injected Clock"): re-derives every
   *  persisted cron/once schedule's `nextFire` from `clock.now()` at startup via the already-tested
   *  pure `bootRearm()` helper, then persists the result back. A `once` schedule whose `at` is
   *  already past still comes back due (its `nextFire` is unchanged from its own `at`) — the
   *  driver's first tick fires it exactly as if the server had never restarted. */
  rearmAtBoot(): void {
    // v24: an unclaimed trigger (`workflow IS NULL`) is excluded — same reasoning as `all()`.
    const rows = this._db
      .prepare("SELECT * FROM schedules WHERE kind IN ('cron','once') AND workflow IS NOT NULL")
      .all() as ScheduleRow[];
    if (rows.length === 0) return;
    const stored: StoredSchedule[] = rows.map((r): StoredSchedule =>
      r.kind === 'cron'
        ? { kind: 'cron', id: r.id, workflow: r.workflow!, args: r.argsJson != null ? JSON.parse(r.argsJson) : undefined, cron: r.cron!, tz: r.tz ?? undefined, enabled: r.enabled === 1, nextFire: r.nextFire ?? this._clock.now() }
        : { kind: 'once', id: r.id, workflow: r.workflow!, args: r.argsJson != null ? JSON.parse(r.argsJson) : undefined, at: r.at!, enabled: r.enabled === 1, nextFire: r.nextFire ?? Date.parse(r.at!) },
    );
    const rearmed = bootRearm(stored, this._clock);
    const update = this._db.prepare('UPDATE schedules SET nextFire = ? WHERE id = ?');
    for (const s of rearmed) {
      if (s.kind !== 'resident') update.run(s.nextFire, s.id);
    }
  }
}
