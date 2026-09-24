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
import { toErrEnvelope } from './errors.js';

// v24 (DES-149, ARCH-099, TASK-141): `workflow` becomes OPTIONAL — a trigger can now be created
// UNCLAIMED (no bound workflow) and claimed later via `claim()`/`release()`/`ownerOf()`. A caller
// may still supply `workflow` at creation (the pre-v24 door, kept). v24 Gate 7.5 (D-1): the H4
// catalog-resolve check that used to run on that door is GONE — REQ-115's last clause moves it to
// the fire path, which refuses and RECORDS the verdict. `claimedBy`/`createdBy` are the
// new per-trigger ownership fields (ARCH-099's "five columns", the other three being the refusal
// trio below).
// v37 P1 (ARCH-182, DES-263, TASK-258, ADR-086's third owner ruling 2026-09-25): `createdRemote` —
// written ONCE at creation from `ToolDeps.isRemoteSubmission`, never updated afterwards (provenance
// is a fact about creation). The earlier monotonic local→remote re-stamp `claim()` applied
// (`3e3c331`+`2cf5f32`, ADR-086's second ruling) is SUPERSEDED and deleted — "who wrote the script
// about to run" now lives on the version row (`workflow_versions.registeredRemote`,
// workflow-catalog.ts), OR'd against this column at admission (`admissionRefusal`).
// Read back by `trigger()` and by `server.ts`'s ticker dispatcher to stamp `RunSpec.origin`.
export type Schedule =
  | { kind: 'cron'; id: string; workflow?: string; claimedBy?: string | null; createdBy?: string; createdRemote?: boolean; args?: unknown; cron: string; tz?: string; enabled: boolean }
  | { kind: 'once'; id: string; workflow?: string; claimedBy?: string | null; createdBy?: string; createdRemote?: boolean; args?: unknown; at: string; enabled: boolean }
  | { kind: 'resident'; id: string; workflow?: string; claimedBy?: string | null; createdBy?: string; createdRemote?: boolean; args?: unknown; enabled: boolean };

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
  /** v37 (ARCH-182, DES-263, TASK-258): read by `server.ts`'s ticker dispatcher (via `get()`) to
   *  stamp the fired run's `RunSpec.origin`. */
  createdRemote?: boolean;
  enabled: boolean;
  /** v24 (integrator; REQ-103/REQ-015): the schedule's own time expression. It was absent, so
   *  `schedule_list` and `workflow_describe.triggers[]` could tell you a cron schedule EXISTS but
   *  never WHEN it fires — the one fact an operator reads a schedule listing for. Present per kind:
   *  `cron`/`tz` for a cron schedule, `at` for a one-shot; neither for a resident. */
  cron?: string;
  tz?: string;
  at?: string;
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

/** Structural seam — matches WorkflowCatalog's own `exists()` signature without importing the
 *  class. It was widened to `resolve()` for the v22 H4 check; v24 Gate 7.5 (D-1) removed that
 *  check from `create()` (REQ-115 moves it to the fire path), leaving `trigger()`'s
 *  "is this a registered name" as the only catalog question this module asks — so the port is
 *  narrowed back rather than left advertising a method nothing calls. */
