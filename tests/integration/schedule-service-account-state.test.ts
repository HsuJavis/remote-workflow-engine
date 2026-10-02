// Service accounts spec send-back D1 (HIGH): the schedule-driven counterpart of
// webhook-service-account-state.test.ts. A cron/once schedule firing (server.ts's real ticker)
// calls RunManager.start({principal: row.createdBy}) with no bearer — same chokepoint, same fix
// (RunManager.start()'s own admission, via PrincipalAdmin.serviceAccountStatus). Each case: an SA
// creates a trigger and claims a workflow while allowlisted/live, something changes (narrow /
// disable / delete) BEFORE the schedule's due instant, and the firing must be refused and recorded
// (schedule_list's lastError, the SAME field any other admission-time refusal uses), never silently
// started.
//
// Mock policy (integration tier, mirrors schedule-fire-principal-live.test.ts): real createServer()
// + real RealTicker + real HTTP + real auth-enabled bearers.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { TokenStore } from '../../src/auth/token-store.js';

let server: Server;
let tmpDir: string;

function mintBearer(email: string): string {
  const db = new Database(join(tmpDir, 'auth-tokens.db'));
  try { return new TokenStore(db, { clock: () => Date.now(), csprng: (n: number) => randomBytes(n) }).issue(email, 7 * 24 * 3600_000).token; }
  finally { db.close(); }
}

async function callTool(name: string, args: Record<string, unknown>, bearer: string): Promise<Record<string, unknown>> {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}') as Record<string, unknown>;
}

async function createSa(adminToken: string, name: string, workflows: string[]): Promise<string> {
  const created = await callTool('service_account_create', { name, role: 'author', workflows }, adminToken);
  const account = created['result'] as { clientSecret: string };
  const tokenRes = await fetch(`http://127.0.0.1:${server.port}/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: `sa:${name}`, client_secret: account.clientSecret }),
  });
  return ((await tokenRes.json()) as { access_token: string }).access_token;
}

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-sched-sa-state-'));
  server = await createServer({
    port: 0, bind: '127.0.0.1', workRoot: tmpDir,
    auth: { enabled: true, issuer: 'http://127.0.0.1:0', googleClientId: 'x', googleClientSecret: 'y' },
    principals: { 'admin@x.com': { role: 'admin' } },
  } as never);
});
afterAll(async () => {
  await server?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

type Row = { id: string; lastRunId?: string; lastError?: { code: string }; refusalCount?: number; lastRefusalReason?: string; enabled: boolean };

// The SA check lives INSIDE RunManager.start()'s own admission — a throw from there reaches the
// ticker's `.catch()`, which calls scheduler.ts's `markFailed(firing, code)` (lastError:{code,at}),
// the SAME path EVERY OTHER admission-time refusal (UNKNOWN_MODEL, a locked param, …) already takes.
// `markRefused`/`refusalCount`/`lastRefusalReason` are a DIFFERENT, pre-dispatch policy door
// (resolveScheduleTarget: UNCLAIMED / CHANNEL_UNPUBLISHED / the claimed workflow missing) that never
// calls RunManager.start() at all — not what this fix throws through.
async function waitForFireOrRefusal(bearer: string, id: string, maxMs = 8000): Promise<Row | undefined> {
  const deadline = Date.now() + maxMs;
  let row: Row | undefined;
  while (Date.now() < deadline) {
    const rows = (await callTool('schedule_list', {}, bearer))['result'] as Row[];
    row = rows.find((r) => r.id === id);
    if (row?.lastRunId || row?.lastError) return row;
    await new Promise((r) => setTimeout(r, 100));
  }
  return row;
}

/** Creates an sa-owned, disabled 'once' schedule for `workflow`, claims+publishes it, then returns
 *  its id — the caller flips a state change (narrow/disable/delete) before enabling the schedule,
 *  so the state is guaranteed dead BEFORE the one tick that can fire it. */
async function prepareDisabledFiring(saToken: string, workflow: string): Promise<string> {
  const sched = await callTool('schedule_create', { kind: 'once', at: new Date(Date.now() + 500).toISOString(), enabled: false }, saToken);
  const id = (sched['result'] as { id: string }).id;
  const reg = await callTool('workflow_register', { name: workflow, script: "export const meta = { phases: [] };\nreturn 'ok';", mermaid: 'graph LR', triggers: [id] }, saToken);
  const version = ((reg['result'] as { version?: string })?.version) ?? `v${reg['version'] as number}`;
  const pub = await callTool('workflow_publish', { name: workflow, version, channel: 'release' }, saToken);
  expect(pub['error'], JSON.stringify(pub)).toBeUndefined();
  return id;
}

describe('cron/once schedule firings respect sa: creator state (service accounts spec send-back D1)', () => {
  it('narrowing the allowlist past the claimed workflow refuses the firing, recorded via lastError', async () => {
    const adminToken = mintBearer('admin@x.com');
    const saToken = await createSa(adminToken, 'cron-narrow-bot', ['top']);
    const id = await prepareDisabledFiring(saToken, 'top');

    await callTool('service_account_update', { name: 'cron-narrow-bot', workflows: ['something-else'] }, adminToken);
    await callTool('schedule_setEnabled', { id, enabled: true }, adminToken);

    const row = await waitForFireOrRefusal(adminToken, id);
    expect(row?.lastRunId).toBeUndefined();
    expect(row?.lastError?.code).toBe('WORKFLOW_NOT_ALLOWED');
  });

  it('disabling the account refuses the firing, never silently starting it', async () => {
    const adminToken = mintBearer('admin@x.com');
    const saToken = await createSa(adminToken, 'cron-disable-bot', ['leafwf']);
    const id = await prepareDisabledFiring(saToken, 'leafwf');

    await callTool('service_account_update', { name: 'cron-disable-bot', disabled: true }, adminToken);
    await callTool('schedule_setEnabled', { id, enabled: true }, adminToken);

    const row = await waitForFireOrRefusal(adminToken, id);
    expect(row?.lastRunId).toBeUndefined();
    expect(row?.lastError?.code).toBe('SERVICE_ACCOUNT_DISABLED');
  });

  it('deleting the account refuses the firing — the trigger/workflow remain, owned by the dead id', async () => {
    const adminToken = mintBearer('admin@x.com');
    const saToken = await createSa(adminToken, 'cron-delete-bot', ['deletewf']);
    const id = await prepareDisabledFiring(saToken, 'deletewf');

    await callTool('service_account_delete', { name: 'cron-delete-bot' }, adminToken);
    await callTool('schedule_setEnabled', { id, enabled: true }, adminToken);

    const row = await waitForFireOrRefusal(adminToken, id);
    expect(row?.lastRunId).toBeUndefined();
    expect(row?.lastError?.code).toBe('SERVICE_ACCOUNT_DISABLED');
  });
});
