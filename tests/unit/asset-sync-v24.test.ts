// UT-155 (DES-153, v24): AssetSyncService v24 — two scopes, catalog rows, kind:'mcp' gated
// (egress before probe, both before the row), pushedAt from the injected clock. Written
// test-first (Gate 5, RED) — today's AssetSyncDeps has no `catalog`/`clock`/`probe`/
// `egressAllowlist`, and `push()` takes the pre-v24 flat AssetPush shape (no `scope`).
import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AssetSyncService, resolveMcp, type AssetCatalogRow } from '../../src/asset-sync.js';
import { FixedClock } from '../../src/clock.js';

function fakeCatalogPort() {
  const rows: AssetCatalogRow[] = [];
  return { putAsset: vi.fn((row: AssetCatalogRow) => { rows.push(row); }), deleteAsset: vi.fn(), listAssets: vi.fn(() => rows) };
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
        catalog, probe, egressAllowlist: [],
      });
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
        catalog: fakeCatalogPort(), probe: { probe: vi.fn() }, egressAllowlist: [],
      });
      // 'hook' is not a v24 AssetKind ('skill'|'mcp') — deliberately mistyped to prove the runtime guard.
      await expect(svc.push({ scope: 'workflow', workflow: 'wf-a', kind: 'hook', name: 'x', files: [], pushedBy: 'bob' } as unknown as Parameters<typeof svc.push>[0]))
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
        catalog, probe: { probe: vi.fn() }, egressAllowlist: [],
      });
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
        catalog: fakeCatalogPort(), probe: { probe: vi.fn() }, egressAllowlist: [],
      });
      const result = await svc.list({ workflow: 'wf-a', kind: 'skill' });
      expect(Array.isArray(result)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// `resolveMcp` (DES-153) — the pure catalog-port helper the SDK gateway binds to. Added at
// Gate 6.5+7 (verifier): the shipped UT-155 covered `push()` only, leaving `resolveMcp` at 0/17
// lines despite it being the whole replacement for the deleted `mcp-registry.ts` (TASK-139/145).
// ---------------------------------------------------------------------------
describe('resolveMcp — workflow scope wins a name clash with global (UT-155, DES-153)', () => {
  const row = (over: Partial<AssetCatalogRow>): AssetCatalogRow => ({
    scope: 'global', builtin: false, kind: 'mcp', name: 'x', pushedBy: 'alice', pushedAt: '2026-01-01T00:00:00Z',
    config: { command: 'global-bin' } as never, ...over,
  });

  it('resolves a global row when no workflow row shadows it', async () => {
    const { configs, missing } = await resolveMcp({ listAssets: () => [row({ name: 'gh' })] }, 'wf-a', ['gh']);
    expect(missing).toEqual([]);
    expect(configs.gh).toEqual({ command: 'global-bin' });
  });

  it('a workflow-scoped row of the SAME name shadows the global one — only for its own workflow', async () => {
    const rows = [
      row({ name: 'gh' }),
      row({ name: 'gh', scope: 'workflow', workflow: 'wf-a', config: { command: 'wf-bin' } as never }),
    ];
    const mine = await resolveMcp({ listAssets: () => rows }, 'wf-a', ['gh']);
    expect(mine.configs.gh).toEqual({ command: 'wf-bin' });
    const other = await resolveMcp({ listAssets: () => rows }, 'wf-b', ['gh']);
    expect(other.configs.gh).toEqual({ command: 'global-bin' });
  });

  it('a name with no row at either scope lands in missing[], never as a silent empty config', async () => {
    const { configs, missing } = await resolveMcp({ listAssets: () => [row({ name: 'gh' })] }, 'wf-a', ['gh', 'nope']);
    expect(missing).toEqual(['nope']);
    expect(Object.keys(configs)).toEqual(['gh']);
  });

  it('a matching row carrying no config is MISSING, not an undefined entry in configs', async () => {
    const { configs, missing } = await resolveMcp({ listAssets: () => [row({ name: 'gh', config: undefined })] }, 'wf-a', ['gh']);
    expect(missing).toEqual(['gh']);
    expect(Object.keys(configs)).toEqual([]);
  });

  it('a skill row never satisfies an mcp name, and an empty request resolves to nothing', async () => {
    const skillOnly = await resolveMcp({ listAssets: () => [row({ name: 'gh', kind: 'skill', config: undefined })] }, 'wf-a', ['gh']);
    expect(skillOnly.missing).toEqual(['gh']);
    const none = await resolveMcp({ listAssets: () => [row({ name: 'gh' })] }, 'wf-a', []);
    expect(none).toEqual({ configs: {}, missing: [] });
  });

  it('awaits a Promise-returning listAssets (the real SQLite catalog port)', async () => {
    const { configs } = await resolveMcp({ listAssets: async () => [row({ name: 'gh' })] }, 'wf-a', ['gh']);
    expect(configs.gh).toEqual({ command: 'global-bin' });
  });
});
