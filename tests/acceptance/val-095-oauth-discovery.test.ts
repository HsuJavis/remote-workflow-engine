// VAL-095 (REQ-012): Engine-as-own-AS — OAuth 2.0 discovery driven via real MCP client SDK +
// full 4-route auth flow + protected surfaces enforce auth when enabled;
// auth disabled → pre-v15 behavior preserved.
//
// REQ-012 acceptance criteria:
//   Given auth enabled: the 4 OAuth routes are present and serve valid RFC 8414 discovery docs;
//   the SDK-driven discovery handshake (protected-resource metadata → AS metadata →
//   discovered authorization_endpoint) resolves to the engine's own AS metadata;
//   the full PKCE authorization_code flow (via injected fake Google) yields an engine bearer;
//   that bearer grants access to protected surfaces; invalid/absent bearer → 401 + WWW-Authenticate
//   with resource_metadata URL (verified via SDK extractWWWAuthenticateParams).
//   Given auth disabled: behavior byte-for-byte matches pre-v15 (no 401 added).
//
// Cases:
//   1. discoverOAuthProtectedResourceMetadata(serverUrl) → resource + authorization_servers
//   2. discoverOAuthProtectedResourceMetadata → authorization_servers[0] →
//      discoverAuthorizationServerMetadata → S256 + code fields
//   3+4. Full PKCE auth_code flow using the SDK-discovered authorization_endpoint:
//      a. GET <discovered authorization_endpoint> → 302 redirect to googleBase (with state, nonce)
//      b. Fake Google token endpoint returns a signed id_token
//      c. GET /oauth/google/callback?state&code → 302 with engine auth-code
//      d. POST /token (code + PKCE verifier) → {access_token, token_type:"Bearer", expires_in}
//      e. Bearer-authed POST /mcp → 200
//   5. No bearer → POST /mcp → 401 + extractWWWAuthenticateParams.resourceMetadataUrl defined
//   6. Auth disabled server → POST /mcp (no bearer) → 200 (pre-v15 open)
//
// Red reason (pre-impl): src/auth/*.ts don't exist → auth routes return 404 →
//   discoverOAuthProtectedResourceMetadata throws ("Resource server does not implement ...") →
//   cases 1, 2, and 3+4 fail; no auth enforcement → case 5 gets 200 instead of 401 → fails.
//   Correct RED for unimplemented auth routes.
//
// Mock policy (acceptance — DES-100): MUST NOT mock the SUT's own boundaries (4 OAuth routes,
//   resolvePrincipal, net-guard, catalog, token-store). Google is a LEGITIMATELY DOUBLED external
//   dep: a minimal local HTTP server simulates Google's /token endpoint + injected jwksFetch
//   for JWKS (no real Google network call). Discovery calls hit the real SUT entrypoint.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, generateKeyPairSync, createSign } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import {
  discoverOAuthProtectedResourceMetadata,
  discoverAuthorizationServerMetadata,
  extractWWWAuthenticateParams,
} from '@modelcontextprotocol/sdk/client/auth.js';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { createServer as nodeHttpCreateServer } from 'node:http';
import type { Server as NodeHttpServer } from 'node:http';

// ── RS256 key for fake Google ─────────────────────────────────────────────────

