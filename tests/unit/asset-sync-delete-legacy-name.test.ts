// Independent verifier (r5-a round-3, 2026-10-10): decision-1 regression on the asset-store
// DELETE site. `#166` added a 200-UTF-8-byte ceiling to `isValidBareName` (path-verdict.ts) and
// `AssetSyncService._skillRoot()` calls it as a backstop BEFORE building the skill-tree path —
// but `delete()` calls `this._catalog.deleteAsset(req)` (the DB-side delete) FIRST and only
// afterwards resolves `_skillRoot()` to remove the tree. For a LEGACY workflow name between
// 201 and 255 UTF-8 bytes — fully valid at registration time (under the pre-#166 128-character
// limit, and under the filesystem's own 255-byte NAME_MAX) — `_skillRoot()` now THROWS
// `INVALID_NAME` on every delete, after the catalog row is already gone: exactly the "DB
// committed, then a filesystem step throws" pattern decision 1 forbids, now on this site. The
// caller is told the delete failed (an uncaught throw) even though the row is gone and the
// on-disk tree is never removed.
//
// RED before the fix: `delete()` throws `INVALID_NAME` and the skill tree survives on disk.
//
// Mock policy (unit): a REAL AssetSyncService on a real tmp dir (same tier as
// asset-sync-deregister-long-name.test.ts) — a fake catalog port whose `deleteAsset` answers
// `{deleted:true}` the way the real `WorkflowCatalog` does for a row that genuinely exists.
import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AssetSyncService, type AssetCatalogRow } from '../../src/asset-sync.js';
import { FixedClock } from '../../src/clock.js';

function fakeCatalogPort(deleted: boolean) {
  const rows: AssetCatalogRow[] = [];
  return { putAsset: vi.fn((row: AssetCatalogRow) => { rows.push(row); }), deleteAsset: vi.fn(() => ({ deleted })), listAssets: vi.fn(() => rows) };
}

function makeService(dir: string, deleted: boolean) {
  return new AssetSyncService({
    workRoot: dir, globalRoot: join(dir, 'global'),
    selfBind: { host: '127.0.0.1', port: 1 }, clock: new FixedClock(new Date('2026-01-01T00:00:00Z')),
    catalog: fakeCatalogPort(deleted), probe: { probe: vi.fn() }, egressAllowlist: [],
  });
}

function makeServiceWithCatalog(dir: string, deleted: boolean) {
  const catalog = fakeCatalogPort(deleted);
  const svc = new AssetSyncService({
    workRoot: dir, globalRoot: join(dir, 'global'),
    selfBind: { host: '127.0.0.1', port: 1 }, clock: new FixedClock(new Date('2026-01-01T00:00:00Z')),
    catalog, probe: { probe: vi.fn() }, egressAllowlist: [],
  });
  return { svc, catalog };
}

describe('AssetSyncService.delete() — a legacy byte-oversized workflow name must not regress decision 1 (#166)', () => {
  it('a 219-byte legacy workflow name (79 chars, under the 128-char limit, over the 200-byte one): the pushed skill tree is actually removed, no throw', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-166-delete-legacy-'));
    try {
      const svc = makeService(dir, true);
      const name = 'ver-01-u-' + '名'.repeat(70); // 79 chars, 219 UTF-8 bytes
      const skillDir = join(dir, name, 'skill', 'myskill');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, 'SKILL.md'), '# myskill');
      expect(existsSync(skillDir)).toBe(true);

      let result: { deleted: boolean; warning?: string } | undefined;
      let threw: unknown;
      try {
        result = await svc.delete({ scope: 'workflow', workflow: name, kind: 'skill', name: 'myskill' });
      } catch (err) {
        threw = err;
      }

      expect(threw).toBeUndefined();
      expect(result?.deleted).toBe(true);
      expect(existsSync(skillDir)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a >255-byte legacy workflow name (true NAME_MAX territory): deleted:true, no throw, no leaked path in any error', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-166-delete-legacy-long-'));
    try {
      const svc = makeService(dir, true);
      const name = 'edge-01-long-' + 'x'.repeat(290); // ~303 bytes, ASCII — the issue's own repro

      let result: { deleted: boolean; warning?: string } | undefined;
      let threw: unknown;
      try {
        result = await svc.delete({ scope: 'workflow', workflow: name, kind: 'skill', name: 'myskill' });
      } catch (err) {
        threw = err;
      }

      expect(threw).toBeUndefined();
      expect(result?.deleted).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('deleted:false (no such row) still leaves the on-disk tree alone, even for a legacy-shaped name — unchanged behaviour', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-166-delete-legacy-noop-'));
    try {
      const svc = makeService(dir, false);
      const name = 'ver-01-u-' + '名'.repeat(70);
      const skillDir = join(dir, name, 'skill', 'orphan');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, 'SKILL.md'), '# orphan');

      const result = await svc.delete({ scope: 'workflow', workflow: name, kind: 'skill', name: 'orphan' });

      expect(result.deleted).toBe(false);
      expect(existsSync(skillDir)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Advisor-caught defect (r5-a, pre-report): a legacy `RWE-*`-prefixed workflow name (registered
  // before the #154 B4 follow-up made the reserved-prefix check case-insensitive, 2026-10-09) is
  // STILL valid under `isValidBareName` (prefix-blind by design, path-verdict.ts's own comment) —
  // `_skillRoot()` happily resolved it at base. `lexicalVerdict('asset-tree', …)`, which
  // `_skillRootLenient` uses for its pre-commit check, DOES reject a reserved prefix — a strictly
  // NARROWER tolerance than `isValidBareName` on this one axis, which would make a real,
  // previously-deletable legacy skill tree undeletable through `workspace_delete` the same way the
  // byte ceiling did. The reserved-prefix rule is a REGISTRATION-time naming policy, not a
  // path-safety one; on a delete site, with the row already catalog-confirmed, it protects
  // nothing, so this pre-commit check must tolerate it (while still refusing a real escape shape).
  it('a legacy RWE-prefixed workflow name (valid under isValidBareName, which is prefix-blind by design) is still deletable — the lenient check does not newly refuse on RESERVED_PREFIX', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-166-delete-legacy-prefix-'));
    try {
      const svc = makeService(dir, true);
      const name = 'RWE-legacy-wf';
      const skillDir = join(dir, name, 'skill', 'myskill');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, 'SKILL.md'), '# myskill');
      expect(existsSync(skillDir)).toBe(true);

      let result: { deleted: boolean; warning?: string } | undefined;
      let threw: unknown;
      try {
        result = await svc.delete({ scope: 'workflow', workflow: name, kind: 'skill', name: 'myskill' });
      } catch (err) {
        threw = err;
      }

      expect(threw).toBeUndefined();
      expect(result?.deleted).toBe(true);
      expect(existsSync(skillDir)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('an escaping/invalid workflow string on delete is refused INVALID_NAME BEFORE any catalog call — this fix does not loosen the escape guard, and the refusal is pre-commit', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-166-delete-legacy-escape-'));
    try {
      const { svc, catalog } = makeServiceWithCatalog(dir, true);
      let threw: unknown;
      try {
        await svc.delete({ scope: 'workflow', workflow: '../../../../tmp/evil', kind: 'skill', name: 'x' });
      } catch (err) {
        threw = err;
      }
      expect((threw as { code?: string } | undefined)?.code).toBe('INVALID_NAME');
      // The refusal happens BEFORE `deleteAsset` — decision 1's own property applied to garbage
      // input too: nothing is committed for a string this method cannot safely join as a path.
      expect(catalog.deleteAsset).not.toHaveBeenCalled();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
