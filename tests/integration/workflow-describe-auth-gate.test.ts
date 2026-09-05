// IT-101 (v24 orchestrator adjudication #8, H-1, issue #57 — OVERRULES ADJ-A1): `GET
// /api/workflows/:name/describe` carries NO authorization gate. It is the only route that serves a
// workflow's author-supplied Mermaid and its per-agent parameters to the dashboard, and the
// dashboard's client is a plain browser fetch from a page with no login and no token — under
// ADJ-A1's gate that client could never be admitted, so with `auth.enabled:true` the workflow-detail
// pane was blank for every workflow.
//
// ADJ-A1 (v23 Gate 2 re-run, ARCH-083 amendment) added the gate to stop an unauthenticated caller
// learning whether a name exists, and marked itself owner-overrulable at Gate 8. Adjudication #8
// overrules it: an anonymous `GET /api/workflows` already returns every name, owner, description,
// versions, channels AND the full per-agent parameter spec, and `/api/home` lists every name too.
// `describe` adds only `mermaid` and `phases` — and v23 adjudication #1 already ruled phases public,
// while v24's whole premise (REQ-111) is that the diagram is a workflow's PUBLIC face. The gate shut
// a side door while the front door stood open, at the cost of the dashboard's main function.
// `workflow_source` is untouched: it carries script text and is the genuinely privileged view — that
// difference is exactly why v24 renamed `workflow_get` to `workflow_source`.
//
// The rows below are ADJ-A1's own four-row parameterized oracle, REWRITTEN to the new expectation
// (not deleted): every row that asserted 401 now asserts the response the dashboard actually needs,
// and each keeps a never-registered name asserting 404 — NOT 401 — which is what proves the gate is
// gone rather than merely relocated (a surviving gate answers 401 before any store read, so a 404
// can only come from a route that reached the catalog).
//
// Row 3b is the case adjudication #8 says never existed and is the whole point: an engine booted
// with `auth.enabled:true` on a LOOPBACK bind — the one construction where `dbindExempt` is false by
// construction (server.ts's D-BIND comment: loopback-BOUND servers are EXCLUDED from the exemption)
// — answers a GET carrying no auth headers at all with 200 and the full mermaid string, verbatim.
// That is the exact request the dashboard makes.
//
// Mock policy (integration, DES-119): real `createServer` + real HTTP + real on-disk catalog.db (v22
// schema, mirrors IT-091/IT-089's hand-seed pattern where an anonymous write cannot reach a
// published starting state under auth) — no mock of the SUT's own auth/routing boundary.
//
// Red reason (measured against 156522d, `server.ts:1113-1127`): that block matched
// `/^\/api\/workflows\/([^/]+)\/describe$/` on GET and, whenever `dbindExempt` was false, required
// `resolvePrincipal` to succeed or sent 401 + WWW-Authenticate before any store read — so rows 3a,
// 3b and row 4's no-bearer case answered 401, never 200/404. Verified by running this file against
// the unmodified engine before the fix, not assumed.
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

/** The author-supplied diagram every seeded workflow below carries — asserted VERBATIM (adjudication
 *  #8: "200 with the full mermaid string"), never merely truthy. */
const SEEDED_MERMAID = 'graph TD;\n  A[start] --> B[finish]';

function uniqueName(prefix: string): string {
  return `it101-${prefix}-${randomUUID().slice(0, 8)}`;
}

/** Hand-seeds an owned, single-version, PUBLISHED workflow directly into catalog.db — the v22 schema
 *  shape (mirrors IT-091/IT-089's own hand-seed helpers; graphAnalyzer stays disabled on every
 *  server below, so no diagram row is ever written and every response's diagram fields are
 *  deterministic without racing an async job). The `mermaid` column is v24's (ARCH-098/DES-148,
 *  added by the catalog's own migration at boot, so `createServer` must have run first) and is
 *  seeded non-null here: `mermaid:null` would surface as `mermaidNote:'LEGACY_NO_DIAGRAM'`, which
 *  is exactly the empty-diagram symptom issue #57 reports, and would make the row-3b assertion
 *  vacuous. */
