// WorkflowCatalog (DES-011 / ARCH-007): named registry + per-workflow/per-run workspace rooting.
//
// Persistence (D-V2, REQ-014): registrations (name/version/script/createdAt) are stored in a
// SQLite DB rooted at workRoot (`catalog.db`, alongside the run store's own on-disk DB) so a
// fresh WorkflowCatalog instance pointed at the same workRoot — e.g. after a server restart —
// sees every previously-registered workflow. Per-name version numbering (register bumps the
// existing row's version) replaced the old in-memory global counter; nothing in this codebase
// depends on version numbers being globally unique across names, only on them changing on update.
//
// Retention/cleanup policy (TASK-016, DES-011 "documented retention/cleanup governs old run
// workspaces"): run workspaces (`workFolder(name)/runs/<runId>`) are retained on disk indefinitely
// by default — a completed run's produced files must stay retrievable (REQ-013) and no test in this
// v1 slice requires automatic deletion. Operators may prune workspace directories for runs that are
// no longer `queued`/`running`/`suspended` (safe to remove once RunStore shows a terminal status);
// this is a manual/ops-owned action, not an in-process timer, keeping the kernel free of unproven
// background-deletion logic.
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { join, resolve, sep, isAbsolute } from 'node:path';
import { CatalogNotFoundError, WorkspaceEscapeError } from './errors.js';
import type { Clock } from './clock.js';
import { SystemClock } from './clock.js';

export class WorkflowCatalog {
  private readonly _db: Database.Database;
  private readonly _runWorkspaces = new Map<string, string>(); // runId -> workspace dir
  private readonly _clock: Clock;
  private readonly _workRoot: string;

  constructor(workRoot: string, clock?: Clock) {
    this._workRoot = workRoot;
    this._clock = clock ?? new SystemClock();
    mkdirSync(workRoot, { recursive: true });
    this._db = new Database(join(workRoot, 'catalog.db'));
    this._db.pragma('journal_mode = WAL');
    this._db.exec(`
      CREATE TABLE IF NOT EXISTS workflows (
        name TEXT PRIMARY KEY,
        script TEXT NOT NULL,
        version TEXT NOT NULL,
        createdAt TEXT NOT NULL
      );
    `);
  }

  async register(name: string, script: string): Promise<{ version: string }> {
    const existing = this._db.prepare('SELECT version FROM workflows WHERE name = ?').get(name) as
      | { version: string }
      | undefined;
    const nextNum = (existing ? Number(existing.version.replace(/^v/, '')) || 0 : 0) + 1;
    const version = `v${nextNum}`;
    this._db
      .prepare(`
        INSERT INTO workflows (name, script, version, createdAt) VALUES (?, ?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET script = excluded.script, version = excluded.version, createdAt = excluded.createdAt
      `)
      .run(name, script, version, this._clock.isoNow());
    return { version };
  }

  async get(name: string): Promise<{ script: string; version: string }> {
    const row = this._db.prepare('SELECT script, version FROM workflows WHERE name = ?').get(name) as
      | { script: string; version: string }
      | undefined;
    if (!row) throw new CatalogNotFoundError(name);
    return row;
  }

  async list(): Promise<Array<{ name: string; version: string; createdAt: string }>> {
    return this._db.prepare('SELECT name, version, createdAt FROM workflows').all() as Array<{
      name: string;
      version: string;
      createdAt: string;
    }>;
  }

  workFolder(name: string): string {
    return join(this._workRoot, 'workflows', name);
  }

  runWorkspace(name: string, runId: string): string {
    const ws = join(this.workFolder(name), 'runs', runId);
    this._runWorkspaces.set(runId, ws);
    return ws;
  }

  /** Resolves a relative path inside the run workspace; throws WorkspaceEscapeError on escape attempts. */
  resolveInWorkspace(runId: string, rel: string): string {
    const base = this._runWorkspaces.get(runId) ?? join(this._workRoot, '_runs', runId);
    if (isAbsolute(rel)) throw new WorkspaceEscapeError(rel);
    const resolved = resolve(base, rel);
    if (resolved !== base && !resolved.startsWith(base + sep)) throw new WorkspaceEscapeError(rel);
    return resolved;
  }
}
