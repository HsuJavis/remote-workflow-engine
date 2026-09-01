// IT-089 (ARCH-076, ARCH-073, DES-116, DES-115, TASK-111): masked reads — REQUIRED `ReadContext` on
// `workflow_get`/`workflow_list`, driven over the REAL transport with a REAL bearer minted via
// `TokenStore` (a facade-level unit test with an injected principal cannot see the `server.ts:823`
// hole — this file IS this task's DoD, not a follow-up).
//
// Mock policy (integration, DES-119): real createServer + real HTTP + real auth (TokenStore); no
// LLM (registration/read only, no agent() dispatch).
//
// Red reason: `server.ts:808`/`:823` thread NO principal into `workflow_list`/`workflow_get` today
// — every principal gets the FULL script back regardless of ownership or auth state. Every masking
// assertion below fails against the current engine.
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
  authTmpDir = mkdtempSync(join(tmpdir(), 'rwe-it089-auth-'));
  authServer = await createServer({
    port: 0, bind: '127.0.0.1', workRoot: authTmpDir,
    auth: {
      enabled: true, issuer: 'http://127.0.0.1:0',
      googleClientId: 'it089-client-id', googleClientSecret: 'it089-client-secret',
      googleBase: 'http://127.0.0.1:0', jwksFetch: async () => [],
    },
  } as never);

  openTmpDir = mkdtempSync(join(tmpdir(), 'rwe-it089-open-'));
  openServer = await createServer({ port: 0, bind: '127.0.0.1', workRoot: openTmpDir }); // auth disabled
});

afterAll(async () => {
  await authServer?.close();
  await openServer?.close();
  rmSync(authTmpDir, { recursive: true, force: true });
  rmSync(openTmpDir, { recursive: true, force: true });
});

async function mintBearer(workRoot: string, port: number, email: string): Promise<string> {
  const dbPath = join(workRoot, 'auth-tokens.db');
  const db = new Database(dbPath);
  const now = Date.now();
  const store = new TokenStore(db, { clock: () => now, csprng: (n: number) => randomBytes(n) });
  const { token } = store.issue(email, 7 * 24 * 3600_000);
  db.close();
  void port;
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

describe('REQ-100: workflow_get masks the script for non-owners (auth-enabled, IT-089)', () => {
  it('the OWNER reads the full script through /mcp with their bearer', async () => {
    const ownerToken = await mintBearer(authTmpDir, authServer.port, 'it089-owner@example.com');
    const reg = await toolCall(authServer, 'workflow_register', { name: 'it089-owned', script: `return 'secret-script-body';` }, ownerToken);
    expect(reg['error']).toBeUndefined();

    const got = await toolCall(authServer, 'workflow_get', { name: 'it089-owned' }, ownerToken);
    expect((got['result'] as { script?: string } | undefined)?.script).toBe(`return 'secret-script-body';`);
  });

  it('a NON-OWNER bearer gets a masked response with NO script anywhere in it (top-level or nested)', async () => {
    const ownerToken = await mintBearer(authTmpDir, authServer.port, 'it089-owner2@example.com');
    await toolCall(authServer, 'workflow_register', { name: 'it089-owned2', script: `return 'never-leak-me';` }, ownerToken);

    const otherToken = await mintBearer(authTmpDir, authServer.port, 'it089-stranger@example.com');
    const got = await toolCall(authServer, 'workflow_get', { name: 'it089-owned2' }, otherToken);
    const flat = JSON.stringify(got);
    expect(flat).not.toContain('never-leak-me');
    expect(got['script']).toBeUndefined();
    expect((got['result'] as Record<string, unknown> | undefined)?.['script']).toBeUndefined();
    expect((got['result'] as Record<string, unknown> | undefined)?.['scriptWithheld']).toBe(true);
  });

  it('supplying {principal:"<owner-email>"} in the arguments does NOT unmask (args.principal barred, ADR-012)', async () => {
    const ownerToken = await mintBearer(authTmpDir, authServer.port, 'it089-owner3@example.com');
    await toolCall(authServer, 'workflow_register', { name: 'it089-owned3', script: `return 'still-hidden';` }, ownerToken);

    const otherToken = await mintBearer(authTmpDir, authServer.port, 'it089-stranger2@example.com');
    const got = await toolCall(authServer, 'workflow_get', { name: 'it089-owned3', principal: 'it089-owner3@example.com' }, otherToken);
    expect(JSON.stringify(got)).not.toContain('still-hidden');
  });

  it('workflow_list also serves masked (public) views while auth is on, for every entry', async () => {
    const ownerToken = await mintBearer(authTmpDir, authServer.port, 'it089-owner4@example.com');
    await toolCall(authServer, 'workflow_register', { name: 'it089-listed', script: `return 'list-secret';` }, ownerToken);

    const otherToken = await mintBearer(authTmpDir, authServer.port, 'it089-stranger3@example.com');
    const listed = await toolCall(authServer, 'workflow_list', {}, otherToken);
    expect(JSON.stringify(listed)).not.toContain('list-secret');
  });

  it('a workflow with NO recorded owner (NULL-owner row) is masked from everyone under auth, fail-closed (ADR-012)', async () => {
    // Hand-seed a v22-schema NULL-owner row directly into the running server's catalog.db (the
    // same file/connection pattern this repo's auth-routes-integration.test.ts uses for
    // mintTestBearer against the SAME server's auth-tokens.db) — a NULL owner cannot otherwise
    // arise on a brand-new workRoot (every write to /mcp requires a bearer).
    const dbPath = join(authTmpDir, 'catalog.db');
    const db = new Database(dbPath);
    const now = new Date().toISOString();
    db.prepare('INSERT INTO workflows (name, createdAt, owner, release_version) VALUES (?, ?, NULL, ?)').run('it089-null-owner', now, 'v1');
    db.prepare('INSERT INTO workflow_versions (name, version, script, createdAt) VALUES (?, ?, ?, ?)').run('it089-null-owner', 'v1', `return 'orphan-script';`, now);
    db.close();

    const someToken = await mintBearer(authTmpDir, authServer.port, 'it089-anyone@example.com');
    const got = await toolCall(authServer, 'workflow_get', { name: 'it089-null-owner' }, someToken);
    expect(JSON.stringify(got)).not.toContain('orphan-script');
    expect((got['result'] as Record<string, unknown> | undefined)?.['scriptWithheld']).toBe(true);
  });
});

describe('REQ-100: auth disabled ⇒ pre-v22 surface, byte-for-byte (IT-089)', () => {
  it('with auth OFF, workflow_get returns the full script to anyone (no bearer needed)', async () => {
    const reg = await toolCall(openServer, 'workflow_register', { name: 'it089-open', script: `return 'open-script';` });
    expect(reg['error']).toBeUndefined();
    const got = await toolCall(openServer, 'workflow_get', { name: 'it089-open' });
    expect((got['result'] as { script?: string } | undefined)?.script).toBe(`return 'open-script';`);
  });
});
