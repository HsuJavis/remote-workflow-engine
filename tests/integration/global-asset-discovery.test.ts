// Issue #109 (medium): global skills/MCP servers were undiscoverable — no MCP surface listed
// scope:'global' assets at all, so an author who didn't already know an admin-pushed asset's exact
// name had no way to find it (the only existence oracle was a missing-registration WARNING, which
// itself requires guessing the name first).
//
// Fix: `workspace_list({scope:'global', kind})`, callable by any approved principal (role 'user' or
// above; role 'none' already refused globally by `authorize()`'s ACCOUNT_PENDING_APPROVAL gate —
// unchanged here), returns a SAFE projection of every global row of that kind:
//   - skill: {name, description} — the SKILL.md frontmatter `description`, bounded, null if absent
//   - mcp:   {name, transport}   — only the stored config's `type`, nothing else
// NEVER command/args/env/url/headers/secret refs/file contents (AssetSyncService.listGlobal,
// src/asset-sync.ts).
//
// Mock policy (integration, mirrors authz-enforcement-live.test.ts): real createServer() with auth
// ENABLED and real bearers (role gating must be genuinely exercised, not short-circuited by
// auth-disabled), a FakeMcpProbe (no real network/process I/O for the mcp push).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { TokenStore } from '../../src/auth/token-store.js';
import { FakeMcpProbe } from '../../src/mcp-probe.js';

const ADMIN_EMAIL = 'g109-admin@example.com';
const AUTHOR_EMAIL = 'g109-author@example.com';
const USER_EMAIL = 'g109-user@example.com';
const NONE_EMAIL = 'g109-none@example.com'; // unlisted-equivalent: explicit role:'none'

function mintBearer(workRoot: string, email: string): string {
  const db = new Database(join(workRoot, 'auth-tokens.db'));
  try {
    return new TokenStore(db, { clock: () => Date.now(), csprng: (n: number) => randomBytes(n) }).issue(email, 7 * 24 * 3600_000).token;
  } finally {
    db.close();
  }
}

