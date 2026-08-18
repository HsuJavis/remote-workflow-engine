// IT-078 (DES-095, DES-096, DES-100, ARCH-059, ARCH-060, TASK-086, TASK-087):
// Running-server integration for the 4 OAuth routes + protected surfaces + principal attribution.
//
// Auth config shape (pinned contract per DES-095; keys on ServerConfig.auth when implemented):
//   { enabled: boolean; issuer: string; googleClientId: string; googleClientSecret: string;
//     googleBase?: string;  // injectable test override (default: https://accounts.google.com)
//     jwksFetch?: (googleBase: string) => Promise<Jwk[]>;  // injectable for tests
//   }
//
// Pinned storage contracts (implementer must honor):
//   Token-store DB:  join(workRoot, 'auth-tokens.db')
//   Ad-hoc workspace: join(workRoot, 'workflows', '_adhoc', 'runs', '<runId>')
//
// Cases (DES-095, DES-096, DES-100):
//   1. GET /.well-known/oauth-protected-resource → 200 JSON with resource + authorization_servers
//   2. GET /.well-known/oauth-authorization-server → 200 JSON with PKCE/code discovery fields
//   3. Un-tokened POST /mcp → 401 + WWW-Authenticate (before any side effect)
//   4. Un-tokened POST /assets/blob/:sha → 401 (before putBlobStream consumes req)
//   5. Un-tokened POST /assets/manifest → 401 (before body read)
//   6. Valid engine bearer → POST /mcp initialize → 200
//   7. I-2 hermeticity (DES-096 DoD): workflow_run with valid bearer → workflow_status carries
//      `principal:<email>` AND the principal is absent from the sandbox child env vars
//
// Red reason: `src/auth/token-store.ts` + `src/auth/auth-service.ts` do not exist →
//   MODULE NOT FOUND → all tests fail at collect time. Correct red for unimplemented modules.
//   (Even before that, auth routes don't exist → un-tokened /mcp would return 200 not 401.)
//
// Mock policy (integration — DES-100): real `createServer` + real HTTP + real net-guard +
//   real SQLite token-store; Google is a legitimately-doubled external dep (injected jwksFetch
//   + googleBase pointing at a local test stub). No LLM/gateway mock (workflow_run uses
//   script-only, no real model call).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, generateKeyPairSync, createSign, randomBytes } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import http from 'node:http';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { TokenStore } from '../../src/auth/token-store.js';
import Database from 'better-sqlite3';

// ── RS256 test id_token helper ────────────────────────────────────────────────

type Jwk = Record<string, unknown>;

const { privateKey: testPrivKey, publicKey: testPubKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const TEST_KID = 'it078-key-1';

function b64u(s: string): string {
  return Buffer.from(s).toString('base64url');
}

function signRS256(payload: object, key: KeyObject = testPrivKey): string {
  const h = b64u(JSON.stringify({ alg: 'RS256', kid: TEST_KID, typ: 'JWT' }));
  const p = b64u(JSON.stringify(payload));
  const sig = createSign('SHA256').update(`${h}.${p}`).sign(key, 'base64url');
  return `${h}.${p}.${sig}`;
}

function makeTestJwk(key: KeyObject, kid: string): Jwk {
  return { ...(key.export({ format: 'jwk' }) as object), alg: 'RS256', use: 'sig', kid };
}

const TEST_JWK = makeTestJwk(testPubKey, TEST_KID);

function fakeJwksFetch(_base: string): Promise<Jwk[]> {
  return Promise.resolve([TEST_JWK]);
}

// ── test server lifecycle ─────────────────────────────────────────────────────

let server: Server;
let tmpDir: string;
const TEST_ISSUER = () => `http://127.0.0.1:${server.port}`;
const NOW_S = () => Math.floor(Date.now() / 1000);

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-it078-'));
  server = await createServer({
    port: 0,
    bind: '127.0.0.1',
    workRoot: tmpDir,
    // Auth config — injected test overrides (ServerConfig.auth, not yet on the interface)
    auth: {
      enabled: true,
      issuer: 'http://127.0.0.1:0', // placeholder; real issuer uses server.port after boot
      googleClientId: 'it078-client-id',
      googleClientSecret: 'it078-client-secret',
      googleBase: 'http://127.0.0.1:0',      // unused in these tests (no full OAuth flow)
      jwksFetch: fakeJwksFetch,
    },
  } as never); // `auth` not yet in ServerConfig → cast to avoid TS error
});

