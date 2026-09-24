// SqliteRunStore (DES-010 / ARCH-006, TASK-013): on-disk RunStore — journal.jsonl per run + SQLite index.
// Single writer per run (append-only journal file); SQLite is the queryable index over run status.
import Database from 'better-sqlite3';
import { mkdirSync, appendFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Clock } from '../clock.js';
import type { RunStore, RunDagSnapshot } from '../run-store.js';
import { deriveAgentRecords, ACTIVE } from '../run-store.js';
import { foldUsage } from '../run-guard.js';
// v36 (REQ-217, DES-250): the shared return shape `RunStore.workflowMetrics()` promises — a
// type-only import, no runtime cycle (dashboard.ts never imports this file).
import type { WorkflowMetrics } from '../dashboard.js';
import type { RunParams } from '../params/resolve.js';
import type {
  RunSpec,
  RunStatusView,
  RunSummary,
  JournalEntry,
  TranscriptEvent,
  RunStatus,
  StateTransition,
  RunListFilter,
  AuditEvent,
  PriceBook,
  RunUsage,
} from '../types.js';

export class SqliteRunStore implements RunStore {
  private readonly _db: Database.Database;
  private readonly _dir: string;

  constructor(dir: string, private readonly _clock: Clock) {
    this._dir = dir;
    mkdirSync(dir, { recursive: true });
    this._db = new Database(join(dir, 'index.db'));
    this._db.pragma('journal_mode = WAL');
    this._db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        runId TEXT PRIMARY KEY,
        name TEXT,
        status TEXT NOT NULL,
        scriptVersion TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        result TEXT,
        script TEXT,
        args TEXT,
        budget TEXT
      );
    `);
    // O-2: the state-transition audit trail (ARCH-006 "one writer of every transition, timestamp+runId").
    // Append-only; `seq` (autoincrement rowid) preserves emission order for getTransitions.
    this._db.exec(`
      CREATE TABLE IF NOT EXISTS transitions (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        runId TEXT NOT NULL,
        from_status TEXT,
        to_status TEXT NOT NULL,
        ts TEXT NOT NULL
      );
    `);
    // v8 Slice 2c (REQ-055): one-shot DAG detail snapshot per run (phases/agents-incl-frame/workflowNodes),
    // written at the terminal transition so a completed composite run's nested tree survives a restart.
    // A migration-free side table (mirrors the scheduler/continuation side-table convention).
    this._db.exec(`
      CREATE TABLE IF NOT EXISTS run_snapshots (
        runId TEXT PRIMARY KEY,
        json TEXT NOT NULL
      );
    `);
    // v11 Sprint 3 (TASK-066): additive migration — adds started_by column to existing runs tables.
    // try/catch handles re-runs against an existing DB ("duplicate column name" error → no-op).
    try { this._db.exec('ALTER TABLE runs ADD COLUMN started_by TEXT'); } catch { /* already exists */ }
    // v15 (REQ-086 / DES-096): additive migration — principal column on the run record.
    try { this._db.exec('ALTER TABLE runs ADD COLUMN principal TEXT'); } catch { /* already exists */ }
    // v21 (ARCH-066, DES-104, TASK-100): additive migration — the run-immutable admission-time
    // parameter snapshot (RunParams). A pre-v21 row reads back NULL; RunManager applies the legacy
    // defaultRunParams(registered.defaults) fallback on resume, never a crash.
    try { this._db.exec('ALTER TABLE runs ADD COLUMN effective_params TEXT'); } catch { /* already exists */ }
    // v22 (DES-113, TASK-108): additive migration — the legacy-cohort fallback record (never the
    // pin itself, which stays in `scriptVersion`). Same idempotent idiom as the columns above.
    try { this._db.exec('ALTER TABLE runs ADD COLUMN legacy_substitution TEXT'); } catch { /* already exists */ }
    // v26 (DES-178, ARCH-116, TASK-178): additive migration — the admission-time price/capability
    // pin. A pre-v26 row reads back NULL; every downstream reader treats that as "unpinned", never
    // a crash (DES-178's own "a pre-v26 run row has no pin" boundary).
    try { this._db.exec('ALTER TABLE runs ADD COLUMN price_book TEXT'); } catch { /* already exists */ }
    // v35 (DES-231, ARCH-143, TASK-235): additive migration — the failure reason. A pre-v35 row
    // reads back NULL = "no recorded reason", never a crash (same idempotent idiom as the columns
    // above).
    try { this._db.exec('ALTER TABLE runs ADD COLUMN error TEXT'); } catch { /* already exists */ }
    // v24 (DES-152, TASK-140): the one query-plan the filtered run_list projection needs — leading
    // column `name` so a workflow-only filter still uses it (SQLite can use a prefix of a composite
    // index), status/createdAt narrow/order the rest.
    this._db.exec('CREATE INDEX IF NOT EXISTS runs_name_status_created ON runs(name, status, createdAt DESC)');
    // v36 (REQ-217 follow-up, ARCH-174, ADR-081): `activeRuns()`'s `WHERE status IN (...)`
    // predicate is status-only — `runs_name_status_created` leads with `name`, so it cannot seek
    // it (`SCAN r`, measured). This index turns that into `SEARCH r USING INDEX runs_status`.
    // Idempotent `CREATE INDEX IF NOT EXISTS`, same idiom as the row above, no migration/backfill.
    this._db.exec('CREATE INDEX IF NOT EXISTS runs_status ON runs(status)');
    // v24 (DES-151, TASK-140): admin cross-owner read audit trail — synchronous append (better-
    // sqlite3), `seq` (autoincrement rowid) orders reads within a runId for auditFor's newest-first cap.
    this._db.exec(`
      CREATE TABLE IF NOT EXISTS audit_events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        runId TEXT NOT NULL,
        owner TEXT NOT NULL,
        path TEXT
      );
    `);
  }

  private _runDir(runId: string): string {
    return join(this._dir, 'runs', runId);
  }

  async createRun(spec: RunSpec, scriptVersion = 'v1', effectiveParams?: RunParams, priceBook?: PriceBook): Promise<string> {
    const runId = randomUUID();
    const ts = this._clock.isoNow();
    this._db
      .prepare('INSERT INTO runs (runId, name, status, scriptVersion, createdAt, script, args, budget, started_by, principal, effective_params, price_book) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(runId, spec.name ?? null, 'queued', scriptVersion, ts, spec.script ?? null, JSON.stringify(spec.args ?? null), JSON.stringify(spec.budget ?? null), spec.startedBy ? JSON.stringify(spec.startedBy) : null, spec.principal ?? null, effectiveParams ? JSON.stringify(effectiveParams) : null, priceBook ? JSON.stringify(priceBook) : null);
    mkdirSync(this._runDir(runId), { recursive: true });
    return runId;
  }

  /** v21 (DES-104): reads back the pinned admission-time snapshot; NULL for a pre-v21 row. */
  async getEffectiveParams(runId: string): Promise<RunParams | null> {
    const row = this._db.prepare('SELECT effective_params FROM runs WHERE runId = ?').get(runId) as { effective_params: string | null } | undefined;
    if (!row || row.effective_params === null) return null;
    return JSON.parse(row.effective_params) as RunParams;
  }

  /** v26 (DES-178, ARCH-116, TASK-178): reads back the pinned price/capability book; NULL for a
   *  pre-v26 row. Same row `getEffectiveParams` reads. */
  async getPriceBook(runId: string): Promise<PriceBook | null> {
    const row = this._db.prepare('SELECT price_book FROM runs WHERE runId = ?').get(runId) as { price_book: string | null } | undefined;
    if (!row || row.price_book === null) return null;
    return JSON.parse(row.price_book) as PriceBook;
  }

  /** v23 (DES-128, ARCH-078, TASK-126): the SYNC `TriggerPorts.runs` read — the chain-upstream join
   *  `getTriggerBindings` needs (a continuation names its DOWNSTREAM target; the upstream workflow
   *  name is this lookup on `afterRunId`). A purged/unknown run is a first-class `null`, never an
   *  invented name. Concrete-class-only (not part of the `RunStore` interface — no other consumer
   *  needs a sync read). */
  getWorkflowName(runId: string): string | null {
    const row = this._db.prepare('SELECT name FROM runs WHERE runId = ?').get(runId) as { name: string | null } | undefined;
    return row?.name ?? null;
  }

  /** Rebuilds the original submission (name/script/args/budget) — lets RunManager reconstruct a
   *  live RunEntry for a suspended/stopped run after a process restart (REQ-006). */
  async getSpec(runId: string): Promise<RunSpec | null> {
    // v36 (DES-245, TASK-243): `principal` gains a column here — it was already WRITTEN (:116) and
    // read by the status view (:326), but omitted from this resume-path rebuild (the ADR-067
    // SQL/TS-twin class: a resumed-run identity test against InMemoryRunStore passed while
    // production on SQLite emitted `principal: null`).
    const row = this._db.prepare('SELECT name, script, args, budget, started_by, principal FROM runs WHERE runId = ?').get(runId) as
      | { name: string | null; script: string | null; args: string | null; budget: string | null; started_by: string | null; principal: string | null }
      | undefined;
    if (!row) return null;
    return {
      name: row.name ?? undefined,
      script: row.script ?? undefined,
      args: row.args ? JSON.parse(row.args) : undefined,
      budget: row.budget ? JSON.parse(row.budget) : null,
      startedBy: row.started_by ? (JSON.parse(row.started_by) as RunSpec['startedBy']) : undefined,
      principal: row.principal ?? undefined,
      // v37 (ARCH-182, DES-263, TASK-258): the `runs` table never gained an `origin` column — this
      // predicate needs the fact only transiently, at admission, and an ORDINARY resume is gated by
      // call-tool.ts's isLoopbackPeer door, not by admissionRefusal. The ONE tolerant read.
      // v37 P1 (R5-F1, 2026-09-25): `resume()` does now apply admissionRefusal in ONE case — when
      // the run's pinned version is gone and the current `release` is substituted for it. That case
      // keys on the SUBSTITUTED VERSION's own `registeredRemote`, never on this synthesized value,
      // so the synthesis is still tolerant-by-design rather than load-bearing.
      origin: 'local',
    };
  }

  async appendJournal(runId: string, entry: JournalEntry): Promise<void> {
    mkdirSync(this._runDir(runId), { recursive: true });
    appendFileSync(join(this._runDir(runId), 'journal.jsonl'), JSON.stringify(entry) + '\n');
  }

  async appendTranscript(runId: string, agentId: string, ev: TranscriptEvent): Promise<void> {
    mkdirSync(this._runDir(runId), { recursive: true });
    appendFileSync(join(this._runDir(runId), `agent-${agentId}.jsonl`), JSON.stringify(ev) + '\n');
  }

  /** Reads back one agent's transcript from its append-only agent-<id>.jsonl file (D-V6) — the
   *  real read-back path, not a hard-coded []; missing file (unknown/never-ran agent) → []. */
  async getTranscript(runId: string, agentId: string): Promise<TranscriptEvent[]> {
    return this._readTranscriptFile(runId, agentId);
  }

  /** v8 Defer A (REQ-059): reads back the settled-call journal from journal.jsonl, dropping the
   *  terminal `{type:'result'}` marker recordResult appends (it has no callSeq). Missing file → [].
   *  Robust to a crash-truncated final line: a real SIGKILL can leave a half-written last line, so an
   *  unparseable line is skipped (not thrown) — the settled prefix is what ResumeCache replays anyway. */
  async getJournal(runId: string): Promise<JournalEntry[]> {
    const file = join(this._runDir(runId), 'journal.jsonl');
    if (!existsSync(file)) return [];
    const entries: JournalEntry[] = [];
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (line.trim().length === 0) continue;
      let parsed: JournalEntry | { type: 'result' };
      try { parsed = JSON.parse(line); } catch { continue; } // crash-truncated tail line → skip
      if (typeof (parsed as JournalEntry).callSeq === 'number') entries.push(parsed as JournalEntry);
    }
    return entries;
  }

  private _readTranscriptFile(runId: string, agentId: string): TranscriptEvent[] {
    const file = join(this._runDir(runId), `agent-${agentId}.jsonl`);
    if (!existsSync(file)) return [];
    const raw = readFileSync(file, 'utf8');
    return raw
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as TranscriptEvent);
  }

  /** Enumerates every agentId this run has an on-disk agent-<id>.jsonl transcript for (D-F9b) —
   *  the restart-survival source `getRun` derives its `agents` field from, since an in-process
   *  AgentExecutor's transient Map does not survive a real server restart. */
  private _allTranscripts(runId: string): Map<string, TranscriptEvent[]> {
    const dir = this._runDir(runId);
    const map = new Map<string, TranscriptEvent[]>();
    if (!existsSync(dir)) return map;
    for (const file of readdirSync(dir)) {
      const match = /^agent-(.+)\.jsonl$/.exec(file);
      if (!match) continue;
      const agentId = match[1];
      map.set(agentId, this._readTranscriptFile(runId, agentId));
    }
    return map;
  }

  async recordTransition(runId: string, from: RunStatus | null, to: RunStatus, ts: string): Promise<void> {
    // O-2: persist the transition (audit trail) BEFORE flipping the queryable status, so a reader
    // never sees a status with no corresponding trail entry.
    this._db.prepare('INSERT INTO transitions (runId, from_status, to_status, ts) VALUES (?, ?, ?, ?)').run(runId, from, to, ts);
    this._db.prepare('UPDATE runs SET status = ? WHERE runId = ?').run(to, runId);
  }

  async getTransitions(runId: string): Promise<StateTransition[]> {
    const rows = this._db
      .prepare('SELECT from_status, to_status, ts FROM transitions WHERE runId = ? ORDER BY seq ASC')
      .all(runId) as Array<{ from_status: RunStatus | null; to_status: RunStatus; ts: string }>;
    return rows.map((r) => ({ from: r.from_status, to: r.to_status, ts: r.ts }));
  }

  /** Persists the script's return value: SQLite row (queryable via getResult) + a journal.jsonl
   *  marker line (audit trail alongside the per-call journal entries), per D-I2. */
  async recordResult(runId: string, result: unknown): Promise<void> {
    const serialized = JSON.stringify(result) ?? 'null';
    this._db.prepare('UPDATE runs SET result = ? WHERE runId = ?').run(serialized, runId);
    mkdirSync(this._runDir(runId), { recursive: true });
    appendFileSync(join(this._runDir(runId), 'journal.jsonl'), JSON.stringify({ type: 'result', value: result }) + '\n');
  }

  async getResult(runId: string): Promise<{ value: unknown } | null> {
    const row = this._db.prepare('SELECT result FROM runs WHERE runId = ?').get(runId) as { result: string | null } | undefined;
    if (!row || row.result === null) return null;
    return { value: JSON.parse(row.result) };
  }

  /** v35 (DES-231): ONE method, two surfaces, in THIS order — the `runs.error` column write
   *  THEN the `{type:'error',...err}` journal.jsonl line (same D-I2 audit-trail convention as
   *  recordResult). If the column write throws, the journal line is never appended. */
  async recordError(runId: string, err: { code: string; message: string }): Promise<void> {
    this._db.prepare('UPDATE runs SET error = ? WHERE runId = ?').run(JSON.stringify(err), runId);
    mkdirSync(this._runDir(runId), { recursive: true });
    appendFileSync(join(this._runDir(runId), 'journal.jsonl'), JSON.stringify({ type: 'error', ...err }) + '\n');
  }

  /** v35 (DES-231): the raw column read-back — ungated; `null` for an unknown runId or a run with
   *  no recorded error. */
  async getError(runId: string): Promise<{ code: string; message: string } | null> {
    const row = this._db.prepare('SELECT error FROM runs WHERE runId = ?').get(runId) as { error: string | null } | undefined;
    if (!row || row.error === null) return null;
    return JSON.parse(row.error) as { code: string; message: string };
  }

  private _rowToSummary(row: {
    runId: string; name: string | null; status: string; scriptVersion: string; createdAt: string;
    started_by?: string | null; terminalAt?: string | null; error?: string | null;
    usagePresentRaw?: number | null; costUSD?: number | null; unpricedCalls?: number | null;
    tokensTotal?: number | null; agentCount?: number | null; failedAgentCount?: number | null;
  }): RunSummary {
    const summary: RunSummary = {
      runId: row.runId,
      name: row.name ?? undefined,
      status: row.status as RunStatus,
      scriptVersion: row.scriptVersion,
      createdAt: row.createdAt,
      startedBy: row.started_by ? (JSON.parse(row.started_by) as RunSummary['startedBy']) : { type: 'unknown' },
    };
    if (row.terminalAt) summary.terminalAt = row.terminalAt;
    // v35 (DES-231): gated on status === 'failed' — a stale column (crash-window row later
    // reclassified) is never served.
    if (row.status === 'failed' && row.error) summary.error = JSON.parse(row.error) as RunSummary['error'];
    // v27 (DES-193, ARCH-128, TASK-198): presence keyed on `usage IS NOT NULL AND
    // COALESCE(agentCount,1) > 0`, never on the arithmetic — a run with zero agent() calls must
    // not surface costUSD:0.
    const usagePresent = !!row.usagePresentRaw && (row.agentCount ?? 1) > 0;
    if (usagePresent) {
      if (row.costUSD !== null && row.costUSD !== undefined) summary.costUSD = row.costUSD;
      if (row.unpricedCalls !== null && row.unpricedCalls !== undefined) summary.unpricedCalls = row.unpricedCalls;
      if (row.tokensTotal !== null && row.tokensTotal !== undefined) summary.tokensTotal = row.tokensTotal;
      if (row.agentCount !== null && row.agentCount !== undefined) summary.agentCount = row.agentCount;
    }
    // v35 (DES-231 boundary (b), TASK-235): `agentCount != null && > 0` — NOT `(agentCount ?? 1) >
    // 0` — so a no-snapshot/{usage}-only/zero-agent run OMITS rather than reading a confident 0.
    if (row.agentCount != null && row.agentCount > 0) {
      summary.failedAgentCount = row.failedAgentCount ?? 0;
    }
    return summary;
  }

  async getRun(runId: string): Promise<RunStatusView | null> {
    const row = this._db.prepare('SELECT * FROM runs WHERE runId = ?').get(runId) as
      | { runId: string; name: string | null; status: string; scriptVersion: string; createdAt: string; started_by?: string | null; principal?: string | null; legacy_substitution?: string | null; error?: string | null }
      | undefined;
    if (!row) return null;
    // v8 Slice 2c: a persisted terminal snapshot restores the full DAG (frames/phases/timing) after a
    // restart; otherwise fall back to deriving bare agent records from transcripts (backward-compatible).
    const snapRow = this._db.prepare('SELECT json FROM run_snapshots WHERE runId = ?').get(runId) as { json: string } | undefined;
    const snap = snapRow ? (JSON.parse(snapRow.json) as RunDagSnapshot) : undefined;
    // v11 Sprint 3 (TASK-067): first terminal transition timestamp for pollers to stop early.
    const termRow = this._db
      .prepare("SELECT ts FROM transitions WHERE runId = ? AND to_status IN ('completed', 'failed', 'stopped') ORDER BY seq ASC LIMIT 1")
      .get(runId) as { ts: string } | undefined;
    return {
      runId: row.runId, status: row.status as RunStatus, scriptVersion: row.scriptVersion,
      phases: snap?.phases ?? [],
      agents: snap?.agents ?? deriveAgentRecords(this._allTranscripts(runId), row.status as RunStatus),
      workflowNodes: snap?.workflowNodes ?? [],
      // v26 (DES-183, TASK-183): same fallback shape as `agents` above.
      usage: snap?.usage ?? foldUsage([...this._allTranscripts(runId).values()].flat()),
      startedBy: row.started_by ? (JSON.parse(row.started_by) as RunStatusView['startedBy']) : { type: 'unknown' },
      terminalAt: termRow?.ts,
      // v15 (DES-096): omit when absent (conditional spread mirrors terminalAt pattern).
      ...(row.principal ? { principal: row.principal } : {}),
      // v22 (DES-113): omit when absent, same conditional-spread convention.
      ...(row.legacy_substitution ? { legacySubstitution: JSON.parse(row.legacy_substitution) as RunStatusView['legacySubstitution'] } : {}),
      // v35 (DES-231): gated on status === 'failed' — a stale column (crash-window row later
      // reclassified interrupted/completed) is never served.
      ...(row.status === 'failed' && row.error ? { error: JSON.parse(row.error) as RunStatusView['error'] } : {}),
    };
  }

  async saveSnapshot(runId: string, snapshot: RunDagSnapshot): Promise<void> {
    this._db.prepare('INSERT OR REPLACE INTO run_snapshots (runId, json) VALUES (?, ?)').run(runId, JSON.stringify(snapshot));
  }

  /** v27 (DES-193, ARCH-128, TASK-198): no-op unless the run is TERMINAL and its persisted
   *  snapshot (if any) has no `usage` key yet — re-checked here, not only by the caller. Merges
   *  into an existing snapshot row, or writes a `{usage}`-only row when none exists. */
  async backfillUsage(runId: string, usage: RunUsage): Promise<void> {
    const runRow = this._db.prepare('SELECT status FROM runs WHERE runId = ?').get(runId) as { status: string } | undefined;
    if (!runRow) return;
    const TERMINAL = new Set(['completed', 'failed', 'stopped']);
    if (!TERMINAL.has(runRow.status)) return;
    const snapRow = this._db.prepare('SELECT json FROM run_snapshots WHERE runId = ?').get(runId) as { json: string } | undefined;
    const existing = snapRow ? (JSON.parse(snapRow.json) as Record<string, unknown>) : undefined;
    if (existing && existing.usage !== undefined) return; // already has usage — no-op (idempotent)
    const merged = { ...(existing ?? {}), usage };
    this._db.prepare('INSERT OR REPLACE INTO run_snapshots (runId, json) VALUES (?, ?)').run(runId, JSON.stringify(merged));
  }

  async recordLegacySubstitution(runId: string, sub: { pinned: string; resolved: string }): Promise<void> {
    this._db.prepare('UPDATE runs SET legacy_substitution = ? WHERE runId = ?').run(JSON.stringify(sub), runId);
  }

  // v27 (DES-193, ARCH-128, TASK-198): the one-batched-read usage projection shared by both
  // `listRuns()` and `list()` — a LEFT JOIN so a snapshot-less run still yields a row (NULLs
  // flowing through, gated off in `_rowToSummary`). COALESCE per token term (SQLite's `+` is
  // NULL if any addend is) so `tokensTotal` is never NULL merely because one column is absent.
  private static readonly _USAGE_PROJECTION = `
             json_extract(s.json, '$.usage') IS NOT NULL AS usagePresentRaw,
             json_extract(s.json, '$.usage.costUSD') AS costUSD,
             json_extract(s.json, '$.usage.unpricedCalls') AS unpricedCalls,
             COALESCE(json_extract(s.json, '$.usage.tokens.input'), 0)
               + COALESCE(json_extract(s.json, '$.usage.tokens.output'), 0)
               + COALESCE(json_extract(s.json, '$.usage.tokens.cacheRead'), 0)
               + COALESCE(json_extract(s.json, '$.usage.tokens.cacheWrite'), 0) AS tokensTotal,
             json_array_length(s.json, '$.agents') AS agentCount,
             (SELECT COUNT(*) FROM json_each(s.json, '$.agents')
                WHERE json_extract(value, '$.state') IN ('failed', 'refused')) AS failedAgentCount`;

  async listRuns(): Promise<RunSummary[]> {
    const rows = this._db.prepare(`
      SELECT r.runId, r.name, r.status, r.scriptVersion, r.createdAt, r.started_by, r.error,
             (SELECT MIN(t.ts) FROM transitions t
              WHERE t.runId = r.runId
                AND t.to_status IN ('completed', 'failed', 'stopped')) AS terminalAt,
             ${SqliteRunStore._USAGE_PROJECTION}
      FROM runs r
      LEFT JOIN run_snapshots s ON s.runId = r.runId
    `).all() as Array<{
      runId: string; name: string | null; status: string; scriptVersion: string; createdAt: string; started_by?: string | null; terminalAt?: string | null; error?: string | null;
      usagePresentRaw?: number | null; costUSD?: number | null; unpricedCalls?: number | null; tokensTotal?: number | null; agentCount?: number | null; failedAgentCount?: number | null;
    }>;
    return rows.map((r) => this._rowToSummary(r));
  }

  /** v36 (DES-247, ARCH-162/163, TASK-245): grouped MAX(createdAt) per name — one statement, no
   *  N+1. A name with no runs never appears (the WHERE excludes NULL names, GROUP BY yields one
   *  row per name that has at least one run). */
  async lastRunAtByName(): Promise<Map<string, string>> {
    const rows = this._db
      .prepare('SELECT name, MAX(createdAt) AS lastRunAt FROM runs WHERE name IS NOT NULL GROUP BY name')
      .all() as Array<{ name: string; lastRunAt: string }>;
    return new Map(rows.map((r) => [r.name, r.lastRunAt]));
  }

  /** v24 (DES-152): filtered/paginated read behind `run_list` — `principal` is set by the FACADE
   *  from the caller's own id (never from args); a row with `principal IS NULL` is excluded by a
   *  `principal` filter (the cross-seam agreement with authz's null=ownerless rule). `limit`
   *  defaults to 50, capped at 500. Uses `runs_name_status_created` (leading column `name`). */
  async list(filter: RunListFilter = {}): Promise<RunSummary[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter.workflow !== undefined) { clauses.push('r.name = ?'); params.push(filter.workflow); }
    if (filter.status !== undefined) { clauses.push('r.status = ?'); params.push(filter.status); }
    if (filter.principal !== undefined) { clauses.push('r.principal = ?'); params.push(filter.principal); }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const limit = Math.min(filter.limit ?? 50, 500);
    const rows = this._db.prepare(`
      SELECT r.runId, r.name, r.status, r.scriptVersion, r.createdAt, r.started_by, r.error,
             (SELECT MIN(t.ts) FROM transitions t
              WHERE t.runId = r.runId
                AND t.to_status IN ('completed', 'failed', 'stopped')) AS terminalAt,
             ${SqliteRunStore._USAGE_PROJECTION}
      FROM runs r
      LEFT JOIN run_snapshots s ON s.runId = r.runId
      ${where}
      ORDER BY r.createdAt DESC
      LIMIT ?
    `).all(...params, limit) as Array<{
      runId: string; name: string | null; status: string; scriptVersion: string; createdAt: string; started_by?: string | null; terminalAt?: string | null; error?: string | null;
      usagePresentRaw?: number | null; costUSD?: number | null; unpricedCalls?: number | null; tokensTotal?: number | null; agentCount?: number | null; failedAgentCount?: number | null;
    }>;
    return rows.map((r) => this._rowToSummary(r));
  }

  /** v36 (REQ-217, ARCH-172/ADR-080, DES-250): per-workflow-name terminal aggregates computed
   *  ENTIRELY in SQL (`AVG()`/`COUNT()`/`SUM()`) — never selects the `runs` table into memory, so
   *  `/api/home`'s `avgCostUSD`/`successRate` keep FULL-HISTORY semantics without reintroducing the
   *  cliff `listSummaries()` was just paginated to remove (ARCH-172). The `avgCostUSD` presence
   *  rule mirrors `_rowToSummary`'s exactly (`usagePresentRaw AND COALESCE(agentCount,1) > 0`), or
   *  this query and that read surface would disagree on which runs are "priced". A name with zero
   *  terminal rows never appears — the `WHERE` excludes non-terminal statuses before the
   *  `GROUP BY` — absent, not a zero-valued row (REQ-186's "unmeasured is absent" convention).
   *  `AVG()` over zero priced rows is SQL NULL, which better-sqlite3 hands back as `null` — read
   *  straight through, never coalesced to 0 (REQ-217's own zero-run case). */
  async workflowMetrics(): Promise<Map<string | undefined, WorkflowMetrics>> {
    const rows = this._db.prepare(`
      WITH term AS (
        SELECT r.runId, r.name, r.status, r.createdAt,
               (SELECT MIN(t.ts) FROM transitions t
                WHERE t.runId = r.runId
                  AND t.to_status IN ('completed', 'failed', 'stopped')) AS terminalAt,
               json_extract(s.json, '$.usage') IS NOT NULL AS usagePresentRaw,
               json_extract(s.json, '$.usage.costUSD') AS costUSD,
               json_array_length(s.json, '$.agents') AS agentCount
        FROM runs r
        LEFT JOIN run_snapshots s ON s.runId = r.runId
        WHERE r.status IN ('completed', 'failed', 'stopped')
      )
      SELECT
        name,
        COUNT(*) AS terminalCount,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completedCount,
        AVG(CASE WHEN usagePresentRaw AND COALESCE(agentCount, 1) > 0 THEN costUSD END) AS avgCostUSD,
        SUM(CASE WHEN usagePresentRaw AND COALESCE(agentCount, 1) > 0 THEN 1 ELSE 0 END) AS pricedCount,
        AVG(CASE WHEN terminalAt IS NOT NULL
                 THEN MAX(0.0, (julianday(terminalAt) - julianday(createdAt)) * 86400000.0)
                 END) AS avgDurationMs
      FROM term
      GROUP BY name
    `).all() as Array<{
      name: string | null; terminalCount: number; completedCount: number;
      avgCostUSD: number | null; pricedCount: number; avgDurationMs: number | null;
    }>;
    const out = new Map<string | undefined, WorkflowMetrics>();
    for (const r of rows) {
      out.set(r.name ?? undefined, {
        successRate: r.completedCount / r.terminalCount,
        avgDurationMs: r.avgDurationMs,
        terminalCount: r.terminalCount,
        avgCostUSD: r.avgCostUSD,
        unpricedRuns: r.terminalCount - r.pricedCount,
      });
    }
    return out;
  }

  /** v36 (REQ-217 follow-up, DES-251, TASK-249): the SQL `WHERE ... IN (...)` counterpart to
   *  `list()`, no `LIMIT` — the same SELECT body / `_rowToSummary` so the agreement test compares
   *  like-for-like against `InMemoryRunStore.activeRuns()`. The `ACTIVE` set is imported from
   *  `run-store.ts`, never re-listed here, so the two stores cannot silently diverge on which
   *  statuses count as "currently active". */
  async activeRuns(): Promise<RunSummary[]> {
    const statuses = [...ACTIVE];
    const placeholders = statuses.map(() => '?').join(', ');
    const rows = this._db.prepare(`
      SELECT r.runId, r.name, r.status, r.scriptVersion, r.createdAt, r.started_by, r.error,
             (SELECT MIN(t.ts) FROM transitions t
              WHERE t.runId = r.runId
                AND t.to_status IN ('completed', 'failed', 'stopped')) AS terminalAt,
             ${SqliteRunStore._USAGE_PROJECTION}
      FROM runs r
      LEFT JOIN run_snapshots s ON s.runId = r.runId
      WHERE r.status IN (${placeholders})
    `).all(...statuses) as Array<{
      runId: string; name: string | null; status: string; scriptVersion: string; createdAt: string; started_by?: string | null; terminalAt?: string | null; error?: string | null;
      usagePresentRaw?: number | null; costUSD?: number | null; unpricedCalls?: number | null; tokensTotal?: number | null; agentCount?: number | null; failedAgentCount?: number | null;
    }>;
    return rows.map((r) => this._rowToSummary(r));
  }

  /** v24 (DES-151): synchronous append (better-sqlite3) — a throw here must reach the call site
   *  BEFORE any bytes are read; no try/catch at this layer. */
  appendAudit(ev: AuditEvent): void {
    this._db.prepare('INSERT INTO audit_events (ts, actor, action, runId, owner, path) VALUES (?, ?, ?, ?, ?, ?)')
      .run(ev.ts, ev.actor, ev.action, ev.runId, ev.owner, ev.path ?? null);
  }

  /** v24 (DES-151): newest-first, capped at `limit` (default 200). */
  auditFor(runId: string, limit = 200): AuditEvent[] {
    const rows = this._db
      .prepare('SELECT ts, actor, action, runId, owner, path FROM audit_events WHERE runId = ? ORDER BY seq DESC LIMIT ?')
      .all(runId, limit) as Array<{ ts: string; actor: string; action: string; runId: string; owner: string; path: string | null }>;
    return rows.map((r) => ({
      ts: r.ts, actor: r.actor, action: r.action as AuditEvent['action'], runId: r.runId, owner: r.owner,
      ...(r.path !== null ? { path: r.path } : {}),
    }));
  }

  /** Boot recovery: enumerates persisted runs; any 'running' run was interrupted by a crash/restart —
   *  v8 Defer A (REQ-060) re-hydrates it as 'interrupted' (RESUMABLE via workflow_resume, replaying its
   *  journaled calls), not 'failed'. (Previously forced running→failed with no resume path.) */
  async hydrateAll(): Promise<RunSummary[]> {
    const stale = this._db.prepare("SELECT runId FROM runs WHERE status = 'running'").all() as Array<{ runId: string }>;
    const reclassify = this._db.prepare("UPDATE runs SET status = 'interrupted' WHERE runId = ?");
    for (const { runId } of stale) reclassify.run(runId);
    const runs = await this.listRuns();
    console.log(`[RunStore] hydrateAll: re-hydrated ${runs.length} run(s), ${stale.length} re-classified running→interrupted (resumable)`);
    return runs;
  }
}
