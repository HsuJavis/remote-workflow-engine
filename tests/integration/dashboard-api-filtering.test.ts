// Dashboard auth spec §A (2026-09-30): per-principal filtering of every /api/* route, by the SAME
// rule as the corresponding MCP tool — so nothing an MCP call refuses is readable through /api.
// Real auth-enabled createServer() on a loopback bind; alice (author) owns a workflow with a
// released v1 and a beta-only v2; bob (user) and alice each start one run; root is admin. Every
// /api read below is compared with what the matching MCP tool answers the SAME principal.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import { createServer, type Server } from '../../src/server.js';
import { TokenStore } from '../../src/auth/token-store.js';
import { startFakeGoogle, fakeJwksFetch, dashboardLogin, type FakeGoogle } from '../helpers/fake-google.js';

const CID = 'dash-filter-cid';
const ROOT = 'root@example.test';
const ALICE = 'alice@example.test';
const BOB = 'bob@example.test';
const WF = 'dash-filter-wf';

let google: FakeGoogle;
let server: Server;
let tmpDir: string;
let base: string;
const bearer: Record<string, string> = {};
const cookie: Record<string, string> = {};
let aliceRun: string;
let bobRun: string;

async function mcp(name: string, args: Record<string, unknown>, who: string): Promise<Record<string, any>> {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer[who]}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}');
}
const codeOf = (r: Record<string, any>) => r['code'] ?? r['error']?.code;
/** GET an /api path as `who`, via the dashboard session cookie (the browser's own credential). */
async function api(path: string, who: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${path}`, { headers: { Cookie: cookie[who]! } });
  const text = await res.text();
  let body: unknown = text;
  try { body = JSON.parse(text); } catch { /* svg / text */ }
  return { status: res.status, body };
}
async function waitTerminal(runId: string, who: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    const s = await mcp('run_status', { runId }, who);
    if (['completed', 'failed', 'stopped'].includes(s.result?.status)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`run ${runId} never reached a terminal status`);
}

beforeAll(async () => {
  google = await startFakeGoogle(CID);
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-dash-filter-'));
  server = await createServer({
    port: 0, bind: '127.0.0.1', workRoot: tmpDir,
    auth: { enabled: true, issuer: 'http://127.0.0.1:0', googleClientId: CID, googleClientSecret: 'cs', googleTokenUrl: google.tokenUrl, jwksFetch: fakeJwksFetch },
    principals: { [ROOT]: { role: 'admin' }, [ALICE]: { role: 'author' }, [BOB]: { role: 'user' } },
  } as never);
  base = `http://127.0.0.1:${server.port}`;
  const db = new Database(join(tmpDir, 'auth-tokens.db'));
  const ts = new TokenStore(db, { clock: () => Date.now(), csprng: (n) => randomBytes(n) });
  for (const who of [ROOT, ALICE, BOB]) bearer[who] = ts.issue(who, 3600_000).token;
  db.close();
  for (const who of [ROOT, ALICE, BOB]) cookie[who] = (await dashboardLogin(base, who)).cookie;

  const r1 = await mcp('workflow_register', { name: WF, script: 'export const meta = { phases: [] };\nreturn "v1";', mermaid: 'graph LR' }, ALICE);
  expect(r1['error']).toBeUndefined();
  expect(codeOf(await mcp('workflow_publish', { name: WF, version: 'v1', channel: 'release' }, ALICE))).toBeUndefined();
  const r2 = await mcp('workflow_register', { name: WF, script: 'export const meta = { phases: [] };\nreturn "v2-secret-draft";', mermaid: 'graph LR' }, ALICE);
  expect(r2['error']).toBeUndefined();
  expect(codeOf(await mcp('workflow_publish', { name: WF, version: 'v2', channel: 'beta' }, ALICE))).toBeUndefined();
  aliceRun = (await mcp('run_start', { name: WF }, ALICE))['runId'];
  bobRun = (await mcp('run_start', { name: WF }, BOB))['runId'];
  expect(typeof aliceRun).toBe('string');
  expect(typeof bobRun).toBe('string');
  await waitTerminal(aliceRun, ALICE);
  await waitTerminal(bobRun, BOB);
}, 60_000);

