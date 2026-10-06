// Issue #154 B4 follow-up (named explicitly in the confirmed-bug plan: "asset-sync.ts:490 also
// joins the raw workflow name into a path, same exposure"): `AssetSyncService.push()`/`delete()`
// join `req.workflow` (a workflow-scoped asset's owning workflow name) directly into a real
// filesystem path via `_skillRoot` — `join(this._workRoot, workflow, 'skill', name)` — with no
// validation on `workflow` at all (only `req.name`, the asset's own name, went through
// `lexicalVerdict`). In production this is reached only after `mcp-facade.ts`'s `workspacePush`
// checks `catalog.exists(a['workflow'])` first (issue #102), and workflow-catalog.ts's B4 fix means
// no malformed name can ever become `exists()===true` — but `AssetSyncService` is a reusable class
// with no such guarantee about ITS OWN callers, so this is defense in depth at the actual join site,
// matching the issue's explicit callout.
//
// RED before the fix: `push()` with `workflow: '../../../../tmp/evil'` accepts the request and
// materializes the skill tree OUTSIDE workRoot entirely.
//
// Mock policy (unit): a real AssetSyncService on a tmp dir, a fake catalog port (same tier as
// asset-sync-v24.test.ts) — no real MCP/network involved (kind:'skill' only).
import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { AssetSyncService, type AssetCatalogRow } from '../../src/asset-sync.js';
import { FixedClock } from '../../src/clock.js';

function fakeCatalogPort() {
  const rows: AssetCatalogRow[] = [];
  return {
    putAsset: vi.fn((row: AssetCatalogRow) => { rows.push(row); }),
    deleteAsset: vi.fn(() => ({ deleted: true })),
    listAssets: vi.fn(() => rows),
  };
}

describe('#154 B4 follow-up: AssetSyncService refuses an escaping req.workflow, not just req.name', () => {
  it('push({scope:"workflow", workflow:"../../../../tmp/evil", kind:"skill", ...}) is refused, not materialized outside workRoot', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-154b4-assetsync-'));
    const escapeTarget = join(tmpdir(), 'rwe-154b4-assetsync-escape-target');
    try {
      const catalog = fakeCatalogPort();
      const svc = new AssetSyncService({
        workRoot: dir, globalRoot: join(dir, 'global'),
        selfBind: { host: '127.0.0.1', port: 1 }, clock: new FixedClock(new Date('2026-01-01T00:00:00Z')),
        catalog, probe: { probe: vi.fn() }, egressAllowlist: [],
      });
      const result = await svc.push({
        scope: 'workflow',
        workflow: '../../../../tmp/rwe-154b4-assetsync-escape-target',
        kind: 'skill',
        name: 'evil-skill',
        files: [{ path: 'SKILL.md', contentB64: Buffer.from('# evil').toString('base64') }],
        pushedBy: 'attacker',
      } as never);
      expect(result).toMatchObject({ error: 'INVALID_NAME' });
      expect(catalog.putAsset).not.toHaveBeenCalled();
      expect(existsSync(escapeTarget)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(escapeTarget, { recursive: true, force: true });
    }
  });

  it('a normal workflow-scoped skill push still works (no false positive)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-154b4-assetsync-ok-'));
    try {
      const catalog = fakeCatalogPort();
      const svc = new AssetSyncService({
        workRoot: dir, globalRoot: join(dir, 'global'),
        selfBind: { host: '127.0.0.1', port: 1 }, clock: new FixedClock(new Date('2026-01-01T00:00:00Z')),
        catalog, probe: { probe: vi.fn() }, egressAllowlist: [],
      });
      const result = await svc.push({
        scope: 'workflow',
        workflow: 'my-normal-workflow',
        kind: 'skill',
        name: 'good-skill',
        files: [{ path: 'SKILL.md', contentB64: Buffer.from('# fine').toString('base64') }],
        pushedBy: 'bob',
      } as never);
      expect(result).toMatchObject({ stored: 'good-skill' });
      expect(resolve(dir, 'my-normal-workflow', 'skill', 'good-skill', 'SKILL.md')).toBeTruthy();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
