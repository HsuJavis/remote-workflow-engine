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
//  2. `workspace_list({workflow, kind})` DOES check the workflow exists: v24's REQ-118 wiring makes
//     `workspaceList` answer `WORKFLOW_NOT_FOUND` for a name the catalog has never heard of
//     (mcp-facade.ts, the `catalog.exists` branch) — "no assets" and "no such workflow" are
//     different answers, and the row's advertised `errors[]` promises the latter. So the workflow
//     this file lists against IS registered in `beforeAll` now. Global rows are still always
//     included alongside the workflow's own (DES-153), which is what these cases read.
//  3. REQ-009 clause 3 (D4 recursion guard: an asset named with the engine's own reserved `rwe-`
//     prefix must not be materialized) is BACK, with a new spelling and a stronger verdict. The old
//     batch mechanism silently EXCLUDED such a name from a multi-asset push (`excluded[]`); v24 has
//     no batch shape to partially exclude from, and the gap this file's header used to record —
//     `pathVerdict`'s `asset-tree` reserved-prefix rule applying only to a file's REL PATH, never to
//     the asset NAME — has since been closed: `AssetSyncService.push` now runs the asset name itself
//     through `lexicalVerdict('asset-tree', name)` before writing anything, so the whole push is
//     REFUSED with `RESERVED_PREFIX` rather than quietly trimmed. Asserted again below.
//  4. The "non-runnable MCP config type" case (a filesystem-stdio MCP server, REQ-009 clause 2) is
//     now an AUTHZ row (`kind:'mcp'` + `config.type:'stdio'` ⇒ `pushMode` `'stdio'` ⇒
//     admin-only, DES-138) that reaches a REAL `McpProbe` (no fake injected — this file boots a
//     plain `createServer()`), not a push-time "unsupported, excluded" classification. Exercising
//     that would mean either injecting a `FakeMcpProbe` (new test infra beyond a rename) or
//     tolerating a real subprocess spawn; dropped here as out of TASK-152's mechanical scope and
//     reported rather than faked. v24 Gate 7.5 (D-11) then found that the key this row read
//     (`config.transport`) was not the key the probe reads (`config.type`), so the admin gate never
//     ran at all — the outcome is now pinned by tests/integration/stdio-mcp-admin-gate.test.ts,
//     which injects a recording probe rather than spawning anything.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { registerPublishedVia } from '../helpers/workflow-fixtures.js';

let server: Server;
let tmpDir: string;

/** The workflow every `workspace_list` below scopes to. It must EXIST (see header note 2) — its
 *  script is irrelevant; the assets under test are all `scope:'global'`, and global rows are
 *  returned alongside any workflow's own. */
const LIST_WORKFLOW = 'val-009-any-workflow';

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-val-009-'));
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir });
  await registerPublishedVia(mcpCall, LIST_WORKFLOW, `return 'no assets of its own';`);
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

    const listR = await mcpCall('workspace_list', { workflow: LIST_WORKFLOW, kind: 'skill' });
    const list = (listR['result'] as Array<{ kind: string; name: string }>) ?? [];
    expect(list.some((a) => a.name === 'val-009-skill' && a.kind === 'skill')).toBe(true);
  });

  it('workspace_delete (scope:global) removes the asset from workspace_list', async () => {
    await mcpCall('workspace_push', {
      scope: 'global', kind: 'skill', name: 'to-delete',
      files: [{ path: 'SKILL.md', contentB64: btoa('# Delete me') }],
    });
    await mcpCall('workspace_delete', { scope: 'global', kind: 'skill', name: 'to-delete' });
    const listR = await mcpCall('workspace_list', { workflow: LIST_WORKFLOW, kind: 'skill' });
    const list = (listR['result'] as Array<{ name: string }>) ?? [];
    expect(list.some((a) => a.name === 'to-delete')).toBe(false);
  });

  // REQ-009 clause 3 (D4 recursion guard) — see header note 3 for the v24 re-spelling. The engine's
  // own plugin/guidance identity lives under the reserved `rwe-` prefix; an asset allowed to claim
  // that prefix would be materialized into a run as `.claude/skills/rwe-…`, impersonating it.
  it('an asset NAME claiming the reserved rwe- prefix is refused RESERVED_PREFIX, not stored', async () => {
    const r = await mcpCall('workspace_push', {
      scope: 'global', kind: 'skill',
      name: 'rwe-remote-workflow',
      files: [{ path: 'SKILL.md', contentB64: btoa('# impersonating the engine') }],
    });
    expect((r['error'] as Record<string, unknown> | undefined)?.['code']).toBe('RESERVED_PREFIX');
    expect((r['result'] as Record<string, unknown> | undefined)?.['stored']).toBeUndefined();

    // …and nothing landed: it is absent from the listing the run materializer reads.
    const listR = await mcpCall('workspace_list', { workflow: LIST_WORKFLOW, kind: 'skill' });
    const list = (listR['result'] as Array<{ name: string }>) ?? [];
    expect(list.some((a) => a.name === 'rwe-remote-workflow')).toBe(false);
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