afterAll(async () => {
  await server?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

// Mint a bearer directly via TokenStore for IT-tier tests (sub-component access is fine at IT tier)
async function mintTestBearer(email: string): Promise<string> {
  // Open the token-store db (tests access it directly at integration tier)
  const dbPath = join(tmpDir, 'auth-tokens.db');
  const db = new Database(dbPath);
  const now = Date.now();
  const store = new TokenStore(db, {
    clock: () => now,
    csprng: (n: number) => randomBytes(n),
  });
  const { token } = store.issue(email, 7 * 24 * 3600_000); // 1 week TTL
  db.close();
  return token;
}

function mcpUrl() { return `http://127.0.0.1:${server.port}/mcp`; }
function blobUrl(sha: string) { return `http://127.0.0.1:${server.port}/assets/blob/${sha}`; }
function manifestUrl() { return `http://127.0.0.1:${server.port}/assets/manifest`; }
function registerUrl() { return `http://127.0.0.1:${server.port}/register`; }

// ── 1. Well-known endpoints ────────────────────────────────────────────────────

describe('OAuth well-known endpoints (DES-095, IT-078)', () => {
  it('GET /.well-known/oauth-protected-resource → 200 with resource + authorization_servers', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/.well-known/oauth-protected-resource`);
    expect(res.status).toBe(200);
    const body = await res.json() as { resource?: string; authorization_servers?: string[] };
    expect(typeof body.resource).toBe('string');
    expect(Array.isArray(body.authorization_servers)).toBe(true);
    expect(body.authorization_servers!.length).toBeGreaterThan(0);
  });

  it('GET /.well-known/oauth-authorization-server → 200 with PKCE/code discovery', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/.well-known/oauth-authorization-server`);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      issuer?: string;
      authorization_endpoint?: string;
      token_endpoint?: string;
      code_challenge_methods_supported?: string[];
    };
    expect(typeof body.issuer).toBe('string');
    expect(typeof body.authorization_endpoint).toBe('string');
    expect(typeof body.token_endpoint).toBe('string');
    expect(body.code_challenge_methods_supported).toContain('S256');
  });
});

// ── 2. Protected surfaces refuse un-tokened requests ──────────────────────────

describe('Protected surfaces → 401 without bearer (DES-095, DES-096, IT-078)', () => {
  it('POST /mcp without Authorization → 401 + WWW-Authenticate', async () => {
    const res = await fetch(mcpUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBeTruthy();
  });

  it('POST /assets/blob/:sha without Authorization → 401 (before body consumed)', async () => {
    const sha = 'a'.repeat(64);
    const res = await fetch(blobUrl(sha), {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: Buffer.from('test-bytes'),
    });
    expect(res.status).toBe(401);
  });

  it('POST /assets/manifest without Authorization → 401 (before body read)', async () => {
    const res = await fetch(manifestUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([{ path: 'f.txt', sha256: 'a'.repeat(64) }]),
    });
    expect(res.status).toBe(401);
  });
});

// ── 3. Valid bearer → protected surfaces proceed ──────────────────────────────

describe('Valid bearer → 200 on protected surfaces (DES-095, DES-096, IT-078)', () => {
  it('POST /mcp with valid bearer → not 401 (initialize proceeds)', async () => {
    const token = await mintTestBearer('it078-user@example.com');
    const res = await fetch(mcpUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } } }),
    });
    expect(res.status).not.toBe(401);
    expect(res.status).toBe(200);
  });
});

// ── 4. I-2 hermeticity: principal present on status, absent from sandbox env ─

describe('I-2 hermeticity (DES-096 DoD, IT-078)', () => {
  it('workflow_run with bearer → workflow_status carries principal:<email> AND principal absent from run workspace files', async () => {
    const email = 'hermetic-it078@example.com';
    const token = await mintTestBearer(email);

    // Use a simple script — no process.env introspection (not available in VM sandbox)
    const runRes = await fetch(mcpUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: { name: 'workflow_run', arguments: { script: `return "done";` } },
      }),
    });
    expect(runRes.status).toBe(200);
    const runBody = await runRes.json() as { result?: { content?: Array<{ text?: string }> } };
    const runResult = JSON.parse(runBody.result?.content?.[0]?.text ?? '{}') as { runId?: string };
    const runId = runResult.runId;
    expect(typeof runId).toBe('string');

    // Poll for completion
    let status: Record<string, unknown> = {};
    for (let i = 0; i < 30; i++) {
      const sRes = await fetch(mcpUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 2, method: 'tools/call',
          params: { name: 'workflow_status', arguments: { runId } },
        }),
      });
      const sBody = await sRes.json() as { result?: { content?: Array<{ text?: string }> } };
      status = JSON.parse(sBody.result?.content?.[0]?.text ?? '{}') as Record<string, unknown>;
      if (status.status === 'completed' || status.status === 'failed') break;
      await new Promise(r => setTimeout(r, 200));
    }

    // Assert principal is attributed on the control-plane row (I-2 presence half)
    expect(typeof status.principal).toBe('string');
    expect(status.principal).toBe(email);

    // I-2 absence half: scan the run workspace files for the principal email.
    // Pinned contract: ad-hoc workspace = join(workRoot, 'workflows', '_adhoc', 'runs', runId)
    // Unconditional — readdirSync throws ENOENT if workspace doesn't exist, failing the test.
    const wsPath = join(tmpDir, 'workflows', '_adhoc', 'runs', runId as string);
    const entries = readdirSync(wsPath, { recursive: true }) as string[];
    const foundInWorkspace = entries.some(f => {
      const fp = join(wsPath, f);
      try { return readFileSync(fp, 'utf8').includes(email); } catch { return false; }
    });
    expect(foundInWorkspace, 'principal must not appear in any run workspace file').toBe(false);
  }, 20_000);
});

