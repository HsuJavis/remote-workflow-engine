// Issue #166 decision 1 + 3 — the end-to-end `workflow_deregister` tool shape: a legacy name past
// the (#166 decision 2) length limits must still come back `removed:true`, never INTERNAL_ERROR,
// and if an asset-tree cleanup error OTHER than ENOENT/ENAMETOOLONG does occur, the wire response
// still reports success (never lies about a completed catalog delete) while carrying a warning —
// and ANY uncoded error this facade method does surface as INTERNAL_ERROR must never leak an
// absolute host path to the caller (decision 3's central `toErrEnvelope` fix).
//
// Mock policy (unit, same tier as mcp-facade-workspace-purge-mcp-state.test.ts): a stubbed
// RunManager.catalog (the DB side is not under test here — workflow-catalog.test.ts covers it
// directly) + a REAL AssetSyncService on a real tmp dir, so the ENAMETOOLONG this test needs is a
// genuine kernel error, not a mock.
import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { McpFacade } from '../../src/mcp-facade.js';
import { AssetSyncService, type AssetCatalogRow } from '../../src/asset-sync.js';
import { WorkflowCatalog } from '../../src/workflow-catalog.js';
import { FixedClock } from '../../src/clock.js';

const PRINCIPAL = { kind: 'auth-disabled' } as const;

// Same raw-INSERT seeding shape workflow-catalog.test.ts's own `seedRawVersion` uses — a legacy
// row `register()` itself can never produce any more (registration always runs the CURRENT name
// rules), simulating "registered before #154/#166 existed".
function seedRawVersion(workRoot: string, name: string, version: string, script: string): void {
  const db = new Database(join(workRoot, 'catalog.db'));
  const now = new Date().toISOString();
  db.prepare('INSERT INTO workflows (name, createdAt, owner, release_version) VALUES (?, ?, NULL, ?)').run(name, now, version);
  db.prepare('INSERT INTO workflow_versions (name, version, script, createdAt) VALUES (?, ?, ?, ?)').run(name, version, script, now);
  db.close();
}

function fakeCatalogPort() {
  const rows: AssetCatalogRow[] = [];
  return { putAsset: vi.fn((row: AssetCatalogRow) => { rows.push(row); }), deleteAsset: vi.fn(), listAssets: vi.fn(() => rows) };
}

function realAssetSync(dir: string): AssetSyncService {
  return new AssetSyncService({
    workRoot: dir, globalRoot: join(dir, 'global'),
    selfBind: { host: '127.0.0.1', port: 1 }, clock: new FixedClock(new Date('2026-01-01T00:00:00Z')),
    catalog: fakeCatalogPort(), probe: { probe: vi.fn() }, egressAllowlist: [],
  });
}

function stubCatalog(removed: boolean) {
  return {
    deregister: vi.fn(async () => ({ removed, claimedTriggers: [] as string[] })),
  };
}