afterAll(async () => {
  await server?.close();
  await google?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('runs: the caller\'s own (admin: all) — the run_list rule', () => {
  it('/api/runs as bob lists bob\'s run and not alice\'s, exactly the runIds MCP run_list gives bob', async () => {
    const r = await api('/api/runs', BOB);
    expect(r.status).toBe(200);
    const ids = (r.body as Array<{ runId: string }>).map((x) => x.runId);
    expect(ids).toContain(bobRun);
    expect(ids).not.toContain(aliceRun);
    const viaMcp = ((await mcp('run_list', {}, BOB)).result as Array<{ runId: string }>).map((x) => x.runId);
    expect(new Set(ids)).toEqual(new Set(viaMcp));
  });

  it('/api/runs as root (admin) lists both', async () => {
    const ids = ((await api('/api/runs', ROOT)).body as Array<{ runId: string }>).map((x) => x.runId);
    expect(ids).toEqual(expect.arrayContaining([aliceRun, bobRun]));
  });

  it('/api/home as bob: no card points at alice\'s run and the metrics count only bob\'s runs', async () => {
    const r = await api('/api/home', BOB);
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body)).not.toContain(aliceRun);
    const card = [...(r.body.running ?? []), ...(r.body.registered ?? [])].find((c: { name: string }) => c.name === WF);
    expect(card).toBeDefined();
    expect(card.latestRunId).toBe(bobRun);
    const rootCard = [...((await api('/api/home', ROOT)).body.registered ?? [])].find((c: { name: string }) => c.name === WF);
    expect(JSON.stringify(rootCard)).not.toEqual(JSON.stringify(card)); // admin sees the 2-run aggregate
  });
});

describe('the parity table: every run-keyed /api route refuses exactly what its MCP tool refuses', () => {
  const ROUTES: Array<{ route: (runId: string) => string; tool: string; args: (runId: string) => Record<string, unknown> }> = [
    { route: (id) => `/api/runs/${id}`, tool: 'run_status', args: (id) => ({ runId: id }) },
    { route: (id) => `/api/runs/${id}/dag`, tool: 'run_status', args: (id) => ({ runId: id }) },
    { route: (id) => `/api/runs/${id}/agents/1`, tool: 'run_agent_log', args: (id) => ({ runId: id, label: '1' }) },
  ];

  for (const row of ROUTES) {
    // Issue #116 (decision a): this row IS the oracle the issue names — bob's non-owner refusal
    // used to come back 403/NOT_RUN_OWNER while an unknown runId came back 404, letting bob learn
    // "this run exists" just from the status code. Both are now masked to RUN_NOT_FOUND/404,
    // indistinguishable from each other — see the very next `it` in this file.
    it(`${row.route(':runId')} vs ${row.tool}: bob on alice's run -> refused, masked to RUN_NOT_FOUND/404 (same as an unknown run)`, async () => {
      const viaMcp = await mcp(row.tool, row.args(aliceRun), BOB);
      expect(viaMcp['code']).toBeUndefined(); // masked envelope carries no top-level `code`
      expect(codeOf(viaMcp)).toBe('RUN_NOT_FOUND'); // codeOf() falls back to error.code
      const r = await api(row.route(aliceRun), BOB);
      expect(r.status).toBe(404);
      expect(r.body.code).toBeUndefined();
      expect(JSON.stringify(r.body)).not.toContain('v1');
    });

    it(`${row.route(':runId')}: bob on his OWN run is served (not a blanket refusal)`, async () => {
      const r = await api(row.route(bobRun), BOB);
      expect(r.status === 200 || (r.status === 404 && row.tool === 'run_agent_log')).toBe(true);
      expect(r.status).not.toBe(403);
    });

    // Issue #116 (decision a): not just "both 404" (checked above) — the BODY itself must be
    // byte-identical (apart from the runId each response names), on THIS route's own genuine
    // not-found producer (each of the three routes below builds its 404 body differently —
    // `sendJson(res,404,{error:...})` inline for `/dag`/the bare route, `shaped.error.message` for
    // `/agents/:id` — so this is checked per-route, not assumed from one of them).
    it(`${row.route(':runId')}: an unknown run's body is byte-identical to bob's non-owner body on alice's run (apart from the runId)`, async () => {
      const nonOwner = await api(row.route(aliceRun), BOB);
      const missing = await api(row.route('00000000-0000-0000-0000-000000000000'), BOB);
      expect(missing.status).toBe(404);
      expect(Object.keys(nonOwner.body).sort()).toEqual(Object.keys(missing.body).sort());
      expect(nonOwner.body.error).toBe(`Run not found: ${aliceRun}`);
      expect(missing.body.error).toBe('Run not found: 00000000-0000-0000-0000-000000000000');
    });

    it(`${row.route(':runId')}: admin root reads alice's run`, async () => {
      const r = await api(row.route(aliceRun), ROOT);
      expect(r.status).not.toBe(403);
    });
  }
});

