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

describe('MED-2: gcExpired() wired to sweep — case 10 (DES-093 v16, DES-095 v16, IT-078)', () => {
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
});
