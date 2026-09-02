// VAL-111 (REQ-100 `[AMENDED v23]`, adjudication #1 2026-09-02, DES-136): on a booted auth-enabled
// engine, a NON-OWNER `workflow_get({name})` over real `/mcp` returns `phases` with the author's
// titles, while `script` stays withheld — the amendment's own surface, proven where it ships (not
// only in the projection unit test, per this ledger's own carried-in discipline).
//
// Mock policy (acceptance, DES-119): real `createServer`, real `/mcp` HTTP, real `TokenStore`-minted
// bearer (same technique as VAL-110). No LLM dispatch needed for this REQ.
//
// Red reason: `WorkflowPublicView` has no `phases` field today (`src/workflow-view.ts`, confirmed by
// direct read) -> the non-owner projection omits `phases` entirely, failing every assertion below.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { TokenStore } from '../../src/auth/token-store.js';
import { registerPublishedVia } from '../helpers/workflow-fixtures.js';

let server: Server;
let workRoot: string;

beforeAll(async () => {
  workRoot = mkdtempSync(join(tmpdir(), 'rwe-val111-'));
  server = await createServer({
    port: 0, bind: '127.0.0.1', workRoot,
    auth: { enabled: true, issuer: 'http://127.0.0.1:0', googleClientId: 'c', googleClientSecret: 's', googleBase: 'http://127.0.0.1:0', jwksFetch: async () => [] },
  } as never);
});
afterAll(async () => { await server?.close(); rmSync(workRoot, { recursive: true, force: true }); });

async function mintBearer(email: string): Promise<string> {
  const db = new Database(join(workRoot, 'auth-tokens.db'));
  const now = Date.now();
  const store = new TokenStore(db, { clock: () => now, csprng: (n: number) => randomBytes(n) });
  const { token } = store.issue(email, 7 * 24 * 3600_000);
  db.close();
  return token;
}

async function toolCall(name: string, args: Record<string, unknown>, bearer?: string): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (bearer) headers['Authorization'] = `Bearer ${bearer}`;
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST', headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}') as Record<string, unknown>;
}

describe('REQ-100 [AMENDED v23]: phases are public even to a non-owner (VAL-111)', () => {
  it('a non-owner workflow_get sees the real phase titles while script stays withheld', async () => {
    const ownerToken = await mintBearer('val111-owner@example.com');
    await registerPublishedVia(
      (n, a) => toolCall(n, a, ownerToken), 'val111-flow',
      `export const meta = { phases: [{title:'Draft'}, {title:'Verify'}] };\nreturn 'val111-secret';`,
    );

    const otherToken = await mintBearer('val111-stranger@example.com');
    const masked = await toolCall('workflow_get', { name: 'val111-flow' }, otherToken);
    const result = masked['result'] as Record<string, unknown> | undefined;
    expect(result?.['scriptWithheld']).toBe(true);
    expect(JSON.stringify(masked)).not.toContain('val111-secret');
    expect((result?.['phases'] as Array<{ title: string }> | undefined)?.map((p) => p.title)).toEqual(['Draft', 'Verify']);
  });
});