// ── v16 HIGH-1: /authorize redirect_uri validation (DES-095 v16, ARCH-059 inv.4) ─────────────
//
// RED reason: authorize() calls tokenStore.putState() with NO redirect_uri validation.
// isLoopbackRedirectUri() does not exist yet → non-loopback URIs get a state row + 302 to Google
// instead of a 400 with no state row.
//
// NOTE: /authorize returns 302 when it succeeds (redirect to Google). We use node:http directly
// so redirects are NOT followed — only the server's immediate response status is observed.

/** GET via node:http without following redirects. */
function rawHttpGet(url: string): Promise<{ status: number; location: string | undefined }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      res.resume(); // drain body
      res.on('end', () => resolve({ status: res.statusCode ?? 0, location: res.headers.location }));
    });
    req.on('error', reject);
  });
}

/** Count rows in a SQLite table via a fresh DB handle (closed immediately after). */
function countRows(dbPath: string, table: string): number {
  const db = new Database(dbPath);
  const n = (db.prepare(`SELECT COUNT(*) as n FROM ${table}`).get() as { n: number }).n;
  db.close();
  return n;
}

describe('HIGH-1: /authorize redirect_uri validation — cases 8–9 (DES-095 v16, IT-078)', () => {
  // Helper: build /authorize URL with the given redirect_uri.
  // code_challenge_method=S256 is required; dummy code_challenge value is fine here.
  function authorizeUrl(redirectUri: string): string {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: 'it078-client-id',
      redirect_uri: redirectUri,
      code_challenge: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      code_challenge_method: 'S256',
    });
    return `http://127.0.0.1:${server.port}/authorize?${params}`;
  }

  // Case 8a (RED): non-loopback https redirect_uri → 400 invalid_request
  // Pre-fix: returns 302; Post-fix: returns 400
  it('case 8a: non-loopback https redirect_uri → 400 invalid_request (RED pre-fix)', async () => {
    const { status } = await rawHttpGet(authorizeUrl('https://evil.example/cb'));
    expect(status).toBe(400);
  });

  // Case 8b (RED): non-loopback redirect_uri → NO oauth_state row written
  // Pre-fix: row IS written; Post-fix: no row
  it('case 8b: non-loopback redirect_uri → no oauth_state row written (RED pre-fix)', async () => {
    const dbPath = join(tmpDir, 'auth-tokens.db');
    const before = countRows(dbPath, 'oauth_state');
    await rawHttpGet(authorizeUrl('https://attacker.example/steal'));
    const after = countRows(dbPath, 'oauth_state');
    expect(after).toBe(before); // no new state row for a rejected request
  });

  // Case 8c (RED): https://127.0.0.1 (https scheme, not http) → 400 (REQ: http: only, per RFC 8252)
  // Pre-fix: returns 302; Post-fix: 400
  it('case 8c: https://127.0.0.1/cb (https scheme) → 400 (http: only per RFC 8252, RED pre-fix)', async () => {
    const { status } = await rawHttpGet(authorizeUrl('https://127.0.0.1/cb'));
    expect(status).toBe(400);
  });

  // Case 8d (RED): unparseable garbage → 400 (try/catch → false in isLoopbackRedirectUri)
  // Pre-fix: returns 302; Post-fix: 400
  it('case 8d: unparseable redirect_uri garbage → 400 (RED pre-fix)', async () => {
    const { status } = await rawHttpGet(authorizeUrl('not-a-uri-at-all'));
    expect(status).toBe(400);
  });

  // Case 8e (RED): empty redirect_uri → 400 (missing/empty → false in isLoopbackRedirectUri)
  // Pre-fix: returns 302; Post-fix: 400
  it('case 8e: empty redirect_uri → 400 (RED pre-fix)', async () => {
    const { status } = await rawHttpGet(authorizeUrl(''));
    expect(status).toBe(400);
  });

  // Case 8f (RED): missing redirect_uri param entirely → 400
  // Pre-fix: redirectUri = '' (missing) → 302; Post-fix: 400
  it('case 8f: missing redirect_uri param → 400 (RED pre-fix)', async () => {
    const url = `http://127.0.0.1:${server.port}/authorize?response_type=code&client_id=it078-client-id&code_challenge=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&code_challenge_method=S256`;
    const { status } = await rawHttpGet(url);
    expect(status).toBe(400);
  });

  // Case 9a (guard — GREEN pre and post fix): loopback 127.0.0.1 redirect_uri → 302 (allowed)
  it('case 9a: loopback 127.0.0.1 redirect_uri → NOT 400 (regression guard)', async () => {
    const { status } = await rawHttpGet(authorizeUrl('http://127.0.0.1:5599/cb'));
    expect(status).not.toBe(400);
    expect(status).toBe(302);
  });

  // Case 9b (guard): localhost redirect_uri → 302 (allowed)
  it('case 9b: loopback localhost redirect_uri → NOT 400 (regression guard)', async () => {
    const { status } = await rawHttpGet(authorizeUrl('http://localhost:5599/cb'));
    expect(status).not.toBe(400);
  });

  // Case 9c (guard — named test for URL.hostname bracket footgun per DES-095 v16):
  // http://[::1]:<port>/cb → isLoopbackRedirectUri must return true (WHATWG URL.hostname
  // serializes IPv6 with brackets: new URL('http://[::1]:1/').hostname === '[::1]').
  // Green pre-fix (no validation; post-fix: implementation must not special-case this wrong).
  it('case 9c: IPv6 loopback http://[::1]:<port>/cb → NOT 400 (regression guard, DES-095 v16 named)', async () => {
    const { status } = await rawHttpGet(authorizeUrl('http://[::1]:5599/cb'));
    expect(status).not.toBe(400);
  });
});

