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

  // Round-3 reverify (low): the LENIENT pre-check this file's own RWE-prefix test (above) added
  // must not be LESS STRICT than the STRICT `_skillRoot()`/`isValidBareName` it replaced on any
  // OTHER axis. `isValidBareName` explicitly refuses the literal `.`/`..` (path-verdict.ts:148),
  // but `lexicalVerdict` — which the lenient check is built on — drops a bare `.` PATH SEGMENT
  // before deciding, so a workflow NAME of exactly `.` comes back `kind:'ok'` with an EMPTY
  // segment list and resolves (pre-fix) to `<workRoot>/skill/<name>` — INSIDE a real sibling
  // workflow literally named `skill`, not a no-op. Refused here BEFORE any catalog call, same
  // convention as the escape-string case just above.
  it('workflow:"." on delete is refused INVALID_NAME BEFORE any catalog call — the lenient pre-check is not less strict than the old one on "."', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-166-delete-legacy-dot-'));
    try {
      const { svc, catalog } = makeServiceWithCatalog(dir, true);
      const siblingSkillDir = join(dir, 'skill', 'x');
      mkdirSync(siblingSkillDir, { recursive: true });
      writeFileSync(join(siblingSkillDir, 'SKILL.md'), '# a real sibling workflow literally named "skill"');

      let threw: unknown;
      try {
        await svc.delete({ scope: 'workflow', workflow: '.', kind: 'skill', name: 'x' });
      } catch (err) {
        threw = err;
      }
      expect((threw as { code?: string } | undefined)?.code).toBe('INVALID_NAME');
      expect(catalog.deleteAsset).not.toHaveBeenCalled();
      expect(existsSync(siblingSkillDir)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Final reverify: a drive-letter-shaped legacy workflow name (C:foo) is registerable
  // (isValidBareName admits it) and is a single POSIX segment — its skill tree must be deletable.
  it('a drive-letter-shaped workflow name (C:foo) is deletable — ABSOLUTE is not a containment risk for a single POSIX segment', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-166-delete-drive-'));
    try {
      const svc = makeService(dir, true);
      const skillDir = join(dir, 'C:foo', 'skill', 'myskill');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, 'SKILL.md'), '# myskill');
      const result = await svc.delete({ scope: 'workflow', workflow: 'C:foo', kind: 'skill', name: 'myskill' });
      expect(result.deleted).toBe(true);
      expect(existsSync(skillDir)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Final reverify (pre-existing, low): an ASSET name of exactly "." passed lexicalVerdict (the
  // bare "." segment is dropped), so delete({name:'.'}) resolved to <assets>/<wf>/skill and
  // removed EVERY skill of that workflow. A single-segment asset name must be refused on delete
  // (pre-commit) and on push.
  it('asset name "." / ".." is refused INVALID_NAME before any catalog call and touches nothing; push refuses "." too', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-166-delete-dot-asset-'));
    try {
      const svc = makeService(dir, true);
      const skillDir = join(dir, 'wf', 'skill', 'keep');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, 'SKILL.md'), '# keep');
      for (const name of ['.', '..']) {
        let code: string | undefined;
        try { await svc.delete({ scope: 'workflow', workflow: 'wf', kind: 'skill', name }); }
        catch (err) { code = (err as { code?: string }).code; }
        expect(code).toBe('INVALID_NAME');
        expect(existsSync(skillDir)).toBe(true);
      }
      const pushed = await svc.push({ scope: 'workflow', workflow: 'wf', kind: 'skill', name: '.', files: [{ path: 'SKILL.md', contentB64: Buffer.from('# x').toString('base64') }] } as never);
      expect((pushed as { error?: string }).error).toBeDefined();
      expect(existsSync(skillDir)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // #166 tail (tester's 2026-10-10 reverify comment, low item 1, owner decision): push's `.`
  // asset-name refusal used to be a bare `{error:'INVALID_ARGUMENT'}` with NO `detail` — mismatched
  // against delete's `INVALID_NAME` for the identical shape, and with no reason attached at all.
  // Both must now return INVALID_NAME, and push's must carry a `detail.message` stating why — the
  // code-only shape alone is not enough: `mcp-facade.ts`'s `workspacePush` only builds a reasoned
  // caller-facing message when `detail` is present (see that method's own comment).
  //
  // RED before the fix: `pushed.error === 'INVALID_ARGUMENT'` and `pushed.detail === undefined`.
  it('push({name:"."}) returns INVALID_NAME WITH a detail.message stating why (#166 tail, low item 1)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-166-push-dot-detail-'));
    try {
      const svc = makeService(dir, true);
      const pushed = await svc.push({ scope: 'workflow', workflow: 'wf', kind: 'skill', name: '.', files: [{ path: 'SKILL.md', contentB64: Buffer.from('# x').toString('base64') }] } as never) as { error?: string; detail?: { message?: string } };
      expect(pushed.error).toBe('INVALID_NAME');
      expect(pushed.detail?.message).toBeTruthy();
      expect(pushed.detail?.message).toMatch(/not valid asset names|single path segment/);
      expect(existsSync(join(dir, 'wf'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

