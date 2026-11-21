// A loopback peer on a non-loopback bind is exempt from the /mcp auth gate only when it presents no
// credentials. One that presents a bearer is authenticated like any other caller.
// Mock policy: integration tier — real createServer() over real HTTP, real token store.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { TokenStore } from '../../src/auth/token-store.js';

const ALICE = 'alice@example.com';
let server: Server;
let dir: string;
let token: string;

async function post(tool: string, headers: Record<string, string>) {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: { runId: '00000000-0000-4000-8000-000000000000' } } }),
  });
  const text = await res.text();
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse((JSON.parse(text) as { result?: { content?: Array<{ text?: string }> } }).result?.content?.[0]?.text ?? '{}') as Record<string, unknown>;
  } catch { /* not a tool result */ }
  return { status: res.status, payload };
}
const codeOf = (r: Record<string, unknown>) => (r['code'] ?? (r['error'] as { code?: string } | undefined)?.code) as string | undefined;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'rwe-loopback-bearer-'));
  server = await createServer({
    port: 0,
    bind: '0.0.0.0', // non-loopback bind: the loopback-peer exemption is ON
    workRoot: dir,
    auth: { enabled: true, issuer: 'http://127.0.0.1:0', googleClientId: 'lb-cid', googleClientSecret: 'lb-cs' },
    principals: { [ALICE]: { role: 'author' } },
  } as never);
  const db = new Database(join(dir, 'auth-tokens.db'));
  try {
    token = new TokenStore(db, { clock: () => Date.now(), csprng: (n: number) => randomBytes(n) }).issue(ALICE, 3600_000).token;
  } finally {
    db.close();
  }
});
afterAll(async () => {
  await server.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('loopback peer on a non-loopback bind', () => {
  it('without credentials keeps the identity-less rescue path', async () => {
    const r = await post('run_status', {});
    expect(r.status).toBe(200);
    expect(codeOf(r.payload)).toBe('PRINCIPAL_REQUIRED');
  });

  it('with a valid bearer is authenticated as that principal', async () => {
    const r = await post('run_status', { Authorization: `Bearer ${token}` });
    expect(r.status).toBe(200);
    expect(codeOf(r.payload)).toBeDefined();
    expect(codeOf(r.payload)).not.toBe('PRINCIPAL_REQUIRED');
  });

  it('with a bad bearer is refused, not silently exempted', async () => {
    const r = await post('run_status', { Authorization: 'Bearer not-a-real-token' });
    expect(r.status).toBe(401);
  });
});