// ── v16 MED-2: gcExpired() wired to sweep (DES-093 v16, DES-095 v16) ────────────────────────
//
// RED reason: server.ts sweep only calls reclaimStaleWorkspaces(), never tokenStore.gcExpired().
// Expired bearer/auth-code/state rows accumulate without bound.
//
// Observable: insert an expired oauth_state row + a live bearer row before the sweep fires,
// then wait for the sweep; assert the expired row is gone and the live bearer is retained.
// Pre-fix: expired row survives (gcExpired not called) → test FAILS (RED).
//
// NOTE on MED-2 widened sweep-creation condition (DES-095 v16 — sweep created when
// auth-enabled OR workspaceTtlMs>0, not only workspaceTtlMs>0):
// The auth-only / no-TTL case would fire the sweep hourly with no test-injectable cadence seam —
// not IT-testable by waiting. It is NOT asserted here. Gate 6 reviewer must confirm the widened
// condition in server.ts (the `if (config?.workspaceTtlMs ... || authCfg)` branch) and
// Gate 7 regression must verify no auth-enabled configs skip the sweep.

let serverSweep: Server;
let tmpDirSweep: string;

beforeAll(async () => {
  tmpDirSweep = mkdtempSync(join(tmpdir(), 'rwe-it078-sweep-'));
  serverSweep = await createServer({
    port: 0,
    bind: '127.0.0.1',
    workRoot: tmpDirSweep,
    workspaceTtlMs: 100, // very short → sweep fires every 100ms, GC authTable side-effect observable
    auth: {
      enabled: true,
      issuer: 'http://127.0.0.1:0',
      googleClientId: 'sweep-client-id',
      googleClientSecret: 'sweep-client-secret',
      jwksFetch: fakeJwksFetch,
    },
  } as never);
});

afterAll(async () => {
  await serverSweep?.close();
  rmSync(tmpDirSweep, { recursive: true, force: true });
});

