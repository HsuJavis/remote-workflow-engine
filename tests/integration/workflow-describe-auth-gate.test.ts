// IT-101 (v23 Gate 8 send-back A1, `ADJ-A1`, 02-architecture.md ARCH-083 amendment,
// 02-architecture.md:1953/1957 Gate-2-re-run handoff): `GET /api/workflows/:name/describe`
// (server.ts:1173-1183) is dispatched at server.ts:1918-1930, OUTSIDE the `authHandlers` block
// (server.ts:1722) that is the only place `dbindExempt`'s four members live — so the route makes NO
// authorization decision at all today. Under `auth.enabled:true` on a non-loopback bind, an
// anonymous LAN socket reads `owner` + raw `triggers[]` (cron/tz/enabled/chain upstream) +
// `versions[]` + `diagram` — none of which are in `EXPECTED_NON_OWNER_KEYS` (workflow-view.ts:59-62).
//
// ADJ-A1's literal rule (02-architecture.md, ARCH-083 amendment): the route is admitted only when
// `!authEnabled` OR the peer is loopback (REQ-089/D-BIND) OR `resolvePrincipal` returns a principal;
// otherwise 401 + `WWW-Authenticate`, BEFORE any store read. Gate-2-re-run's own oracle
// (02-architecture.md:1957): "A1's four-row parameterized route oracle with
// `{authEnabled:false} -> 200` first" — this file's four `describe('row N…')` blocks below are that
// oracle, in that order.
//
// Mock policy (integration, DES-119): real `createServer` + real HTTP + real on-disk catalog.db (v22
// schema, mirrors IT-091/IT-089's hand-seed pattern where an anonymous write cannot reach a
// published starting state under auth) — no mock of the SUT's own auth/routing boundary.
//
// Red reason (measured against today's engine, `server.ts:1173-1183`/`:1918-1930`): the route body
// makes no authorization decision and is dispatched outside `authHandlers`, so row 3's non-loopback
// peer gets 200 with the full body, never 401 — verified by reading the two cited line ranges before
// writing these assertions, not assumed.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir, networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

function getLanIp(): string | undefined {
  for (const ifaces of Object.values(networkInterfaces())) {
    for (const iface of ifaces ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return undefined;
}
const LAN_IP = getLanIp();
const HAS_LAN_IP = LAN_IP !== undefined;

function uniqueName(prefix: string): string {
  return `it101-${prefix}-${randomUUID().slice(0, 8)}`;
}

/** Hand-seeds an owned, single-version, PUBLISHED workflow directly into catalog.db — the v22 schema
 *  shape (mirrors IT-091/IT-089's own hand-seed helpers; graphAnalyzer stays disabled on every
 *  server below, so no diagram row is ever written and every response's diagram fields are
 *  deterministic without racing an async job). */
function seedPublishedWorkflow(dbPath: string, name: string, owner: string, version: string, script: string): void {
  const db = new Database(dbPath);
  const now = new Date().toISOString();
  db.prepare('INSERT INTO workflows (name, createdAt, owner, release_version) VALUES (?, ?, ?, ?)').run(name, now, owner, version);
  db.prepare('INSERT INTO workflow_versions (name, version, script, createdAt) VALUES (?, ?, ?, ?)').run(name, version, script, now);
  db.close();
}

async function getDescribe(base: string, name: string, extraHeaders: Record<string, string> = {}): Promise<Response> {
  return fetch(`${base}/api/workflows/${encodeURIComponent(name)}/describe`, { headers: extraHeaders });
}

// ── Row 1: {authEnabled:false} -> 200 (checked FIRST, per the Gate-2-re-run's own ordering) ───────

describe('row 1: auth DISABLED -> 200 (IT-101, ADJ-A1)', () => {
  let server: Server;
  let workRoot: string;
  const NAME = uniqueName('open');

  beforeAll(async () => {
    workRoot = mkdtempSync(join(tmpdir(), 'rwe-it101-open-'));
    server = await createServer({ port: 0, bind: '127.0.0.1', workRoot });
    seedPublishedWorkflow(join(workRoot, 'catalog.db'), NAME, 'it101-owner@example.com', 'v1', `return 'v1';`);
  });
  afterAll(async () => { await server?.close(); rmSync(workRoot, { recursive: true, force: true }); });

  it('GET /api/workflows/:name/describe -> 200 with no bearer at all', async () => {
    const res = await getDescribe(`http://127.0.0.1:${server.port}`, NAME);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body['name']).toBe(NAME);
  });
});

// ── Row 2: {authEnabled:true, loopback peer} -> 200 ─────────────────────────────────────────────

describe('row 2: auth ENABLED, D-BIND loopback-exempt peer -> 200 (IT-101, ADJ-A1)', () => {
  let server: Server;
  let workRoot: string;
  const NAME = uniqueName('dbind');

  beforeAll(async () => {
    workRoot = mkdtempSync(join(tmpdir(), 'rwe-it101-dbind-'));
    server = await createServer({
      port: 0, bind: '0.0.0.0', workRoot,
      auth: { enabled: true, issuer: 'http://127.0.0.1:0', googleClientId: 'it101-cid', googleClientSecret: 'it101-cs' },
    } as never);
    seedPublishedWorkflow(join(workRoot, 'catalog.db'), NAME, 'it101-owner2@example.com', 'v1', `return 'v1';`);
  });
  afterAll(async () => { await server?.close(); rmSync(workRoot, { recursive: true, force: true }); });

  it('connecting via 127.0.0.1 to a 0.0.0.0-bound auth-enabled server -> 200, no bearer needed (D-BIND exemption)', async () => {
    const res = await getDescribe(`http://127.0.0.1:${server.port}`, NAME);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body['name']).toBe(NAME);
  });
});

