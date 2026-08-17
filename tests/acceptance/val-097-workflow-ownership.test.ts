// VAL-097 (REQ-087): Workflow ownership — only the creating principal can edit/deregister;
// others may run/read; idempotent boot backfill; null-principal ungated.
//
// REQ-087 acceptance criteria:
//   Given alice registers a workflow, When bob tries to register-overwrite or deregister it,
//   Then the operation fails with NOT_WORKFLOW_OWNER and the stored definition is unchanged;
//   When alice re-registers or deregisters, Then it succeeds;
//   When bob runs or reads alice's workflow, Then it succeeds (not gated);
//   Given a pre-v15 NULL-owner workflow, When the engine boots with auth enabled,
//   Then it is backfilled to hsuhungjung@gmail.com (idempotent across re-boots).
//
// Red reason: workflow_register does not yet accept `principal` / `owner` is not a column →
//   NOT_WORKFLOW_OWNER never returned → non-owner mutation succeeds when it should fail → FAIL.
//
// Mock policy (acceptance — DES-100): MUST NOT mock the SUT's own boundaries.
//   Bearer obtained via real engine /token route (full OAuth flow via fake Google).
//   No direct DB row insertion — principal passed as a tool arg per the v15 spec.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, generateKeyPairSync, createSign } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { createServer as nodeHttp } from 'node:http';
import type { Server as NodeServer } from 'node:http';

// ── fake Google for two users ─────────────────────────────────────────────────

const { privateKey: gPriv, publicKey: gPub } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const G_KID = 'val097-k1';
const CLIENT_ID = 'val097-cid';
const ALICE = 'alice-val097@example.com';
const BOB = 'bob-val097@example.com';

function b64u(s: string) { return Buffer.from(s).toString('base64url'); }
function signJwt(payload: object): string {
  const h = b64u(JSON.stringify({ alg: 'RS256', kid: G_KID, typ: 'JWT' }));
  const p = b64u(JSON.stringify(payload));
  return `${h}.${p}.${createSign('SHA256').update(`${h}.${p}`).sign(gPriv, 'base64url')}`;
}
function makeJwk(k: KeyObject, kid: string) { return { ...(k.export({ format: 'jwk' }) as object), alg: 'RS256', use: 'sig', kid }; }
const JWK = makeJwk(gPub, G_KID);

let fakeGoog: NodeServer;
let fakeGoogPort: number;
let currentEmail = ALICE;
let currentNonce = '';

beforeAll(async () => {
  await new Promise<void>((res, rej) => {
    fakeGoog = nodeHttp((req, resp) => {
      if (req.method === 'POST' && req.url === '/token') {
        req.resume();
        const nowS = Math.floor(Date.now() / 1000);
        const tok = signJwt({ iss: 'https://accounts.google.com', aud: CLIENT_ID, exp: nowS + 300, iat: nowS - 5, sub: `uid-${currentEmail}`, email: currentEmail, email_verified: true, nonce: currentNonce });
        resp.writeHead(200, { 'Content-Type': 'application/json' });
        resp.end(JSON.stringify({ id_token: tok, access_token: 'goog-at-val097', token_type: 'Bearer' }));
      } else { resp.writeHead(404); resp.end(); }
    });
    fakeGoog.listen(0, '127.0.0.1', () => { fakeGoogPort = (fakeGoog.address() as { port: number }).port; res(); });
    fakeGoog.once('error', rej);
  });
});

let server: Server;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-val097-'));
  server = await createServer({
    port: 0, bind: '127.0.0.1', workRoot: tmpDir,
    auth: { enabled: true, issuer: `http://127.0.0.1:0`, googleClientId: CLIENT_ID, googleClientSecret: 'val097-cs', googleBase: `http://127.0.0.1:${fakeGoogPort}`, jwksFetch: () => Promise.resolve([JWK]) },
  } as never);
});

afterAll(async () => {
  await server?.close();
  await new Promise<void>(r => fakeGoog?.close(() => r()));
  rmSync(tmpDir, { recursive: true, force: true });
});

// PKCE helpers
function mkV(): string { return Buffer.from(createHash('sha256').update('v097s').digest()).toString('base64url').slice(0, 43); }
function mkC(v: string): string { return createHash('sha256').update(v).digest('base64url'); }

