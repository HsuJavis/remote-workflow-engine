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

  it('every existing run_start({name}) keeps working post-migration (no fleet-wide outage, ADR-011)', async () => {
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
    const { version: v1 } = await catalog.register({ name: 'two-versions', script: `return 'first';`, mermaid: 'graph LR' });
    const { version: v2 } = await catalog.register({ name: 'two-versions', script: `return 'second';`, mermaid: 'graph LR' });
    expect(v1).not.toBe(v2);
    const first = await catalog.resolve('two-versions', { version: v1 });
    const second = await catalog.resolve('two-versions', { version: v2 });
    expect(first.script).toBe(`return 'first';`);
    expect(second.script).toBe(`return 'second';`);
  });

  it('registration is not automatically published to any channel (REQ-097: registration ≠ publication)', async () => {
    const catalog = new WorkflowCatalog(workRoot, CLOCK);
    const { version } = await catalog.register({ name: 'unpublished', script: `return 1;`, mermaid: 'graph LR' });
    const detail = await catalog.resolveDetail('unpublished', { version });
    expect(detail.channels.release).not.toBe(version);
    expect(detail.channels.beta).not.toBe(version);
  });

  it('publish moves the named channel pointer; a non-owner is refused NOT_WORKFLOW_OWNER', async () => {
    const catalog = new WorkflowCatalog(workRoot, CLOCK);
    const { version } = await catalog.register({ name: 'publishable', script: `return 1;`, mermaid: 'graph LR', principal: 'owner@example.com' });
    await catalog.publish('publishable', version, 'release', 'owner@example.com');
    const resolved = await catalog.resolve('publishable', {});
    expect(resolved.version).toBe(version);
    await expect(catalog.publish('publishable', version, 'beta', 'not-the-owner@example.com')).rejects.toThrow(/NOT_WORKFLOW_OWNER/);
  });

  it('listVersions reports every registered version for a name, ascending', async () => {
    const catalog = new WorkflowCatalog(workRoot, CLOCK);
    const { version: v1 } = await catalog.register({ name: 'list-versions', script: `return 1;`, mermaid: 'graph LR' });
    const { version: v2 } = await catalog.register({ name: 'list-versions', script: `return 2;`, mermaid: 'graph LR' });
    expect(await catalog.listVersions('list-versions')).toEqual([v1, v2]);
  });

  it('publish naming a version that was never registered is refused VERSION_NOT_FOUND; no pointer moves (Gate 6.5+7 coverage)', async () => {
    const catalog = new WorkflowCatalog(workRoot, CLOCK);
    await catalog.register({ name: 'publish-unknown-version', script: `return 1;`, mermaid: 'graph LR', principal: 'owner@example.com' });
    await expect(
      catalog.publish('publish-unknown-version', 'v99', 'release', 'owner@example.com')
    ).rejects.toThrow(/VERSION_NOT_FOUND/);
    // the refusal happened BEFORE any pointer write — `release` is still unpublished, not
    // pointing at the (never-registered) 'v99'.
    await expect(catalog.resolve('publish-unknown-version', {})).rejects.toThrow(/CHANNEL_UNPUBLISHED/);
  });
});

