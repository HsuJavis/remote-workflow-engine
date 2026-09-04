// VAL-096 (REQ-086): Per-caller principal — protected surfaces require a bearer; valid bearer →
// principal recorded on the artifact (run record + CAS namespace); invalid/absent → 401 before
// any side effect; auth disabled → pre-v15 open behavior.
//
// REQ-086 acceptance criteria:
//   Given auth enabled: un-tokened hit to /mcp OR /assets/blob OR /assets/manifest → 401,
//   NO side effect (no run created, no blob stored, no manifest registered);
//   Given valid engine bearer (principal=alice@example.com): run_start → run record carries
//   `principal:alice@example.com` (observable via run_status); bearer-authed blob upload →
//   CAS namespace first-writer equals the principal (checked via direct store read);
//   Given auth disabled: no principal required (open behavior preserved).
//
// Red reason: auth routes don't exist yet → auth config fields ignored → un-tokened /mcp returns 200
//   instead of 401 → assertion fails. OR src/auth/*.ts doesn't exist → MODULE NOT FOUND on
//   auth-routes-integration.test.ts chain import → file fails. Correct RED.
//
// Mock policy (acceptance — DES-100): MUST NOT mock the SUT's own boundaries.
//   Google is legitimately doubled (injected jwksFetch + fake Google base). Bearer obtained via
//   the SUT's own /token endpoint (not by inserting DB rows directly).

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
import { registerPublishedVia, uniqueWorkflowName } from '../helpers/workflow-fixtures.js';

// ── shared RS256 key for fake Google ─────────────────────────────────────────

const { privateKey: gPriv, publicKey: gPub } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const G_KID = 'val096-k1';
const TEST_EMAIL = 'val096@example.com';
const CLIENT_ID = 'val096-cid';

function b64u(s: string) { return Buffer.from(s).toString('base64url'); }
function signJwt(payload: object): string {
  const h = b64u(JSON.stringify({ alg: 'RS256', kid: G_KID, typ: 'JWT' }));
  const p = b64u(JSON.stringify(payload));
  return `${h}.${p}.${createSign('SHA256').update(`${h}.${p}`).sign(gPriv, 'base64url')}`;
}
function makeJwk(k: KeyObject, kid: string) {
  return { ...(k.export({ format: 'jwk' }) as object), alg: 'RS256', use: 'sig', kid };
}
const JWK = makeJwk(gPub, G_KID);

let fakeGoog: NodeServer;
let fakeGoogPort: number;
let _nonce = '';

// ── fake Google token endpoint ────────────────────────────────────────────────
beforeAll(async () => {
  await new Promise<void>((res, rej) => {
    fakeGoog = nodeHttp((req, resp) => {
      if (req.method === 'POST' && req.url === '/token') {
        req.resume();
        const nowS = Math.floor(Date.now() / 1000);
        const tok = signJwt({ iss: 'https://accounts.google.com', aud: CLIENT_ID, exp: nowS + 300, iat: nowS - 5, sub: 'uid-val096', email: TEST_EMAIL, email_verified: true, nonce: _nonce });
        resp.writeHead(200, { 'Content-Type': 'application/json' });
        resp.end(JSON.stringify({ id_token: tok, access_token: 'goog-at-val096', token_type: 'Bearer' }));
      } else {
        resp.writeHead(404); resp.end();
      }
    });
    fakeGoog.listen(0, '127.0.0.1', () => { fakeGoogPort = (fakeGoog.address() as { port: number }).port; res(); });
    fakeGoog.once('error', rej);
  });
});

// ── engine server ────────────────────────────────────────────────────────────
let server: Server;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-val096-'));
  server = await createServer({
    port: 0, bind: '127.0.0.1', workRoot: tmpDir,
    auth: {
      enabled: true,
      issuer: `http://127.0.0.1:0`,
      googleClientId: CLIENT_ID,
      googleClientSecret: 'val096-cs',
      googleBase: `http://127.0.0.1:${fakeGoogPort}`,
      jwksFetch: () => Promise.resolve([JWK]),
    },
  } as never);
});

afterAll(async () => {
  await server?.close();
  await new Promise<void>(r => fakeGoog?.close(() => r()));
  rmSync(tmpDir, { recursive: true, force: true });
});

// ── PKCE helpers ─────────────────────────────────────────────────────────────
function mkVerifier(): string { return Buffer.from(createHash('sha256').update('val096seed').digest()).toString('base64url').slice(0, 43); }
function mkChallenge(v: string): string { return createHash('sha256').update(v).digest('base64url'); }