async function getBearerFor(email: string): Promise<string> {
  currentEmail = email;
  const base = `http://127.0.0.1:${server.port}`;
  const cv = mkV(); const cc = mkC(cv);
  const rUri = `${base}/oauth/google/callback`;
  const a = await fetch(`${base}/authorize?` + new URLSearchParams({ response_type: 'code', client_id: 'c', redirect_uri: rUri, code_challenge: cc, code_challenge_method: 'S256' }), { redirect: 'manual' });
  const aLoc = new URL(a.headers.get('location') ?? 'http://x');
  currentNonce = aLoc.searchParams.get('nonce') ?? '';
  const state = aLoc.searchParams.get('state') ?? '';
  const cb = await fetch(`${base}/oauth/google/callback?state=${state}&code=fake097`, { redirect: 'manual' });
  const cbLoc = new URL(cb.headers.get('location') ?? 'http://x');
  const engineCode = cbLoc.searchParams.get('code') ?? '';
  const tok = await fetch(`${base}/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code: engineCode, code_verifier: cv, redirect_uri: rUri }) });
  const tb = await tok.json() as { access_token?: string };
  return tb.access_token ?? '';
}

async function mcp(bearer: string, name: string, args: Record<string, unknown>) {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${bearer}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}') as Record<string, unknown>;
}

const WF = 'owned-val097';
const SCRIPT = 'return "owned";';

describe('REQ-087: workflow ownership gate (VAL-097)', () => {
  let aliceBearer: string;
  let bobBearer: string;

  beforeAll(async () => {
    aliceBearer = await getBearerFor(ALICE);
    bobBearer = await getBearerFor(BOB);
  });

  it('alice registers workflow → owned by alice', async () => {
    const r = await mcp(aliceBearer, 'workflow_register', { name: WF, script: SCRIPT });
    expect(r.error).toBeUndefined();
    expect(r.code).not.toBe('NOT_WORKFLOW_OWNER');
  });

  it('bob tries to overwrite alice workflow → NOT_WORKFLOW_OWNER', async () => {
    const r = await mcp(bobBearer, 'workflow_register', { name: WF, script: 'return "hijacked";' });
    expect(r.code).toBe('NOT_WORKFLOW_OWNER');
  });

  it('stored definition unchanged after bob\'s rejected overwrite', async () => {
    const r = await mcp(aliceBearer, 'workflow_get', { name: WF });
    expect((r as { script?: string }).script).not.toContain('hijacked');
  });

  it('bob tries to deregister alice workflow → NOT_WORKFLOW_OWNER', async () => {
    const r = await mcp(bobBearer, 'workflow_deregister', { name: WF });
    expect(r.code).toBe('NOT_WORKFLOW_OWNER');
  });

  it('workflow still present after bob\'s rejected deregister', async () => {
    const r = await mcp(aliceBearer, 'workflow_get', { name: WF });
    expect(r.error).toBeUndefined();
    expect(r.code).toBeUndefined();
  });

  it('bob can RUN alice\'s workflow (run not gated on ownership)', async () => {
    const r = await mcp(bobBearer, 'workflow_run', { name: WF });
    expect(r.code).not.toBe('NOT_WORKFLOW_OWNER');
    expect(typeof r.runId).toBe('string');
  });

  it('alice can deregister her own workflow', async () => {
    const r = await mcp(aliceBearer, 'workflow_deregister', { name: WF });
    expect(r.code).not.toBe('NOT_WORKFLOW_OWNER');
    expect((r as { removed?: boolean }).removed).toBe(true);
  });

  it('boot backfill: NULL-owner row → backfilled on next auth-enabled boot', async () => {
    // Register without bearing a principal (loopback+auth-disabled on a secondary server)
    const nullServer = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir });
    const wf2 = 'null-owner-val097';
    try {
      const nullMcp = async (name: string, args: Record<string, unknown>) => {
        const r = await fetch(`http://127.0.0.1:${nullServer.port}/mcp`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
        });
        const b = await r.json() as { result?: { content?: Array<{ text?: string }> } };
        return JSON.parse(b.result?.content?.[0]?.text ?? '{}') as Record<string, unknown>;
      };
      await nullMcp('workflow_register', { name: wf2, script: SCRIPT });
    } finally {
      await nullServer.close();
    }

    // Re-boot with auth enabled (backfill runs)
    const bootedServer = await createServer({
      port: 0, bind: '127.0.0.1', workRoot: tmpDir,
      auth: { enabled: true, issuer: 'http://127.0.0.1:0', googleClientId: CLIENT_ID, googleClientSecret: 'cs', googleBase: `http://127.0.0.1:${fakeGoogPort}`, jwksFetch: () => Promise.resolve([JWK]) },
    } as never);

    try {
      const b2 = await getBearerFor(ALICE);
      const r = await mcp(b2, 'workflow_get', { name: wf2 });
      expect((r as { owner?: string }).owner).toBe('hsuhungjung@gmail.com');
    } finally {
      await bootedServer.close();
    }
  }, 15_000);
});