describe('MED-2: gcExpired() wired to sweep — case 10 + case 18 (DES-093 v16/v17, DES-095 v16, IT-078)', () => {
  it('case 10: expired auth rows GC-ed by sweep; live bearer retained (RED pre-fix)', async () => {
    const dbPath = join(tmpDirSweep, 'auth-tokens.db');
    const now = Date.now();

    // Insert already-expired oauth_state row (expires 5s in the past)
    const expiredState = 'med2-expired-state-' + randomBytes(4).toString('hex');
    const db = new Database(dbPath);
    db.prepare(
      'INSERT INTO oauth_state (state, nonce, code_challenge, redirect_uri, expires_at) VALUES (?, ?, ?, ?, ?)'
    ).run(expiredState, 'nonce1', 'chal1', 'http://127.0.0.1:1/cb', now - 5_000);

    // Insert live bearer row (expires 7 days from now — must NOT be GC'd)
    const liveBearerRaw = 'med2-live-bearer-' + randomBytes(8).toString('hex');
    const liveBearerHash = createHash('sha256').update(liveBearerRaw).digest('hex');
    db.prepare(
      'INSERT INTO bearer_tokens (token_hash, principal, issued_at, expires_at) VALUES (?, ?, ?, ?)'
    ).run(liveBearerHash, 'med2-user@example.com', now, now + 7 * 24 * 3600_000);
    db.close();

    // Poll until the expired row disappears or deadline (3 s).
    // Pre-fix: row survives indefinitely → loop exhausts → fail.
    // Post-fix: gcExpired() called by sweep within ~100ms → row deleted → loop exits early.
    const deadline = Date.now() + 3_000;
    let expiredRowGone = false;
    while (Date.now() < deadline) {
      const db2 = new Database(dbPath);
      const row = db2.prepare('SELECT state FROM oauth_state WHERE state = ?').get(expiredState);
      db2.close();
      if (row === undefined) { expiredRowGone = true; break; }
      await new Promise(r => setTimeout(r, 100));
    }

    // Assert expired row is gone (GC'd)
    expect(expiredRowGone, 'expired oauth_state row must be deleted by gcExpired() within 3 s').toBe(true);

    // Assert live bearer is retained
    const db3 = new Database(dbPath);
    const liveRow = db3.prepare('SELECT principal FROM bearer_tokens WHERE token_hash = ?').get(liveBearerHash) as { principal: string } | undefined;
    db3.close();
    expect(liveRow?.principal, 'live bearer must be retained (not deleted by GC)').toBe('med2-user@example.com');
  }, 10_000);

  // Case 18 (RED — v17 DCR): expired registered_clients row GC-ed by sweep; live row retained.
  // Pre-fix: registered_clients table does not exist → INSERT throws 'no such table' → test fails
  //   for the right reason (DES-093 v17 4th table not yet implemented).
  // Post-fix: table created by _init(), gcExpired() sweeps it → expired row gone within 3 s.
  it('case 18: expired registered_clients row GC-ed by sweep; live registration retained (DES-093 v17 4th table)', async () => {
    const dbPath = join(tmpDirSweep, 'auth-tokens.db');
    const now = Date.now();

    const expiredClientId = 'gc-expired-client-' + randomBytes(4).toString('hex');
    const liveClientId = 'gc-live-client-' + randomBytes(4).toString('hex');

    const db = new Database(dbPath);
    // Pre-fix: 'no such table: registered_clients' → test throws → RED for right reason
    db.prepare(
      'INSERT INTO registered_clients (client_id, redirect_uris, client_id_issued_at, expires_at) VALUES (?, ?, ?, ?)'
    ).run(expiredClientId, JSON.stringify(['http://127.0.0.1:1/cb']), Math.floor(now / 1000), now - 5_000);
    db.prepare(
      'INSERT INTO registered_clients (client_id, redirect_uris, client_id_issued_at, expires_at) VALUES (?, ?, ?, ?)'
    ).run(liveClientId, JSON.stringify(['http://127.0.0.1:2/cb']), Math.floor(now / 1000), now + 30 * 24 * 3600_000);
    db.close();

    // Poll until expired row disappears or deadline (3 s)
    const deadline = Date.now() + 3_000;
    let expiredRowGone = false;
    while (Date.now() < deadline) {
      const db2 = new Database(dbPath);
      const row = db2.prepare('SELECT client_id FROM registered_clients WHERE client_id = ?').get(expiredClientId);
      db2.close();
      if (row === undefined) { expiredRowGone = true; break; }
      await new Promise(r => setTimeout(r, 100));
    }

    expect(expiredRowGone, 'expired registered_clients row must be deleted by gcExpired() within 3 s').toBe(true);

    const db3 = new Database(dbPath);
    const liveRow = db3.prepare('SELECT client_id FROM registered_clients WHERE client_id = ?').get(liveClientId) as { client_id: string } | undefined;
    db3.close();
    expect(liveRow?.client_id, 'live registration must be retained (not deleted by GC)').toBe(liveClientId);
  }, 10_000);
});

// ── v17 RFC 7591 DCR: registration_endpoint in AS metadata ──────────────────
//
// RED reason: buildAuthServerMetadata does not return registration_endpoint yet (DES-092 v17).
// Pre-fix: field absent → typeof undefined !== 'string' → assertion fails.

describe('v17 DCR: registration_endpoint in AS metadata (DES-092 v17, IT-078)', () => {
  it('case 11: GET /.well-known/oauth-authorization-server → registration_endpoint present', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/.well-known/oauth-authorization-server`);
    expect(res.status).toBe(200);
    const body = await res.json() as { registration_endpoint?: string };
    // Pre-fix: registration_endpoint absent → fail; Post-fix: exactly `${issuer}/register`
    expect(typeof body.registration_endpoint).toBe('string');
    expect(body.registration_endpoint).toBe(`http://127.0.0.1:${server.port}/register`);
  });
});

