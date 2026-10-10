// Issue #166 decision 1: `workflow_deregister` on a legacy workflow whose name predates the
// length limits (registered before #154/#166, or a byte-oversized-but-character-limit-compliant
// name — see workflow-name-validation.test.ts/workflow-catalog.test.ts for that half) deleted the
// catalog's DB row FIRST, then called `AssetSyncService.deleteWorkflowTree(name)`, which
// `rmSync(join(assetRoot, name), {recursive:true, force:true})`s the on-disk asset tree —
// `force:true` only ever suppresses `ENOENT`, never `ENAMETOOLONG` (a name long enough to exceed
// NAME_MAX, 255 bytes on every target filesystem, blows up the `lstat` the removal starts with
// regardless of whether anything is actually there). The real fs error — carrying the engine's
// absolute host path (`unlink '/home/rwe/.local/share/rwe-data/assets/<name>'`) — propagated
// straight out of a call whose DB-side delete had ALREADY SUCCEEDED, so the caller saw
// INTERNAL_ERROR for what was, from the catalog's point of view, a completed deregister.
//
// Owner decision 1 (#166): ENOENT/ENAMETOOLONG while removing a deregistered workflow's on-disk
// tree means "nothing on disk to remove" — the call must still report success. ANY OTHER fs error
// must likewise never make a completed catalog delete look like a failure to the caller (the DB
// row is already gone by the time this runs — there is nothing left to roll back): it is logged
// server-side and surfaced as a warning on the otherwise-successful response, never a thrown
// INTERNAL_ERROR.
//
// RED before the fix: `deleteWorkflowTree` with a >255-byte name throws (uncaught ENAMETOOLONG).
//
// Mock policy (unit): a REAL AssetSyncService on a real tmp dir — the ENAMETOOLONG this test
// needs is a genuine kernel error (NAME_MAX), not something worth mocking; a fake catalog port
// (same tier as asset-sync-v24.test.ts / asset-sync-workflow-name-escape.test.ts).
import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AssetSyncService, type AssetCatalogRow } from '../../src/asset-sync.js';
import { FixedClock } from '../../src/clock.js';

function fakeCatalogPort() {
  const rows: AssetCatalogRow[] = [];
  return { putAsset: vi.fn((row: AssetCatalogRow) => { rows.push(row); }), deleteAsset: vi.fn(), listAssets: vi.fn(() => rows) };
}

function makeService(dir: string) {
  return new AssetSyncService({
    workRoot: dir, globalRoot: join(dir, 'global'),
    selfBind: { host: '127.0.0.1', port: 1 }, clock: new FixedClock(new Date('2026-01-01T00:00:00Z')),
    catalog: fakeCatalogPort(), probe: { probe: vi.fn() }, egressAllowlist: [],
  });
}

