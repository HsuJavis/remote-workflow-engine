// Independent verifier (r5-a round-3, 2026-10-10): `deleteWorkflowTree`'s ASSET_CLEANUP_INCOMPLETE
// branch (an fs error OTHER than ENOENT/ENAMETOOLONG) had no test anywhere — the implementer's own
// residual-risk note called it "hard to force", but it is not: `rmSync` throwing a plain
// `{code:'EACCES'}` reaches it directly, no real permission setup needed. Node's `node:fs` module
// namespace is non-configurable (`vi.spyOn(fs, 'rmSync')` throws "Cannot redefine property"), so
// this file uses `vi.mock('node:fs', ...)` (module-level, hoisted) with a real `importOriginal` for
// everything except `rmSync`, which starts as a passthrough to the REAL `rmSync` captured once
// inside the factory — so every OTHER test file touching real fs state is unaffected, and only
// this file's own test overrides the behaviour for one call.
//
// A future edit that makes this branch throw again (regressing #166 decision 1 — "DB committed,
// then a filesystem step throws" — for this exact case), or that drops `result.warning` on the way
// out of `mcp-facade.ts`'s `workflowDeregister` OR `workspaceDelete`, would otherwise pass the
// whole suite unnoticed.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const rmSyncMock = vi.hoisted(() => vi.fn());

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  rmSyncMock.mockImplementation((...args: Parameters<typeof actual.rmSync>) => actual.rmSync(...args));
  return { ...actual, rmSync: (...args: Parameters<typeof actual.rmSync>) => rmSyncMock(...args) };
});

const { rmSync } = await import('node:fs');
const { AssetSyncService } = await import('../../src/asset-sync.js');
import type { AssetCatalogRow } from '../../src/asset-sync.js';
const { McpFacade } = await import('../../src/mcp-facade.js');
const { FixedClock } = await import('../../src/clock.js');

function fakeCatalogPort() {
  return { putAsset: vi.fn(), deleteAsset: vi.fn(), listAssets: vi.fn(() => []) };
}

function makeService(dir: string) {
  return new AssetSyncService({
    workRoot: dir, globalRoot: join(dir, 'global'),
    selfBind: { host: '127.0.0.1', port: 1 }, clock: new FixedClock(new Date('2026-01-01T00:00:00Z')),
    catalog: fakeCatalogPort(), probe: { probe: vi.fn() }, egressAllowlist: [],
  });
}

function forwardToReal() {
  rmSyncMock.mockClear();
  // rmSyncMock's own default implementation (set once inside the vi.mock factory, above) already
  // forwards to the real fs.rmSync — just clearing any per-test override restores it.
}

beforeEach(() => {
  forwardToReal();
});

describe('AssetSyncService.deleteWorkflowTree — the ASSET_CLEANUP_INCOMPLETE branch is real and tested (#166 decision 1)', () => {
  it('a non-ENOENT/ENAMETOOLONG fs error (e.g. EACCES) answers removed:true with warning:"ASSET_CLEANUP_INCOMPLETE" — never a thrown error', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-166-cleanup-incomplete-'));
    rmSyncMock.mockImplementationOnce(() => {
      throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const svc = makeService(dir);
      const result = svc.deleteWorkflowTree('some-workflow');
      expect(result).toEqual({ removed: true, warning: 'ASSET_CLEANUP_INCOMPLETE' });
      expect(errSpy).toHaveBeenCalled();
      expect(String(errSpy.mock.calls[0]?.[0])).toContain('EACCES');
    } finally {
      errSpy.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('McpFacade.workflowDeregister — forwards deleteWorkflowTree\'s warning onto the wire result (#166 decision 1)', () => {
  it('a non-ENOENT/ENAMETOOLONG asset-tree cleanup error still reports removed:true, with result.warning:"ASSET_CLEANUP_INCOMPLETE"', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-166-cleanup-incomplete-facade-'));
    rmSyncMock.mockImplementationOnce(() => {
      throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const facade = new McpFacade({
        runManager: { catalog: { deregister: vi.fn(async () => ({ removed: true, claimedTriggers: [] as string[] })) } },
        assetSync: makeService(dir),
        schedulerClaims: { release: vi.fn(), disable: vi.fn(), claimedIdsFor: () => [] } as never,
        webhookClaims: { release: vi.fn(), disable: vi.fn(), claimedIdsFor: () => [] } as never,
      } as never);

      const result = await facade.workflowDeregister({ name: 'some-workflow' }, { kind: 'auth-disabled' } as never);

      expect(result.status).toBe('completed');
      expect(result.error).toBeUndefined();
      const r = result.result as { removed?: boolean; warning?: string } | undefined;
      expect(r?.removed).toBe(true);
      expect(r?.warning).toBe('ASSET_CLEANUP_INCOMPLETE');
    } finally {
      errSpy.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('McpFacade.workspaceDelete — forwards AssetSyncService.delete()\'s warning onto the wire result (#166 decision 1)', () => {
  it('a non-ENOENT/ENAMETOOLONG on-disk cleanup error (e.g. EACCES) still reports deleted:true, with result.warning:"ASSET_CLEANUP_INCOMPLETE"', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-166-cleanup-incomplete-wsdelete-'));
    // This test's own catalog port (NOT the shared `fakeCatalogPort()` above, whose `deleteAsset`
    // is an unconfigured `vi.fn()` answering `undefined` — `delete()` must see a REAL `{deleted:
    // true}` to ever reach the on-disk cleanup step this test is exercising).
    const assetRows: AssetCatalogRow[] = [];
    const svc = new AssetSyncService({
      workRoot: dir, globalRoot: join(dir, 'global'),
      selfBind: { host: '127.0.0.1', port: 1 }, clock: new FixedClock(new Date('2026-01-01T00:00:00Z')),
      catalog: { putAsset: vi.fn((r: AssetCatalogRow) => { assetRows.push(r); }), deleteAsset: vi.fn(() => ({ deleted: true })), listAssets: vi.fn(() => assetRows) },
      probe: { probe: vi.fn() }, egressAllowlist: [],
    });
    // Materialize a real skill tree first, same as the happy-path AssetSyncService.delete() tests
    // elsewhere in this suite — `rmSyncMock` is only overridden for the one call inside delete().
    await svc.push({ scope: 'workflow', workflow: 'wf-a', kind: 'skill', name: 'reviewer', files: [{ path: 'SKILL.md', contentB64: Buffer.from('x').toString('base64') }] });
    rmSyncMock.mockImplementationOnce(() => {
      throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const facade = new McpFacade({
        runManager: { catalog: { exists: vi.fn(async () => true) } },
        assetSync: svc,
      } as never);

      const result = await facade.workspaceDelete({ workflow: 'wf-a', kind: 'skill', name: 'reviewer' }, { kind: 'auth-disabled' } as never) as Record<string, unknown>;

      expect(result['status']).toBe('completed');
      expect(result['error']).toBeUndefined();
      const r = result['result'] as { deleted?: boolean; warning?: string } | undefined;
      expect(r?.deleted).toBe(true);
      expect(r?.warning).toBe('ASSET_CLEANUP_INCOMPLETE');
    } finally {
      errSpy.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
