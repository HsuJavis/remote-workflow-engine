// issue #103(a): AssetSyncService.resolveDeclaredAssets — the SAME resolver dispatch uses
// (claude-agent-sdk-client.ts's materializeAssets: workflow-scoped skill tree then global, and
// asset-sync.ts's own resolveMcp: workflow-scoped mcp row then global) — reused here so
// registration-time warnings and admission-time refusals can never disagree with what dispatch
// actually materializes.
// Mock policy (unit): a real temp dir for the skill trees (existsSync is genuine fs, mirroring
// materializeAssets exactly); the mcp catalog is a fake in-memory port (same fake shape
// asset-sync-v24.test.ts already uses).
import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AssetSyncService, type AssetCatalogRow } from '../../src/asset-sync.js';
import { FixedClock } from '../../src/clock.js';
import { FakeMcpProbe } from '../../src/mcp-probe.js';

function fakeCatalogPort(rows: AssetCatalogRow[] = []) {
  return { putAsset: vi.fn((row: AssetCatalogRow) => { rows.push(row); }), deleteAsset: vi.fn(), listAssets: vi.fn(() => rows) };
}

function makeSvc(dir: string, rows: AssetCatalogRow[] = []) {
  return new AssetSyncService({
    workRoot: join(dir, 'assets'), globalRoot: join(dir, 'global-assets'),
    selfBind: { host: '127.0.0.1', port: 1 }, clock: new FixedClock(new Date('2026-01-01T00:00:00Z')),
    catalog: fakeCatalogPort(rows), probe: new FakeMcpProbe(true), egressAllowlist: [],
  });
}

describe('AssetSyncService.resolveDeclaredAssets (issue #103a)', () => {
  it('a declared skill present in the WORKFLOW scope tree is not missing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-declared-assets-'));
    try {
      mkdirSync(join(dir, 'assets', 'wf-a', 'skill', 'reviewer'), { recursive: true });
      const svc = makeSvc(dir);
      const r = await svc.resolveDeclaredAssets('wf-a', { skills: ['reviewer'], mcp: [] });
      expect(r.missingSkills).toEqual([]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('a declared skill present only in the GLOBAL scope tree is not missing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-declared-assets-'));
    try {
      mkdirSync(join(dir, 'global-assets', 'skill', 'shared'), { recursive: true });
      const svc = makeSvc(dir);
      const r = await svc.resolveDeclaredAssets('wf-a', { skills: ['shared'], mcp: [] });
      expect(r.missingSkills).toEqual([]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('a declared skill present in NEITHER scope is missing, by name', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-declared-assets-'));
    try {
      const svc = makeSvc(dir);
      const r = await svc.resolveDeclaredAssets('wf-a', { skills: ['ghost'], mcp: [] });
      expect(r.missingSkills).toEqual(['ghost']);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('a declared mcp name provisioned in the WORKFLOW scope is not missing (via the SAME resolveMcp resolver)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-declared-assets-'));
    try {
      const rows: AssetCatalogRow[] = [{ scope: 'workflow', workflow: 'wf-a', builtin: false, kind: 'mcp', name: 'echo-mcp', pushedBy: 'bob', pushedAt: '2026-01-01T00:00:00Z', config: { type: 'http', url: 'https://example.com' } }];
      const svc = makeSvc(dir, rows);
      const r = await svc.resolveDeclaredAssets('wf-a', { skills: [], mcp: ['echo-mcp'] });
      expect(r.missingMcp).toEqual([]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('a declared mcp name provisioned for a DIFFERENT workflow is missing (workflow scope is not global)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-declared-assets-'));
    try {
      const rows: AssetCatalogRow[] = [{ scope: 'workflow', workflow: 'wf-other', builtin: false, kind: 'mcp', name: 'echo-mcp', pushedBy: 'bob', pushedAt: '2026-01-01T00:00:00Z', config: { type: 'http', url: 'https://example.com' } }];
      const svc = makeSvc(dir, rows);
      const r = await svc.resolveDeclaredAssets('wf-a', { skills: [], mcp: ['echo-mcp'] });
      expect(r.missingMcp).toEqual(['echo-mcp']);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('a declared mcp name provisioned in the GLOBAL scope is not missing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-declared-assets-'));
    try {
      const rows: AssetCatalogRow[] = [{ scope: 'global', builtin: true, kind: 'mcp', name: 'shared-mcp', pushedBy: 'admin', pushedAt: '2026-01-01T00:00:00Z', config: { type: 'http', url: 'https://example.com' } }];
      const svc = makeSvc(dir, rows);
      const r = await svc.resolveDeclaredAssets('wf-a', { skills: [], mcp: ['shared-mcp'] });
      expect(r.missingMcp).toEqual([]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('empty declared sets resolve to empty missing sets, no catalog/fs calls needed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-declared-assets-'));
    try {
      const svc = makeSvc(dir);
      const r = await svc.resolveDeclaredAssets('wf-a', { skills: [], mcp: [] });
      expect(r).toEqual({ missingSkills: [], missingMcp: [] });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