// ── v17 RFC 7591 DCR: POST /register handler (DES-095 v17, DES-093 v17) ────
//
// RED reason: POST /register route does not exist yet → server returns 404 (or 405) →
//   expect(res.status).toBe(201) fails for all happy-path cases, and expect(res.status).toBe(400)
//   fails for validation cases (404 ≠ 400), all for the right reason: route unimplemented.
//
// Mock policy: same real server + real SQLite as the rest of IT-078; no auth header required
//   (public endpoint per DES-095 v17 — a spec-only client registers before it has any token).

/** Build a /authorize URL with an explicit client_id and redirect_uri. */
function authorizeWithClientUrl(redirectUri: string, clientId: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    code_challenge_method: 'S256',
  });
  return `http://127.0.0.1:${server.port}/authorize?${params}`;
}

describe('v17 DCR: POST /register happy path + validation (DES-095 v17, DES-093 v17, IT-078)', () => {
  // Case 12: happy path — public endpoint, loopback redirect_uri → 201, clamped fields, no client_secret
  it('case 12: POST /register with loopback redirect_uri → 201, no auth required, no client_secret', async () => {
    const res = await fetch(registerUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ redirect_uris: ['http://127.0.0.1:33333/cb'] }),
    });
    // Pre-fix: 404 (route absent); Post-fix: 201
    expect(res.status).toBe(201);
    const body = await res.json() as {
      client_id?: string;
      client_id_issued_at?: number;
      redirect_uris?: string[];
      grant_types?: string[];
      response_types?: string[];
      token_endpoint_auth_method?: string;
      client_secret?: unknown;
    };
    expect(typeof body.client_id).toBe('string');
    // client_id_issued_at MUST be in seconds (RFC 7591) — DES-093 seam (ms vs s trap)
    expect(body.client_id_issued_at).toBeGreaterThan(1e9);
    expect(body.client_id_issued_at).toBeLessThan(1e10);
    expect(body.redirect_uris).toEqual(['http://127.0.0.1:33333/cb']);
    expect(body.grant_types).toEqual(['authorization_code']);
    expect(body.response_types).toEqual(['code']);
    expect(body.token_endpoint_auth_method).toBe('none');
    // MUST NOT include client_secret (public PKCE client — DES-095 v17)
    expect(body).not.toHaveProperty('client_secret');
  });

  // Case 13: clamp-don't-reject richer metadata (Decision B — what un-breaks live connect)
  // MCP SDK requests refresh_token in grant_types; rejecting would re-break live connect.
  it('case 13: POST /register with refresh_token grant_type → 201 with clamped grant_types (Decision B)', async () => {
    const res = await fetch(registerUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        redirect_uris: ['http://127.0.0.1:33334/cb'],
        grant_types: ['authorization_code', 'refresh_token'],
        token_endpoint_auth_method: 'client_secret_basic',
      }),
    });
    // Pre-fix: 404; Post-fix: 201 (NOT 400)
    expect(res.status).toBe(201);
    const body = await res.json() as { grant_types?: string[] };
    expect(body.grant_types).toEqual(['authorization_code']); // clamped, not echoed
  });

  // Case 14a: non-loopback redirect_uri → 400 invalid_redirect_uri
  it('case 14a: POST /register non-loopback redirect_uri → 400 invalid_redirect_uri', async () => {
    const res = await fetch(registerUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ redirect_uris: ['https://evil.example/cb'] }),
    });
    // Pre-fix: 404 ≠ 400 → fail; Post-fix: 400
    expect(res.status).toBe(400);
    const body = await res.json() as { error?: string };
    expect(body.error).toBe('invalid_redirect_uri');
  });

  // Case 14b: empty redirect_uris array → 400 invalid_redirect_uri
  it('case 14b: POST /register empty redirect_uris array → 400 invalid_redirect_uri', async () => {
    const res = await fetch(registerUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ redirect_uris: [] }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error?: string };
    expect(body.error).toBe('invalid_redirect_uri');
  });

  // Case 14c: unparseable JSON body → 400 invalid_client_metadata
  it('case 14c: POST /register unparseable JSON body → 400 invalid_client_metadata', async () => {
    const res = await fetch(registerUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not valid json',
    });
    // Pre-fix: 404 ≠ 400 → fail; Post-fix: 400
    expect(res.status).toBe(400);
    const body = await res.json() as { error?: string };
    expect(body.error).toBe('invalid_client_metadata');
  });

  // Case 15: persistence observable — registered_clients row exists after 201
  it('case 15: POST /register → registered_clients row persisted (DES-093 v17 4th table)', async () => {
    const res = await fetch(registerUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ redirect_uris: ['http://127.0.0.1:33335/cb'] }),
    });
    // Pre-fix: 404 → fails here before DB check
    expect(res.status).toBe(201);
    const { client_id } = await res.json() as { client_id: string };
    // Check DB directly (IT-tier: sub-component access allowed)
    // Pre-fix (if route existed but table missing): throws 'no such table: registered_clients'
    const dbPath = join(tmpDir, 'auth-tokens.db');
    const db = new Database(dbPath);
    const row = db.prepare('SELECT client_id FROM registered_clients WHERE client_id = ?').get(client_id) as { client_id: string } | undefined;
    db.close();
    expect(row?.client_id).toBe(client_id);
  });
});

