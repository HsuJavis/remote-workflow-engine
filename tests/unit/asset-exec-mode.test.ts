// Issue #105 part A (owner decision): skill asset files get a per-file optional `exec` flag,
// identical in shape to seedManifest's {path, sha256, exec?} — exec:true materializes 0o755,
// absent/false materializes 0o644. exec:true on the skill's top-level SKILL.md is refused
// INVALID_ARGUMENT (SKILL.md is never executed; the flag exists for scripts with a shebang and
// compiled CLIs, not for the skill's own manifest).
//
// Written test-first (Gate 5, RED) — today's AssetSyncService.push() writes every skill file with
// writeFileSync(abs, buf) and no mode argument at all, so every stored file lands 0644 regardless
// of what the caller asked for, and no SKILL.md guard exists.
import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AssetSyncService, type AssetCatalogRow } from '../../src/asset-sync.js';
import { FixedClock } from '../../src/clock.js';

function fakeCatalogPort() {
  const rows: AssetCatalogRow[] = [];
  return { putAsset: vi.fn((row: AssetCatalogRow) => { rows.push(row); }), deleteAsset: vi.fn(), listAssets: vi.fn(() => rows) };
}

function mode(path: string): number {
  return statSync(path).mode & 0o777;
}

describe('AssetSyncService.push() — per-file exec flag controls materialized mode (issue #105 part A)', () => {
  it('exec:true stores the file 0o755', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-asset-exec-'));
    try {
      const svc = new AssetSyncService({
        workRoot: dir, globalRoot: join(dir, 'global'), selfBind: { host: '127.0.0.1', port: 1 },
        clock: new FixedClock(new Date('2026-01-01T00:00:00Z')),
        catalog: fakeCatalogPort(), probe: { probe: vi.fn() }, egressAllowlist: [],
      });
      const result = await svc.push({
        scope: 'workflow', workflow: 'wf-a', kind: 'skill', name: 'exec-skill', pushedBy: 'bob',
        files: [
          { path: 'SKILL.md', contentB64: Buffer.from('# exec-skill').toString('base64') },
          { path: 'run.sh', contentB64: Buffer.from('#!/bin/sh\necho hi\n').toString('base64'), exec: true },
        ],
      });
      expect(result).toEqual({ stored: 'exec-skill' });
      expect(mode(join(dir, 'wf-a', 'skill', 'exec-skill', 'run.sh'))).toBe(0o755);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exec absent stores the file 0o644', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-asset-exec-'));
    try {
      const svc = new AssetSyncService({
        workRoot: dir, globalRoot: join(dir, 'global'), selfBind: { host: '127.0.0.1', port: 1 },
        clock: new FixedClock(new Date('2026-01-01T00:00:00Z')),
        catalog: fakeCatalogPort(), probe: { probe: vi.fn() }, egressAllowlist: [],
      });
      await svc.push({
        scope: 'workflow', workflow: 'wf-a', kind: 'skill', name: 'plain-skill', pushedBy: 'bob',
        files: [{ path: 'SKILL.md', contentB64: Buffer.from('# plain-skill').toString('base64') }],
      });
      expect(mode(join(dir, 'wf-a', 'skill', 'plain-skill', 'SKILL.md'))).toBe(0o644);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exec:false explicitly stores the file 0o644 (same as absent)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-asset-exec-'));
    try {
      const svc = new AssetSyncService({
        workRoot: dir, globalRoot: join(dir, 'global'), selfBind: { host: '127.0.0.1', port: 1 },
        clock: new FixedClock(new Date('2026-01-01T00:00:00Z')),
        catalog: fakeCatalogPort(), probe: { probe: vi.fn() }, egressAllowlist: [],
      });
      await svc.push({
        scope: 'workflow', workflow: 'wf-a', kind: 'skill', name: 'false-skill', pushedBy: 'bob',
        files: [
          { path: 'SKILL.md', contentB64: Buffer.from('# false-skill').toString('base64') },
          { path: 'notes.txt', contentB64: Buffer.from('hi').toString('base64'), exec: false },
        ],
      });
      expect(mode(join(dir, 'wf-a', 'skill', 'false-skill', 'notes.txt'))).toBe(0o644);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exec:true on the skill\'s top-level SKILL.md is refused INVALID_ARGUMENT, before any file is written', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-asset-exec-'));
    try {
      const svc = new AssetSyncService({
        workRoot: dir, globalRoot: join(dir, 'global'), selfBind: { host: '127.0.0.1', port: 1 },
        clock: new FixedClock(new Date('2026-01-01T00:00:00Z')),
        catalog: fakeCatalogPort(), probe: { probe: vi.fn() }, egressAllowlist: [],
      });
      await expect(svc.push({
        scope: 'workflow', workflow: 'wf-a', kind: 'skill', name: 'bad-skill', pushedBy: 'bob',
        files: [
          { path: 'SKILL.md', contentB64: Buffer.from('# bad-skill').toString('base64'), exec: true },
          { path: 'run.sh', contentB64: Buffer.from('#!/bin/sh\n').toString('base64'), exec: true },
        ],
      })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
      const { existsSync } = await import('node:fs');
      expect(existsSync(join(dir, 'wf-a', 'skill', 'bad-skill'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
