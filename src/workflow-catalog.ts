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
import { CatalogNotFoundError, WorkspaceEscapeError, codedError } from './errors.js';
import { parseMeta } from './workflow-meta.js';
import type { Clock } from './clock.js';
import { SystemClock } from './clock.js';
import { validateHarnessDefaults, type HarnessDefaults } from './harness-defaults.js';

// DES-098: hardcoded operator email for boot backfill of NULL-owner rows
const BOOT_BACKFILL_EMAIL = 'hsuhungjung@gmail.com';

export interface WorkflowCatalogOpts {
  /** When set and auth is enabled, backfill NULL-owner rows to this email at construction time. */
  backfillOwner?: boolean;
  /** Set of valid model alias names for register-time validation (D-AUTH-5-B). */
  aliasNames?: Set<string>;
}

export class WorkflowCatalog {
  private readonly _db: Database.Database;
  private readonly _runWorkspaces = new Map<string, string>(); // runId -> workspace dir
  private readonly _clock: Clock;
  private readonly _workRoot: string;
  private readonly _aliasNames?: Set<string>;

  constructor(workRoot: string, clock?: Clock, opts?: WorkflowCatalogOpts) {
    this._workRoot = workRoot;
    this._clock = clock ?? new SystemClock();
    this._aliasNames = opts?.aliasNames;
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
    // Idempotent migration: add owner + defaults columns if absent (DES-098, DES-099)
    const existingCols = (this._db.prepare('PRAGMA table_info(workflows)').all() as Array<{ name: string }>)
      .map((c) => c.name);
    if (!existingCols.includes('owner')) {
      this._db.exec('ALTER TABLE workflows ADD COLUMN owner TEXT');
    }
    if (!existingCols.includes('defaults')) {
      this._db.exec('ALTER TABLE workflows ADD COLUMN defaults TEXT');
    }
    // DES-098: idempotent boot backfill — NULL-owner rows → operator email; once/boot, self-limiting
    if (opts?.backfillOwner) {
      const n = this._db
        .prepare("UPDATE workflows SET owner = ? WHERE owner IS NULL")
        .run(BOOT_BACKFILL_EMAIL).changes;
      if (n > 0) {
        console.log(`auth.migrate: ${n} workflows backfilled to owner=${BOOT_BACKFILL_EMAIL}`);
      }
    }
  }

  // v15 (DES-098, DES-099, TASK-089): ownership gate + harness defaults registration.
  async register(
    name: string,
    script: string,
    defaults?: HarnessDefaults,
    principal: string | null = null,
  ): Promise<{ version: string }> {
    // D-AUTH-5 (DES-099): validate defaults before any DB operation (fail-closed, no partial write)
    if (defaults !== undefined) {
      const result = validateHarnessDefaults(defaults as Record<string, unknown>, this._aliasNames);
      if (!result.ok) {
        throw codedError('HARNESS_DEFAULTS_INVALID', result.message);
      }
    }

    const existing = this._db.prepare('SELECT version, owner FROM workflows WHERE name = ?').get(name) as
      | { version: string; owner: string | null }
      | undefined;

    // DES-098: ownership gate — only non-null principal is gated; null principal = auth-disabled (D-AUTH-6)
    if (existing && existing.owner && principal !== null && existing.owner !== principal) {
      throw codedError('NOT_WORKFLOW_OWNER', `Workflow '${name}' is owned by ${existing.owner}`);
    }

    const nextNum = (existing ? Number(existing.version.replace(/^v/, '')) || 0 : 0) + 1;
    const version = `v${nextNum}`;
    // Set owner on first registration; preserve existing owner on overwrite
    const owner = existing?.owner ?? principal;
    const defaultsJson = defaults !== undefined ? JSON.stringify(defaults) : null;
    this._db
      .prepare(`
        INSERT INTO workflows (name, script, version, createdAt, owner, defaults) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET
          script = excluded.script,
          version = excluded.version,
          createdAt = excluded.createdAt,
          defaults = excluded.defaults
      `)
      .run(name, script, version, this._clock.isoNow(), owner, defaultsJson);
    return { version };
  }

  /** Remove a registered workflow from the catalog. `removed:false` when the name was not present.
   *  Prior runs' journals keep their own scriptVersion, so this only affects future run-by-name.
   *  v15 (DES-098, TASK-089): ownership gate — non-owner principal → NOT_WORKFLOW_OWNER. */
  async deregister(name: string, principal: string | null = null): Promise<{ removed: boolean }> {
    const existing = this._db.prepare('SELECT owner FROM workflows WHERE name = ?').get(name) as
      | { owner: string | null }
      | undefined;

    if (existing && existing.owner && principal !== null && existing.owner !== principal) {
      throw codedError('NOT_WORKFLOW_OWNER', `Workflow '${name}' is owned by ${existing.owner}`);
    }

    const info = this._db.prepare('DELETE FROM workflows WHERE name = ?').run(name);
    return { removed: info.changes > 0 };
  }

  async get(name: string): Promise<{ script: string; version: string }> {
    const row = this._db.prepare('SELECT script, version FROM workflows WHERE name = ?').get(name) as
      | { script: string; version: string }
      | undefined;
    if (!row) throw new CatalogNotFoundError(name);
    return row;
  }

  /** v9 (REQ-061): full detail for one workflow — name/script/version/createdAt/owner/defaults.
   *  v15 (DES-098, DES-099, TASK-089): includes owner + defaults columns.
   *  Throws CatalogNotFoundError for unknown names. */
  async getFull(name: string): Promise<{
    name: string; script: string; version: string; createdAt: string;
    owner: string | null; defaults: HarnessDefaults | undefined;
  }> {
    const row = this._db
      .prepare('SELECT name, script, version, createdAt, owner, defaults FROM workflows WHERE name = ?')
      .get(name) as
      | { name: string; script: string; version: string; createdAt: string; owner: string | null; defaults: string | null }
      | undefined;
    if (!row) throw new CatalogNotFoundError(name);
    return {
      name: row.name,
      script: row.script,
      version: row.version,
      createdAt: row.createdAt,
      owner: row.owner,
      defaults: row.defaults ? JSON.parse(row.defaults) as HarnessDefaults : undefined,
    };
  }

  async list(): Promise<Array<{ name: string; version: string; createdAt: string; description: string }>> {
    // v9 (REQ-061): surface each workflow's purpose (meta.description) so a client can see WHAT each
    // one does without reading its script — parsed on-demand from the stored script (always in sync).
    const rows = this._db.prepare('SELECT name, script, version, createdAt FROM workflows').all() as Array<{
      name: string; script: string; version: string; createdAt: string;
    }>;
    return rows.map((r) => ({ name: r.name, version: r.version, createdAt: r.createdAt, description: parseMeta(r.script).description }));
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
