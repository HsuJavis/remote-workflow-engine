// Service accounts spec (owner decision 2026-10-03), §Token exchange: POST /token
// grant_type=client_credentials (RFC 6749 §4.4) for a `sa:<name>` principal. Client auth via HTTP
// Basic (client_secret_basic) AND a form body (client_secret_post); every failure (unknown id, bad
// secret, disabled/expired account) answers the SAME 401 {"error":"invalid_client"} — no wire
// distinction (spec's no-oracle rule). The issued token is a normal engine opaque bearer, NO
// refresh_token, TTL from `auth.serviceAccountTokenTtlMs` (default 1h).
//
// Mock policy (integration, DES-100 precedent — same tier as auth-routes-integration.test.ts):
// real createServer() + real HTTP; the service account is seeded by opening ServiceAccountStore
// directly against the same auth-tokens.db (the same "sub-component access is fine at IT tier"
// convention that file's own mintTestBearer() already uses) — this file does not depend on the
// service_account_create MCP tool existing yet.
//
// Red reason: `createAuthRouteHandlers`'s `tokenExchange` has no `client_credentials` arm yet
// (falls into the existing `grantType !== 'authorization_code'` branch → unsupported_grant_type),
// and `server.ts` wires no ServiceAccountStore into it yet.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { ServiceAccountStore } from '../../src/auth/service-account-store.js';

let server: Server;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-sa-token-'));
  server = await createServer({
    port: 0, bind: '127.0.0.1', workRoot: tmpDir,
    auth: {
      enabled: true,
      issuer: 'http://127.0.0.1:0',
      googleClientId: 'sa-token-client-id',
      googleClientSecret: 'sa-token-client-secret',
      googleBase: 'http://127.0.0.1:0',
    },
  } as never);
});

afterAll(async () => {
  await server?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

function tokenUrl() { return `http://127.0.0.1:${server.port}/token`; }
function metadataUrl() { return `http://127.0.0.1:${server.port}/.well-known/oauth-authorization-server`; }

/** Seeds a service account directly in the SAME auth-tokens.db the running server opened —
 *  sub-component access at IT tier (same convention as mintTestBearer in
 *  auth-routes-integration.test.ts). */
function seedServiceAccount(params: { name: string; role: 'author' | 'user'; disabled?: boolean; expiresAt?: number }) {
  const db = new Database(join(tmpDir, 'auth-tokens.db'));
  const store = new ServiceAccountStore(db, { clock: () => Date.now(), csprng: (n) => randomBytes(n) });
  const created = store.create({ name: params.name, role: params.role, createdBy: 'test', expiresAt: params.expiresAt ?? null });
  if (!created.ok) throw new Error(`seed setup failed: ${created.reason}`);
  if (params.disabled) store.update(params.name, { disabled: true }, 'test');
  db.close();
  return created;
}

describe('POST /token grant_type=client_credentials (service accounts spec §Token exchange)', () => {
  it('HTTP Basic auth → 200 {access_token, token_type:"Bearer", expires_in}, no refresh_token', async () => {
    const created = seedServiceAccount({ name: 'basic-sa', role: 'user' });
    // RFC 6749 §2.3.1: Basic <base64(urlencode(client_id):urlencode(client_secret))> — client_id
    // itself contains a ':' (sa:<name>), so it MUST be percent-encoded before the join, or the
    // first ':' found on decode would split the wrong place.
    const auth = Buffer.from(`${encodeURIComponent('sa:basic-sa')}:${encodeURIComponent(created.clientSecret)}`).toString('base64');
    const res = await fetch(tokenUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': `Basic ${auth}` },
      body: new URLSearchParams({ grant_type: 'client_credentials' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { access_token?: string; token_type?: string; expires_in?: number; refresh_token?: string };
    expect(typeof body.access_token).toBe('string');
    expect(body.token_type).toBe('Bearer');
    expect(body.expires_in).toBe(3600);
    expect(body.refresh_token).toBeUndefined();
  });

  it('form body client_id/client_secret (client_secret_post) → 200', async () => {
    const created = seedServiceAccount({ name: 'post-sa', role: 'author' });
    const res = await fetch(tokenUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: 'sa:post-sa', client_secret: created.clientSecret }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { access_token?: string };
    expect(typeof body.access_token).toBe('string');
  });

  it('the issued bearer actually authenticates /mcp as the sa: principal', async () => {
    const created = seedServiceAccount({ name: 'works-sa', role: 'user' });
    const tok = await (await fetch(tokenUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: 'sa:works-sa', client_secret: created.clientSecret }),
    })).json() as { access_token: string };
    const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tok.access_token}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } } }),
    });
    expect(res.status).toBe(200);
  });

  it('a wrong secret → 401 {"error":"invalid_client"}', async () => {
    seedServiceAccount({ name: 'wrong-secret-sa', role: 'user' });
    const res = await fetch(tokenUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: 'sa:wrong-secret-sa', client_secret: 'rwe_sa_totally-wrong' }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'invalid_client' });
  });

  it('an unknown client_id → the SAME 401 {"error":"invalid_client"} (no oracle)', async () => {
    const res = await fetch(tokenUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: 'sa:no-such-account', client_secret: 'whatever' }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'invalid_client' });
  });

  it('a disabled account with the CORRECT secret → the SAME 401 {"error":"invalid_client"}', async () => {
    const created = seedServiceAccount({ name: 'disabled-sa', role: 'user', disabled: true });
    const res = await fetch(tokenUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: 'sa:disabled-sa', client_secret: created.clientSecret }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'invalid_client' });
  });

  it('an expired account with the CORRECT secret → the SAME 401 {"error":"invalid_client"}', async () => {
    const created = seedServiceAccount({ name: 'expired-sa', role: 'user', expiresAt: Date.now() - 1000 });
    const res = await fetch(tokenUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: 'sa:expired-sa', client_secret: created.clientSecret }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'invalid_client' });
  });

  it('a human (non sa:) client_id never matches a service account → 401 invalid_client', async () => {
    const res = await fetch(tokenUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: 'someone@example.com', client_secret: 'whatever' }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'invalid_client' });
  });
});

describe('AS metadata advertises client_credentials (service accounts spec)', () => {
  it('grant_types_supported includes client_credentials; token_endpoint_auth_methods_supported includes client_secret_basic/post', async () => {
    const res = await fetch(metadataUrl());
    const body = await res.json() as { grant_types_supported?: string[]; token_endpoint_auth_methods_supported?: string[] };
    expect(body.grant_types_supported).toContain('client_credentials');
    expect(body.token_endpoint_auth_methods_supported).toContain('client_secret_basic');
    expect(body.token_endpoint_auth_methods_supported).toContain('client_secret_post');
  });
});
