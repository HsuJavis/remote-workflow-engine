// VAL-009: Asset sync — push skill/hook/MCP config, recursion-guard exclusion, path-safety (REQ-009)
// RED: asset_push / asset_list / asset_delete tools do not exist yet — assertions fail on "Unknown tool".
// Per DES-023: no mock of the SUT boundary.
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
  it('asset_push a skill stores it; asset_list returns it', async () => {
    const r = await mcpCall('asset_push', {
      kind: 'skill',
      name: 'val-009-skill',
      files: [{ path: 'SKILL.md', contentB64: btoa('# My skill\nDoes useful things.') }],
    });
    expect(r['error']).toBeUndefined();
    const stored = ((r['result'] as Record<string, unknown>)?.['stored'] as string[]) ?? [];
    expect(stored).toContain('val-009-skill');

    const listR = await mcpCall('asset_list');
    const list = (listR['result'] as Array<{ kind: string; name: string }>) ?? [];
    expect(list.some((a) => a.name === 'val-009-skill' && a.kind === 'skill')).toBe(true);
  });

  it('asset_delete removes the asset from asset_list', async () => {
    await mcpCall('asset_push', {
      kind: 'skill', name: 'to-delete',
      files: [{ path: 'SKILL.md', contentB64: btoa('# Delete me') }],
    });
    await mcpCall('asset_delete', { kind: 'skill', name: 'to-delete' });
    const listR = await mcpCall('asset_list');
    const list = (listR['result'] as Array<{ name: string }>) ?? [];
    expect(list.some((a) => a.name === 'to-delete')).toBe(false);
  });

  it('pushing a non-runnable MCP config type returns a rejection with a machine-readable code (REQ-009 clause 2)', async () => {
    // A filesystem stdio MCP server (unsupported kind — not npx-installable, not remote-http)
    const r = await mcpCall('asset_push', {
      kind: 'mcp-config',
      name: 'fs-server',
      files: [{
        path: 'config.json',
        contentB64: btoa(JSON.stringify({ type: 'stdio', command: '/usr/bin/python3', args: ['server.py'] })),
      }],
    });
    // Either the whole push is rejected (error) or the asset is in excluded[]
    const hasError = r['error'] != null;
    const excluded = ((r['result'] as Record<string, unknown>)?.['excluded'] as Array<{ name: string; reason: string }>) ?? [];
    const isExcluded = excluded.some((e) => e.name === 'fs-server');
    expect(hasError || isExcluded).toBe(true);
  });

  it('pushing this system\'s own rwe-* guidance skill is excluded and reported (REQ-009 clause 3, D4)', async () => {
    const r = await mcpCall('asset_push', {
      kind: 'skill',
      name: 'rwe-remote-workflow',
      files: [{ path: 'SKILL.md', contentB64: btoa('# Self-ref') }],
    });
    const excluded = ((r['result'] as Record<string, unknown>)?.['excluded'] as Array<{ name: string; reason: string }>) ?? [];
    expect(excluded.some((e) => e.name === 'rwe-remote-workflow')).toBe(true);
    // stored[] must NOT contain the self-referential entry
    const stored = ((r['result'] as Record<string, unknown>)?.['stored'] as string[]) ?? [];
    expect(stored).not.toContain('rwe-remote-workflow');
  });

  it('pushing a file with path traversal rejects the whole push (partial-push atomicity)', async () => {
    // Uses kind 'skill' as the traversal-test vehicle — 'hook' is unconditionally rejected by
    // classifyAsset (DES-028/REQ-019, v3 hook-ban) before the path-safety check is ever reached,
    // so it can no longer isolate the path-traversal invariant under test here (that rejection
    // path is separately covered by IT-041/VAL-022).
    const r = await mcpCall('asset_push', {
      kind: 'skill',
      name: 'evil-skill',
      files: [{ path: '../../etc/passwd', contentB64: btoa('evil') }],
    });
    // The entire push should be rejected
    expect(r['error']).toBeDefined();
    const stored = ((r['result'] as Record<string, unknown>)?.['stored'] as string[]) ?? [];
    expect(stored).not.toContain('evil-skill');
  });
});
