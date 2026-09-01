// VAL-110 (REQ-100): `workflow_get` masks the script for non-owners. Real entrypoint: `createServer`,
// real MCP HTTP, real auth (TokenStore-minted bearer), real `/api/*` routes.
//
// Mock policy (acceptance, DES-119): no mocking of the SUT's own boundaries. No LLM dispatch needed.
//
// Red reason: `/api/workflows/:name/skeleton` returns the script-derived skeleton/phases
// unconditionally today, and `server.ts:823` threads no principal into `workflow_get` at all — every
// masking assertion below fails against the current engine.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { TokenStore } from '../../src/auth/token-store.js';

let authServer: Server;
let openServer: Server;
let authTmpDir: string;
let openTmpDir: string;

beforeAll(async () => {
  authTmpDir = mkdtempSync(join(tmpdir(), 'rwe-val110-auth-'));
  authServer = await createServer({
    port: 0, bind: '127.0.0.1', workRoot: authTmpDir,
    auth: {
      enabled: true, issuer: 'http://127.0.0.1:0',
      googleClientId: 'val110-client-id', googleClientSecret: 'val110-client-secret',
      googleBase: 'http://127.0.0.1:0', jwksFetch: async () => [],
    },
  } as never);
  openTmpDir = mkdtempSync(join(tmpdir(), 'rwe-val110-open-'));
  openServer = await createServer({ port: 0, bind: '127.0.0.1', workRoot: openTmpDir });
});
afterAll(async () => {
  await authServer?.close(); await openServer?.close();
  rmSync(authTmpDir, { recursive: true, force: true }); rmSync(openTmpDir, { recursive: true, force: true });
});

async function mintBearer(workRoot: string, email: string): Promise<string> {
  const db = new Database(join(workRoot, 'auth-tokens.db'));
  const now = Date.now();
  const store = new TokenStore(db, { clock: () => now, csprng: (n: number) => randomBytes(n) });
  const { token } = store.issue(email, 7 * 24 * 3600_000);
  db.close();
  return token;
}
async function toolCall(server: Server, name: string, args: Record<string, unknown>, bearer?: string): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (bearer) headers['Authorization'] = `Bearer ${bearer}`;
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST', headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}') as Record<string, unknown>;
}

describe('REQ-100: two real principals over /mcp (VAL-110)', () => {
  it('owner reads the script; a non-owner bearer gets exactly the masked non-owner key set', async () => {
    const ownerToken = await mintBearer(authTmpDir, 'val110-owner@example.com');
    await toolCall(authServer, 'workflow_register', { name: 'val110-flow', script: `return 'val110-secret';` }, ownerToken);

    const owned = await toolCall(authServer, 'workflow_get', { name: 'val110-flow' }, ownerToken);
    expect((owned['result'] as { script?: string } | undefined)?.script).toBe(`return 'val110-secret';`);

    const otherToken = await mintBearer(authTmpDir, 'val110-stranger@example.com');
    const masked = await toolCall(authServer, 'workflow_get', { name: 'val110-flow' }, otherToken);
    const maskedResult = masked['result'] as Record<string, unknown> | undefined;
    expect(maskedResult?.['scriptWithheld']).toBe(true);
    expect(JSON.stringify(masked)).not.toContain('val110-secret');
  });
});

describe('REQ-100: /api/workflows and the skeleton route are masked while auth is enabled, no exceptions (VAL-110)', () => {
  it('/api/workflows/:name/skeleton omits skeleton/phases entirely while auth is on', async () => {
    const ownerToken = await mintBearer(authTmpDir, 'val110-owner2@example.com');
    await toolCall(authServer, 'workflow_register', { name: 'val110-api', script: `phase('secret-phase'); return 1;` }, ownerToken);

    const res = await fetch(`http://127.0.0.1:${authServer.port}/api/workflows/val110-api/skeleton`);
    const body = await res.json() as Record<string, unknown>;
    expect(body['skeleton']).toBeUndefined();
    expect(body['phases']).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('secret-phase');
  });

  it('/api/workflows never carries a `script` field while auth is on', async () => {
    const res = await fetch(`http://127.0.0.1:${authServer.port}/api/workflows`);
    const body = await res.json() as Array<Record<string, unknown>>;
    for (const entry of body) expect('script' in entry).toBe(false);
  });
});

describe('REQ-100: auth OFF → pre-v22 surface, byte-for-byte (VAL-110)', () => {
  it('/api/workflows/:name/skeleton returns the real skeleton/phases when auth is disabled', async () => {
    await toolCall(openServer, 'workflow_register', { name: 'val110-open-api', script: `phase('open-phase'); return 1;` });
    const res = await fetch(`http://127.0.0.1:${openServer.port}/api/workflows/val110-open-api/skeleton`);
    const body = await res.json() as Record<string, unknown>;
    expect(body['phases']).toBeDefined();
  });
});