function seedPublishedWorkflow(dbPath: string, name: string, owner: string, version: string, script: string): void {
  const db = new Database(dbPath);
  const now = new Date().toISOString();
  db.prepare('INSERT INTO workflows (name, createdAt, owner, release_version) VALUES (?, ?, ?, ?)').run(name, now, owner, version);
  db.prepare('INSERT INTO workflow_versions (name, version, script, mermaid, createdAt) VALUES (?, ?, ?, ?, ?)').run(name, version, script, SEEDED_MERMAID, now);
  db.close();
}

async function getDescribe(base: string, name: string, extraHeaders: Record<string, string> = {}): Promise<Response> {
  return fetch(`${base}/api/workflows/${encodeURIComponent(name)}/describe`, { headers: extraHeaders });
}

// ── Row 1: {authEnabled:false} -> 200 (checked FIRST, per the Gate-2-re-run's own ordering) ───────

describe('row 1: auth DISABLED -> 200 (IT-101, adjudication #8)', () => {
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
    expect(body['mermaid']).toBe(SEEDED_MERMAID);
  });
});

// ── Row 2: {authEnabled:true, loopback peer} -> 200 ─────────────────────────────────────────────

describe('row 2: auth ENABLED, D-BIND loopback peer -> 200 (IT-101, adjudication #8)', () => {
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

  it('connecting via 127.0.0.1 to a 0.0.0.0-bound auth-enabled server -> 200, no bearer needed', async () => {
    const res = await getDescribe(`http://127.0.0.1:${server.port}`, NAME);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body['name']).toBe(NAME);
  });
});

// ── Row 3: {authEnabled:true, NON-exempt peer, no/invalid bearer}. Was ADJ-A1's 401 row; under
//    adjudication #8 it is the DASHBOARD row -> 200 with the diagram. Two variants, both kept: the
//    genuine non-loopback-peer case (needs a real LAN IP, per net-guard-bind-integration.test.ts's
//    own precedent — skipIf(!HAS_LAN_IP)) and the environment-independent one — bind LOOPBACK with
//    auth enabled, where D-BIND's own comment (server.ts) states loopback-BOUND servers are EXCLUDED
//    from the exemption ("no non-loopback peers possible"), so `dbindExempt` is unconditionally
//    false and, under ADJ-A1, EVERY peer — including 127.0.0.1 itself — needed a real bearer. ─────

describe('row 3a: auth ENABLED, genuine non-loopback (LAN) peer, no bearer -> 200 (IT-101, adjudication #8)', () => {
  let server: Server;
  let workRoot: string;
  const NAME = uniqueName('lan');

  beforeAll(async () => {
    workRoot = mkdtempSync(join(tmpdir(), 'rwe-it101-lan-'));
    server = await createServer({
      port: 0, bind: '0.0.0.0', workRoot,
      allowedHosts: LAN_IP ? [LAN_IP] : [],
      auth: { enabled: true, issuer: 'http://127.0.0.1:0', googleClientId: 'it101-lan-cid', googleClientSecret: 'it101-lan-cs' },
    } as never);
    seedPublishedWorkflow(join(workRoot, 'catalog.db'), NAME, 'it101-owner3a@example.com', 'v1', `return 'v1';`);
  });
  afterAll(async () => { await server?.close(); rmSync(workRoot, { recursive: true, force: true }); });

  it.skipIf(!HAS_LAN_IP)('connecting via the LAN IP with no bearer -> 200 with the diagram', async () => {
    const res = await getDescribe(`http://${LAN_IP}:${server.port}`, NAME);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body['name']).toBe(NAME);
    expect(body['mermaid']).toBe(SEEDED_MERMAID);
  });

  it.skipIf(!HAS_LAN_IP)('an INVALID bearer over the LAN IP is IGNORED, not refused -> 200 (the route makes no authorization decision at all)', async () => {
    const res = await getDescribe(`http://${LAN_IP}:${server.port}`, NAME, { Authorization: 'Bearer not-a-real-token' });
    expect(res.status).toBe(200);
  });

  it.skipIf(!HAS_LAN_IP)('a NEVER-REGISTERED name over the LAN IP -> 404, not 401 — the request reached the catalog', async () => {
    const res = await getDescribe(`http://${LAN_IP}:${server.port}`, 'it101-never-registered');
    expect(res.status).toBe(404);
  });
});

