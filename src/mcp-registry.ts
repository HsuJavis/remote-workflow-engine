// MCP Provisioning Registry (DES-024 / ARCH-015 / TASK-028): SQLite sibling catalog over the
// ARCH-006 store — `name -> {kind, config}` — plus a pure strict-by-name `resolveInjected` that
// returns ONLY explicitly-referenced entries (host ambient MCP never inherited, VAL-003). Register
// probes first via the existing injected `McpProbe` port (TASK-029 wires the real admin tool +
// real prober; this store only needs the port shape to stay pure/testable with a fake).
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { McpProbe } from './mcp-probe.js';

export type McpKind = 'stdio' | 'http';

export interface McpProvisionRecord {
  name: string;
  kind: McpKind;
  config: unknown;
  healthy: boolean;
  provisionedAt: string;
}

export type McpReasonCode = 'MCP_PROBE_FAILED' | 'MCP_NOT_PROVISIONED';

interface McpProvisionRow {
  name: string;
  kind: McpKind;
  config: string;
  healthy: number;
  provisionedAt: string;
}

export class McpRegistry {
  private readonly _db: Database.Database;
  private readonly _probe: McpProbe;

  constructor(opts: { dbPath: string; probe: McpProbe }) {
    this._probe = opts.probe;
    mkdirSync(dirname(opts.dbPath), { recursive: true });
    this._db = new Database(opts.dbPath);
    this._db.pragma('journal_mode = WAL');
    this._db.exec(`
      CREATE TABLE IF NOT EXISTS mcp_provisions (
        name TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        config TEXT NOT NULL,
        healthy INTEGER NOT NULL,
        provisionedAt TEXT NOT NULL
      );
    `);
  }

  /** Probes the config first (TASK-029's real prober / a FakeMcpProbe in tests); nothing is
   *  persisted when the probe reports dead (fail-closed — no ghost registration). */
  async register(rec: { name: string; kind: McpKind; config: unknown }): Promise<{ ok: true } | { ok: false; error: 'MCP_PROBE_FAILED' }> {
    const probed = await this._probe.probe(rec.config as never);
    if (!probed.ok) return { ok: false, error: 'MCP_PROBE_FAILED' };
    this._db
      .prepare(`
        INSERT INTO mcp_provisions (name, kind, config, healthy, provisionedAt) VALUES (?, ?, ?, 1, ?)
        ON CONFLICT(name) DO UPDATE SET kind = excluded.kind, config = excluded.config, healthy = 1, provisionedAt = excluded.provisionedAt
      `)
      .run(rec.name, rec.kind, JSON.stringify(rec.config), new Date().toISOString());
    return { ok: true };
  }

  get(name: string): McpProvisionRecord | undefined {
    const row = this._db
      .prepare('SELECT name, kind, config, healthy, provisionedAt FROM mcp_provisions WHERE name = ?')
      .get(name) as McpProvisionRow | undefined;
    return row ? rowToRecord(row) : undefined;
  }

  /** Store-internal listing — NOT an unauth MCP tool (D-V3f); callers gate this behind admin auth. */
  list(): McpProvisionRecord[] {
    const rows = this._db
      .prepare('SELECT name, kind, config, healthy, provisionedAt FROM mcp_provisions')
      .all() as McpProvisionRow[];
    return rows.map(rowToRecord);
  }

  async delete(name: string): Promise<void> {
    this._db.prepare('DELETE FROM mcp_provisions WHERE name = ?').run(name);
  }

  /** Strict-by-name resolve: returns ONLY the explicitly-referenced entries — never an unreferenced
   *  provisioned row leaking in (VAL-003 isolation). Unknown name -> typed error, never a silent
   *  no-op/partial result. */
  resolveInjected(referencedNames: string[]): { configs: Record<string, unknown> } | { error: 'MCP_NOT_PROVISIONED' } {
    const configs: Record<string, unknown> = {};
    for (const name of referencedNames) {
      const row = this.get(name);
      if (!row) return { error: 'MCP_NOT_PROVISIONED' };
      configs[name] = row.config;
    }
    return { configs };
  }
}

function rowToRecord(row: McpProvisionRow): McpProvisionRecord {
  return {
    name: row.name,
    kind: row.kind,
    config: JSON.parse(row.config),
    healthy: !!row.healthy,
    provisionedAt: row.provisionedAt,
  };
}