// ── v17 DCR: /authorize registered-client binding (DES-095 v17) ─────────────
//
// RED reason: /register route absent → regRes.status ≠ 201 → test aborts before /authorize call.
// Post-fix behavioral contract (verified once /register exists):
//   case 16: same scheme+host+path but DIFFERENT port → 302 (RFC 8252 §7.3 port-ignored)
//   case 17: same scheme+host but DIFFERENT pathname → 400 invalid_request + no oauth_state row

describe('v17 DCR: /authorize registered-client binding (DES-095 v17, IT-078)', () => {
  it('case 16: /authorize with registered client_id + different port → 302 (RFC 8252 §7.3 port-ignored)', async () => {
    // Register client with port 33333
    const regRes = await fetch(registerUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ redirect_uris: ['http://127.0.0.1:33333/cb'] }),
    });
    // Pre-fix: 404 → fail here; Post-fix: continue
    expect(regRes.status).toBe(201);
    const { client_id } = await regRes.json() as { client_id: string };

    // /authorize with same scheme+host+path but DIFFERENT port 44444
    // Port-ignored per RFC 8252 §7.3 → must be 302 (allowed), not 400
    const { status } = await rawHttpGet(authorizeWithClientUrl('http://127.0.0.1:44444/cb', client_id));
    expect(status).toBe(302);
  });

  it('case 17: /authorize with registered client_id + mismatched pathname → 400 invalid_request, no state row', async () => {
    // Register client with path /cb
    const regRes = await fetch(registerUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ redirect_uris: ['http://127.0.0.1:33336/cb'] }),
    });
    // Pre-fix: 404 → fail here; Post-fix: continue
    expect(regRes.status).toBe(201);
    const { client_id } = await regRes.json() as { client_id: string };

    // /authorize with same host but DIFFERENT pathname /other → must be 400 (binding mismatch)
    const dbPath = join(tmpDir, 'auth-tokens.db');
    const before = countRows(dbPath, 'oauth_state');
    const { status } = await rawHttpGet(authorizeWithClientUrl('http://127.0.0.1:33336/other', client_id));
    const after = countRows(dbPath, 'oauth_state');
    expect(status).toBe(400);
    expect(after).toBe(before); // no state row written for rejected request
  });
});

// ── v18: DISTINCT Google OAuth URL fields — cases 19-20 (DES-095 v18) ────────
//
// RED reason: pre-impl `createAuthRouteHandlers` reads cfg.googleBase (fallback:
// 'https://accounts.google.com'). It ignores cfg.googleAuthorizeUrl / cfg.googleTokenUrl.
//
// Case 19 (hermetic): /authorize with the v18 config → 302 Location origin must
//   equal the injected googleAuthorizeUrl origin.
//   Pre-impl: Location origin = googleBase fallback ('http://127.0.0.1:59990') ≠ '59099' → FAIL.
//   Post-impl: Location origin = googleAuthorizeUrl ('http://127.0.0.1:59099') → PASS.
//
// Case 20 (full repro): authorize → parse state+nonce from Location →
//   GET /oauth/google/callback → engine exchanges code at injected googleTokenUrl
//   (fake server on a DISTINCT port).
//   Pre-impl: engine uses googleBase ('http://127.0.0.1:59990', dead) → ECONNREFUSED → 502.
//   Post-impl: engine uses googleTokenUrl (live fake token server) → signed id_token → 302.
//
// Mock policy: serverV18 has jwksFetch injected (same fakeJwksFetch); googleBase set to a
//   dead loopback port (59990) for hermetic pre-impl failure (no real Google calls).
//   googleAuthorizeUrl and googleTokenUrl use DISTINCT loopback ports (59099 vs dynamic).

let fakeV18TokenNonce = '';
let fakeV18TokenServer: import('node:http').Server;
let fakeV18TokenPort: number;
let serverV18: Server;
let tmpDirV18: string;