describe('AssetSyncService.deleteWorkflowTree — ENAMETOOLONG/ENOENT tolerance (#166 decision 1)', () => {
  it('an ASCII legacy name past NAME_MAX (255 bytes) never throws — reports removed:true, no asset dir ever existed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-166-del-ascii-'));
    try {
      const svc = makeService(dir);
      const name = 'edge-01-long-' + 'x'.repeat(290); // ~303 bytes — the issue's own ASCII repro
      expect(() => svc.deleteWorkflowTree(name)).not.toThrow();
      const result = svc.deleteWorkflowTree(name);
      expect(result).toMatchObject({ removed: true });
      expect(result.warning).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a CJK legacy name past NAME_MAX (character-limit-compliant, byte-oversized) never throws — removed:true', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-166-del-cjk-'));
    try {
      const svc = makeService(dir);
      const name = 'ver-01-u-' + '名'.repeat(119); // 128 chars, ~366 bytes
      expect(() => svc.deleteWorkflowTree(name)).not.toThrow();
      expect(svc.deleteWorkflowTree(name)).toMatchObject({ removed: true });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('an ordinary name with a REAL on-disk asset tree is still actually removed (no false "nothing to remove")', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-166-del-real-'));
    try {
      const svc = makeService(dir);
      const treeDir = join(dir, 'ordinary-wf', 'skill', 'declared-skill');
      mkdirSync(treeDir, { recursive: true });
      writeFileSync(join(treeDir, 'SKILL.md'), '# x');
      expect(existsSync(treeDir)).toBe(true);
      const result = svc.deleteWorkflowTree('ordinary-wf');
      expect(result).toEqual({ removed: true });
      expect(existsSync(join(dir, 'ordinary-wf'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a name with no asset tree at all still reports removed:true (the ENOENT case, unchanged from before)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-166-del-none-'));
    try {
      const svc = makeService(dir);
      expect(svc.deleteWorkflowTree('never-pushed-anything')).toEqual({ removed: true });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('an escaping/invalid workflow string is still refused outright (removed:false) — this fix does not loosen the existing escape guard', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-166-del-escape-'));
    try {
      const svc = makeService(dir);
      expect(svc.deleteWorkflowTree('../../../../tmp/evil')).toEqual({ removed: false });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Round-3 reverify (medium): a legacy `RWE-*`/`rwe-*`-named workflow — valid at registration
  // before the #154 B4 follow-up made the reserved-prefix check case-insensitive, and whose
  // pushed skill tree was itself materialized through the prefix-blind `isValidBareName` — used to
  // get `{removed:false}` from the plain `lexicalVerdict('asset-tree', workflow)` check
  // (RESERVED_PREFIX is a lexical rejection too), silently orphaning the tree forever: the DB row
  // is already gone by the time this runs, the freed name can't be re-registered to retry, and
  // `workspace_delete` needs `catalog.exists`, which is also now false. This mirrors the tolerance
  // `_skillRootLenient` already had for `delete()` (round 2) — `deleteWorkflowTree` must have it
  // too.
  it('a legacy RESERVED_PREFIX (RWE-x) workflow name with a real on-disk asset tree is fully removed — the reserved prefix is a registration-time policy, not a cleanup-site refusal', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-166-del-reserved-prefix-'));
    try {
      const svc = makeService(dir);
      const treeDir = join(dir, 'RWE-x', 'skill', 'declared-skill');
      mkdirSync(treeDir, { recursive: true });
      writeFileSync(join(treeDir, 'SKILL.md'), '# x');
      expect(existsSync(treeDir)).toBe(true);
      const result = svc.deleteWorkflowTree('RWE-x');
      expect(result).toEqual({ removed: true });
      expect(existsSync(join(dir, 'RWE-x'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Round-3 reverify (low): `lexicalVerdict` drops a bare `.` PATH SEGMENT before deciding, so a
  // workflow NAME of EXACTLY `.` comes back `kind:'ok'` with an EMPTY segment list — joined as
  // `join(workRoot, '.')`, which resolves to `workRoot` itself. A legacy `.`-named catalog row
  // (only reachable from before the #154 B4 name-validation fix existed) would therefore wipe
  // EVERY workflow's asset tree, not just its own. `..` is already caught by `lexicalVerdict`'s
  // own ESCAPE check (segments.some(s => s === '..')) — asserted here too as a belt-and-braces
  // regression guard on the same literal-name family.
  it('"." and ".." are refused outright (removed:false) and never touch any OTHER workflow\'s tree, even though "." alone is otherwise lexically "ok"', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-166-del-dot-'));
    try {
      const svc = makeService(dir);
      const siblingDir = join(dir, 'other-workflow', 'skill', 'declared-skill');
      mkdirSync(siblingDir, { recursive: true });
      writeFileSync(join(siblingDir, 'SKILL.md'), '# x');

      expect(svc.deleteWorkflowTree('.')).toEqual({ removed: false });
      expect(existsSync(siblingDir)).toBe(true);
      expect(existsSync(dir)).toBe(true);

      expect(svc.deleteWorkflowTree('..')).toEqual({ removed: false });
      expect(existsSync(siblingDir)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