// UT-106 (H3 send-back, 07-review.md §4.2 — ARCH-071 inv 7, DES-111, ADR-011, ADR-009, REQ-096):
// `register()`'s next-version allocator uses `SELECT COUNT(*)` over a name's `workflow_versions`
// rows (`workflow-catalog.ts:341`), not `MAX(version)` — confirmed against `git show
// a54a794^:src/workflow-catalog.ts:205` (the pre-v22 allocator was monotonic-per-name over a
// single overwritten row). ARCH-071 inv 7 requires "computed as max over the name's rows"
// (`02-architecture.md:1009`, verbatim). COUNT and MAX only diverge when a name's version rows
// don't start contiguously at v1 — exactly the shape a migrated (ADR-011) or previously-gapped
// workflow has. Red reason: both cases below observe `v2`/`v3` (COUNT-based) where MAX-based
// allocation requires `v8`/`v4`.
describe("version allocator: MAX over a name's rows, not COUNT (ARCH-071 inv 7, H3 send-back, 07-review.md §4.2)", () => {
  it('re-registering a workflow migrated at a HIGH version number (v7) allocates v8, not v2', async () => {
    buildLegacyDb(join(workRoot, 'catalog.db'), [
      { name: 'h3-migrated', script: `return 'v7';`, version: 'v7', createdAt: '2025-01-01T00:00:00.000Z', owner: 'owner@example.com' },
    ]);
    const catalog = new WorkflowCatalog(workRoot, CLOCK); // triggers the boot migration (v7 lands in workflow_versions)
    const { version } = await catalog.register({ name: 'h3-migrated', script: `return 'v8-body';`, mermaid: 'graph LR' });
    // Today: COUNT(*) over the 1 migrated row + 1 = 'v2' — OLDER-numbered than 'v7', the version
    // it supersedes (ARCH-071 inv 7 violated). Correct: MAX(7) + 1 = 'v8'.
    expect(version).toBe('v8');
  });

  it('a gapped version history (v1, v3 — no v2) does not brick re-registration behind REGISTRATION_CONFLICT', async () => {
    // Hand-seed the v22 schema DIRECTLY (not via register(), which cannot itself produce a gap
    // under either the buggy or the fixed allocator) — reproduces the "already-migrated
    // multi-registration cohort" shape 07-review.md H3 describes without needing 3+ live
    // registrations to walk COUNT up to a collision.
    const catalog = new WorkflowCatalog(workRoot, CLOCK); // creates the schema
    const raw = new Database(join(workRoot, 'catalog.db'));
    const now = CLOCK.isoNow();
    raw.prepare('INSERT INTO workflows (name, createdAt, owner, release_version) VALUES (?, ?, ?, ?)').run('h3-gapped', now, 'owner2@example.com', 'v1');
    raw.prepare('INSERT INTO workflow_versions (name, version, script, createdAt) VALUES (?, ?, ?, ?)').run('h3-gapped', 'v1', `return 'v1';`, now);
    raw.prepare('INSERT INTO workflow_versions (name, version, script, createdAt) VALUES (?, ?, ?, ?)').run('h3-gapped', 'v3', `return 'v3';`, now);
    raw.close();

    // Today: COUNT(*) = 2 rows -> v${2+1} = 'v3' -> collides with the row already at 'v3'
    // (PRIMARY KEY (name, version)) -> maps to REGISTRATION_CONFLICT ("retry") -> retrying
    // recomputes the SAME 'v3' every time -> permanently bricked, exactly H3's "any migrated
    // multi-registration workflow" scenario. Correct: MAX(1,3) + 1 = 'v4', no collision.
    const { version } = await catalog.register({ name: 'h3-gapped', script: `return 'v4-body';`, mermaid: 'graph LR', principal: 'owner2@example.com' });
    expect(version).toBe('v4');
  });
});