describe('workflows: the workflow_list / workflow_describe masking for a non-owner', () => {
  it('/api/workflows as bob: only the released version is visible, beta masked — same as MCP workflow_list', async () => {
    const r = await api('/api/workflows', BOB);
    expect(r.status).toBe(200);
    const row = (r.body as Array<{ name: string; versions: string[]; channels: Record<string, string | null> }>).find((w) => w.name === WF)!;
    expect(row.versions).toEqual(['v1']);
    expect(row.channels).toEqual({ release: 'v1', beta: null });
    expect(JSON.stringify(row)).not.toContain('v2');
    const mcpRow = ((await mcp('workflow_list', { onlyRunnable: false }, BOB)).result as Array<{ name: string; versions: string[]; channels: unknown }>).find((w) => w.name === WF)!;
    expect(row.versions).toEqual(mcpRow.versions);
    expect(row.channels).toEqual(mcpRow.channels);
  });

  it('/api/workflows as alice (owner) shows both versions and the beta channel', async () => {
    const row = ((await api('/api/workflows', ALICE)).body as Array<{ name: string; versions: string[]; channels: Record<string, string | null> }>).find((w) => w.name === WF)!;
    expect(row.versions).toEqual(['v1', 'v2']);
    expect(row.channels).toEqual({ release: 'v1', beta: 'v2' });
  });

  it('describe / diagram.svg of the beta-only v2 as bob -> 404, as the MCP tool refuses VERSION_NOT_FOUND; alice reads it', async () => {
    expect(codeOf(await mcp('workflow_describe', { name: WF, version: 'v2' }, BOB))).toBe('VERSION_NOT_FOUND');
    expect((await api(`/api/workflows/${WF}/describe?version=v2`, BOB)).status).toBe(404);
    expect((await api(`/api/workflows/${WF}/diagram.svg?version=v2`, BOB)).status).toBe(404);
    const own = await api(`/api/workflows/${WF}/describe?version=v2`, ALICE);
    expect(own.status).toBe(200);
    expect(own.body.version).toBe('v2');
  });

  it('describe (release) as bob matches MCP workflow_describe for bob, key-for-key', async () => {
    const r = await api(`/api/workflows/${WF}/describe`, BOB);
    const m = await mcp('workflow_describe', { name: WF }, BOB);
    expect(r.status).toBe(200);
    expect(r.body).toEqual(m.result);
  });
});

describe('any logged-in user: system, models, issues', () => {
  it.each([['/api/system'], ['/api/models'], ['/api/issues']])('%s as bob -> 200', async (p) => {
    expect((await api(p, BOB)).status).toBe(200);
  });
});
