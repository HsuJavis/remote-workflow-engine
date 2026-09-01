// IT-084 (ARCH-071, DES-109, DES-110, DES-111, TASK-105): versioned catalog — `workflow_versions`
// table, transactional idempotent boot migration, `resolve`/`resolveDetail`/`exists`/`listVersions`/
// `publish`, and every converted call site in ONE commit.
//
// Mock policy (integration, DES-119): real adjacent components — a real SQLite file under a tmp
// workRoot (no `Database` injection seam), the real `WorkflowCatalog`. No network.
//
// Red reason: `WorkflowCatalog` has no `workflow_versions` table, no `resolve`/`resolveDetail`/
// `publish`, and `register` still does `ON CONFLICT(name) DO UPDATE` (overwrite) today — every
// assertion below fails against the current engine.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import Database from 'better-sqlite3';
import { WorkflowCatalog } from '../../src/workflow-catalog.js';
import { FixedClock } from '../../src/clock.js';

const CLOCK = new FixedClock(new Date('2026-01-01T00:00:00Z'));

let workRoot: string;

beforeEach(() => {
  workRoot = mkdtempSync(join(tmpdir(), 'rwe-it084-'));
});
afterEach(() => {
  rmSync(workRoot, { recursive: true, force: true });
});

/** DES-109's binding fixture rule: the pre-v22 DB is built with HAND-WRITTEN legacy SQL, never by
 *  instantiating the new WorkflowCatalog — a fixture built by the code under test cannot detect a
 *  migration that is wrong in the same direction. */