function callToolFactory(server: () => Server) {
  return async (name: string, args: Record<string, unknown>, bearer: string) => {
    const res = await fetch(`http://127.0.0.1:${server().port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
    const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
    const text = body.result?.content?.[0]?.text ?? '{}';
    return { text, json: JSON.parse(text) as Record<string, unknown> };
  };
}
const codeOf = (r: Record<string, unknown>) => (r['code'] ?? (r['error'] as { code?: string } | undefined)?.code) as string | undefined;

describe('issue #109: workspace_list({scope:"global", kind}) — safe global-asset discovery', () => {
  let server: Server;
  let tmpDir: string;
  let adminToken: string;
  let authorToken: string;
  let userToken: string;
  let noneToken: string;
  const call = callToolFactory(() => server);

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'rwe-it109-'));
    server = await createServer({
      port: 0,
      bind: '127.0.0.1',
      workRoot: tmpDir,
      auth: { enabled: true, issuer: 'http://127.0.0.1:0', googleClientId: 'it109-cid', googleClientSecret: 'it109-cs' },
      principals: {
        [ADMIN_EMAIL]: { role: 'admin' },
        [AUTHOR_EMAIL]: { role: 'author' },
        [USER_EMAIL]: { role: 'user' },
        [NONE_EMAIL]: { role: 'none' },
      },
      mcpProbe: new FakeMcpProbe(true),
      mcpEgressAllowlist: ['https://example.com/'],
    } as never);
    adminToken = mintBearer(tmpDir, ADMIN_EMAIL);
    authorToken = mintBearer(tmpDir, AUTHOR_EMAIL);
    userToken = mintBearer(tmpDir, USER_EMAIL);
    noneToken = mintBearer(tmpDir, NONE_EMAIL);

    // Admin pushes a global skill with a real SKILL.md frontmatter description.
    const skillPush = await call('workspace_push', {
      scope: 'global', kind: 'skill', name: 'g109-toolkit',
      files: [{ path: 'SKILL.md', contentB64: Buffer.from('---\nname: g109-toolkit\ndescription: Formats quarterly reports.\n---\n\nSecret body text nobody should see via list.').toString('base64') }],
    }, adminToken);
    expect(codeOf(skillPush.json), JSON.stringify(skillPush.json)).toBeUndefined();

    // Admin pushes a global MCP server whose config is stdio (admin-only transport) and carries
    // secret-looking fields that MUST NOT reach a discovery listing.
    const mcpPush = await call('workspace_push', {
      scope: 'global', kind: 'mcp', name: 'g109-thinker',
      config: { type: 'stdio', command: 'npx', args: ['g109-secret-launcher', '--token=SECRET-XYZ-999'], env: { G109_API_KEY: 'sekrit-value-12345' } },
    }, adminToken);
    expect(codeOf(mcpPush.json), JSON.stringify(mcpPush.json)).toBeUndefined();
  });

  afterAll(async () => {
    await server?.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('[LOAD-BEARING] author sees the global skill as {name, description}, body/files never exposed', async () => {
    const r = await call('workspace_list', { scope: 'global', kind: 'skill' }, authorToken);
    expect(codeOf(r.json)).toBeUndefined();
    const rows = r.json['result'] as Array<Record<string, unknown>>;
    const row = rows.find((x) => x['name'] === 'g109-toolkit');
    expect(row).toBeDefined();
    expect(row?.['description']).toBe('Formats quarterly reports.');
    expect(r.text).not.toContain('Secret body text');
    expect(r.text).not.toContain('files');
  });

  it('[LOAD-BEARING] user (plain role) sees the SAME global skill listing as author', async () => {
    const r = await call('workspace_list', { scope: 'global', kind: 'skill' }, userToken);
    expect(codeOf(r.json)).toBeUndefined();
    const rows = r.json['result'] as Array<Record<string, unknown>>;
    expect(rows.find((x) => x['name'] === 'g109-toolkit')?.['description']).toBe('Formats quarterly reports.');
  });

  it('[LOAD-BEARING] author sees the global mcp server as {name, transport} only — command/args/env/secrets absent from the serialized response', async () => {
    const r = await call('workspace_list', { scope: 'global', kind: 'mcp' }, authorToken);
    expect(codeOf(r.json)).toBeUndefined();
    const rows = r.json['result'] as Array<Record<string, unknown>>;
    const row = rows.find((x) => x['name'] === 'g109-thinker');
    expect(row).toBeDefined();
    expect(row?.['transport']).toBe('stdio');
    expect(Object.keys(row!).sort()).toEqual(['kind', 'name', 'transport'].sort());
    // The secret-bearing fields must be absent from the WHOLE serialized response, not merely off
    // this one row (a defense against a sibling field leaking them elsewhere in the envelope).
    expect(r.text).not.toContain('SECRET-XYZ-999');
    expect(r.text).not.toContain('sekrit-value-12345');
    expect(r.text).not.toContain('g109-secret-launcher');
    expect(r.text).not.toContain('"command"');
    expect(r.text).not.toContain('"args"');
    expect(r.text).not.toContain('"env"');
  });

  it('role:"none" is refused ACCOUNT_PENDING_APPROVAL for a global list, same as every other tool', async () => {
    const r = await call('workspace_list', { scope: 'global', kind: 'skill' }, noneToken);
    expect(codeOf(r.json)).toBe('ACCOUNT_PENDING_APPROVAL');
  });

  it('scope:"global" with a workflow is refused INVALID_ARGUMENT, not silently resolved either way', async () => {
    const r = await call('workspace_list', { scope: 'global', workflow: 'whatever', kind: 'skill' }, authorToken);
    expect(codeOf(r.json)).toBe('INVALID_ARGUMENT');
  });

  it('scope:"global" with no kind is refused INVALID_ARGUMENT, never a silent []', async () => {
    const r = await call('workspace_list', { scope: 'global' }, authorToken);
    expect(codeOf(r.json)).toBe('INVALID_ARGUMENT');
  });

  it('an empty global store answers [] (no global mcp server has ever been pushed under this kind in a fresh server)', async () => {
    const dir2 = mkdtempSync(join(tmpdir(), 'rwe-it109-empty-'));
    let server2: Server | undefined;
    try {
      server2 = await createServer({ port: 0, bind: '127.0.0.1', workRoot: dir2, mcpProbe: new FakeMcpProbe(true) });
      const call2 = callToolFactory(() => server2!);
      const r = await call2('workspace_list', { scope: 'global', kind: 'mcp' }, 'unused');
      expect(codeOf(r.json)).toBeUndefined();
      expect(r.json['result']).toEqual([]);
    } finally {
      await server2?.close();
      rmSync(dir2, { recursive: true, force: true });
    }
  });
});
