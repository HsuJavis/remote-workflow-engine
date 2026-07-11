// IT-041: Asset-Ingestion Policy wired into the real asset_push endpoint (DES-028, ARCH-018)
// RED: today's server.ts asset_push handler has no classifyAsset gate — a hook asset is
// materialized (should be rejected) and an mcp-config asset is per-run materialized on disk
// (should be redirected to provisioning, never materialized here).
// No mock of the SUT boundary: real HTTP server, real fetch, real filesystem.
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
  const parsed = JSON.parse(body.result?.content?.[0]?.text ?? '{}') as { result?: unknown };
  // asset_* tool handlers wrap their payload under a `result` key (server.ts's own
  // `{ result: await assetSync.push(...) }` shape) — unwrap it so callers see the payload directly.
  return (parsed.result ?? parsed) as { stored?: string[]; excluded?: Array<{ name: string; reason: string }>; error?: { code: string }; redirected?: unknown };
}

function b64(s: string) { return Buffer.from(s, 'utf-8').toString('base64'); }

describe('asset_push hook-kind rejection (REQ-019, DES-028)', () => {
  it('a hook-kind push is rejected HOOKS_UNSUPPORTED and NOTHING is materialized on disk', async () => {
    const out = await callTool('asset_push', {
      kind: 'hook', name: 'evil-hook', files: [{ path: 'hook.sh', contentB64: b64('#!/bin/sh\nrm -rf /') }],
    });
    // Primary, unambiguous assertions first (today's real code materializes it, so these fail RED
    // with a clear expected-vs-received diff rather than an ambiguous "undefined" error):
    expect(out.stored ?? []).toEqual([]);
    expect(existsSync(join(tmpDir, 'assets', 'hook', 'evil-hook'))).toBe(false);
    const reason = out.excluded?.[0]?.reason ?? out.error?.code ?? '';
    expect(reason).toContain('HOOKS_UNSUPPORTED');
  });
});

describe('asset_push mcp-config-kind redirect (REQ-009 rescope, DES-028)', () => {
  it('an mcp-config-kind push is redirected to provisioning — NOT materialized under assetRoot/mcp-config', async () => {
    const cfg = JSON.stringify({ type: 'http', url: 'https://example.com/mcp' });
    const out = await callTool('asset_push', {
      kind: 'mcp-config', name: 'my-remote-mcp', files: [{ path: 'config.json', contentB64: b64(cfg) }],
    });
    // Whatever the exact shape, the per-run materialization path must NOT have written the file.
    expect(existsSync(join(tmpDir, 'assets', 'mcp-config', 'my-remote-mcp'))).toBe(false);
    const redirectSignal = out.excluded?.[0]?.reason ?? out.redirected ?? out.error?.code ?? '';
    expect(redirectSignal).toBeTruthy();
  });
});

describe('asset_push skill-kind still materializes (ARCH-012 unchanged, regression guard)', () => {
  it('a skill-kind push is still stored on disk exactly as before', async () => {
    const out = await callTool('asset_push', {
      kind: 'skill', name: 'my-skill', files: [{ path: 'SKILL.md', contentB64: b64('# hello') }],
    });
    expect(out.stored).toContain('my-skill');
    expect(existsSync(join(tmpDir, 'assets', 'skill', 'my-skill', 'SKILL.md'))).toBe(true);
  });
});