const { privateKey: googlePrivKey, publicKey: googlePubKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const GOOGLE_KID = 'val095-google-key';

function b64u(s: string): string { return Buffer.from(s).toString('base64url'); }

function signIdToken(payload: object): string {
  const h = b64u(JSON.stringify({ alg: 'RS256', kid: GOOGLE_KID, typ: 'JWT' }));
  const p = b64u(JSON.stringify(payload));
  const sig = createSign('SHA256').update(`${h}.${p}`).sign(googlePrivKey, 'base64url');
  return `${h}.${p}.${sig}`;
}

function makeJwk(key: KeyObject, kid: string): Record<string, unknown> {
  return { ...(key.export({ format: 'jwk' }) as object), alg: 'RS256', use: 'sig', kid };
}

const TEST_JWK = makeJwk(googlePubKey, GOOGLE_KID);
const TEST_EMAIL = 'val095-user@example.com';
const TEST_CLIENT_ID = 'val095-google-client-id';

// ── PKCE helpers ──────────────────────────────────────────────────────────────

function makeCodeVerifier(): string {
  return Buffer.from(createHash('sha256').update(String(Math.random())).digest()).toString('base64url').slice(0, 43);
}

function makeCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

// ── Fake Google OAuth server ───────────────────────────────────────────────────

/** A tiny local HTTP server that simulates Google's token exchange endpoint.
 *  Accepts POST /token with a code, returns a signed RS256 id_token. */
let fakeGoogleServer: NodeHttpServer;
let fakeGooglePort: number;
let lastExpectedNonce = '';

beforeAll(async () => {
  await new Promise<void>((resolve, reject) => {
    fakeGoogleServer = nodeHttpCreateServer((req, res) => {
      if (req.method === 'POST' && req.url === '/token') {
        let body = '';
        req.on('data', (c: Buffer) => { body += c.toString(); });
        req.on('end', () => {
          const nowS = Math.floor(Date.now() / 1000);
          const idToken = signIdToken({
            iss: 'https://accounts.google.com',
            aud: TEST_CLIENT_ID,
            exp: nowS + 300,
            iat: nowS - 5,
            sub: 'google-uid-val095',
            email: TEST_EMAIL,
            email_verified: true,
            nonce: lastExpectedNonce,
          });
          const payload = JSON.stringify({ id_token: idToken, access_token: 'fake-goog-access', token_type: 'Bearer' });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(payload);
        });
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    fakeGoogleServer.listen(0, '127.0.0.1', () => {
      fakeGooglePort = (fakeGoogleServer.address() as { port: number }).port;
      resolve();
    });
    fakeGoogleServer.once('error', reject);
  });
});

// ── Test server (auth enabled) ─────────────────────────────────────────────────

let server: Server;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-val095-'));
  server = await createServer({
    port: 0,
    bind: '127.0.0.1',
    workRoot: tmpDir,
    auth: {
      enabled: true,
      issuer: `http://127.0.0.1:0`,  // placeholder; real issuer built after boot
      googleClientId: TEST_CLIENT_ID,
      googleClientSecret: 'val095-client-secret',
      googleBase: `http://127.0.0.1:${fakeGooglePort}`,
      jwksFetch: (_base: string) => Promise.resolve([TEST_JWK]),
    },
  } as never);
});

afterAll(async () => {
  await server?.close();
  await new Promise<void>((r) => fakeGoogleServer?.close(() => r()));
  rmSync(tmpDir, { recursive: true, force: true });
});

// ── Auth-disabled server (backward-compat) ────────────────────────────────────

let serverAuthOff: Server;
let tmpDir2: string;

beforeAll(async () => {
  tmpDir2 = mkdtempSync(join(tmpdir(), 'rwe-val095b-'));
  serverAuthOff = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir2 });
});

afterAll(async () => {
  await serverAuthOff?.close();
  rmSync(tmpDir2, { recursive: true, force: true });
});

// ── helper: drive the full 4-route OAuth flow using SDK-discovered authorization_endpoint ──────

