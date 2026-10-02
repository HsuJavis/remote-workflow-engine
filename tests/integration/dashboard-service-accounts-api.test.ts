// Service accounts spec (owner decision 2026-10-03), §Management surface: the dashboard admin
// page's "Service accounts" section backend — /api/service-accounts* — is the SAME 6 tools an MCP
// client calls (same authorize() row, same CSRF rule as /api/principals/*).
//
// Mock policy (integration, DES-100 precedent): real createServer() + real HTTP; an admin bearer is
// minted directly via TokenStore (the same "sub-component access at IT tier" convention
// auth-routes-integration.test.ts's mintTestBearer already uses).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { TokenStore } from '../../src/auth/token-store.js';

let server: Server;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-sa-dash-'));
  server = await createServer({
    port: 0, bind: '127.0.0.1', workRoot: tmpDir,
    auth: { enabled: true, issuer: 'http://127.0.0.1:0', googleClientId: 'x', googleClientSecret: 'y', googleBase: 'http://127.0.0.1:0' },
    principals: { 'admin@x.com': { role: 'admin' }, 'author@x.com': { role: 'author' } },
  } as never);
});

afterAll(async () => {
  await server?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

async function mintBearer(email: string): Promise<string> {
  const db = new Database(join(tmpDir, 'auth-tokens.db'));
  const store = new TokenStore(db, { clock: () => Date.now(), csprng: (n) => randomBytes(n) });
  const { token } = store.issue(email, 7 * 24 * 3600_000);
  db.close();
  return token;
}

function apiUrl(path: string) { return `http://127.0.0.1:${server.port}${path}`; }

describe('dashboard /api/service-accounts* (service accounts spec §Management surface)', () => {
  it('GET as admin -> 200 []', async () => {
    const token = await mintBearer('admin@x.com');
    const res = await fetch(apiUrl('/api/service-accounts'), { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it('GET as a non-admin -> 403 FORBIDDEN_ROLE', async () => {
    const token = await mintBearer('author@x.com');
    const res = await fetch(apiUrl('/api/service-accounts'), { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(403);
  });

  it('POST create without X-Requested-With/same-origin Origin -> 403 CSRF_REFUSED', async () => {
    const token = await mintBearer('admin@x.com');
    const res = await fetch(apiUrl('/api/service-accounts'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'dash-bot', role: 'user' }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('CSRF_REFUSED');
  });

  it('full lifecycle via the dashboard API: create -> list -> update -> rotate -> revoke -> delete', async () => {
    const token = await mintBearer('admin@x.com');
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Requested-With': 'rwe-dashboard' };

    const created = await fetch(apiUrl('/api/service-accounts'), { method: 'POST', headers, body: JSON.stringify({ name: 'dash-bot', role: 'user' }) });
    expect(created.status).toBe(200);
    const createdBody = await created.json() as { clientId: string; clientSecret: string; account: { secrets: Array<{ id: string }> } };
    expect(createdBody.clientId).toBe('sa:dash-bot');
    const firstSecretId = createdBody.account.secrets[0]!.id;

    const listed = await fetch(apiUrl('/api/service-accounts'), { headers: { Authorization: `Bearer ${token}` } });
    expect((await listed.json() as Array<{ name: string }>).map((a) => a.name)).toEqual(['dash-bot']);

    const updated = await fetch(apiUrl('/api/service-accounts/update'), { method: 'POST', headers, body: JSON.stringify({ name: 'dash-bot', disabled: true }) });
    expect(updated.status).toBe(200);
    expect((await updated.json() as { disabled: boolean }).disabled).toBe(true);

    const rotated = await fetch(apiUrl('/api/service-accounts/rotate'), { method: 'POST', headers, body: JSON.stringify({ name: 'dash-bot' }) });
    expect(rotated.status).toBe(200);

    const revoked = await fetch(apiUrl('/api/service-accounts/revoke'), { method: 'POST', headers, body: JSON.stringify({ name: 'dash-bot', secretId: firstSecretId }) });
    expect(revoked.status).toBe(200);

    const deleted = await fetch(apiUrl('/api/service-accounts/delete'), { method: 'POST', headers, body: JSON.stringify({ name: 'dash-bot' }) });
    expect(deleted.status).toBe(200);

    const afterDelete = await fetch(apiUrl('/api/service-accounts'), { headers: { Authorization: `Bearer ${token}` } });
    expect(await afterDelete.json()).toEqual([]);
  });

  it('a not-found update -> 404', async () => {
    const token = await mintBearer('admin@x.com');
    const res = await fetch(apiUrl('/api/service-accounts/update'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Requested-With': 'rwe-dashboard' },
      body: JSON.stringify({ name: 'nope', disabled: true }),
    });
    expect(res.status).toBe(404);
  });
});
