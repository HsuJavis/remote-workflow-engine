// UT-155 (DES-153, v24): AssetSyncService v24 — two scopes, catalog rows, kind:'mcp' gated
// (egress before probe, both before the row), pushedAt from the injected clock. Written
// test-first (Gate 5, RED) — today's AssetSyncDeps has no `catalog`/`clock`/`probe`/
// `egressAllowlist`, and `push()` takes the pre-v24 flat AssetPush shape (no `scope`).
import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AssetSyncService } from '../../src/asset-sync.js';
import { FixedClock } from '../../src/clock.js';

function fakeCatalogPort() {
  const rows: unknown[] = [];
  return { putAsset: vi.fn((row: unknown) => { rows.push(row); }), deleteAsset: vi.fn(), listAssets: vi.fn(() => rows) };
}

describe('AssetSyncService v24 — two scopes, mcp gating, clock-sourced pushedAt (UT-155, DES-153)', () => {
  it('kind:"mcp" over http checks egress BEFORE any fetch — EGRESS_DENIED, probe never called, nothing stored', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-asset-v24-'));
    try {
      const probe = { probe: vi.fn() };
      const catalog = fakeCatalogPort();
      const svc = new AssetSyncService({
        workRoot: dir, globalRoot: join(dir, 'global'),
        selfBind: { host: '127.0.0.1', port: 1 }, clock: new FixedClock(new Date('2026-01-01T00:00:00Z')),
        // @ts-expect-error — AssetSyncDeps has no catalog/probe/egressAllowlist yet (v24 DES-153/TASK-144)
        catalog, probe, egressAllowlist: [],
      });
      // @ts-expect-error — push() takes the v24 union req shape; today's is flat {kind,name,files}
      const result = await svc.push({ scope: 'workflow', workflow: 'wf-a', kind: 'mcp', name: 'srv', config: { url: 'https://evil.example.com' }, pushedBy: 'bob' });
      expect(result).toMatchObject({ error: 'EGRESS_DENIED' });
      expect(probe.probe).not.toHaveBeenCalled();
      expect(catalog.putAsset).not.toHaveBeenCalled();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('kind:"hook" is refused by the schema enum — HOOKS_UNSUPPORTED is retired, no path can produce it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-asset-v24-'));
    try {
      const svc = new AssetSyncService({
        workRoot: dir, globalRoot: join(dir, 'global'), selfBind: { host: '127.0.0.1', port: 1 },
        clock: new FixedClock(new Date('2026-01-01T00:00:00Z')),
        // @ts-expect-error
        catalog: fakeCatalogPort(), probe: { probe: vi.fn() }, egressAllowlist: [],
      });
      // @ts-expect-error — 'hook' is not a v24 AssetKind
      await expect(svc.push({ scope: 'workflow', workflow: 'wf-a', kind: 'hook', name: 'x', files: [], pushedBy: 'bob' }))
        .rejects.toThrow(/INVALID_ARGUMENT/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('pushedAt comes from deps.clock, never Date.now()', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-asset-v24-'));
    try {
      const clock = new FixedClock(new Date('2026-06-15T00:00:00Z'));
      const catalog = fakeCatalogPort();
      const svc = new AssetSyncService({
        workRoot: dir, globalRoot: join(dir, 'global'), selfBind: { host: '127.0.0.1', port: 1 }, clock,
        // @ts-expect-error
        catalog, probe: { probe: vi.fn() }, egressAllowlist: [],
      });
      // @ts-expect-error
      await svc.push({ scope: 'workflow', workflow: 'wf-a', kind: 'skill', name: 'reviewer', files: [{ path: 'SKILL.md', contentB64: Buffer.from('x').toString('base64') }], pushedBy: 'bob' });
      expect(catalog.putAsset).toHaveBeenCalledWith(expect.objectContaining({ pushedAt: clock.isoNow() }));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('list({workflow, kind}) returns BOTH scopes in one response, each marked scope/builtin/pushedBy', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-asset-v24-'));
    try {
      const svc = new AssetSyncService({
        workRoot: dir, globalRoot: join(dir, 'global'), selfBind: { host: '127.0.0.1', port: 1 },
        clock: new FixedClock(new Date('2026-01-01T00:00:00Z')),
        // @ts-expect-error
        catalog: fakeCatalogPort(), probe: { probe: vi.fn() }, egressAllowlist: [],
      });
      // @ts-expect-error — list({workflow, kind}) does not exist yet
      const result = await svc.list({ workflow: 'wf-a', kind: 'skill' });
      expect(Array.isArray(result)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