function buildLegacyDb(dbPath: string, rows: Array<{ name: string; script: string; version: string; createdAt: string; owner: string | null }>): void {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE workflows (name TEXT PRIMARY KEY, script TEXT NOT NULL, version TEXT NOT NULL, createdAt TEXT NOT NULL);
    ALTER TABLE workflows ADD COLUMN owner TEXT;
    ALTER TABLE workflows ADD COLUMN defaults TEXT;
    ALTER TABLE workflows ADD COLUMN params TEXT;
  `);
  const ins = db.prepare('INSERT INTO workflows (name, script, version, createdAt, owner) VALUES (?, ?, ?, ?, ?)');
  for (const r of rows) ins.run(r.name, r.script, r.version, r.createdAt, r.owner);
  db.close();
}

describe('boot migration: pre-v22 catalog.db → workflow_versions (ADR-011, DES-109, IT-084)', () => {
  it('migrates every existing row: retrievable in workflow_versions, release_version set to its migrated version', () => {
    buildLegacyDb(join(workRoot, 'catalog.db'), [
      { name: 'legacy-a', script: `return 'A';`, version: 'v3', createdAt: '2025-01-01T00:00:00.000Z', owner: 'owner@example.com' },
    ]);
    const catalog = new WorkflowCatalog(workRoot, CLOCK);
    const raw = new Database(join(workRoot, 'catalog.db'));
    const versionRow = raw.prepare('SELECT * FROM workflow_versions WHERE name = ? AND version = ?').get('legacy-a', 'v3') as { script: string } | undefined;
    expect(versionRow).toBeDefined();
    expect(versionRow!.script).toBe(`return 'A';`);
    const wfRow = raw.prepare('SELECT release_version, owner FROM workflows WHERE name = ?').get('legacy-a') as { release_version: string | null; owner: string | null };
    expect(wfRow.release_version).toBe('v3'); // ADR-011: migrated version is published to release
    expect(wfRow.owner).toBe('owner@example.com'); // owner preserved
    raw.close();
    void catalog; // constructed only to trigger the migration
  });

  it('the legacy script/version/defaults/params columns are DROPPED from workflows after migration', () => {
    buildLegacyDb(join(workRoot, 'catalog.db'), [
      { name: 'legacy-b', script: `return 'B';`, version: 'v1', createdAt: '2025-01-01T00:00:00.000Z', owner: null },
    ]);
    new WorkflowCatalog(workRoot, CLOCK);
    const raw = new Database(join(workRoot, 'catalog.db'));
    const cols = (raw.prepare('PRAGMA table_info(workflows)').all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols).not.toContain('script');
    expect(cols).not.toContain('version');
    expect(cols).not.toContain('defaults');
    expect(cols).not.toContain('params');
    raw.close();
  });

  it('is idempotent: a second boot on the already-migrated DB logs "0 migrated"', () => {
    buildLegacyDb(join(workRoot, 'catalog.db'), [
      { name: 'legacy-c', script: `return 'C';`, version: 'v1', createdAt: '2025-01-01T00:00:00.000Z', owner: null },
    ]);
    new WorkflowCatalog(workRoot, CLOCK); // first boot: migrates
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    new WorkflowCatalog(workRoot, CLOCK); // second boot: idempotent, should log "0 migrated"
    const calls = logSpy.mock.calls.map((c) => String(c[0]));
    expect(calls.some((line) => /catalog\.migrate:\s*0\s*workflows/.test(line))).toBe(true);
    logSpy.mockRestore();
  });

  it('every existing workflow_run({name}) keeps working post-migration (no fleet-wide outage, ADR-011)', async () => {
    buildLegacyDb(join(workRoot, 'catalog.db'), [
      { name: 'legacy-d', script: `return 'D';`, version: 'v1', createdAt: '2025-01-01T00:00:00.000Z', owner: null },
    ]);
    const catalog = new WorkflowCatalog(workRoot, CLOCK);
    const entry = await catalog.resolve('legacy-d', {}); // no selector → default release
    expect(entry.script).toBe(`return 'D';`);
    expect(entry.version).toBe('v1');
  });
});

describe('version history: both versions of a twice-registered name remain retrievable (REQ-096, IT-084)', () => {
  it('register twice under the same name never overwrites the earlier script', async () => {
    const catalog = new WorkflowCatalog(workRoot, CLOCK);
    const { version: v1 } = await catalog.register('two-versions', `return 'first';`);
    const { version: v2 } = await catalog.register('two-versions', `return 'second';`);
    expect(v1).not.toBe(v2);
    const first = await catalog.resolve('two-versions', { version: v1 });
    const second = await catalog.resolve('two-versions', { version: v2 });
    expect(first.script).toBe(`return 'first';`);
    expect(second.script).toBe(`return 'second';`);
  });

  it('registration is not automatically published to any channel (REQ-097: registration ≠ publication)', async () => {
    const catalog = new WorkflowCatalog(workRoot, CLOCK);
    const { version } = await catalog.register('unpublished', `return 1;`);
    const detail = await catalog.resolveDetail('unpublished', { version });
    expect(detail.channels.release).not.toBe(version);
    expect(detail.channels.beta).not.toBe(version);
  });

  it('publish moves the named channel pointer; a non-owner is refused NOT_WORKFLOW_OWNER', async () => {
    const catalog = new WorkflowCatalog(workRoot, CLOCK);
    const { version } = await catalog.register('publishable', `return 1;`, undefined, 'owner@example.com');
    await catalog.publish('publishable', version, 'release', 'owner@example.com');
    const resolved = await catalog.resolve('publishable', {});
    expect(resolved.version).toBe(version);
    await expect(catalog.publish('publishable', version, 'beta', 'not-the-owner@example.com')).rejects.toThrow(/NOT_WORKFLOW_OWNER/);
  });

  it('listVersions reports every registered version for a name, ascending', async () => {
    const catalog = new WorkflowCatalog(workRoot, CLOCK);
    const { version: v1 } = await catalog.register('list-versions', `return 1;`);
    const { version: v2 } = await catalog.register('list-versions', `return 2;`);
    expect(await catalog.listVersions('list-versions')).toEqual([v1, v2]);
  });
});

describe('per-name version ceiling (ADR-014, S-1 debt closed, IT-084)', () => {
  it('an (N+1)th registration is refused VERSION_CEILING_EXCEEDED, naming both remedies', async () => {
    const catalog = new WorkflowCatalog(workRoot, CLOCK, { ceilings: { maxTimeoutMs: 600_000, maxAppendPromptBytes: 1024, maxEffort: 'high', maxWorkflowVersions: 2 } as never });
    await catalog.register('ceiling-test', `return 1;`);
    await catalog.register('ceiling-test', `return 2;`);
    await expect(catalog.register('ceiling-test', `return 3;`)).rejects.toMatchObject({ code: 'VERSION_CEILING_EXCEEDED' });
    expect(await catalog.listVersions('ceiling-test')).toHaveLength(2); // refused registration stores nothing
  });
});

// Structural guard (TASK-105 dod): after this task lands, the compiler — not a reviewer — finds a
// missed call site; nothing under src/ may still call the deleted legacy accessors.
describe('no src/ call site still calls the deleted get()/getFull() (structural, TASK-105)', () => {
  it('rg "catalog\\.get\\(|\\.getFull\\(" over src/ finds nothing', () => {
    const srcDir = join(import.meta.dirname, '../../src');
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) { walk(p); continue; }
        if (!name.endsWith('.ts')) continue;
        const src = readFileSync(p, 'utf8');
        if (/catalog\.get\(|\.getFull\(/.test(src)) hits.push(relative(srcDir, p));
      }
    };
    walk(srcDir);
    expect(hits).toEqual([]);
  });
});
