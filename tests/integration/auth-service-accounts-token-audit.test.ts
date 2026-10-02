// Service accounts spec send-back D3 (MEDIUM): "no audit line when a token is issued (spec
// §Audit)". The spec requires a log line on create/rotate/revoke/disable/delete (already covered —
// service_account_* events) AND on token issuance; failed exchanges should be observable too (for
// spotting brute-force / misconfiguration). This pins both the success and failure lines: client id
// (or 'unknown'), outcome, source IP — and that the raw secret/token never appear in either.
//
// Mock policy (integration tier): real createServer() + real HTTP; console.log is spied to capture
// the audit lines without parsing the engine's stdout stream.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { ServiceAccountStore } from '../../src/auth/service-account-store.js';
import Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';

let server: Server;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-sa-audit-'));
  server = await createServer({
    port: 0, bind: '127.0.0.1', workRoot: tmpDir,
    auth: { enabled: true, issuer: 'http://127.0.0.1:0', googleClientId: 'x', googleClientSecret: 'y' },
  } as never);
});
afterAll(async () => {
  await server?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

function seedServiceAccount(name: string): string {
  const db = new Database(join(tmpDir, 'auth-tokens.db'));
  try {
    const store = new ServiceAccountStore(db, { clock: () => Date.now(), csprng: (n) => randomBytes(n) });
    const created = store.create({ name, role: 'user', createdBy: 'test' });
    if (!created.ok) throw new Error('setup');
    return created.clientSecret;
  } finally { db.close(); }
}

describe('POST /token client_credentials audit logging (service accounts spec send-back D3)', () => {
  it('logs service_account_token_issued on success — client id + ip, never the secret or the token', async () => {
    const secret = seedServiceAccount('audit-ok-bot');
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/token`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'client_credentials', client_id: 'sa:audit-ok-bot', client_secret: secret }),
      });
      const body = await res.json() as { access_token: string };
      const lines = spy.mock.calls.map((c) => String(c[0]));
      const issued = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((e) => e?.event === 'service_account_token_issued');
      expect(issued).toBeDefined();
      expect(issued.clientId).toBe('sa:audit-ok-bot');
      expect(typeof issued.ip).toBe('string');
      for (const line of lines) {
        expect(line).not.toContain(secret);
        expect(line).not.toContain(body.access_token);
      }
    } finally {
      spy.mockRestore();
    }
  });

  it('logs service_account_token_denied on a wrong secret and on an unknown client id — never leaking the secret', async () => {
    seedServiceAccount('audit-deny-bot');
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await fetch(`http://127.0.0.1:${server.port}/token`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'client_credentials', client_id: 'sa:audit-deny-bot', client_secret: 'totally-wrong-secret' }),
      });
      await fetch(`http://127.0.0.1:${server.port}/token`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'client_credentials' }), // no client_id/secret at all -> 'unknown'
      });
      const events = spy.mock.calls
        .map((c) => { try { return JSON.parse(String(c[0])); } catch { return null; } })
        .filter((e) => e?.event === 'service_account_token_denied');
      expect(events.some((e) => e.clientId === 'sa:audit-deny-bot')).toBe(true);
      expect(events.some((e) => e.clientId === 'unknown')).toBe(true);
      for (const e of events) expect(JSON.stringify(e)).not.toContain('totally-wrong-secret');
    } finally {
      spy.mockRestore();
    }
  });
});
