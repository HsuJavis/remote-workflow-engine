// Owner decision 2026-09-30 (verify-i MEDIUM-1): with auth enabled, a Google account that has no
// configured/DB role signs in as 'none' (pending approval). It can connect (initialize, tools/list)
// but every MCP tool and every /api route except GET /api/me is refused ACCOUNT_PENDING_APPROVAL;
// the admin sees it pending and grants a role, effective on its next request; revoking ('none')
// refuses it again. Config principals are unaffected. Real auth-enabled createServer().
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import { createServer, type Server } from '../../src/server.js';
import { TokenStore } from '../../src/auth/token-store.js';
import { startFakeGoogle, fakeJwksFetch, dashboardLogin, type FakeGoogle } from '../helpers/fake-google.js';

const CID = 'pending-cid';
const ROOT = 'root@example.test';
const ALICE = 'alice@example.test';
const NEW = 'newcomer@example.test';
let google: FakeGoogle; let server: Server; let dir: string; let base: string;
const bearer: Record<string, string> = {};

async function rpc(method: string, params: unknown, who: string): Promise<any> {
  const res = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer[who]}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  return res.json();
}
async function tool(name: string, args: Record<string, unknown>, who: string): Promise<Record<string, any>> {
  const b = await rpc('tools/call', { name, arguments: args }, who);
  return JSON.parse(b.result?.content?.[0]?.text ?? '{}');
}
const codeOf = (r: Record<string, any>) => r['code'] ?? r['error']?.code;

beforeAll(async () => {
  google = await startFakeGoogle(CID);
  dir = mkdtempSync(join(tmpdir(), 'rwe-pending-'));
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: dir,
    auth: { enabled: true, issuer: 'http://127.0.0.1:0', googleClientId: CID, googleClientSecret: 'cs', googleTokenUrl: google.tokenUrl, jwksFetch: fakeJwksFetch },
    principals: { [ROOT]: { role: 'admin' }, [ALICE]: { role: 'author' } } } as never);
  base = `http://127.0.0.1:${server.port}`;
  const db = new Database(join(dir, 'auth-tokens.db'));
  const ts = new TokenStore(db, { clock: () => Date.now(), csprng: (n) => randomBytes(n) });
  for (const who of [ROOT, ALICE, NEW]) bearer[who] = ts.issue(who, 3600_000).token;
  db.close();
});
afterAll(async () => { await server?.close(); await google?.close(); rmSync(dir, { recursive: true, force: true }); });

describe('an unknown email is pending approval', () => {
  it('can connect: initialize + tools/list answer, and initialize says access is pending', async () => {
    const init = await rpc('initialize', { protocolVersion: '2025-06-18' }, NEW);
    expect(init.result?.serverInfo?.name).toBe('remote-workflow-engine');
    expect(init.result?.instructions).toContain('ACCOUNT_PENDING_APPROVAL');
    const list = await rpc('tools/list', {}, NEW);
    expect((list.result?.tools ?? []).length).toBeGreaterThan(0);
  });

  it.each([['run_start', { name: 'x' }], ['workflow_list', {}], ['system_info', {}], ['run_list', {}], ['workflow_authoring_guide', {}]])('MCP %s -> ACCOUNT_PENDING_APPROVAL', async (name, args) => {
    const r = await tool(name, args as Record<string, unknown>, NEW);
    expect(codeOf(r)).toBe('ACCOUNT_PENDING_APPROVAL');
    expect(JSON.stringify(r)).not.toContain('result":');
  });

  it('every /api data route -> 403 ACCOUNT_PENDING_APPROVAL; GET /api/me answers who they are', async () => {
    const { cookie } = await dashboardLogin(base, NEW);
    for (const p of ['/api/runs', '/api/system', '/api/workflows', '/api/home', '/api/models', '/api/issues', '/api/workflows/x/describe', '/api/runs/x', '/api/principals']) {
      const r = await fetch(`${base}${p}`, { headers: { Cookie: cookie } });
      expect(r.status, p).toBe(403);
      expect((await r.json()).code, p).toBe('ACCOUNT_PENDING_APPROVAL');
    }
    const me = await fetch(`${base}/api/me`, { headers: { Cookie: cookie } });
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual({ authEnabled: true, id: NEW, role: 'none', pending: true });
    const page = await fetch(`${base}/dashboard`, { headers: { Cookie: cookie } });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('"role":"none"');
    expect((await fetch(`${base}/api/me`)).status).toBe(401);
  });

  it('the admin sees them pending; a grant works on the next request; revoking refuses again; config principals unaffected', async () => {
    const listed = await tool('principals_list', {}, ROOT);
    expect(listed.result.principals.find((p: { id: string }) => p.id === NEW)).toMatchObject({ role: 'none', source: 'default' });
    expect(codeOf(await tool('workflow_list', {}, ALICE))).toBeUndefined();
    expect((await tool('principal_set_role', { id: NEW, role: 'user' }, ROOT)).status).toBe('completed');
    expect(codeOf(await tool('workflow_list', {}, NEW))).toBeUndefined();
    expect((await tool('principal_set_role', { id: NEW, role: 'none' }, ROOT)).result).toMatchObject({ role: 'none', source: 'db' });
    expect(codeOf(await tool('workflow_list', {}, NEW))).toBe('ACCOUNT_PENDING_APPROVAL');
    expect(codeOf(await tool('workflow_list', {}, ALICE))).toBeUndefined();
  });
});