async function getBearerViaFakeGoogle(): Promise<string> {
  const base = `http://127.0.0.1:${server.port}`;
  const redirectUri = `${base}/oauth/google/callback`;

  // SDK-driven discovery: protected-resource metadata → AS metadata → authorization_endpoint
  const prm = await discoverOAuthProtectedResourceMetadata(base);
  const asMeta = await discoverAuthorizationServerMetadata(prm.authorization_servers![0]);
  const authorizeBase = asMeta!.authorization_endpoint;

  const codeVerifier = makeCodeVerifier();
  const codeChallenge = makeCodeChallenge(codeVerifier);

  // Step 1: GET <discovered authorization_endpoint> (no redirect follow) → capture state + nonce
  const authRes = await fetch(authorizeBase + '?' + new URLSearchParams({
    response_type: 'code',
    client_id: 'val095-mcp-client',
    redirect_uri: redirectUri,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  }), { redirect: 'manual' });
  expect(authRes.status).toBe(302);
  const authLocation = authRes.headers.get('location') ?? '';
  const authUrl = new URL(authLocation);
  const state = authUrl.searchParams.get('state') ?? '';
  const nonce = authUrl.searchParams.get('nonce') ?? '';
  lastExpectedNonce = nonce;

  // Step 2: Simulate Google calling back our engine with a code
  const fakeGoogleCode = 'fake-google-code-val095';

  // Step 3: GET /oauth/google/callback?state=<state>&code=<fake-google-code>
  const cbRes = await fetch(`${base}/oauth/google/callback?` + new URLSearchParams({
    state,
    code: fakeGoogleCode,
  }), { redirect: 'manual' });
  expect(cbRes.status).toBe(302);
  const cbLocation = cbRes.headers.get('location') ?? '';
  const cbUrl = new URL(cbLocation);
  const engineCode = cbUrl.searchParams.get('code') ?? '';
  expect(engineCode.length).toBeGreaterThan(0);

  // Step 4: POST /token with engine code + PKCE verifier (uses discovered token_endpoint)
  const tokenEndpoint = asMeta!.token_endpoint;
  const tokenRes = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: engineCode,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
    }),
  });
  expect(tokenRes.status).toBe(200);
  const tokenBody = await tokenRes.json() as { access_token?: string; token_type?: string; expires_in?: number };
  expect(tokenBody.token_type).toBe('Bearer');
  expect(typeof tokenBody.access_token).toBe('string');
  expect(typeof tokenBody.expires_in).toBe('number');
  return tokenBody.access_token!;
}

// ── cases ─────────────────────────────────────────────────────────────────────

describe('REQ-012: OAuth 2.0 discovery via MCP SDK (VAL-095)', () => {
  it('case 1: discoverOAuthProtectedResourceMetadata → resource + authorization_servers', async () => {
    const meta = await discoverOAuthProtectedResourceMetadata(`http://127.0.0.1:${server.port}`);
    expect(typeof meta.resource).toBe('string');
    expect(Array.isArray(meta.authorization_servers)).toBe(true);
    expect((meta.authorization_servers ?? []).length).toBeGreaterThan(0);
  });

  it('case 2: SDK discovery chain: PRM → AS metadata → S256 + code fields', async () => {
    const prm = await discoverOAuthProtectedResourceMetadata(`http://127.0.0.1:${server.port}`);
    const asMeta = await discoverAuthorizationServerMetadata(prm.authorization_servers![0]);
    expect(asMeta).toBeDefined();
    expect(asMeta!.code_challenge_methods_supported).toContain('S256');
    expect(asMeta!.response_types_supported).toContain('code');
  });

  it('case 5: no bearer → POST /mcp → 401 + extractWWWAuthenticateParams.resourceMetadataUrl', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    });
    expect(res.status).toBe(401);
    const wwwParams = extractWWWAuthenticateParams(res);
    expect(wwwParams.resourceMetadataUrl).toBeDefined();
  });
});

describe('REQ-012: full PKCE auth_code flow via SDK-discovered endpoint + fake Google (VAL-095)', () => {
  it('case 3+4: SDK discovery → discovered authorize URL → engine bearer → /mcp succeeds', async () => {
    const bearer = await getBearerViaFakeGoogle();
    const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${bearer}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'val095', version: '1' } } }),
    });
    expect(res.status).toBe(200);
  });
});

describe('REQ-012: auth disabled → pre-v15 open behavior (VAL-095)', () => {
  it('case 6: auth disabled → /mcp without bearer → NOT 401 (open)', async () => {
    const res = await fetch(`http://127.0.0.1:${serverAuthOff.port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } } }),
    });
    expect(res.status).not.toBe(401);
    expect(res.status).toBe(200);
  });
});
