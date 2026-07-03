// SqliteRunStore (DES-010 / ARCH-006, TASK-013): on-disk RunStore — journal.jsonl per run + SQLite index.
// Single writer per run (append-only journal file); SQLite is the queryable index over run status.
import Database from 'better-sqlite3';
import { mkdirSync, appendFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Clock } from '../clock.js';
import type { RunStore } from '../run-store.js';
import { deriveAgentRecords } from '../run-store.js';
import type {
  RunSpec,
  RunStatusView,
  RunSummary,
  JournalEntry,
  TranscriptEvent,
  RunStatus,
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
  }

  private _runDir(runId: string): string {
    return join(this._dir, 'runs', runId);
  }

  async createRun(spec: RunSpec, scriptVersion = 'v1'): Promise<string> {
    const runId = randomUUID();
    const ts = this._clock.isoNow();
    this._db
      .prepare('INSERT INTO runs (runId, name, status, scriptVersion, createdAt, script, args, budget) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(runId, spec.name ?? null, 'queued', scriptVersion, ts, spec.script ?? null, JSON.stringify(spec.args ?? null), JSON.stringify(spec.budget ?? null));
    mkdirSync(this._runDir(runId), { recursive: true });
    return runId;
  }

  /** Rebuilds the original submission (name/script/args/budget) — lets RunManager reconstruct a
   *  live RunEntry for a suspended/stopped run after a process restart (REQ-006). */
  async getSpec(runId: string): Promise<RunSpec | null> {
    const row = this._db.prepare('SELECT name, script, args, budget FROM runs WHERE runId = ?').get(runId) as
      | { name: string | null; script: string | null; args: string | null; budget: string | null }
      | undefined;
    if (!row) return null;
    return {
      name: row.name ?? undefined,
      script: row.script ?? undefined,
      args: row.args ? JSON.parse(row.args) : undefined,
      budget: row.budget ? JSON.parse(row.budget) : null,
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

  async recordTransition(runId: string, _from: RunStatus | null, to: RunStatus, _ts: string): Promise<void> {
    this._db.prepare('UPDATE runs SET status = ? WHERE runId = ?').run(to, runId);
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

  private _rowToSummary(row: { runId: string; name: string | null; status: string; scriptVersion: string; createdAt: string }): RunSummary {
    return {
      runId: row.runId,
      name: row.name ?? undefined,
      status: row.status as RunStatus,
      scriptVersion: row.scriptVersion,
      createdAt: row.createdAt,
    };
  }

  async getRun(runId: string): Promise<RunStatusView | null> {
    const row = this._db.prepare('SELECT * FROM runs WHERE runId = ?').get(runId) as
      | { runId: string; name: string | null; status: string; scriptVersion: string; createdAt: string }
      | undefined;
    if (!row) return null;
    return { runId: row.runId, status: row.status as RunStatus, phases: [], agents: deriveAgentRecords(this._allTranscripts(runId)), scriptVersion: row.scriptVersion };
  }

  async listRuns(): Promise<RunSummary[]> {
    const rows = this._db.prepare('SELECT * FROM runs').all() as Array<{
      runId: string; name: string | null; status: string; scriptVersion: string; createdAt: string;
    }>;
    return rows.map((r) => this._rowToSummary(r));
  }

  /** Boot recovery: enumerates persisted runs; any 'running' run re-hydrates as 'failed' (crash, not silently running). */
  async hydrateAll(): Promise<RunSummary[]> {
    const stale = this._db.prepare("SELECT runId FROM runs WHERE status = 'running'").all() as Array<{ runId: string }>;
    const reclassify = this._db.prepare("UPDATE runs SET status = 'failed' WHERE runId = ?");
    for (const { runId } of stale) reclassify.run(runId);
    const runs = await this.listRuns();
    console.log(`[RunStore] hydrateAll: re-hydrated ${runs.length} run(s), ${stale.length} re-classified running→failed`);
    return runs;
  }
}
