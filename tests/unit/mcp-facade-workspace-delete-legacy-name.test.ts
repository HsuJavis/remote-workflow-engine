// Independent verifier (r5-a round-3, 2026-10-10): the verifier's OWN repro for the delete()
// regression is at the `McpFacade.workspaceDelete` level — "Legacy workflow 'ver-01-u-' + '名'×70
// (79 chars, 219 bytes), registered at base, with a pushed skill 'myskill' ... Call
// workspace_delete({workflow:<name>, kind:'skill', name:'myskill'})." `AssetSyncService.delete()`
// has its own direct unit coverage (asset-sync-delete-legacy-name.test.ts); this file pins the
// SAME scenario end-to-end through the real facade, the real WorkflowCatalog's `exists()` check
// (mcp-facade.ts's own twin guard, ~line 1475), and the real AssetSyncService — the exact call
// shape a live MCP caller would make.
//
// Mock policy (unit): a REAL WorkflowCatalog (seeded by raw INSERT — `register()` itself could
// never produce a row this shaped any more) through a REAL RunManager, and a REAL AssetSyncService
// on a real tmp dir with a fake asset-row catalog port (same tier as every other asset-sync-* unit
// test in this suite — the asset ROW store is not under test here, only the on-disk tree).
import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { McpFacade } from '../../src/mcp-facade.js';
import { AssetSyncService, type AssetCatalogRow } from '../../src/asset-sync.js';
import { WorkflowCatalog } from '../../src/workflow-catalog.js';
import { RunManager } from '../../src/run-manager.js';
import { FixedClock } from '../../src/clock.js';

const CLOCK = new FixedClock(new Date('2026-01-01T00:00:00Z'));
const OPEN = { kind: 'auth-disabled' } as const;

function fakeAssetCatalogPort() {
  const rows: AssetCatalogRow[] = [];
  return { putAsset: vi.fn((row: AssetCatalogRow) => { rows.push(row); }), deleteAsset: vi.fn(() => ({ deleted: true })), listAssets: vi.fn(() => rows) };
}

describe('McpFacade.workspaceDelete — the verifier\'s own repro: a 219-byte legacy workflow name (#166 decision 1)', () => {
  it('a 219-byte legacy workflow name, registered at base, with a real pushed skill tree: the tree is actually removed, deleted:true, no throw', async () => {
    const workRoot = mkdtempSync(join(tmpdir(), 'rwe-166-wsdelete-legacy-'));
    try {
      const name = 'ver-01-u-' + '名'.repeat(70); // 79 chars, 219 UTF-8 bytes — the verifier's own repro
      const catalog = new WorkflowCatalog(workRoot, CLOCK);
      // Raw INSERT, same shape `register()` itself could never produce post-#166 (simulates "this
      // workflow was registered before the length limits existed").
      await catalog.register({ name: 'placeholder-to-init-db', script: "export const meta = { phases: [] };\nreturn 1;", mermaid: 'graph LR' });
      const Database = (await import('better-sqlite3')).default;
      const db = new Database(join(workRoot, 'catalog.db'));
      const now = new Date().toISOString();
      db.prepare('INSERT INTO workflows (name, createdAt, owner, release_version) VALUES (?, ?, NULL, ?)').run(name, now, 'v1');
      db.prepare('INSERT INTO workflow_versions (name, version, script, createdAt) VALUES (?, ?, ?, ?)').run(name, 'v1', "export const meta = { phases: [] };\nreturn 1;", now);
      db.close();
      expect(await catalog.exists(name)).toBe(true);

      const assetRoot = join(workRoot, 'assets');
      const skillDir = join(assetRoot, name, 'skill', 'myskill');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, 'SKILL.md'), '# myskill');
      expect(existsSync(skillDir)).toBe(true);

      const assetSync = new AssetSyncService({
        workRoot: assetRoot, globalRoot: join(workRoot, 'global'),
        selfBind: { host: '127.0.0.1', port: 1 }, clock: CLOCK,
        catalog: fakeAssetCatalogPort(), probe: { probe: vi.fn() }, egressAllowlist: [],
      });
      const facade = new McpFacade({ runManager: new RunManager({ catalog, clock: CLOCK }), clock: CLOCK });
      facade.bindAssetSync(assetSync);

      const res = await facade.workspaceDelete({ workflow: name, kind: 'skill', name: 'myskill' }, OPEN) as Record<string, unknown>;

      expect(res['status']).toBe('completed');
      expect(res['error']).toBeUndefined();
      expect((res['result'] as { deleted?: boolean } | undefined)?.deleted).toBe(true);
      expect(existsSync(skillDir)).toBe(false);
    } finally {
      rmSync(workRoot, { recursive: true, force: true });
    }
  });
});