describe('row 3b: auth ENABLED, LOOPBACK bind (exemption excluded by construction), NO headers at all -> 200 + full mermaid — the dashboard\'s own request (IT-101, adjudication #8, issue #57)', () => {
  let server: Server;
  let workRoot: string;
  const NAME = uniqueName('loopbound');

  beforeAll(async () => {
    workRoot = mkdtempSync(join(tmpdir(), 'rwe-it101-loopbound-'));
    server = await createServer({
      port: 0, bind: '127.0.0.1', workRoot,
      auth: { enabled: true, issuer: 'http://127.0.0.1:0', googleClientId: 'it101-lb-cid', googleClientSecret: 'it101-lb-cs' },
    } as never);
    seedPublishedWorkflow(join(workRoot, 'catalog.db'), NAME, 'it101-owner3b@example.com', 'v1', `return 'v1';`);
  });
  afterAll(async () => { await server?.close(); rmSync(workRoot, { recursive: true, force: true }); });

  it('a browser GET with NO auth headers on an auth-ENABLED engine -> 200 carrying the author-supplied mermaid VERBATIM', async () => {
    const res = await getDescribe(`http://127.0.0.1:${server.port}`, NAME);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body['name']).toBe(NAME);
    // The whole defect: the dashboard renders THIS string. Exact, not truthy — and no
    // LEGACY_NO_DIAGRAM stand-in.
    expect(body['mermaid']).toBe(SEEDED_MERMAID);
    expect(body['mermaidNote']).toBeNull();
    // DES-125: one projection for every principal — an anonymous caller still gets no script body.
    expect(JSON.stringify(body)).not.toContain(`return 'v1';`);
  });

  it('a NEVER-REGISTERED name on the same auth-enabled server -> 404, not 401 — proof the gate is gone, not relocated', async () => {
    const res = await getDescribe(`http://127.0.0.1:${server.port}`, 'it101-never-registered-2');
    expect(res.status).toBe(404);
    expect(res.headers.get('www-authenticate')).toBeNull();
  });
});

// ── Row 4: {authEnabled:true, non-exempt peer, VALID bearer} -> 200, identical to the anonymous
//    body. ADJ-A1 added this row to prove the gate ADMITTED as well as refused; under adjudication
//    #8 it proves the stronger property — presenting a token changes NOTHING, which is DES-125's
//    "every principal gets the same shape" made observable. Same loopback-BOUND construction as row
//    3b, with a hand-seeded live bearer (IT-078/auth-routes-integration.test.ts's `bearer_tokens`
//    pattern, expiry derived RELATIVE to now, never a literal date). ───────────────────────────────

describe('row 4: auth ENABLED, non-exempt peer, VALID bearer -> 200 and byte-identical to anonymous (IT-101, adjudication #8, DES-125)', () => {
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
    // DES-125: the projection is single — passing a token does NOT turn the caller into an owner,
    // so the response still carries no script body.
    expect(JSON.stringify(body)).not.toContain(`return 'v1';`);
  });

  it('the SAME server serves the SAME name with NO bearer, and the body is identical — the token buys nothing here', async () => {
    const withToken = await getDescribe(`http://127.0.0.1:${server.port}`, NAME, { Authorization: `Bearer ${RAW_TOKEN}` });
    const anonymous = await getDescribe(`http://127.0.0.1:${server.port}`, NAME);
    expect(anonymous.status).toBe(200);
    expect(await anonymous.json()).toEqual(await withToken.json());
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
    seedPublishedWorkflow(join(workRoot, 'catalog.db'), NAME, 'it101-owner5@example.com', 'v1', `return 'v1';`);
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
