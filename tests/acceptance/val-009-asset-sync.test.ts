// VAL-009: Asset sync — push skill/hook/MCP config, recursion-guard exclusion, path-safety (REQ-009)
// RED (pre-v24): asset-push / asset-list / asset-delete tools do not exist yet — assertions fail on
// "Unknown tool".
// Per DES-023: no mock of the SUT boundary.
//
// v24 (TASK-152, DES-153/DES-155): asset-push/asset-list/asset-delete rename to workspace_push
// (mode B)/workspace_list/workspace_delete. Three behaviour changes, not just names:
//  1. `push()` is single-asset now — it returns `{stored: name}` (a string), never a batch
//     `{stored: string[], excluded: [...]}` — there is no multi-asset-per-call batch shape left to
//     partially exclude from, so this file uses `scope:'global'` pushes (admin-scope, matching the
//     old flat single-operator asset store most closely) and asserts the STRING shape directly.
//  2. `workspace_list({workflow, kind})` never checks the workflow exists (mcp-facade.ts's
//     `workspaceList` — `assetSync.list()` is called for ANY `workflow` string; global rows are
//     always included alongside it, DES-153) — no `workflow_register` fixture is needed here.
//  3. The old batch `excluded[]` self-exclusion mechanism (REQ-009 clause 3, D4: a name starting
//     with the reserved `rwe-` prefix gets excluded from the push) has NO v24 equivalent:
//     `asset-sync.ts:148` marks `reservedPrefix` "unused by the v24 flow itself", `push()` never
//     calls `isSelfReferential`, and `pathVerdict`'s `asset-tree` reserved-prefix rule rejects a
//     `rwe-` REL-PATH FIRST SEGMENT, not the asset NAME — so `name:'rwe-remote-workflow'` with a
//     `SKILL.md` file at the top level now STORES. This is a genuine D4 recursion-guard gap, not a
//     rename target; reported in PARIMPL, not asserted here (see the same breadcrumb left by
//     `tests/integration/asset-mcp-tools.test.ts`'s IT-115 block for the sibling gap this file's
//     "REQ-009 clause 3" case used to cover).
//  4. The "non-runnable MCP config type" case (a filesystem-stdio MCP server, REQ-009 clause 2) is
//     now an AUTHZ row (`kind:'mcp'` + `config.transport:'stdio'` ⇒ `pushMode` `'stdio'` ⇒
//     admin-only, DES-138) that reaches a REAL `McpProbe` (no fake injected — this file boots a
//     plain `createServer()`), not a push-time "unsupported, excluded" classification. Exercising
//     that would mean either injecting a `FakeMcpProbe` (new test infra beyond a rename) or
//     tolerating a real subprocess spawn; dropped here as out of TASK-152's mechanical scope and
//     reported rather than faked.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

let server: Server;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-val-009-'));
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir });
});

afterAll(async () => {
  await server?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

async function mcpCall(name: string, args: Record<string, unknown> = {}) {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}') as Record<string, unknown>;
}

describe('Asset sync via MCP (REQ-009, VAL-009)', () => {
  it('workspace_push (scope:global, kind:skill) stores it; workspace_list returns it', async () => {
    const r = await mcpCall('workspace_push', {
      scope: 'global', kind: 'skill',
      name: 'val-009-skill',
      files: [{ path: 'SKILL.md', contentB64: btoa('# My skill\nDoes useful things.') }],
    });
    expect(r['error']).toBeUndefined();
    const stored = (r['result'] as Record<string, unknown>)?.['stored'];
    expect(stored).toBe('val-009-skill');

    const listR = await mcpCall('workspace_list', { workflow: 'val-009-any-workflow', kind: 'skill' });
    const list = (listR['result'] as Array<{ kind: string; name: string }>) ?? [];
    expect(list.some((a) => a.name === 'val-009-skill' && a.kind === 'skill')).toBe(true);
  });

  it('workspace_delete (scope:global) removes the asset from workspace_list', async () => {
    await mcpCall('workspace_push', {
      scope: 'global', kind: 'skill', name: 'to-delete',
      files: [{ path: 'SKILL.md', contentB64: btoa('# Delete me') }],
    });
    await mcpCall('workspace_delete', { scope: 'global', kind: 'skill', name: 'to-delete' });
    const listR = await mcpCall('workspace_list', { workflow: 'val-009-any-workflow', kind: 'skill' });
    const list = (listR['result'] as Array<{ name: string }>) ?? [];
    expect(list.some((a) => a.name === 'to-delete')).toBe(false);
  });

  it('pushing a file with path traversal rejects the whole push (partial-push atomicity)', async () => {
    // Uses kind 'skill' as the traversal-test vehicle — 'hook' is refused by workspace_push's own
    // kind guard (DES-153/REQ-019, v3 hook-ban) before the path-safety check is ever reached, so it
    // can no longer isolate the path-traversal invariant under test here (that rejection path is
    // separately covered by IT-041/VAL-022).
    const r = await mcpCall('workspace_push', {
      scope: 'global', kind: 'skill',
      name: 'evil-skill',
      files: [{ path: '../../etc/passwd', contentB64: btoa('evil') }],
    });
    // The entire push should be rejected
    expect(r['error']).toBeDefined();
    const stored = (r['result'] as Record<string, unknown>)?.['stored'];
    expect(stored).not.toBe('evil-skill');
  });
});
