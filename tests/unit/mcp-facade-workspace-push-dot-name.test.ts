// #166 tail (tester's 2026-10-10 reverify comment, low item 1, owner decision): the FACADE-level
// repro — "Check how push's {error} reaches the MCP caller (mcp-facade workspacePush) so the
// message is actually delivered, not just the code." `AssetSyncService.push()` has its own direct
// unit coverage (asset-sync-delete-legacy-name.test.ts's "push({name:'.'}) returns INVALID_NAME
// WITH a detail.message" case); this file pins the SAME scenario through the real facade's
// `workspacePush`, the exact call shape a live MCP caller would make, proving the `detail.message`
// actually reaches `error.message` on the wire envelope rather than being dropped on the way.
//
// RED before the fix: `error.code === 'INVALID_ARGUMENT'` and `error.message === 'INVALID_ARGUMENT'`
// (the bare code, no reason attached at all).
//
// Mock policy (unit): a REAL McpFacade/RunManager/WorkflowCatalog and a REAL AssetSyncService on a
// real tmp dir with a fake asset-row catalog port (same tier as every other asset-sync-* unit test
// in this suite — the asset ROW store is not under test here, only the on-disk tree / wire shape).
import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
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

describe('McpFacade.workspacePush — asset name "." is refused INVALID_NAME WITH a delivered reason (#166 tail, low item 1)', () => {
  it('a global-scope push of name "." returns status:failed, code:INVALID_NAME, and error.message states why — not just the bare code', async () => {
    const workRoot = mkdtempSync(join(tmpdir(), 'rwe-166-push-dot-facade-'));
    try {
      const catalog = new WorkflowCatalog(workRoot, CLOCK);
      const assetSync = new AssetSyncService({
        workRoot: join(workRoot, 'assets'), globalRoot: join(workRoot, 'global'),
        selfBind: { host: '127.0.0.1', port: 1 }, clock: CLOCK,
        catalog: fakeAssetCatalogPort(), probe: { probe: vi.fn() }, egressAllowlist: [],
      });
      const facade = new McpFacade({ runManager: new RunManager({ catalog, clock: CLOCK }), clock: CLOCK });
      facade.bindAssetSync(assetSync);

      const res = await facade.workspacePush(
        { scope: 'global', kind: 'skill', name: '.', files: [{ path: 'SKILL.md', contentB64: Buffer.from('# x').toString('base64') }] },
        OPEN,
      ) as Record<string, unknown>;

      expect(res['status']).toBe('failed');
      expect(res['code']).toBe('INVALID_NAME');
      const error = res['error'] as { code?: string; message?: string } | undefined;
      expect(error?.code).toBe('INVALID_NAME');
      expect(error?.message).toBeTruthy();
      // A REASON must be attached, not just the bare code string repeated as the message.
      expect(error?.message).not.toBe('INVALID_NAME');
      expect(error?.message).toMatch(/not valid asset names|single path segment/);
      expect(existsSync(join(workRoot, 'global', 'skill', '.'))).toBe(false);
    } finally {
      rmSync(workRoot, { recursive: true, force: true });
    }
  });
});
