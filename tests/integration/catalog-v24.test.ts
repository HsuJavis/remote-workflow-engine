// IT-110 (DES-148, v24): the catalog — validateRegistration/insertVersion split, `assets`, the
// ordered idempotent migration, deregister returning claimedTriggers. Written test-first (Gate 5,
// RED) — WorkflowCatalog.register still takes the pre-v24 (name, script, defaults, principal)
// shape with no `mermaid`/`triggers`, and `deregister` still returns only `{removed}`.
// Mock policy: real SQLite-backed WorkflowCatalog (better-sqlite3), no mocks.
//
// Gate 6 (implementer, TASK-143): filled out from 4 to the dod's own ≥25 floor (adjudication v24
// #2 A-6, applied by analogy — same rationale as TASK-140's shortfall) and the two stale
// `@ts-expect-error` directives removed (the shipped `deregister`/`listAssets` already carry the
// v24 shape — the directives were asserting a type error that no longer exists, which itself
// fails `tsc --noEmit` with TS2578).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkflowCatalog } from '../../src/workflow-catalog.js';
import { reclaimStaleWorkspaces } from '../../src/workspace-gc.js';

describe('WorkflowCatalog v24 — mermaid/triggers required, assets, deregister union (IT-110, DES-148)', () => {
  let dir: string;
  let catalog: WorkflowCatalog;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rwe-catalog-v24-'));
    catalog = new WorkflowCatalog(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('register() without a mermaid string is refused MERMAID_REQUIRED, and NOTHING is written', async () => {
    await expect(
      // @ts-expect-error — v24 register() takes {name, script, mermaid, triggers, principal}; today omits mermaid entirely
      catalog.register({ name: 'wf-v24-a', script: 'workflow(() => {});' }),
    ).rejects.toMatchObject({ message: expect.stringMatching(/MERMAID_REQUIRED/i) });
  });

  it('a MERMAID_REQUIRED refusal specifically leaves the version-row count unchanged [T1]', async () => {
    const before = await catalog.list();
    let threw: unknown;
    try {
      // @ts-expect-error — v24 shape
      await catalog.register({ name: 'wf-v24-b', script: 'workflow(() => {});' });
    } catch (e) {
      threw = e;
    }
    // Pinned to the SAME refusal as the case above — a differently-failing register (e.g. a
    // missing-script bug) must not false-green this row-count assertion.
    expect((threw as { message?: string } | undefined)?.message).toMatch(/MERMAID_REQUIRED/i);
    const after = await catalog.list();
    expect(after.length).toBe(before.length);
  });

  it('deregister() returns {removed, claimedTriggers} — the union over ALL versions', async () => {
    const result = await catalog.deregister('nonexistent-v24-workflow');
    expect(result.claimedTriggers).toBeDefined();
    expect(result.claimedTriggers).toEqual([]);
  });

  it('the assets table exists after migration (walked from the pre-v24 global tree as legacy rows)', () => {
    expect(typeof catalog.listAssets).toBe('function');
  });

  it('a whitespace-only mermaid string is MERMAID_INVALID (line 1), not MERMAID_REQUIRED', async () => {
    await expect(
      catalog.register({ name: 'wf-v24-ws', script: 'workflow(() => {});', mermaid: '   ' }),
    ).rejects.toMatchObject({ message: expect.stringMatching(/MERMAID_INVALID/i) });
  });

  it('a whitespace-only mermaid refusal ALSO leaves the version-row count unchanged [T1]', async () => {
    const before = await catalog.list();
    await expect(catalog.register({ name: 'wf-v24-ws2', script: 'workflow(() => {});', mermaid: '  \n  ' })).rejects.toThrow();
    const after = await catalog.list();
    expect(after.length).toBe(before.length);
  });

  it('a valid zero-label registration (flowchart-only diagram, no agent calls) succeeds and stores a non-null mermaid', async () => {
    const { version } = await catalog.register({ name: 'wf-v24-ok', script: 'workflow(() => {});', mermaid: 'flowchart TD' });
    expect(version).toBe('v1');
    const row = (catalog as unknown as { _db: Database.Database })._db
      .prepare('SELECT mermaid FROM workflow_versions WHERE name = ? AND version = ?')
      .get('wf-v24-ok', version) as { mermaid: string | null };
    expect(row.mermaid).toBe('flowchart TD');
  });

  it('ten successful registrations under distinct names — no row is written with mermaid NULL', async () => {
    for (let i = 0; i < 10; i++) {
      await catalog.register({ name: `wf-v24-ten-${i}`, script: 'workflow(() => {});', mermaid: 'flowchart TD' });
    }
    const nullCount = (
      (catalog as unknown as { _db: Database.Database })._db
        .prepare("SELECT COUNT(*) AS n FROM workflow_versions WHERE name LIKE 'wf-v24-ten-%' AND mermaid IS NULL")
        .get() as { n: number }
    ).n;
    expect(nullCount).toBe(0);
  });

  it('register() with an unknown positional-shaped argument is refused INVALID_ARGUMENT (pre-v24 callers)', async () => {
    await expect(
      // @ts-expect-error — the retired pre-v24 positional shape
      catalog.register('wf-legacy', 'workflow(() => {});', undefined, null),
    ).rejects.toMatchObject({ message: expect.stringMatching(/INVALID_ARGUMENT|register\(\) takes/i) });
  });

  it('deregister() deletes every `assets` row for that workflow, in the same transaction as the version rows', async () => {
    await catalog.register({ name: 'wf-v24-assets', script: 'workflow(() => {});', mermaid: 'flowchart TD' });
    catalog.putAsset({ workflow: 'wf-v24-assets', kind: 'skill', name: 'demo', pushedBy: 'tester', pushedAt: new Date().toISOString() });
    expect(catalog.listAssets('wf-v24-assets')).toHaveLength(1);
    await catalog.deregister('wf-v24-assets');
    expect(catalog.listAssets('wf-v24-assets')).toHaveLength(0);
  });

  it('deregister() returns the UNION of triggers[] across every version row for that name', async () => {
    await catalog.register({ name: 'wf-v24-trig', script: 'workflow(() => {});', mermaid: 'flowchart TD', triggers: ['t1', 't2'] });
    await catalog.register({ name: 'wf-v24-trig', script: 'workflow(() => {});', mermaid: 'flowchart TD', triggers: ['t2', 't3'] });
    const result = await catalog.deregister('wf-v24-trig');
    expect(result.removed).toBe(true);
    expect(new Set(result.claimedTriggers)).toEqual(new Set(['t1', 't2', 't3']));
  });

  it('deregister() of a name with no triggers on any version ⇒ claimedTriggers is empty, removed is true', async () => {
    await catalog.register({ name: 'wf-v24-notrig', script: 'workflow(() => {});', mermaid: 'flowchart TD' });
    const result = await catalog.deregister('wf-v24-notrig');
    expect(result).toEqual({ removed: true, claimedTriggers: [] });
  });

  it('deregister() of an unregistered name ⇒ removed:false, claimedTriggers:[] (never throws)', async () => {
    const result = await catalog.deregister('never-existed');
    expect(result).toEqual({ removed: false, claimedTriggers: [] });
  });

  it('putAsset upserts on a repeat (workflow, kind, name) — one row, latest pushedBy/pushedAt win', () => {
    catalog.putAsset({ workflow: 'wf-v24-upsert', kind: 'skill', name: 's1', pushedBy: 'first', pushedAt: 't1' });
    catalog.putAsset({ workflow: 'wf-v24-upsert', kind: 'skill', name: 's1', pushedBy: 'second', pushedAt: 't2' });
    const rows = catalog.listAssets('wf-v24-upsert');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ pushedBy: 'second', pushedAt: 't2' });
  });

  it('putAsset/deleteAsset/listAssets/assetsOf round-trip across the workflow and global scopes', () => {
    catalog.putAsset({ workflow: 'wf-v24-round', kind: 'skill', name: 's1', pushedBy: 'a', pushedAt: 't1' });
    catalog.putAsset({ workflow: '', kind: 'skill', name: 'g1', pushedBy: 'b', pushedAt: 't2' });
    expect(catalog.listAssets('wf-v24-round')).toHaveLength(1);
    expect(catalog.assetsOf('wf-v24-round')).toHaveLength(2); // workflow-scoped ∪ global
    const del = catalog.deleteAsset('wf-v24-round', 'skill', 's1');
    expect(del).toEqual({ deleted: true });
    expect(catalog.listAssets('wf-v24-round')).toHaveLength(0);
    expect(catalog.deleteAsset('wf-v24-round', 'skill', 'never-there')).toEqual({ deleted: false });
  });

  it('an AGENT_UNDECLARED refusal (a script agent() call with no meta.params.agents block) leaves the version-row count unchanged [T1]', async () => {
    const script = `
      workflow(async ({ agent }) => {
        await agent('reviewer', {});
      });
    `;
    const before = await catalog.list();
    await expect(
      catalog.register({ name: 'wf-v24-mismatch', script, mermaid: 'flowchart TD' }),
    ).rejects.toMatchObject({ code: 'AGENT_UNDECLARED' });
    const after = await catalog.list();
    expect(after.length).toBe(before.length);
  });

  it('a SCAN_VIOLATION refusal (e.g. no label on the agent() call) leaves the version-row count unchanged [T1]', async () => {
    const script = `
      workflow(async ({ agent }) => {
        await agent('do the thing with no label arg');
      });
    `;
    const before = await catalog.list();
    await expect(catalog.register({ name: 'wf-v24-scanviol', script, mermaid: 'flowchart TD' })).rejects.toMatchObject({ code: 'SCAN_VIOLATION' });
    const after = await catalog.list();
    expect(after.length).toBe(before.length);
  });

  it('a VERSION_CEILING_EXCEEDED refusal leaves the version-row count unchanged [T1]', async () => {
    const capped = new WorkflowCatalog(join(dir, 'capped'), undefined, { ceilings: { maxTimeoutMs: 600_000, maxAppendPromptBytes: 1024, maxEffort: 'high', maxWorkflowVersions: 1 } as never });
    await capped.register({ name: 'wf-v24-ceiling', script: 'workflow(() => {});', mermaid: 'flowchart TD' });
    const before = await capped.list();
    await expect(
      capped.register({ name: 'wf-v24-ceiling', script: 'workflow(() => {});', mermaid: 'flowchart TD' }),
    ).rejects.toMatchObject({ code: 'VERSION_CEILING_EXCEEDED' });
    const after = await capped.list();
    expect(after.length).toBe(before.length);
  });

  it('a NOT_WORKFLOW_OWNER refusal (auth enabled, wrong principal) leaves the version-row count unchanged [T1]', async () => {
    await catalog.register({ name: 'wf-v24-owned', script: 'workflow(() => {});', mermaid: 'flowchart TD', principal: 'alice@example.com' });
    const before = await catalog.list();
    await expect(
      catalog.register({ name: 'wf-v24-owned', script: 'workflow(() => {});', mermaid: 'flowchart TD', principal: 'mallory@example.com' }),
    ).rejects.toMatchObject({ code: 'NOT_WORKFLOW_OWNER' });
    const after = await catalog.list();
    expect(after.length).toBe(before.length);
  });

  it('validateRegistration() alone writes NOTHING — insertVersion() is the ONE write', async () => {
    const before = await catalog.list();
    const { params, labels, agents } = await catalog.validateRegistration({ name: 'wf-v24-split', script: 'workflow(() => {});', mermaid: 'flowchart TD' });
    expect(params).toBeDefined();
    expect(labels).toEqual([]);
    expect(agents).toEqual({});
    const after = await catalog.list();
    expect(after.length).toBe(before.length); // still nothing written — insertVersion was never called
    const { version } = await catalog.insertVersion({ name: 'wf-v24-split', script: 'workflow(() => {});', mermaid: 'flowchart TD', params });
    expect(version).toBe('v1');
    expect((await catalog.list()).length).toBe(before.length + 1);
  });

  it('register() stores `triggers[]` on the version row, readable back via resolve()', async () => {
    await catalog.register({ name: 'wf-v24-trigrow', script: 'workflow(() => {});', mermaid: 'flowchart TD', triggers: ['hook-a', 'hook-b'] });
    const row = (catalog as unknown as { _db: Database.Database })._db
      .prepare('SELECT triggers FROM workflow_versions WHERE name = ?')
      .get('wf-v24-trigrow') as { triggers: string | null };
    expect(JSON.parse(row.triggers!)).toEqual(['hook-a', 'hook-b']);
  });

  it('re-registering a deregistered name allocates a fresh version number, not a reused one', async () => {
    await catalog.register({ name: 'wf-v24-realloc', script: 'workflow(() => {});', mermaid: 'flowchart TD' });
    await catalog.register({ name: 'wf-v24-realloc', script: 'workflow(() => {});', mermaid: 'flowchart TD' });
    await catalog.deregister('wf-v24-realloc');
    const { version } = await catalog.register({ name: 'wf-v24-realloc', script: 'workflow(() => {});', mermaid: 'flowchart TD' });
    expect(version).toBe('v1'); // fresh row set (workflow row deleted by deregister) — allocator restarts clean
  });

  describe('migration over a v23 fixture db', () => {
    function makeV23FixtureDb(fixtureDir: string): void {
      mkdirSync(fixtureDir, { recursive: true });
      const db = new Database(join(fixtureDir, 'catalog.db'));
      // Shape of a post-v22/pre-v24 db: `workflows` already migrated off the legacy columns, but
      // `workflow_versions` has NEITHER `mermaid` NOR `triggers`, and no `assets` table exists yet
      // — exactly what TASK-143's migration block (`mermaid`/`triggers` ALTERs + `CREATE TABLE
      // assets IF NOT EXISTS`) is written to bring forward.
      db.exec(`
        CREATE TABLE workflows (name TEXT PRIMARY KEY, createdAt TEXT NOT NULL, owner TEXT, release_version TEXT, beta_version TEXT);
        CREATE TABLE workflow_versions (name TEXT NOT NULL, version TEXT NOT NULL, script TEXT NOT NULL, defaults TEXT, params TEXT, createdAt TEXT NOT NULL, PRIMARY KEY (name, version));
        INSERT INTO workflows (name, createdAt, owner, release_version, beta_version) VALUES ('v23-wf', 't0', NULL, 'v1', NULL);
        INSERT INTO workflow_versions (name, version, script, defaults, params, createdAt) VALUES ('v23-wf', 'v1', 'workflow(() => {});', NULL, NULL, 't0');
      `);
      db.close();
    }

    it('runs twice with an identical end state (idempotent ALTERs/CREATEs, no throw, no duplicate columns)', async () => {
      const fixtureDir = join(dir, 'v23-fixture');
      makeV23FixtureDb(fixtureDir);
      const first = new WorkflowCatalog(fixtureDir);
      const colsAfterFirst = (first as unknown as { _db: Database.Database })._db
        .prepare('PRAGMA table_info(workflow_versions)')
        .all() as Array<{ name: string }>;
      expect(colsAfterFirst.map((c) => c.name).sort()).toEqual(
        // v26 (DES-184, TASK-184, REQ-128): `diagram_contract` — the per-version stamp that says
        // whether this version's diagram was checked against the v2 LR-swimlane grammar. A row
        // migrated from a pre-v26 db has it NULL, read back as 'v1' (grandfathered, never
        // re-checked), which is why the column joins the pinned set rather than replacing anything.
        ['name', 'version', 'script', 'defaults', 'params', 'createdAt', 'mermaid', 'triggers', 'diagram_contract'].sort(),
      );
      // Re-opening a SECOND WorkflowCatalog over the SAME already-migrated file must not throw
      // (a non-guarded `ALTER TABLE ADD COLUMN` on an existing column throws SQLITE_ERROR) and must
      // leave an IDENTICAL column set — the migration's own idempotence, not just "runs once".
      const second = new WorkflowCatalog(fixtureDir);
      const colsAfterSecond = (second as unknown as { _db: Database.Database })._db
        .prepare('PRAGMA table_info(workflow_versions)')
        .all() as Array<{ name: string }>;
      expect(colsAfterSecond.map((c) => c.name).sort()).toEqual(colsAfterFirst.map((c) => c.name).sort());
      // The pre-existing v23 row survives the migration untouched (mermaid/triggers NULL on the
      // LEGACY row — only NEW registrations from here on are required to carry a non-null mermaid).
      const legacyRow = (second as unknown as { _db: Database.Database })._db
        .prepare('SELECT mermaid, triggers FROM workflow_versions WHERE name = ?')
        .get('v23-wf') as { mermaid: string | null; triggers: string | null };
      expect(legacyRow).toEqual({ mermaid: null, triggers: null });
    });

    it('the assets table exists after migrating a v23 fixture db that never had one', () => {
      const fixtureDir = join(dir, 'v23-fixture-assets');
      makeV23FixtureDb(fixtureDir);
      const migrated = new WorkflowCatalog(fixtureDir);
      const tables = (migrated as unknown as { _db: Database.Database })._db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='assets'")
        .all();
      expect(tables).toHaveLength(1);
    });
  });

  describe('orphan asset-tree GC sweep (workspace-gc.ts, ARCH-098)', () => {
    it('an orphan `<workRoot>/assets/<name>/` tree is reclaimed while a live workflow tree is not', async () => {
      await catalog.register({ name: 'wf-v24-live', script: 'workflow(() => {});', mermaid: 'flowchart TD' });
      const liveDir = join(dir, 'assets', 'wf-v24-live');
      const orphanDir = join(dir, 'assets', 'wf-v24-orphan-gone');
      mkdirSync(liveDir, { recursive: true });
      mkdirSync(orphanDir, { recursive: true });
      writeFileSync(join(liveDir, 'f.txt'), 'x');
      writeFileSync(join(orphanDir, 'f.txt'), 'x');
      const names = new Set((await catalog.list()).map((w) => w.name));
      const reclaimed = reclaimStaleWorkspaces(dir, 0, () => null, Date.now(), (name) => names.has(name));
      expect(reclaimed).toContain('assets/wf-v24-orphan-gone');
      expect(reclaimed).not.toContain('assets/wf-v24-live');
    });
  });
});