// Issue #87: version identifiers must never be reused after a version — or the whole workflow —
// is deregistered. The pre-fix allocator (`v${MAX(existing rows)+1}`) reads only SURVIVING rows,
// so deleting the highest version (or every version) frees its number back up for the NEXT
// registration, silently violating the documented immutability of a version row (docs/AUTHORING.md:
// "Versions are immutable"). Fix: a monotonic per-name high-water mark, `workflow_version_hwm`,
// that `deregister`/`deregisterVersion` never touch.
describe('issue #87: version numbers are never reused after deregister (monotonic per-name high-water mark)', () => {
  it('v1..v3, deregister v3 (not last, not published), register → v4, not v3 again', async () => {
    const catalog = new WorkflowCatalog(workRoot, CLOCK);
    await catalog.register({ name: 'issue87-partial', script: `return 1;`, mermaid: 'graph LR' });
    await catalog.register({ name: 'issue87-partial', script: `return 2;`, mermaid: 'graph LR' });
    await catalog.register({ name: 'issue87-partial', script: `return 3;`, mermaid: 'graph LR' });
    const bypass = { id: null, bypass: true, idSource: 'none' as const };
    await catalog.deregisterVersion('issue87-partial', 'v3', bypass, null);
    const { version } = await catalog.register({ name: 'issue87-partial', script: `return 4;`, mermaid: 'graph LR' });
    expect(version).toBe('v4'); // pre-fix: MAX(v1,v2) + 1 = 'v3' — a DIFFERENT script reusing 'v3'
  });

  it('v1..v2, deregister the WHOLE workflow, register → v3, not v1 (the counter survives the deleted `workflows` row)', async () => {
    const catalog = new WorkflowCatalog(workRoot, CLOCK);
    await catalog.register({ name: 'issue87-whole', script: `return 1;`, mermaid: 'graph LR' });
    await catalog.register({ name: 'issue87-whole', script: `return 2;`, mermaid: 'graph LR' });
    await catalog.deregister('issue87-whole');
    const { version } = await catalog.register({ name: 'issue87-whole', script: `return 3;`, mermaid: 'graph LR' });
    expect(version).toBe('v3'); // pre-fix: no surviving rows -> MAX(none) + 1 = 'v1'
  });

  it('VERSION_CEILING_EXCEEDED still counts LIVE rows only — the hwm never gates registration', async () => {
    const catalog = new WorkflowCatalog(workRoot, CLOCK, { ceilings: { maxTimeoutMs: 600_000, maxAppendPromptBytes: 1024, maxEffort: 'high', maxWorkflowVersions: 3 } as never });
    await catalog.register({ name: 'issue87-ceiling', script: `return 1;`, mermaid: 'graph LR' });
    await catalog.register({ name: 'issue87-ceiling', script: `return 2;`, mermaid: 'graph LR' });
    await catalog.register({ name: 'issue87-ceiling', script: `return 3;`, mermaid: 'graph LR' });
    const bypass = { id: null, bypass: true, idSource: 'none' as const };
    await catalog.deregisterVersion('issue87-ceiling', 'v3', bypass, null); // 2 live rows left
    const { version } = await catalog.register({ name: 'issue87-ceiling', script: `return 4;`, mermaid: 'graph LR' });
    expect(version).toBe('v4'); // 2 live rows < ceiling of 3 — succeeds, and the number is not reused either
  });

  it('parallel registrations of a fresh name still allocate 8 distinct versions', async () => {
    const catalog = new WorkflowCatalog(workRoot, CLOCK);
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => catalog.register({ name: 'issue87-parallel', script: `return ${i};`, mermaid: 'graph LR' })),
    );
    const versions = results.map((r) => r.version);
    expect(new Set(versions).size).toBe(8);
  });

  it('a name with no hwm row (pre-fix DB, or hand-seeded rows) seeds the allocator from MAX(existing) — no regression', async () => {
    // Hand-seed workflow_versions directly (bypassing insertVersion, so no hwm row is written) —
    // exactly a production DB's shape the moment this fix ships: existing names have version rows
    // but no workflow_version_hwm row yet.
    const catalog = new WorkflowCatalog(workRoot, CLOCK);
    const raw = new Database(join(workRoot, 'catalog.db'));
    const now = CLOCK.isoNow();
    raw.prepare('INSERT INTO workflows (name, createdAt, owner, release_version) VALUES (?, ?, ?, ?)').run('issue87-preexisting', now, null, 'v2');
    raw.prepare('INSERT INTO workflow_versions (name, version, script, createdAt) VALUES (?, ?, ?, ?)').run('issue87-preexisting', 'v1', `return 'v1';`, now);
    raw.prepare('INSERT INTO workflow_versions (name, version, script, createdAt) VALUES (?, ?, ?, ?)').run('issue87-preexisting', 'v2', `return 'v2';`, now);
    raw.close();
    const { version } = await catalog.register({ name: 'issue87-preexisting', script: `return 'v3';`, mermaid: 'graph LR' });
    expect(version).toBe('v3');
  });
});

describe('per-name version ceiling (ADR-014, S-1 debt closed, IT-084)', () => {
  it('an (N+1)th registration is refused VERSION_CEILING_EXCEEDED, naming both remedies', async () => {
    const catalog = new WorkflowCatalog(workRoot, CLOCK, { ceilings: { maxTimeoutMs: 600_000, maxAppendPromptBytes: 1024, maxEffort: 'high', maxWorkflowVersions: 2 } as never });
    await catalog.register({ name: 'ceiling-test', script: `return 1;`, mermaid: 'graph LR' });
    await catalog.register({ name: 'ceiling-test', script: `return 2;`, mermaid: 'graph LR' });
    await expect(catalog.register({ name: 'ceiling-test', script: `return 3;`, mermaid: 'graph LR' })).rejects.toMatchObject({ code: 'VERSION_CEILING_EXCEEDED' });
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