describe('McpFacade.workflowDeregister — a byte-oversized legacy name succeeds, not INTERNAL_ERROR (#166 decision 1)', () => {
  it('a >255-byte legacy name (never length-limited at registration) deregisters cleanly: removed:true, no error', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-166-facade-dereg-'));
    try {
      const name = 'edge-01-long-' + 'x'.repeat(290);
      const facade = new McpFacade({
        runManager: { catalog: stubCatalog(true) },
        assetSync: realAssetSync(dir),
        schedulerClaims: { release: vi.fn(), disable: vi.fn(), claimedIdsFor: () => [] } as never,
        webhookClaims: { release: vi.fn(), disable: vi.fn(), claimedIdsFor: () => [] } as never,
      } as never);

      const result = await facade.workflowDeregister({ name }, PRINCIPAL);

      expect(result.status).toBe('completed');
      expect(result.error).toBeUndefined();
      expect((result.result as { removed?: boolean })?.removed).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a CJK legacy name (128 chars, byte-oversized — #166 decision 2\'s own shape) also deregisters cleanly', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-166-facade-dereg-cjk-'));
    try {
      const name = 'ver-01-u-' + '名'.repeat(119);
      const facade = new McpFacade({
        runManager: { catalog: stubCatalog(true) },
        assetSync: realAssetSync(dir),
        schedulerClaims: { release: vi.fn(), disable: vi.fn(), claimedIdsFor: () => [] } as never,
        webhookClaims: { release: vi.fn(), disable: vi.fn(), claimedIdsFor: () => [] } as never,
      } as never);

      const result = await facade.workflowDeregister({ name }, PRINCIPAL);

      expect(result.status).toBe('completed');
      expect(result.error).toBeUndefined();
      expect((result.result as { removed?: boolean })?.removed).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('an UNKNOWN workflow (removed:false from the catalog) still answers WORKFLOW_NOT_FOUND — this fix does not loosen that', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-166-facade-dereg-unknown-'));
    try {
      const facade = new McpFacade({
        runManager: { catalog: stubCatalog(false) },
        assetSync: realAssetSync(dir),
        schedulerClaims: { release: vi.fn(), disable: vi.fn(), claimedIdsFor: () => [] } as never,
        webhookClaims: { release: vi.fn(), disable: vi.fn(), claimedIdsFor: () => [] } as never,
      } as never);

      const result = await facade.workflowDeregister({ name: 'never-registered' }, PRINCIPAL);

      expect(result.status).toBe('failed');
      expect((result.error as { code?: string })?.code).toBe('WORKFLOW_NOT_FOUND');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // The task's own acceptance test, verbatim: "deregister of a >255-byte legacy name (inserted
  // directly into the catalog db) succeeds" — a REAL WorkflowCatalog (not a stub), seeded by raw
  // INSERT the same way `register()` itself could never produce a row this shaped, through the
  // REAL `McpFacade.workflowDeregister`, with the SAME name also pinned at the decision-2 pairing:
  // `validateStoredVersion` must call it NOT_RUNNABLE/INVALID_NAME, yet deregister must still
  // remove it.
  it('a REAL WorkflowCatalog, seeded by raw INSERT with a >255-byte name: NOT_RUNNABLE at validateStoredVersion, yet still fully deregisterable (removed:true, catalog.exists → false)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-166-facade-dereg-realdb-'));
    try {
      const name = 'edge-01-long-' + 'x'.repeat(290);
      const catalog = new WorkflowCatalog(dir);
      seedRawVersion(dir, name, 'v1', "export const meta = { phases: [] };\nreturn 1;");

      // Decision 2's pairing: this exact row is NOT_RUNNABLE (its name no longer validates) —
      expect(await catalog.exists(name)).toBe(true);
      const validity = await catalog.validateStoredVersion(name, 'v1');
      expect(validity.ok).toBe(false);
      if (!validity.ok) {
        expect(validity.code).toBe('NOT_RUNNABLE');
        expect(validity.detail?.['violation']).toBe('INVALID_NAME');
      }

      // ...but decision 1 still requires it to be fully deregisterable through the REAL facade.
      // Independent verifier (round-3): this directory must actually EXIST before the facade's
      // asset-tree cleanup runs — `realAssetSync(join(dir,'assets'))` roots the service at a path
      // that was otherwise never created, so `rmSync`'s own `lstat` hit `ENOENT` on the MISSING
      // PARENT before it ever got a chance to hit `ENAMETOOLONG` on the long name itself, and
      // `force:true` silently swallows that ENOENT — this case would pass unchanged even if the
      // `ENAMETOOLONG` tolerance this issue added were deleted entirely. Creating the parent here
      // makes `rmSync` actually reach the long name and hit the real `ENAMETOOLONG` this test means
      // to exercise (the stub-catalog cases above already do, by construction of their own
      // `realAssetSync(dir)` root).
      mkdirSync(join(dir, 'assets'), { recursive: true });
      const facade = new McpFacade({
        runManager: { catalog },
        assetSync: realAssetSync(join(dir, 'assets')),
        schedulerClaims: { release: vi.fn(), disable: vi.fn(), claimedIdsFor: () => [] } as never,
        webhookClaims: { release: vi.fn(), disable: vi.fn(), claimedIdsFor: () => [] } as never,
      } as never);

      const result = await facade.workflowDeregister({ name }, PRINCIPAL);

      expect(result.status).toBe('completed');
      expect(result.error).toBeUndefined();
      expect((result.result as { removed?: boolean })?.removed).toBe(true);
      expect(await catalog.exists(name)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('McpFacade.workflowDeregister — INTERNAL_ERROR never leaks an absolute host path (#166 decision 3)', () => {
  it('an uncoded throw from the catalog carrying a host path reaches the wire as a generic message, with the path logged server-side only', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-166-facade-dereg-leak-'));
    try {
      const leakyPath = '/home/rwe/.local/share/rwe-data/assets/some-workflow-name';
      const facade = new McpFacade({
        runManager: {
          catalog: { deregister: vi.fn(async () => { throw new Error(`ENAMETOOLONG: name too long, unlink '${leakyPath}'`); }) },
        },
        assetSync: realAssetSync(dir),
      } as never);
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = await facade.workflowDeregister({ name: 'whatever' }, PRINCIPAL);

      expect(result.status).toBe('failed');
      const error = result.error as { code?: string; message?: string };
      expect(error?.code).toBe('INTERNAL_ERROR');
      expect(error?.message ?? '').not.toContain('/home/');
      expect(error?.message ?? '').not.toContain(leakyPath);

      errSpy.mockRestore();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