beforeAll(async () => {
  // Start the fake Google token server for case 20 on a random port.
  // Distinct from googleAuthorizeUrl (port 59099) — satisfying the "two origins" contract.
  await new Promise<void>((resolve, reject) => {
    fakeV18TokenServer = http.createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/token') {
        let body = '';
        req.on('data', (c: Buffer) => { body += c.toString(); });
        req.on('end', () => {
          const nowS = Math.floor(Date.now() / 1000);
          const idToken = signRS256({
            iss: 'https://accounts.google.com',
            aud: 'it078v18-client-id',
            exp: nowS + 300,
            iat: nowS - 5,
            sub: 'case20-uid',
            email: 'case20@example.com',
            email_verified: true,
            nonce: fakeV18TokenNonce,
          });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            id_token: idToken,
            access_token: 'fake-access-v18',
            token_type: 'Bearer',
          }));
        });
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    fakeV18TokenServer.listen(0, '127.0.0.1', () => {
      fakeV18TokenPort = (fakeV18TokenServer.address() as { port: number }).port;
      resolve();
    });
    fakeV18TokenServer.once('error', reject);
  });

  tmpDirV18 = mkdtempSync(join(tmpdir(), 'rwe-it078v18-'));
  serverV18 = await createServer({
    port: 0,
    bind: '127.0.0.1',
    workRoot: tmpDirV18,
    auth: {
      enabled: true,
      issuer: 'http://127.0.0.1:0',
      googleClientId: 'it078v18-client-id',
      googleClientSecret: 'it078v18-secret',
      // v18 new fields (DES-095 v18) — ignored by pre-impl code:
      googleAuthorizeUrl: 'http://127.0.0.1:59099',           // case 19 assertion target
      googleTokenUrl: `http://127.0.0.1:${fakeV18TokenPort}/token`, // case 20 token exchange
      googleJwksUrl: 'http://127.0.0.1:59099/certs',          // not used (jwksFetch injected)
      // Legacy fallback — pre-impl uses this; 59990 is a dead port → hermetic ECONNREFUSED:
      googleBase: 'http://127.0.0.1:59990',
      jwksFetch: fakeJwksFetch,
    },
  } as never);
});

afterAll(async () => {
  await serverV18?.close();
  await new Promise<void>((r) => fakeV18TokenServer?.close(() => r()));
  rmSync(tmpDirV18, { recursive: true, force: true });
});

describe('v18: /authorize uses injected googleAuthorizeUrl — case 19 (DES-095 v18, IT-078)', () => {
  it('case 19: /authorize → 302 Location origin equals injected googleAuthorizeUrl (not googleBase fallback)', async () => {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: 'it078v18-client-id',
      redirect_uri: 'http://127.0.0.1:19999/cb',
      code_challenge: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      code_challenge_method: 'S256',
    });
    const { status, location } = await rawHttpGet(
      `http://127.0.0.1:${serverV18.port}/authorize?${params}`
    );
    expect(status).toBe(302);
    expect(location).toBeDefined();
    const locUrl = new URL(location!);
    // Pre-impl: origin = 'http://127.0.0.1:59990' (googleBase fallback) → FAIL
    // Post-impl: origin = 'http://127.0.0.1:59099' (googleAuthorizeUrl) → PASS
    expect(locUrl.origin).toBe('http://127.0.0.1:59099');
  });
});

describe('v18: /oauth/google/callback uses injected googleTokenUrl — case 20 (DES-095 v18, IT-078)', () => {
  it('case 20: full callback flow → engine exchanges code at googleTokenUrl (distinct port from googleAuthorizeUrl)', async () => {
    // Step 1: GET /authorize — parse state + nonce from the 302 Location
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: 'it078v18-client-id',
      redirect_uri: 'http://127.0.0.1:19999/cb',
      code_challenge: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      code_challenge_method: 'S256',
    });
    const authResp = await rawHttpGet(
      `http://127.0.0.1:${serverV18.port}/authorize?${params}`
    );
    expect(authResp.status).toBe(302);
    const locUrl = new URL(authResp.location!);
    const state = locUrl.searchParams.get('state') ?? '';
    const nonce = locUrl.searchParams.get('nonce') ?? '';
    expect(state.length).toBeGreaterThan(0);
    expect(nonce.length).toBeGreaterThan(0);
    fakeV18TokenNonce = nonce; // so fake token server echoes the correct nonce

    // Step 2: GET /oauth/google/callback — engine exchanges code at googleTokenUrl
    const cbResp = await rawHttpGet(
      `http://127.0.0.1:${serverV18.port}/oauth/google/callback?` +
        new URLSearchParams({ state, code: 'fake-case20-google-code' })
    );
    // Pre-impl: engine uses googleBase fallback ('http://127.0.0.1:59990', dead)
    //   → fetch throws ECONNREFUSED → 502 google_token_error → FAIL
    // Post-impl: engine uses googleTokenUrl → fake token server → signed id_token
    //   → verifyIdToken → mintAuthCode → 302 to redirectUri?code=ENGINE_CODE → PASS
    expect(cbResp.status).toBe(302);
    const cbUrl = new URL(cbResp.location!);
    expect((cbUrl.searchParams.get('code') ?? '').length).toBeGreaterThan(0);
  }, 15_000);
});
