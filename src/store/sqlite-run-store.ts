// SqliteRunStore (DES-010 / ARCH-006, TASK-013): on-disk RunStore — journal.jsonl per run + SQLite index.
// Single writer per run (append-only journal file); SQLite is the queryable index over run status.
import Database from 'better-sqlite3';
import { mkdirSync, appendFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Clock } from '../clock.js';
import type { RunStore, RunDagSnapshot } from '../run-store.js';
import { deriveAgentRecords } from '../run-store.js';
import type {
  RunSpec,
  RunStatusView,
  RunSummary,
  JournalEntry,
  TranscriptEvent,
  RunStatus,
  StateTransition,
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
  }

  private _runDir(runId: string): string {
    return join(this._dir, 'runs', runId);
  }

  async createRun(spec: RunSpec, scriptVersion = 'v1'): Promise<string> {
    const runId = randomUUID();
    const ts = this._clock.isoNow();
    this._db
      .prepare('INSERT INTO runs (runId, name, status, scriptVersion, createdAt, script, args, budget, started_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(runId, spec.name ?? null, 'queued', scriptVersion, ts, spec.script ?? null, JSON.stringify(spec.args ?? null), JSON.stringify(spec.budget ?? null), spec.startedBy ? JSON.stringify(spec.startedBy) : null);
    mkdirSync(this._runDir(runId), { recursive: true });
    return runId;
  }

  /** Rebuilds the original submission (name/script/args/budget) — lets RunManager reconstruct a
   *  live RunEntry for a suspended/stopped run after a process restart (REQ-006). */
  async getSpec(runId: string): Promise<RunSpec | null> {
    const row = this._db.prepare('SELECT name, script, args, budget, started_by FROM runs WHERE runId = ?').get(runId) as
      | { name: string | null; script: string | null; args: string | null; budget: string | null; started_by: string | null }
      | undefined;
    if (!row) return null;
    return {
      name: row.name ?? undefined,
      script: row.script ?? undefined,
      args: row.args ? JSON.parse(row.args) : undefined,
      budget: row.budget ? JSON.parse(row.budget) : null,
      startedBy: row.started_by ? (JSON.parse(row.started_by) as RunSpec['startedBy']) : undefined,
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

  private _rowToSummary(row: { runId: string; name: string | null; status: string; scriptVersion: string; createdAt: string; started_by?: string | null; terminalAt?: string | null }): RunSummary {
    const summary: RunSummary = {
      runId: row.runId,
      name: row.name ?? undefined,
      status: row.status as RunStatus,
      scriptVersion: row.scriptVersion,
      createdAt: row.createdAt,
      startedBy: row.started_by ? (JSON.parse(row.started_by) as RunSummary['startedBy']) : { type: 'unknown' },
    };
    if (row.terminalAt) summary.terminalAt = row.terminalAt;
    return summary;
  }

  async getRun(runId: string): Promise<RunStatusView | null> {
    const row = this._db.prepare('SELECT * FROM runs WHERE runId = ?').get(runId) as
      | { runId: string; name: string | null; status: string; scriptVersion: string; createdAt: string; started_by?: string | null }
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
      startedBy: row.started_by ? (JSON.parse(row.started_by) as RunStatusView['startedBy']) : { type: 'unknown' },
      terminalAt: termRow?.ts,
    };
  }

  async saveSnapshot(runId: string, snapshot: RunDagSnapshot): Promise<void> {
    this._db.prepare('INSERT OR REPLACE INTO run_snapshots (runId, json) VALUES (?, ?)').run(runId, JSON.stringify(snapshot));
  }

  async listRuns(): Promise<RunSummary[]> {
    const rows = this._db.prepare(`
      SELECT r.runId, r.name, r.status, r.scriptVersion, r.createdAt, r.started_by,
             (SELECT MIN(t.ts) FROM transitions t
              WHERE t.runId = r.runId
                AND t.to_status IN ('completed', 'failed', 'stopped')) AS terminalAt
      FROM runs r
    `).all() as Array<{
      runId: string; name: string | null; status: string; scriptVersion: string; createdAt: string; started_by?: string | null; terminalAt?: string | null;
    }>;
    return rows.map((r) => this._rowToSummary(r));
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
