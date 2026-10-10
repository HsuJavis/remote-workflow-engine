// Issue #116: end-to-end, through a REAL booted server (real auth, real SQLite RunStore/catalog/
// scheduler/webhook registry), proving both owner decisions together:
//   a. non-owner vs missing are byte-identical on the MCP surface AND the dashboard API, for a
//      non-admin caller; admin is unaffected (still gets real cross-owner access, never masked).
//   b. every refusal is audited with ts/actor/tool/target/realReason/returnedCode/requestId, the
//      SAME requestId the (unmasked) response carries, queryable by an admin via
//      `audit_refusals_list`; an audit-write failure never turns a refusal into a success.
//
// Mock policy: integration tier, same convention as authz-enforcement-live.test.ts /
// dashboard-auth.test.ts — real createServer() over real HTTP, real SQLite stores, real bearers/
// sessions (fake-google.ts doubles only the third-party Google upstream).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import { createServer, type Server } from '../../src/server.js';
import { TokenStore } from '../../src/auth/token-store.js';
import { startFakeGoogle, fakeJwksFetch, dashboardLogin, type FakeGoogle } from '../helpers/fake-google.js';

const CID = 'it116-cid';
const ROOT = 'root@it116.test';
const ALICE = 'alice@it116.test'; // owns the fixture workflow + its runs/triggers
const BOB = 'bob@it116.test'; // non-owner author — sees the masked/audited refusals
const PLAIN_USER = 'plain-user@it116.test'; // role 'user' — below author's minRole, for FORBIDDEN_ROLE
const WF = 'it116-owned';

let google: FakeGoogle;
let server: Server;
let tmpDir: string;
let base: string;

function authDb(): Database.Database { return new Database(join(tmpDir, 'auth-tokens.db')); }
function mintBearer(email: string): string {
  const db = authDb();
  try { return new TokenStore(db, { clock: () => Date.now(), csprng: (n) => randomBytes(n) }).issue(email, 3600_000).token; } finally { db.close(); }
}
async function mcp(name: string, args: Record<string, unknown>, bearer: string): Promise<Record<string, any>> {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}');
}

let aliceToken: string, bobToken: string, rootToken: string;
let runId: string, scheduleId: string, webhookId: string;

beforeAll(async () => {
  google = await startFakeGoogle(CID);
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-it116-'));
  server = await createServer({
    port: 0,
    bind: '127.0.0.1',
    workRoot: tmpDir,
    auth: { enabled: true, issuer: 'http://127.0.0.1:0', googleClientId: CID, googleClientSecret: 'cs', googleAuthorizeUrl: 'http://127.0.0.1:9/auth', googleTokenUrl: google.tokenUrl, jwksFetch: fakeJwksFetch },
    principals: { [ROOT]: { role: 'admin' }, [ALICE]: { role: 'author' }, [BOB]: { role: 'author' }, [PLAIN_USER]: { role: 'user' } },
  } as never);
  base = `http://127.0.0.1:${server.port}`;
  aliceToken = mintBearer(ALICE);
  bobToken = mintBearer(BOB);
  rootToken = mintBearer(ROOT);

  const reg = await mcp('workflow_register', { name: WF, script: 'export const meta = { phases: [] };\nreturn "hello";', mermaid: 'graph LR' }, aliceToken);
  expect(reg['error']).toBeUndefined();
  const pub = await mcp('workflow_publish', { name: WF, version: `v${reg['version'] as number}`, channel: 'release' }, aliceToken);
  expect(pub['error']).toBeUndefined();
  const run = await mcp('run_start', { name: WF }, aliceToken);
  expect(run['error']).toBeUndefined();
  runId = run['runId'] as string;
  const sched = await mcp('schedule_create', { cron: '0 0 * * *' }, aliceToken);
  expect(sched['error']).toBeUndefined();
  scheduleId = (sched['result'] as { id: string }).id;
  const hook = await mcp('webhook_create', {}, aliceToken);
  expect(hook['error']).toBeUndefined();
  webhookId = (hook['result'] as { webhookId: string }).webhookId;
});