// ── Row 3: {authEnabled:true, non-loopback peer, no/invalid bearer} -> 401 + WWW-Authenticate,
//    zero store reads. Two variants: the genuine non-loopback-peer case (needs a real LAN IP, per
//    net-guard-bind-integration.test.ts's own precedent — skipIf(!HAS_LAN_IP)) and a
//    environment-independent guaranteed-red row — bind LOOPBACK with auth enabled: D-BIND's own
//    comment (server.ts:1717-1718) states loopback-BOUND servers are EXCLUDED from the exemption
//    ("no non-loopback peers possible"), so `dbindExempt` is unconditionally false there and EVERY
//    peer — including 127.0.0.1 itself — needs a real bearer, exactly like /mcp on IT-089's
//    loopback-bound auth-enabled server. ──────────────────────────────────────────────────────────

describe('row 3a: auth ENABLED, genuine non-loopback (LAN) peer, no bearer -> 401 (IT-101, ADJ-A1)', () => {
  let server: Server;
  let workRoot: string;

  beforeAll(async () => {
    workRoot = mkdtempSync(join(tmpdir(), 'rwe-it101-lan-'));
    server = await createServer({
      port: 0, bind: '0.0.0.0', workRoot,
      allowedHosts: LAN_IP ? [LAN_IP] : [],
      auth: { enabled: true, issuer: 'http://127.0.0.1:0', googleClientId: 'it101-lan-cid', googleClientSecret: 'it101-lan-cs' },
    } as never);
    // deliberately NOT seeding a workflow — the zero-store-read oracle below needs a name that was
    // NEVER registered: if the gate ran AFTER a store read, a nonexistent name would 404
    // (WORKFLOW_NOT_FOUND); a genuine pre-read gate 401s regardless of whether the name exists.
  });
  afterAll(async () => { await server?.close(); rmSync(workRoot, { recursive: true, force: true }); });

  it.skipIf(!HAS_LAN_IP)('connecting via the LAN IP with no bearer -> 401 + WWW-Authenticate, NOT 404 (zero store reads before the gate)', async () => {
    const res = await getDescribe(`http://${LAN_IP}:${server.port}`, 'it101-never-registered');
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBeTruthy();
  });

  it.skipIf(!HAS_LAN_IP)('an INVALID bearer over the LAN IP also -> 401', async () => {
    const res = await getDescribe(`http://${LAN_IP}:${server.port}`, 'it101-never-registered', { Authorization: 'Bearer not-a-real-token' });
    expect(res.status).toBe(401);
  });
});

describe('row 3b: auth ENABLED, LOOPBACK bind (exemption excluded by construction), no bearer -> 401 (IT-101, ADJ-A1, environment-independent)', () => {
  let server: Server;
  let workRoot: string;

  beforeAll(async () => {
    workRoot = mkdtempSync(join(tmpdir(), 'rwe-it101-loopbound-'));
    server = await createServer({
      port: 0, bind: '127.0.0.1', workRoot,
      auth: { enabled: true, issuer: 'http://127.0.0.1:0', googleClientId: 'it101-lb-cid', googleClientSecret: 'it101-lb-cs' },
    } as never);
  });
  afterAll(async () => { await server?.close(); rmSync(workRoot, { recursive: true, force: true }); });

  it('a loopback-bound auth-enabled server refuses an unauthenticated describe -> 401 + WWW-Authenticate, NOT 404', async () => {
    const res = await getDescribe(`http://127.0.0.1:${server.port}`, 'it101-never-registered-2');
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBeTruthy();
  });
});

