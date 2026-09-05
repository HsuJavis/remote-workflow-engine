// IT-131 (v24 Gate 8 AF-1 / TASK-160, ARCH-098 + ARCH-102, adjudication (v24) #7 G-1): the boot
// migration ARCH-098 specified and nobody wrote, plus the ORDERING that makes it a data-safety
// property rather than a convenience.
//
// The hazard this file exists to make impossible: a pre-v24 deployment keeps its GLOBAL asset tree
// at `<assetRoot>/<kind>/<name>` (e.g. `<workRoot>/assets/skill/my-skill/`), and v24's new sweep
// (`workspace-gc.ts:66-88`, wired unconditionally at `server.ts:847`) deletes EVERY child of
// `<assetRoot>/` whose name is not a live workflow — and `skill` is not a live workflow. On the
// first sweep after an upgrade with `workspaceTtlMs > 0`, the operator's global skills are gone,
// and every previously provisioned MCP config resolves to `missing` with no error (`resolveMcp`
// reads only `catalog.assets`). So the assertion below is not "the migration ran": it is "the
// sweep RAN and the legacy tree survived it", which is only true if the migration got there first.
//
// The `mcp_provisions` half reads the ON-DISK pre-v24 database (`<workRoot>/mcp-registry.db`,
// pre-v24 `server.ts:1362`). `grep -rn "mcp_provisions" src/` is empty ONLY because v24 deleted
// `mcp-registry.ts`; a pre-v24 db on disk still has the table, and that difference is the whole
// risk. This fixture therefore builds the real pre-v24 table by hand.
//
// Mock policy (integration, DES-119): a real `createServer()` over a real work root and real
// SQLite. The oracle is deliberately BLACK-BOX — raw SELECTs against `catalog.db` and the
// filesystem, never an import of the migration function — so a missing migration fails these
// tests behaviourally rather than at import time.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

let server: Server;
let tmpDir: string;

const SKILL = 'legacy-global-skill';
const MCP = 'legacy-global-mcp';
const MCP_CONFIG = { type: 'http', url: 'https://legacy.example.test/mcp' };
const PROVISIONED_AT = '2026-01-02T03:04:05.000Z';

interface AssetRow { workflow: string; kind: string; name: string; pushedBy: string | null; pushedAt: string; config: string | null }

function assetRows(root: string): AssetRow[] {
  const db = new Database(join(root, 'catalog.db'), { readonly: true });
  try {
    return db.prepare('SELECT workflow, kind, name, pushedBy, pushedAt, config FROM assets ORDER BY workflow, kind, name').all() as AssetRow[];
  } finally {
    db.close();
  }
}

/** The pre-v24 on-disk state: a global skill tree under `<assetRoot>/skill/`, and the separate
 *  `mcp-registry.db` file with its `mcp_provisions` table (schema copied verbatim from the deleted
 *  `src/mcp-registry.ts`, recovered with `git show <sha>^:src/mcp-registry.ts`). */
function seedPreV24Deployment(root: string): void {
  mkdirSync(join(root, 'assets', 'skill', SKILL), { recursive: true });
  writeFileSync(join(root, 'assets', 'skill', SKILL, 'SKILL.md'), '# legacy skill body\n');
  const db = new Database(join(root, 'mcp-registry.db'));
  db.exec(`
    CREATE TABLE IF NOT EXISTS mcp_provisions (
      name TEXT PRIMARY KEY, kind TEXT NOT NULL, config TEXT NOT NULL,
      healthy INTEGER NOT NULL, provisionedAt TEXT NOT NULL);
  `);
  db.prepare('INSERT INTO mcp_provisions (name, kind, config, healthy, provisionedAt) VALUES (?, ?, ?, 1, ?)')
    .run(MCP, 'http', JSON.stringify(MCP_CONFIG), PROVISIONED_AT);
  db.close();
}

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-it131-'));
  seedPreV24Deployment(tmpDir);
  // `workspaceTtlMs > 0` is the exact precondition AF-1 identified: it is what arms the destructive
  // asset-tree branch of the sweep (`server.ts:836-849`). 15 ms => the sweep interval is 15 ms.
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir, workspaceTtlMs: 15 });
  // Let several sweeps run. Without the migration ordering, the FIRST of them deletes the tree.
  await new Promise((r) => setTimeout(r, 200));
});
afterAll(async () => { await server?.close(); rmSync(tmpDir, { recursive: true, force: true }); });

describe('the pre-v24 global asset tree survives the v24 GC sweep (IT-131, AF-1, TASK-160)', () => {
  it('THE ORDERING: after real sweeps have run, the legacy skill is still on disk — moved out of the swept tree', () => {
    const moved = join(tmpDir, '_global_assets', 'skill', SKILL, 'SKILL.md');
    expect(existsSync(moved), 'the pre-v24 global skill was destroyed by the GC sweep (or never migrated)').toBe(true);
    expect(readFileSync(moved, 'utf-8')).toBe('# legacy skill body\n');
  });

  it('the legacy tree no longer sits inside the swept `<assetRoot>/` — it was moved, not copied', () => {
    // Both halves, deliberately: "absent from the swept tree" alone is ALSO true when the sweep
    // simply deleted it, which is the defect. The pair is only true for a move.
    expect(existsSync(join(tmpDir, '_global_assets', 'skill', SKILL, 'SKILL.md'))).toBe(true);
    expect(existsSync(join(tmpDir, 'assets', 'skill'))).toBe(false);
  });

  it('the legacy skill resolves as a v24 global row: workflow=\'\', pushedBy=\'legacy\'', () => {
    const row = assetRows(tmpDir).find((r) => r.kind === 'skill' && r.name === SKILL);
    expect(row, 'no assets row was written for the pre-v24 global skill').toBeDefined();
    expect(row!.workflow).toBe('');
    expect(row!.pushedBy).toBe('legacy');
  });

  it('the on-disk `mcp_provisions` row is migrated with its config (the table src/ no longer mentions)', () => {
    const row = assetRows(tmpDir).find((r) => r.kind === 'mcp' && r.name === MCP);
    expect(row, 'no assets row was written for the pre-v24 mcp_provisions row').toBeDefined();
    expect(row!.workflow).toBe('');
    expect(row!.pushedBy).toBe('legacy');
    expect(JSON.parse(row!.config ?? 'null')).toEqual(MCP_CONFIG);
    expect(row!.pushedAt).toBe(PROVISIONED_AT); // the original provisioning time, not "now"
  });
});

describe('the migration is idempotent and does not resurrect (IT-131, AF-1, TASK-160)', () => {
  it('a SECOND boot over the same work root adds no duplicate rows and does not throw', async () => {
    const before = assetRows(tmpDir);
    await server.close();
    server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir, workspaceTtlMs: 15 });
    await new Promise((r) => setTimeout(r, 200));
    expect(assetRows(tmpDir)).toEqual(before);
    expect(existsSync(join(tmpDir, '_global_assets', 'skill', SKILL, 'SKILL.md'))).toBe(true);
  });

  it('an asset an admin DELETED after the migration stays deleted across the next boot', async () => {
    await server.close();
    const db = new Database(join(tmpDir, 'catalog.db'));
    db.prepare("DELETE FROM assets WHERE workflow = '' AND kind = 'mcp' AND name = ?").run(MCP);
    db.close();
    server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir, workspaceTtlMs: 15 });
    await new Promise((r) => setTimeout(r, 200));
    const resurrected = assetRows(tmpDir).find((r) => r.kind === 'mcp' && r.name === MCP);
    expect(resurrected, 'the migration re-ran and resurrected a deliberately deleted asset').toBeUndefined();
  });
});