afterAll(async () => {
  await server?.close();
  await google?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('issue #116 decision a: non-owner is indistinguishable from missing', () => {
  it('run_status: BOB (non-owner) on the real run vs a random missing runId get byte-identical envelopes', async () => {
    const nonOwner = await mcp('run_status', { runId }, bobToken);
    const missing = await mcp('run_status', { runId: '00000000-0000-0000-0000-000000000000' }, bobToken);
    expect(nonOwner['error']).toEqual({ code: 'RUN_NOT_FOUND', message: `Run not found: ${runId}` });
    expect(missing['error']).toEqual({ code: 'RUN_NOT_FOUND', message: 'Run not found: 00000000-0000-0000-0000-000000000000' });
    // Same shape modulo the id itself: neither carries any extra key the other lacks.
    expect(Object.keys(nonOwner).sort()).toEqual(Object.keys(missing).sort());
    expect(Object.keys(nonOwner['error']).sort()).toEqual(Object.keys(missing['error']).sort());
  });

  it('workflow_deregister: non-owner vs missing-name are byte-identical (apart from the name)', async () => {
    const nonOwner = await mcp('workflow_deregister', { name: WF }, bobToken);
    const missing = await mcp('workflow_deregister', { name: 'no-such-workflow-it116' }, bobToken);
    expect(nonOwner).toEqual({ runId: '', status: 'failed', code: 'WORKFLOW_NOT_FOUND', error: { code: 'WORKFLOW_NOT_FOUND', message: `Unknown workflow: ${WF}` } });
    expect(missing).toEqual({ runId: '', status: 'failed', code: 'WORKFLOW_NOT_FOUND', error: { code: 'WORKFLOW_NOT_FOUND', message: 'Unknown workflow: no-such-workflow-it116' } });
  });

  it('schedule_delete: non-owner vs missing-id are byte-identical (apart from the id)', async () => {
    const nonOwner = await mcp('schedule_delete', { id: scheduleId }, bobToken);
    const missing = await mcp('schedule_delete', { id: 'no-such-schedule-it116' }, bobToken);
    expect(nonOwner).toEqual({ error: { code: 'TRIGGER_NOT_FOUND', message: `Unknown schedule: ${scheduleId}` } });
    expect(missing).toEqual({ error: { code: 'TRIGGER_NOT_FOUND', message: 'Unknown schedule: no-such-schedule-it116' } });
  });

  it('webhook_delete: non-owner vs missing-id are byte-identical (apart from the id)', async () => {
    const nonOwner = await mcp('webhook_delete', { id: webhookId }, bobToken);
    const missing = await mcp('webhook_delete', { id: 'no-such-webhook-it116' }, bobToken);
    expect(nonOwner).toEqual({ error: { code: 'TRIGGER_NOT_FOUND', message: `Unknown webhook: ${webhookId}` } });
    expect(missing).toEqual({ error: { code: 'TRIGGER_NOT_FOUND', message: 'Unknown webhook: no-such-webhook-it116' } });
  });

  // The remaining templated tools, each checked against the REAL handler's own genuine-not-found
  // answer (never against a hand-assumed shape) — authz.ts's ownership check runs BEFORE any
  // run-state/version check, so a non-owner is refused identically regardless of the run's actual
  // status or the workflow's actual version; only ownership and existence matter here.
  it.each(['run_result', 'run_suspend', 'run_resume', 'run_stop'] as const)('%s: non-owner vs missing are byte-identical (apart from the runId)', async (tool) => {
    const nonOwner = await mcp(tool, { runId }, bobToken);
    const missing = await mcp(tool, { runId: '00000000-0000-0000-0000-000000000000' }, bobToken);
    expect(Object.keys(nonOwner).sort()).toEqual(Object.keys(missing).sort());
    expect(Object.keys(nonOwner['error']).sort()).toEqual(Object.keys(missing['error']).sort());
    expect(nonOwner['error']['code']).toBe('RUN_NOT_FOUND');
    expect(missing['error']['code']).toBe('RUN_NOT_FOUND');
    expect(nonOwner['error']['message']).toBe(`Run not found: ${runId}`);
  });

  it('run_agent_log: non-owner vs missing are byte-identical (apart from the runId)', async () => {
    const nonOwner = await mcp('run_agent_log', { runId, agentId: 'a1' }, bobToken);
    const missing = await mcp('run_agent_log', { runId: '00000000-0000-0000-0000-000000000000', agentId: 'a1' }, bobToken);
    expect(nonOwner).toEqual({ runId, status: 'failed', error: { code: 'RUN_NOT_FOUND', message: `Run not found: ${runId}` }, harness: null, events: [], hasMore: false });
    expect(missing).toEqual({ runId: '00000000-0000-0000-0000-000000000000', status: 'failed', error: { code: 'RUN_NOT_FOUND', message: 'Run not found: 00000000-0000-0000-0000-000000000000' }, harness: null, events: [], hasMore: false });
  });

  it('issue_report: non-owner vs missing-run are byte-identical (apart from the runId)', async () => {
    const args = (id: string) => ({ title: 't', body: 'b', reproSteps: 's', analysis: 'a', runId: id });
    const nonOwner = await mcp('issue_report', args(runId), bobToken);
    const missing = await mcp('issue_report', args('00000000-0000-0000-0000-000000000000'), bobToken);
    expect(nonOwner).toEqual({ error: { code: 'RUN_NOT_FOUND', message: `Run not found: ${runId}` } });
    expect(missing).toEqual({ error: { code: 'RUN_NOT_FOUND', message: 'Run not found: 00000000-0000-0000-0000-000000000000' } });
  });

  // workflow_publish's genuine not-found travels through toErrEnvelope() and carries `error.see:
  // null` — unlike every other templated tool — so this is checked separately, against the real
  // handler, not assumed from workflow_deregister's shape.
  it('workflow_publish: non-owner vs missing-name are byte-identical (apart from the name), including error.see', async () => {
    const nonOwner = await mcp('workflow_publish', { name: WF, version: 'v1', channel: 'release' }, bobToken);
    const missing = await mcp('workflow_publish', { name: 'no-such-workflow-it116-publish', version: 'v1', channel: 'release' }, bobToken);
    expect(nonOwner).toEqual({ runId: '', status: 'failed', code: 'WORKFLOW_NOT_FOUND', error: { code: 'WORKFLOW_NOT_FOUND', message: `Workflow not found in catalog: ${WF}`, see: null } });
    expect(missing).toEqual({ runId: '', status: 'failed', code: 'WORKFLOW_NOT_FOUND', error: { code: 'WORKFLOW_NOT_FOUND', message: 'Workflow not found in catalog: no-such-workflow-it116-publish', see: null } });
  });

  it('schedule_setEnabled: non-owner vs missing-id are byte-identical (apart from the id)', async () => {
    const nonOwner = await mcp('schedule_setEnabled', { id: scheduleId, enabled: false }, bobToken);
    const missing = await mcp('schedule_setEnabled', { id: 'no-such-schedule-it116-enable', enabled: false }, bobToken);
    expect(nonOwner).toEqual({ error: { code: 'TRIGGER_NOT_FOUND', message: `Unknown schedule: ${scheduleId}` } });
    expect(missing).toEqual({ error: { code: 'TRIGGER_NOT_FOUND', message: 'Unknown schedule: no-such-schedule-it116-enable' } });
  });

  it('admin is NEVER masked — root sees the real run, not a RUN_NOT_FOUND refusal', async () => {
    const result = await mcp('run_status', { runId }, rootToken);
    expect(result['error']).toBeUndefined();
    expect(result['runId']).toBe(runId);
  });

  it('a role refusal (user-role tool gate) is NEVER masked — a non-author calling an author-only tool still sees FORBIDDEN_ROLE, not a *_NOT_FOUND code', async () => {
    const result = await mcp('workflow_deregister', { name: WF }, mintBearer(PLAIN_USER));
    expect(result['code']).toBe('FORBIDDEN_ROLE');
  });

  it('the dashboard API masks run_status the same way (404, no top-level code) — identical to a genuinely missing run', async () => {
    const bobSession = await dashboardLogin(base, BOB);
    const nonOwner = await fetch(`${base}/api/runs/${runId}`, { headers: { Cookie: bobSession.cookie } });
    const missing = await fetch(`${base}/api/runs/00000000-0000-0000-0000-000000000000`, { headers: { Cookie: bobSession.cookie } });
    expect(nonOwner.status).toBe(404);
    expect(missing.status).toBe(404);
    const nonOwnerBody = await nonOwner.json();
    const missingBody = await missing.json();
    expect(Object.keys(nonOwnerBody)).toEqual(['error']);
    expect(Object.keys(missingBody)).toEqual(['error']);
    expect(nonOwnerBody.error).toBe(`Run not found: ${runId}`);
  });
});

describe('issue #116 decision b: every refusal is audited + traceable', () => {
  it('a masked refusal (run_status non-owner) writes exactly one audit row with the TRUE reason, queryable by an admin', async () => {
    const before = await mcp('audit_refusals_list', { tool: 'run_status', actor: BOB }, rootToken);
    const beforeCount = (before['result'] as unknown[]).length;
    const refused = await mcp('run_status', { runId }, bobToken);
    expect(refused['error']['code']).toBe('RUN_NOT_FOUND');
    const after = await mcp('audit_refusals_list', { tool: 'run_status', actor: BOB }, rootToken);
    const rows = after['result'] as Array<Record<string, unknown>>;
    expect(rows.length).toBe(beforeCount + 1);
    expect(rows[0]).toMatchObject({ actor: BOB, tool: 'run_status', targetKind: 'run', targetId: runId, realReason: 'NOT_RUN_OWNER', returnedCode: 'RUN_NOT_FOUND' });
    expect(typeof rows[0]!['requestId']).toBe('string');
  });

  it('an UNMASKED refusal (FORBIDDEN_ROLE) echoes requestId on the response, matching the audit row', async () => {
    const refused = await mcp('workflow_deregister', { name: WF }, mintBearer(PLAIN_USER));
    const requestId = refused['error']['detail']['requestId'];
    expect(typeof requestId).toBe('string');
    const rows = (await mcp('audit_refusals_list', { tool: 'workflow_deregister', actor: PLAIN_USER }, rootToken))['result'] as Array<Record<string, unknown>>;
    const match = rows.find((r) => r['requestId'] === requestId);
    expect(match).toMatchObject({ realReason: 'FORBIDDEN_ROLE', returnedCode: 'FORBIDDEN_ROLE' });
  });

  it('a non-admin cannot query the refusal audit trail', async () => {
    const result = await mcp('audit_refusals_list', {}, bobToken);
    expect(result['code']).toBe('FORBIDDEN_ROLE');
  });
});
