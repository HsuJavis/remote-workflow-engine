// Service accounts spec (owner decision 2026-10-03), §Model/§Token exchange: "on each request the
// SA row is re-checked (disabled/deleted/expired/role/allowlist take effect immediately even for
// already-issued tokens)" and "Dashboard login is human-only (SAs cannot get a dashboard session)".
//
// Cases:
//   - a live SA bearer authenticates /mcp normally, with Principal.workflows carrying its allowlist
//     (checked indirectly via a WORKFLOW_NOT_ALLOWED refusal, since nothing else exposes the
//     resolved Principal directly).
//   - disabling the account mid-flight refuses the SAME already-issued bearer on the very next
//     /mcp call — 401 SERVICE_ACCOUNT_DISABLED, never ACCOUNT_PENDING_APPROVAL.
//   - the same immediate refusal on the blob-upload route (POST /assets/blob/:sha), which
//     authenticates by bearer directly (no callTool/authorize involved).
//   - an SA bearer is refused on the dashboard (human-only) — GET /dashboard and GET /api/status
//     (full) both refuse it exactly as "no caller" would, never granting a session.
//
// Red reason: server.ts's bearer-resolution call sites (`/mcp`, blob upload, `resolveCaller` for
// the dashboard) don't yet re-check ServiceAccountStore.isLive() per request, and `principalFor`
// doesn't yet attach `workflows` to an `sa:` principal.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { ServiceAccountStore } from '../../src/auth/service-account-store.js';
import { SqliteRunStore } from '../../src/store/sqlite-run-store.js';
import { SystemClock } from '../../src/clock.js';

let server: Server;
let tmpDir: string;
let serviceAccounts: ServiceAccountStore;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-sa-recheck-'));
  server = await createServer({
    port: 0, bind: '127.0.0.1', workRoot: tmpDir,
    auth: { enabled: true, issuer: 'http://127.0.0.1:0', googleClientId: 'x', googleClientSecret: 'y', googleBase: 'http://127.0.0.1:0' },
  } as never);
  serviceAccounts = new ServiceAccountStore(new Database(join(tmpDir, 'auth-tokens.db')), { clock: () => Date.now(), csprng: (n) => randomBytes(n) });
});

afterAll(async () => {
  await server?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

async function exchangeToken(clientId: string, clientSecret: string): Promise<string> {
  const res = await fetch(`http://127.0.0.1:${server.port}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }),
  });
  const body = await res.json() as { access_token: string };
  return body.access_token;
}

function mcpCall(token: string, name: string, args: unknown) {
  return fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
}

describe('bearer per-request service-account re-check (service accounts spec)', () => {
  it('a live SA bearer authenticates /mcp; disabling it refuses the SAME bearer on the very next call (401 SERVICE_ACCOUNT_DISABLED, not ACCOUNT_PENDING_APPROVAL)', async () => {
    const created = serviceAccounts.create({ name: 'recheck-sa', role: 'user', createdBy: 'test' });
    if (!created.ok) throw new Error('setup');
    const token = await exchangeToken('sa:recheck-sa', created.clientSecret);

    const before = await mcpCall(token, 'workflow_list', {});
    expect(before.status).toBe(200);

    serviceAccounts.update('recheck-sa', { disabled: true }, 'test');

    const after = await mcpCall(token, 'workflow_list', {});
    expect(after.status).toBe(401);
    const body = await after.json() as { code?: string };
    expect(body.code).toBe('SERVICE_ACCOUNT_DISABLED');
  });

  it('the same re-check refuses the blob-upload route (POST /assets/blob/:sha) immediately', async () => {
    const created = serviceAccounts.create({ name: 'recheck-blob-sa', role: 'user', createdBy: 'test' });
    if (!created.ok) throw new Error('setup');
    const token = await exchangeToken('sa:recheck-blob-sa', created.clientSecret);
    serviceAccounts.update('recheck-blob-sa', { disabled: true }, 'test');

    const bytes = Buffer.from('hello');
    const sha = createHash('sha256').update(bytes).digest('hex');
    const res = await fetch(`http://127.0.0.1:${server.port}/assets/blob/${sha}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'Authorization': `Bearer ${token}` },
      body: bytes,
    });
    expect(res.status).toBe(401);
    const body = await res.json() as { code?: string };
    expect(body.code).toBe('SERVICE_ACCOUNT_DISABLED');
  });

  it('an SA bearer is refused on the dashboard page (human-only) — same as no caller at all', async () => {
    const created = serviceAccounts.create({ name: 'dash-refused-sa', role: 'user', createdBy: 'test' });
    if (!created.ok) throw new Error('setup');
    const token = await exchangeToken('sa:dash-refused-sa', created.clientSecret);
    const res = await fetch(`http://127.0.0.1:${server.port}/dashboard`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` },
      redirect: 'manual',
    });
    // "no caller" on a dashboard page is a 302 to /dashboard/login (never a 200 dashboard render).
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toMatch(/\/dashboard\/login/);
  });

  it('an SA bearer is refused on a gated dashboard /api/* route (human-only) — 401, never a principals_list response', async () => {
    const created = serviceAccounts.create({ name: 'dash-api-refused-sa', role: 'user', createdBy: 'test' });
    if (!created.ok) throw new Error('setup');
    const token = await exchangeToken('sa:dash-api-refused-sa', created.clientSecret);
    const res = await fetch(`http://127.0.0.1:${server.port}/api/principals`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` },
    });
    expect(res.status).toBe(401);
  });

  // Issue #116 (decision b, review round 6 finding 5): a bearer-layer refusal (no MCP tool
  // dispatch at all — this happens ahead of `callTool`'s own `authorize()`) now writes an audit
  // row too, keyed by the HTTP route (there is no tool name to key it by), with the SAME requestId
  // echoed on the response body.
  it('a disabled SA bearer refused on /mcp writes one audit row keyed by the route, with a requestId on the 401 body matching it', async () => {
    const created = serviceAccounts.create({ name: 'recheck-audit-sa', role: 'user', createdBy: 'test' });
    if (!created.ok) throw new Error('setup');
    const token = await exchangeToken('sa:recheck-audit-sa', created.clientSecret);
    serviceAccounts.update('recheck-audit-sa', { disabled: true }, 'test');

    const refusalStore = new SqliteRunStore(join(tmpDir, 'store'), new SystemClock());
    const before = refusalStore.queryRefusals({ tool: 'POST /mcp' }).length;

    const res = await mcpCall(token, 'workflow_list', {});
    expect(res.status).toBe(401);
    const body = await res.json() as { code?: string; requestId?: string };
    expect(body.code).toBe('SERVICE_ACCOUNT_DISABLED');
    expect(typeof body.requestId).toBe('string');

    const rows = refusalStore.queryRefusals({ tool: 'POST /mcp' });
    expect(rows.length).toBe(before + 1);
    expect(rows[0]).toMatchObject({ actor: 'sa:recheck-audit-sa', authMethod: 'service-account', tool: 'POST /mcp', targetKind: 'none', targetId: null, realReason: 'SERVICE_ACCOUNT_DISABLED', returnedCode: 'SERVICE_ACCOUNT_DISABLED', requestId: body.requestId });
  });

});
