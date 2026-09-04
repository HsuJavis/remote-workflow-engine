// IT-041: Asset-Ingestion Policy wired into the real workspace_push endpoint (DES-028, ARCH-018)
// RED (pre-v24): today's server.ts asset-push handler has no classifyAsset gate — a hook asset is
// materialized (should be rejected) and an mcp-config asset is per-run materialized on disk
// (should be redirected to provisioning, never materialized here).
// No mock of the SUT boundary: real HTTP server, real fetch, real filesystem.
//
// v24 (TASK-152, DES-153/DES-155): the old asset-push tool is renamed workspace_push. Its
// mcp-config-kind "redirect to provisioning" mechanism is RETIRED — the provisioning tool this used
// to redirect to is itself gone (ARCH-101); an MCP config is pushed DIRECTLY as
// `workspace_push({kind:'mcp', config})`, no redirect step, no intermediate `files:[…config.json…]`
// shape. That describe block is removed rather than re-pointed at a mechanism that no longer
// exists; the direct kind:'mcp' path is covered by `tests/acceptance/val-021-secret-store.test.ts`
// and `tests/integration/asset-mcp-tools.test.ts`'s IT-115 block.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

let server: Server;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-it-asset-policy-'));
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir, assetRoot: join(tmpDir, 'assets') });
});

afterAll(async () => {
  await server?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

async function callTool(name: string, args: unknown) {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
  const parsed = JSON.parse(body.result?.content?.[0]?.text ?? '{}') as { result?: unknown; error?: { code: string } };
  // workspace_push wraps its payload under a `result` key on success (mcp-facade.ts's own
  // `{ result: await assetSync.push(...) }` shape) but a refusal carries `error` at the TOP level
  // (call-tool.ts's `refusalEnvelope`) — surface both rather than unwrapping only `.result`.
  return { ...(parsed.result as Record<string, unknown> ?? {}), error: parsed.error } as { stored?: string; excluded?: Array<{ name: string; reason: string }>; error?: { code: string }; redirected?: unknown };
}

function b64(s: string) { return Buffer.from(s, 'utf-8').toString('base64'); }

describe('workspace_push hook-kind rejection (REQ-019, DES-028)', () => {
  it('a hook-kind push is rejected from the schema/facade guard and NOTHING is materialized on disk', async () => {
    const out = await callTool('workspace_push', {
      scope: 'global', kind: 'hook', name: 'evil-hook', files: [{ path: 'hook.sh', contentB64: b64('#!/bin/sh\nrm -rf /') }],
    });
    // v24: `kind` outside {'skill','mcp'} is refused by mcp-facade.ts's mode guard BEFORE ever
    // reaching classifyAsset — INVALID_ARGUMENT, not the (now-unreachable) HOOKS_UNSUPPORTED code
    // asset-sync.ts still carries (DES-153 says that code retires; not yet cleaned up — reported
    // separately in PARIMPL, not asserted here).
    expect(out.stored ?? []).toEqual([]);
    expect(existsSync(join(tmpDir, '_global_assets', 'hook', 'evil-hook'))).toBe(false);
    expect(out.error?.code).toBe('INVALID_ARGUMENT');
  });
});

describe('workspace_push skill-kind still materializes (ARCH-012 unchanged, regression guard)', () => {
  it('a skill-kind push is still stored on disk exactly as before', async () => {
    const out = await callTool('workspace_push', {
      scope: 'global', kind: 'skill', name: 'my-skill', files: [{ path: 'SKILL.md', contentB64: b64('# hello') }],
    });
    expect(out.stored).toBe('my-skill');
    expect(existsSync(join(tmpDir, '_global_assets', 'skill', 'my-skill', 'SKILL.md'))).toBe(true);
  });
});