interface CatalogPort {
  exists(name: string): Promise<boolean>;
}
/** Structural seam — matches RunManager's own start() signature without importing the class. */
interface RunManagerPort {
  // v26 (DES-181, ARCH-118, TASK-181): `budget` widened to match `RunSpec` — a fire-path caller
  // never sets it (undefined), but the port's inline shape must stay a superset of `RunSpec`'s or
  // `RunManager` stops structurally satisfying this seam.
  // v37 (ARCH-182, DES-263, TASK-258): `origin` is REQUIRED here too, matching `RunSpec.origin` —
  // the compiler, not a reviewer, is what stops this call site from silently omitting it.
  start(spec: { name?: string; script?: string; args?: unknown; budget?: number | { usd?: number; tokens?: number } | null; startedBy?: { type: string; id?: string }; origin: 'local' | 'remote' }): Promise<string>;
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
  createdRemote: number;
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
  const shared = { workflow: r.workflow ?? undefined, claimedBy: r.claimedBy, createdBy: r.createdBy ?? undefined, createdRemote: r.createdRemote === 1 };
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
    createdRemote: r.createdRemote === 1,
    enabled: r.enabled === 1,
    cron: r.cron ?? undefined,
    tz: r.tz ?? undefined,
    at: r.at ?? undefined,
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
    try { this._db.exec('ALTER TABLE schedules ADD COLUMN claimedBy TEXT'); } catch { /* already present */ }
    try { this._db.exec('ALTER TABLE schedules ADD COLUMN createdBy TEXT'); } catch { /* already present */ }
    try { this._db.exec('ALTER TABLE schedules ADD COLUMN refusalCount INTEGER NOT NULL DEFAULT 0'); } catch { /* already present */ }
    try { this._db.exec('ALTER TABLE schedules ADD COLUMN lastRefusedAt TEXT'); } catch { /* already present */ }
    try { this._db.exec('ALTER TABLE schedules ADD COLUMN lastRefusalReason TEXT'); } catch { /* already present */ }
    // v37 P1 (ARCH-182, DES-263, TASK-258): same idempotent idiom — written once at
    // `schedule_create` from `ToolDeps.isRemoteSubmission`, never updated afterwards (see the
    // column's own comment above), read back by `trigger()` and the ticker dispatcher.
    try { this._db.exec('ALTER TABLE schedules ADD COLUMN createdRemote INTEGER NOT NULL DEFAULT 0'); } catch { /* already present */ }
    // v26 Gate 7.5 round 6, defect D13: the `CREATE TABLE` above relaxed `workflow` to nullable for
    // a FRESH database only — an already-created file keeps `workflow TEXT NOT NULL`, and since
    // REQ-115 made a trigger creatable before any workflow claims it, `create()` inserts NULL there
    // and every UPGRADED deployment fails `schedule_create` outright. SQLite cannot drop a NOT NULL
    // via ALTER, so this is the documented table-rebuild: create the correct shape under a temp
    // name, copy every row, drop, rename. Same migration `webhook-registry.ts:112` already runs for
    // the twin table — `schedules` was simply missed in v24.
    //
    // WHY IT SITS AFTER THE ALTERs (and the webhooks one sits before them): the webhooks rebuild
    // ran on the FIRST v24 boot, so the source table could only be the old 5-column one. `schedules`
    // never got that boot — production has already ALTERed in all six columns and STILL carries the
    // NOT NULL. Running after the ALTERs makes the source column set identical for both a pre-v22
    // file and today's production file, so the copy can name all seventeen columns explicitly
    // instead of guessing which exist. Idempotent: a fresh or already-rebuilt db has `workflow`
    // nullable, so the PRAGMA guard skips the block entirely and does not even rewrite the schema.
    const workflowIsNotNull = (this._db.prepare('PRAGMA table_info(schedules)').all() as Array<{ name: string; notnull: number }>)
      .some((c) => c.name === 'workflow' && c.notnull === 1);
    if (workflowIsNotNull) {
      // Transactional (SQLite DDL is transactional): a crash mid-rebuild leaves the original
      // `schedules` untouched and the next boot's PRAGMA check simply redoes it, rather than
      // stranding rows in a half-renamed table.
      this._db.transaction(() => {
        this._db.exec(`
          CREATE TABLE schedules__d13_rebuild (
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
            lastRunId TEXT,
            lastError TEXT,
            claimedBy TEXT,
            createdBy TEXT,
            refusalCount INTEGER NOT NULL DEFAULT 0,
            lastRefusedAt TEXT,
            lastRefusalReason TEXT,
            createdRemote INTEGER NOT NULL DEFAULT 0
          );
          INSERT INTO schedules__d13_rebuild
            SELECT id, kind, workflow, argsJson, cron, tz, at, enabled, nextFire, lastFire, lastRunId,
                   lastError, claimedBy, createdBy, refusalCount, lastRefusedAt, lastRefusalReason,
                   createdRemote
              FROM schedules;
          DROP TABLE schedules;
          ALTER TABLE schedules__d13_rebuild RENAME TO schedules;
        `);
      })();
    }
  }

  async create(s: NewSchedule): Promise<ScheduleResult<Schedule>> {
    // v24 Gate 7.5 (D-1, REQ-115's last clause): the v22 H4 create-time catalog-resolve check is
    // GONE. REQ-115 moves it: a trigger is created FIRST and claimed by a workflow at registration,
    // so at creation there is routinely nothing to resolve — and keeping the check for the
    // bind-at-creation door meant the tool row had to require `workflow`, which made an unclaimed
    // trigger impossible to create at all (ADR-026 scenario S-5). The check did not disappear, it
    // changed site: the FIRE path (`resolveScheduleTarget`, server.ts) refuses and RECORDS
    // UNCLAIMED / CLAIMED_WORKFLOW_MISSING / CHANNEL_UNPUBLISHED / NOT_IN_RELEASE, which is the
    // signal REQ-115 asks for and the one place the answer is still true at the moment it matters.
    if (s.kind === 'cron' && !isValidCron(s.cron)) {
      return { error: { code: 'INVALID_CRON', message: `Not a valid cron expression: ${s.cron}`, field: 'cron' } };
    }
    if (s.kind === 'once' && Number.isNaN(Date.parse(s.at))) {
      return { error: { code: 'INVALID_AT', message: `Not a valid ISO timestamp: ${s.at}`, field: 'at' } };
    }
    const id = randomUUID();
    const argsJson = s.args !== undefined ? JSON.stringify(s.args) : null;
    // DES-017: `nextFire` is computed once at creation (via the injected Clock, never a bare
    // Date.now()) so the firing engine's `tick()` has an immediately-usable due-time for cron/once det:allow — a comment naming the API, not a call
    // schedules; `resident` schedules never fire via tick() (trigger-only) and get no nextFire.
    const nextFire: number | null =
      s.kind === 'cron' ? computeNextFire(s.cron, s.tz, this._clock.now() - 1)
      : s.kind === 'once' ? Date.parse(s.at)
      : null;
    this._db
      .prepare(`
        INSERT INTO schedules (id, kind, workflow, claimedBy, createdBy, createdRemote, argsJson, cron, tz, at, enabled, nextFire, lastFire, lastRunId)
        VALUES (@id, @kind, @workflow, @claimedBy, @createdBy, @createdRemote, @argsJson, @cron, @tz, @at, @enabled, @nextFire, NULL, NULL)
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
        // v37 P1 (ARCH-182, DES-263, TASK-258): the ONLY write this column ever gets — `claim()`
        // below does NOT touch it (that re-stamp rule is superseded); this INSERT never runs again
        // for an existing row either, so the value is frozen from creation onward.
        createdRemote: s.createdRemote ? 1 : 0,
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

  /** v24 (integrator; DES-156/REQ-103 — `workflow_describe.triggers[]` is resolved BY ID, never by
   *  workflow: `listByWorkflow` was retired with `trigger-bindings.ts` and left no by-id reader, so
   *  the facade shipped a hardcoded `triggers: []` with a "until TASK-149 wires it" comment. */
  get(id: string): ScheduleStatus | null {
    const row = this._db.prepare('SELECT * FROM schedules WHERE id = ?').get(id) as ScheduleRow | undefined;
    return row ? rowToStatus(row) : null;
  }

  /** v24 (integrator; DES-156/REQ-103): the ID SET for one workflow. DES-156 pins the RESOLUTION —
   *  `scheduler.get(id) ?? webhooks.get(id)`, by id, never a by-workflow BINDING query — and this
   *  respects that: it returns ids only, which `_resolveTriggers` then resolves one at a time. It
   *  is NOT a resurrection of the retired `listByWorkflow`, which returned full binding objects for
   *  the deleted analyzer's diagram fingerprint. It exists because BOTH v24 binding doors are live:
   *  a trigger declared in a version's `triggers[]` (the claim door — the ONLY door since v24
   *  adjudication #8, H-2/issue #56, removed `workflow` from `schedule_create`) and a trigger bound
   *  at creation, which now means a PRE-v24 legacy row only. Sourcing ids from only one of them
   *  would make REQ-103 unobservable for triggers bound the other way — and, since D-1b, would also
   *  leave a legacy binding unreleased at deregister, which is what `McpFacade.workflowDeregister`
   *  calls this for. */
  claimedIdsFor(workflow: string): string[] {
    const rows = this._db
      .prepare('SELECT id FROM schedules WHERE claimedBy = ? OR workflow = ?')
      .all(workflow, workflow) as Array<{ id: string }>;
    return rows.map((r) => r.id);
  }

  async list(): Promise<ScheduleStatus[]> {
    const rows = this._db.prepare('SELECT * FROM schedules').all() as ScheduleRow[];
    return rows.map(rowToStatus);
  }

  async setEnabled(id: string, on: boolean): Promise<ScheduleResult<void>> {
    const info = this._db.prepare('UPDATE schedules SET enabled = ? WHERE id = ?').run(on ? 1 : 0, id);
    // v24 (integrator, DES-137): `SCHEDULE_NOT_FOUND` is not a member of the closed `ErrorCode`
    // union — `schedule_delete`/`schedule_setEnabled` both advertise `TRIGGER_NOT_FOUND` in their
    // `tools/list` `Errors:` line, and a cold model can only anticipate the name it was shown.
    if (info.changes === 0) return { error: { code: 'TRIGGER_NOT_FOUND', message: `Unknown schedule: ${id}` } };
    return { result: undefined };
  }

  async delete(id: string): Promise<ScheduleResult<void>> {
    const info = this._db.prepare('DELETE FROM schedules WHERE id = ?').run(id);
    // v24 (integrator, DES-137): `SCHEDULE_NOT_FOUND` is not a member of the closed `ErrorCode`
    // union — `schedule_delete`/`schedule_setEnabled` both advertise `TRIGGER_NOT_FOUND` in their
    // `tools/list` `Errors:` line, and a cold model can only anticipate the name it was shown.
    if (info.changes === 0) return { error: { code: 'TRIGGER_NOT_FOUND', message: `Unknown schedule: ${id}` } };
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
    // v37 (ARCH-182, DES-263, TASK-258): stamps `origin` from the SAME row this function already
    // loaded (no `row` — no resident schedule found for this workflow — reads as 'local': there is
    // no creator to consult, and this call path has no production caller today, ARCH-181's own
    // finding). A thrown CONFINEMENT_UNAVAILABLE is mapped into this function's own typed
    // ScheduleResult rather than escaping as a rejected promise.
    let runId: string;
    try {
      runId = await this._runManager.start({ name: workflow, args, startedBy: { type: 'schedule', id: workflow }, origin: row?.createdRemote === 1 ? 'remote' : 'local' });
    } catch (err) {
      return { error: toErrEnvelope(err) };
    }
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
    // v24 (integrator; ARCH-099, DES-150): the filter was `workflow IS NOT NULL` with a note saying
    // the fire-path claim check "lands with the facade wiring in TASK-148, out of this task's
    // scope" — TASK-148 did not land it either, so `markRefused` had NO caller and REQ-115's
    // "recorded refusals" recorded nothing. Two consequences, both fixed here: an UNCLAIMED due row
    // was invisible to the driver, so its refusal could never be recorded; and a row claimed AFTER
    // creation (`claim()` writes `claimedBy`, never `workflow`) would never fire at all. The
    // authority is `claimedBy` (ARCH-099's rename); `workflow` remains only as the create-time
    // binding, and an unclaimed row is surfaced with an EMPTY target so the driver refuses it
    // UNCLAIMED rather than silently skipping it.
    const rows = this._db
      .prepare("SELECT * FROM schedules WHERE enabled = 1 AND kind IN ('cron','once') AND nextFire IS NOT NULL")
      .all() as ScheduleRow[];
    return rows.map((r): StoredSchedule => {
      const target = r.claimedBy ?? r.workflow ?? '';
      return r.kind === 'cron'
        ? { kind: 'cron', id: r.id, workflow: target, args: r.argsJson != null ? JSON.parse(r.argsJson) : undefined, cron: r.cron!, tz: r.tz ?? undefined, enabled: true, nextFire: r.nextFire! }
        : { kind: 'once', id: r.id, workflow: target, args: r.argsJson != null ? JSON.parse(r.argsJson) : undefined, at: r.at!, enabled: true, nextFire: r.nextFire! };
    });
  }

  /** D-V2I-2: records one `tick()` firing's outcome — the driver's own impure edge, called right
   *  after `RunManager.start()` succeeds for that firing. `once` auto-completes (`enabled:false`,
   *  REQ-015 clause 2); `cron` recomputes a fresh future `nextFire` from `clock.now()` (fire-once-
   *  on-catch-up-then-resume, DES-017 — never re-fires the same instant, never backfills). Also
   *  records the scheduleId->runId join (D-V2a) so `originOf()` reports it, same as `trigger()`. */
  /** [v29, REQ-152, R29-A1] CLAIMS a due firing SYNCHRONOUSLY, before the driver awaits anything.
   *  Returns `false` when another tick already took it.
   *
   *  The defect this closes: `markFired` was the only writer that made a fired schedule stop being
   *  due, and the driver called it inside a `.then()` — after `runManager.start()` resolved. With a
   *  500 ms `RealTicker`, any dispatch slower than one tick left the row still `enabled = 1` with an
   *  unchanged `nextFire`, so the next tick returned the SAME firing and started a SECOND run.
   *  Observed twice in v29's full regressions, always exactly two runs, never three.
   *
   *  The guards are the ones `markRefused` already uses for its own "two ticks racing the same
   *  instant" trap — `enabled = 1` in the WHERE for `once`, a pre-update `nextFire` still-due check
   *  for `cron`. What changes is WHEN they run: at the moment the firing leaves `tick()`, not after
   *  the work it authorises has finished.
   *
   *  Accepted trade-off, stated rather than discovered later: a crash between the claim and the
   *  dispatch consumes a `once` schedule without running it. That is strictly better than the
   *  behaviour it replaces — running an arbitrary workflow twice — and matches what `markFailed`
   *  and `markRefused` already do to a `once` row whose dispatch never produced a run. */
  claimFiring(firing: { id: string; kind: Schedule['kind'] }): boolean {
    if (firing.kind === 'once') {
      const res = this._db
        .prepare('UPDATE schedules SET enabled = 0 WHERE id = ? AND enabled = 1')
        .run(firing.id);
      return res.changes === 1;
    }
    const row = this._db.prepare('SELECT cron, tz, nextFire FROM schedules WHERE id = ?').get(firing.id) as
      | { cron: string; tz: string | null; nextFire: number | null }
      | undefined;
    if (row == null) return false;
    // already advanced past this due instant by a racing tick
    if (row.nextFire != null && row.nextFire > this._clock.now()) return false;
    const nextFire = computeNextFire(row.cron, row.tz ?? undefined, this._clock.now());
    this._db.prepare('UPDATE schedules SET nextFire = ? WHERE id = ?').run(nextFire, firing.id);
    return true;
  }

  markFired(firing: { id: string; kind: Schedule['kind'] }, runId: string): void {
    const ts = this._clock.isoNow();
    // v24 (DES-150, TASK-141): a successful fire resets the consecutive-refusal counter — the field
    // reads "refusals since the last successful fire", not a lifetime total.
    if (firing.kind === 'once') {
      this._db.prepare('UPDATE schedules SET lastFire = ?, lastRunId = ?, enabled = 0, refusalCount = 0 WHERE id = ?').run(ts, runId, firing.id);
    } else {
      // [v29, REQ-152] `nextFire` is NOT recomputed here any more — `claimFiring()` advanced it at
      // the moment this firing left `tick()`. Advancing again would skip one whole occurrence per
      // fire, which is the regression a naive fix introduces (UT-270 pins it). This method now
      // records only WHAT HAPPENED; the schedule's future belongs to the claim.
      this._db.prepare('UPDATE schedules SET lastFire = ?, lastRunId = ?, refusalCount = 0 WHERE id = ?').run(ts, runId, firing.id);
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
    // [v29, REQ-152] BOTH tight-loop traps are REMOVED, because the trap MOVED — and leaving them
    // here made this method silently stop recording. The `once` guard was `AND enabled = 1`; the
    // `cron` guard was an early return when `nextFire` had already advanced. Both asked "am I the
    // one who consumed this firing?" — true when a refusal was the first writer, false the moment
    // `claimFiring()` consumes it BEFORE dispatch. The result was a refusal that took effect but
    // left `lastRefusalReason` empty (caught by val-016 and IT-093, not by this file's own tests).
    //
    // `claimFiring()` is now the single at-most-once gate: two ticks can no longer both reach
    // dispatch for one due instant, so these writers are called at most once per firing and need
    // no race guard of their own. They record WHAT HAPPENED; the schedule's future is the claim's.
    if (firing.kind === 'once') {
      this._db
        .prepare('UPDATE schedules SET enabled = 0, refusalCount = refusalCount + 1, lastRefusedAt = ?, lastRefusalReason = ? WHERE id = ?')
        .run(ts, reason, firing.id);
    } else {
      this._db
        .prepare('UPDATE schedules SET refusalCount = refusalCount + 1, lastRefusedAt = ?, lastRefusalReason = ? WHERE id = ?')
        .run(ts, reason, firing.id);
    }
  }

  /** v24 (DES-149, TASK-141): per-trigger claim, inside one better-sqlite3 transaction (better-
   *  sqlite3 is synchronous, so the SELECT-then-UPDATE below is already atomic — no explicit
   *  `.transaction()` wrapper needed for a single connection). `'held'` (already claimed by the
   *  SAME workflow) is distinct from `'claimed'` for a reason: compensation on a later failure must
   *  release only ids THIS call newly claimed, never an id that was already a working claim.
   *  v37 P1 (ADR-086's third owner ruling, 2026-09-25, DES-263's 第三次修訂): back to its pre-v24.5
   *  shape — `createdRemote` is NOT touched here on any outcome. The re-stamp rule this method
   *  applied for one iteration (`3e3c331`+`2cf5f32`, ADR-086's second ruling) is SUPERSEDED and
   *  deleted: it closed the re-registration hole by rewriting the TRIGGER row, which meant a local
   *  re-claim of a remotely-created trigger had to be defended separately (the monotonic
   *  local→remote-only rule `confinement-unconfined-wiring.test.ts` caught the first draft
   *  missing). The hole is now closed one row over — `insertVersion` stamps
   *  `workflow_versions.registeredRemote` from the SAME registration's remoteness, and the
   *  admission predicate ORs it against this column — so the trigger row never needs rewriting at
   *  all, on any outcome. */
  claim(id: string, workflow: string): 'claimed' | 'held' | 'NOT_FOUND' | 'ALREADY_CLAIMED' {
    const row = this._db.prepare('SELECT claimedBy FROM schedules WHERE id = ?').get(id) as { claimedBy: string | null } | undefined;
    if (!row) return 'NOT_FOUND';
    if (row.claimedBy === workflow) return 'held';
    if (row.claimedBy != null) return 'ALREADY_CLAIMED';
    const info = this._db
      .prepare('UPDATE schedules SET claimedBy = ? WHERE id = ? AND claimedBy IS NULL')
      .run(workflow, id);
    return info.changes === 1 ? 'claimed' : 'ALREADY_CLAIMED'; // lost a race between the SELECT and the UPDATE
  }

  /** Idempotent: releasing an id not claimed by `workflow` (including one already unclaimed) is a
   *  no-op, never an error — this is what lets compensation call `release` unconditionally on every
   *  id it attempted. */
  release(id: string, workflow: string): void {
    // v24 Gate 7.5 (D-1b, ADR-026): BOTH columns are cleared. Nulling `claimedBy` alone left the
    // create-time `workflow` binding in place, and the fire path folds them together
    // (`all()`'s `claimedBy ?? workflow`, and `resolveScheduleTarget`'s same fallback) — so a
    // released schedule went on firing, and after a same-name re-registration it fired for a
    // workflow that had never claimed it (live: 47 s after the deregister). The WHERE matches a
    // row claimed by this workflow OR a legacy row bound to it before `claimedBy` existed;
    // releasing is idempotent and touches nothing claimed by anyone else.
    this._db
      .prepare('UPDATE schedules SET claimedBy = NULL, workflow = NULL WHERE id = ? AND (claimedBy = ? OR (claimedBy IS NULL AND workflow = ?))')
      .run(id, workflow, workflow);
  }

  /** DES-139/DES-149 step 2: the OWNER is the CREATING PRINCIPAL (`createdBy`), never the claiming
   *  workflow (`claimedBy`) — claiming a trigger for a workflow does not transfer its ownership.
   *  `undefined` = no trigger with this id in this store (distinct from `null` = a migrated row
   *  with no recorded creator, which DES-139 makes admin-only). */
  ownerOf(id: string): string | null | undefined {
    const row = this._db.prepare('SELECT createdBy FROM schedules WHERE id = ?').get(id) as { createdBy: string | null } | undefined;
    return row ? row.createdBy : undefined;
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
      // [v29, REQ-152] `nextFire` belongs to `claimFiring()` now — see `markFired`.
      this._db.prepare('UPDATE schedules SET lastError = ? WHERE id = ?').run(lastError, firing.id);
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