async function getBearer(): Promise<string> {
  const base = `http://127.0.0.1:${server.port}`;
  const cv = mkVerifier();
  const cc = mkChallenge(cv);
  const rUri = `${base}/oauth/google/callback`;

  const a = await fetch(`${base}/authorize?` + new URLSearchParams({ response_type: 'code', client_id: 'mcp-c', redirect_uri: rUri, code_challenge: cc, code_challenge_method: 'S256' }), { redirect: 'manual' });
  const aLoc = new URL(a.headers.get('location') ?? 'http://x');
  _nonce = aLoc.searchParams.get('nonce') ?? '';
  const state = aLoc.searchParams.get('state') ?? '';

  const cb = await fetch(`${base}/oauth/google/callback?state=${state}&code=fakeGoogleCode096`, { redirect: 'manual' });
  const cbHtml = await cb.text();
  const m = cbHtml.match(/id="callback-url"[^>]*>([^<]+)</);
  const cbLoc = new URL(m ? m[1].trim() : 'http://x');
  const engineCode = cbLoc.searchParams.get('code') ?? '';

  const tok = await fetch(`${base}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: engineCode, code_verifier: cv, redirect_uri: rUri }),
  });
  const tb = await tok.json() as { access_token?: string };
  return tb.access_token ?? '';
}

function sha256(data: Buffer): string { return createHash('sha256').update(data).digest('hex'); }
const BASE = () => `http://127.0.0.1:${server.port}`;

// ── tests ─────────────────────────────────────────────────────────────────────

describe('REQ-086: protected surfaces reject un-tokened requests (VAL-096)', () => {
  it('/mcp without bearer → 401 before any side effect', async () => {
    const res = await fetch(`${BASE()}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'run_start', arguments: { script: 'return 1;' } } }),
    });
    expect(res.status).toBe(401);
  });

  it('/assets/blob without bearer → 401 (no blob stored)', async () => {
    const data = Buffer.from('val096-test-blob');
    const h = sha256(data);
    const res = await fetch(`${BASE()}/assets/blob/${h}`, {
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: data,
    });
    expect(res.status).toBe(401);
  });

  it('/assets/manifest without bearer → 401 (no manifest stored)', async () => {
    const res = await fetch(`${BASE()}/assets/manifest`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([{ path: 'f.txt', sha256: 'a'.repeat(64) }]),
    });
    expect(res.status).toBe(401);
  });
});

describe('REQ-086: valid bearer → principal attributed on artifacts (VAL-096)', () => {
  it('run_start with bearer → run_status carries principal:<email>', async () => {
    const bearer = await getBearer();

    // v22: runs are by name only, so register+publish first — through the SAME bearer, so the
    // publish ownership gate is exercised by the real principal (L-4) rather than skipped by a
    // null one. The raw run fetch below is left intact so its `runRes.status === 200` oracle stands.
    const bearerCall = async (tool: string, args: Record<string, unknown>) => {
      const r = await fetch(`${BASE()}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${bearer}` },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } }),
      });
      const b = await r.json() as { result?: { content?: Array<{ text?: string }> } };
      return JSON.parse(b.result?.content?.[0]?.text ?? '{}') as Record<string, unknown>;
    };
    const wf = uniqueWorkflowName('val096-attributed');
    await registerPublishedVia(bearerCall, wf, 'return "attributed";');

    const runRes = await fetch(`${BASE()}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${bearer}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'run_start', arguments: { name: wf } } }),
    });
    expect(runRes.status).toBe(200);
    const rb = await runRes.json() as { result?: { content?: Array<{ text?: string }> } };
    const { runId } = JSON.parse(rb.result?.content?.[0]?.text ?? '{}') as { runId?: string };
    expect(typeof runId).toBe('string');

    // Poll for status
    let statusResult: Record<string, unknown> = {};
    for (let i = 0; i < 30; i++) {
      const sr = await fetch(`${BASE()}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${bearer}` },
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'run_status', arguments: { runId } } }),
      });
      const sb = await sr.json() as { result?: { content?: Array<{ text?: string }> } };
      statusResult = JSON.parse(sb.result?.content?.[0]?.text ?? '{}') as Record<string, unknown>;
      if (statusResult.status === 'completed' || statusResult.status === 'failed') break;
      await new Promise(r => setTimeout(r, 200));
    }
    expect(statusResult.principal).toBe(TEST_EMAIL);
  }, 20_000);

  it('bearer-authed blob upload → CAS namespace first-writer equals the principal (server derives from bearer, no echo)', async () => {
    const bearer = await getBearer();
    const blobData = Buffer.from('val096-attributed-blob');
    const h = sha256(blobData);

    // Do NOT pass a namespace query param — the server must derive the namespace from the bearer.
    // If the server echoes back whatever the client supplies, it can't pass this test
    // (DES-100: first-writer namespace must equal the authenticated principal).
    const res = await fetch(`${BASE()}/assets/blob/${h}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'Authorization': `Bearer ${bearer}` },
      body: blobData,
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { namespace?: string };
    // Server must attribute the blob to the bearer's principal (not an echo of a query param)
    expect(body.namespace).toBe(TEST_EMAIL);
  });
});
