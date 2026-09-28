// issue #97: webhook_create returned `url` built from the server's own bind address/request
// Host header — `http://localhost:8899/hooks/<id>` to a remote client sitting behind a reverse
// proxy/tunnel (the operator's production Cloudflare ingress only forwards `/hooks/` to the real
// engine port, which never sees "localhost:8899" as reachable from outside the host). This pins
// `resolvePublicBaseUrl`'s (src/server.ts) three-way precedence, over a real booted server:
//   1. explicit `config.publicBaseUrl` always wins;
//   2. absent that, `auth.issuer` (already this deployment's externally-reachable identity whenever
//      auth is configured);
//   3. absent both, the pre-fix bind/request-derived fallback — unchanged (regression guard).
// Mock policy: integration tier — real createServer() over real HTTP, no mock at the SUT boundary.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { TokenStore } from '../../src/auth/token-store.js';

let server: Server | undefined;
let tmpDir: string | undefined;

afterEach(async () => {
  await server?.close();
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  server = undefined;
  tmpDir = undefined;
});

// bind stays loopback ('127.0.0.1') in every case below, which — same as authz-enforcement-live.
// test.ts's own comment — turns OFF the D-BIND loopback exemption, so an auth-enabled server here
// really validates the bearer rather than silently admitting the request.
function mintBearer(workRoot: string, email: string): string {
  const db = new Database(join(workRoot, 'auth-tokens.db'));
  try {
    return new TokenStore(db, { clock: () => Date.now(), csprng: (n: number) => randomBytes(n) })
      .issue(email, 7 * 24 * 3600_000).token;
  } finally {
    db.close();
  }
}

async function callTool(name: string, args: Record<string, unknown>, bearer?: string): Promise<any> {
  const res = await fetch(`http://127.0.0.1:${server!.port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}');
}

describe('webhook_create url — publicBaseUrl resolution (issue #97)', () => {
  it('no publicBaseUrl, no auth: falls back to the bind/request-derived origin unchanged (regression guard)', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'rwe-wh-pbu-none-'));
    server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir });
    const created = await callTool('webhook_create', {});
    expect(created.result.url).toBe(`http://127.0.0.1:${server.port}/hooks/${created.result.webhookId}`);
  });

  it('explicit config.publicBaseUrl wins even when auth is disabled', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'rwe-wh-pbu-explicit-'));
    server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir, publicBaseUrl: 'https://rwe.example.com' } as never);
    const created = await callTool('webhook_create', {});
    expect(created.result.url).toBe(`https://rwe.example.com/hooks/${created.result.webhookId}`);
  });

  it('no publicBaseUrl but auth is configured: falls back to auth.issuer', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'rwe-wh-pbu-issuer-'));
    server = await createServer({
      port: 0, bind: '127.0.0.1', workRoot: tmpDir,
      auth: { enabled: true, issuer: 'https://rwe-issuer.example.com', googleClientId: 'cid', googleClientSecret: 'cs' },
      principals: { 'author@example.com': { role: 'author' } },
    } as never);
    const bearer = mintBearer(tmpDir, 'author@example.com');
    const created = await callTool('webhook_create', {}, bearer);
    expect(created.result.url).toBe(`https://rwe-issuer.example.com/hooks/${created.result.webhookId}`);
  });

  it('publicBaseUrl beats auth.issuer when both are set', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'rwe-wh-pbu-both-'));
    server = await createServer({
      port: 0, bind: '127.0.0.1', workRoot: tmpDir,
      publicBaseUrl: 'https://public.example.com',
      auth: { enabled: true, issuer: 'https://rwe-issuer.example.com', googleClientId: 'cid', googleClientSecret: 'cs' },
      principals: { 'author@example.com': { role: 'author' } },
    } as never);
    const bearer = mintBearer(tmpDir, 'author@example.com');
    const created = await callTool('webhook_create', {}, bearer);
    expect(created.result.url).toBe(`https://public.example.com/hooks/${created.result.webhookId}`);
  });
});