// ── Row 4: {authEnabled:true, non-exempt peer, VALID bearer} -> 200. ADDED at v23 Gate 6.5+7
//    round 4 (verifier) off a measured coverage hole: the gate's ADMIT line (`dispatchDashboard()`
//    at server.ts:1904) was executed by no test in the suite — rows 1 and 2 never enter the block
//    (auth off / D-BIND exempt) and rows 3a/3b stop at the 401. A gate that refused EVERY
//    authenticated caller would have passed the whole oracle, so this row is what makes rows 3a/3b
//    mean something. Same loopback-BOUND construction as row 3b (exemption excluded by
//    construction), with a hand-seeded live bearer — the same `bearer_tokens` seeding pattern
//    IT-078/auth-routes-integration.test.ts uses, expiry derived RELATIVE to now, never a literal
//    date. ────────────────────────────────────────────────────────────────────────────────────────

describe('row 4: auth ENABLED, non-exempt peer, VALID bearer -> 200 (IT-101, ADJ-A1 — the gate admits, not only refuses)', () => {
  let server: Server;
  let workRoot: string;
  const NAME = uniqueName('bearer');
  const RAW_TOKEN = 'it101-bearer-' + randomBytes(8).toString('hex');

  beforeAll(async () => {
    workRoot = mkdtempSync(join(tmpdir(), 'rwe-it101-bearer-'));
    server = await createServer({
      port: 0, bind: '127.0.0.1', workRoot,
      auth: { enabled: true, issuer: 'http://127.0.0.1:0', googleClientId: 'it101-b-cid', googleClientSecret: 'it101-b-cs' },
    } as never);
    seedPublishedWorkflow(join(workRoot, 'catalog.db'), NAME, 'it101-owner4@example.com', 'v1', `return 'v1';`);
    const db = new Database(join(workRoot, 'auth-tokens.db'));
    const now = Date.now();
    db.prepare('INSERT INTO bearer_tokens (token_hash, principal, issued_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(createHash('sha256').update(RAW_TOKEN).digest('hex'), 'it101-caller@example.com', now, now + 7 * 24 * 3600_000);
    db.close();
  });
  afterAll(async () => { await server?.close(); rmSync(workRoot, { recursive: true, force: true }); });

  it('a valid bearer on a loopback-BOUND auth-enabled server -> 200 with the full describe projection', async () => {
    const res = await getDescribe(`http://127.0.0.1:${server.port}`, NAME, { Authorization: `Bearer ${RAW_TOKEN}` });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body['name']).toBe(NAME);
    // DES-125: the projection is single — passing the gate does NOT turn the caller into an owner,
    // so the response still carries no script body.
    expect(JSON.stringify(body)).not.toContain(`return 'v1';`);
  });

  it('the SAME server 401s the SAME name with no bearer — so the 200 above is the token, not an open route', async () => {
    const res = await getDescribe(`http://127.0.0.1:${server.port}`, NAME);
    expect(res.status).toBe(401);
  });
});

// ── Parity row: the HTTP 200 body is key-identical to the MCP tool's `result`, over the SAME
//    projection (DES-125/132's own "the two masks cannot drift apart"). ────────────────────────────

describe('parity row: GET /describe and MCP workflow_describe serve the IDENTICAL projection (IT-101, DES-132, ARCH-083)', () => {
  let server: Server;
  let workRoot: string;
  const NAME = uniqueName('parity');

  beforeAll(async () => {
    workRoot = mkdtempSync(join(tmpdir(), 'rwe-it101-parity-'));
    server = await createServer({ port: 0, bind: '127.0.0.1', workRoot });
    seedPublishedWorkflow(join(workRoot, 'catalog.db'), NAME, 'it101-owner3@example.com', 'v1', `return 'v1';`);
  });
  afterAll(async () => { await server?.close(); rmSync(workRoot, { recursive: true, force: true }); });

  it('GET /api/workflows/:name/describe body === MCP workflow_describe result, key-for-key and value-for-value', async () => {
    const httpRes = await getDescribe(`http://127.0.0.1:${server.port}`, NAME);
    expect(httpRes.status).toBe(200);
    const httpBody = await httpRes.json() as Record<string, unknown>;

    const mcpRes = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'workflow_describe', arguments: { name: NAME } } }),
    });
    const mcpEnvelope = await mcpRes.json() as { result?: { content?: Array<{ text?: string }> } };
    const mcpOuter = JSON.parse(mcpEnvelope.result?.content?.[0]?.text ?? '{}') as { status?: string; result?: Record<string, unknown> };
    expect(mcpOuter.status).toBe('completed');
    const mcpBody = mcpOuter.result ?? {};

    expect(Object.keys(httpBody).sort()).toEqual(Object.keys(mcpBody).sort());
    expect(httpBody).toEqual(mcpBody);
  });
});
