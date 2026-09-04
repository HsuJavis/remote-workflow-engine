// IT-124 (v24, Gate 6.5+7 round 2): the authorization path driven end-to-end through a REAL booted
// server with auth ENABLED and real bearers — `callTool → authorize() → OwnerLookup → the real
// store columns`. Round 1's send-back named this exact blind spot: every pre-existing test runs
// auth-disabled, which short-circuits `authorize()` before any ownership lookup, so two wiring
// defects survived Gate 6 with ~2000 green tests. It is also this round's exit-gate item 7
// ("real-dependency smoke") for the authorization integration.
//
// Mock policy: integration tier — real `createServer()` over real HTTP, real SQLite run store /
// catalog / scheduler / webhook registry, real `TokenStore` bearers. Nothing at the SUT boundary is
// mocked; the fixture workflow's script is pure (`return "hello"`) so no gateway is needed.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { TokenStore } from '../../src/auth/token-store.js';

const ALICE = 'alice@example.com';
const BOB = 'bob@example.com';
const ROOT = 'root@example.com';
const WF = 'it124-owned';

let server: Server;
let tmpDir: string;
let aliceToken: string;
let bobToken: string;
let rootToken: string;

function mintBearer(workRoot: string, email: string): string {
  const db = new Database(join(workRoot, 'auth-tokens.db'));
  try {
    return new TokenStore(db, { clock: () => Date.now(), csprng: (n: number) => randomBytes(n) })
      .issue(email, 7 * 24 * 3600_000).token;
  } finally {
    db.close();
  }
}

async function callTool(name: string, args: Record<string, unknown>, bearer: string) {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}') as Record<string, unknown>;
}
const codeOf = (r: Record<string, unknown>) => (r['code'] ?? (r['error'] as { code?: string } | undefined)?.code) as string | undefined;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-it124-'));
  server = await createServer({
    port: 0,
    bind: '127.0.0.1', // NOT 0.0.0.0 — a loopback bind means the D-BIND exemption is off and the bearer is really validated
    workRoot: tmpDir,
    auth: { enabled: true, issuer: 'http://127.0.0.1:0', googleClientId: 'it124-cid', googleClientSecret: 'it124-cs' },
    principals: { [ALICE]: { role: 'author' }, [BOB]: { role: 'author' }, [ROOT]: { role: 'admin' } },
  } as never);
  aliceToken = mintBearer(tmpDir, ALICE);
  bobToken = mintBearer(tmpDir, BOB);
  rootToken = mintBearer(tmpDir, ROOT);
  const reg = await callTool('workflow_register', { name: WF, script: 'return "hello";', mermaid: 'graph TD;' }, aliceToken);
  expect(reg['error']).toBeUndefined();
  const pub = await callTool('workflow_publish', { name: WF, version: `v${reg['version'] as number}`, channel: 'release' }, aliceToken);
  expect(pub['error']).toBeUndefined();
});

afterAll(async () => {
  await server?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('authorization enforced through a real auth-enabled boot (IT-124, DES-139/DES-149)', () => {
  it('a schedule is owned by its CREATOR: the creator lists and deletes it, another author cannot', async () => {
    const created = await callTool('schedule_create', { workflow: WF, cron: '0 3 * * *' }, aliceToken);
    const id = ((created['result'] ?? created) as { id?: string }).id;
    expect(typeof id).toBe('string');

    // schedule_list is principal-scoped off the SAME column authz reads.
    expect((await callTool('schedule_list', {}, aliceToken))['result'] as unknown[]).toHaveLength(1);
    expect((await callTool('schedule_list', {}, bobToken))['result'] as unknown[]).toHaveLength(0);

    // The whole point of round 1's send-back: with auth ON, bob is refused and alice is not.
    expect(codeOf(await callTool('schedule_delete', { id }, bobToken))).toBe('NOT_TRIGGER_OWNER');
    expect(codeOf(await callTool('schedule_setEnabled', { id, enabled: false }, bobToken))).toBe('NOT_TRIGGER_OWNER');
    const mine = await callTool('schedule_delete', { id }, aliceToken);
    expect(codeOf(mine)).toBeUndefined();
    expect((await callTool('schedule_list', {}, aliceToken))['result'] as unknown[]).toHaveLength(0);
  });

  it('a webhook is owned by its CREATOR: same three answers, through the OTHER trigger store', async () => {
    const created = await callTool('webhook_create', { workflow: WF }, aliceToken);
    const id = ((created['result'] ?? created) as { webhookId?: string }).webhookId;
    expect(typeof id).toBe('string');

    expect((await callTool('webhook_list', {}, aliceToken))['result'] as unknown[]).toHaveLength(1);
    expect((await callTool('webhook_list', {}, bobToken))['result'] as unknown[]).toHaveLength(0);
    expect(codeOf(await callTool('webhook_delete', { id }, bobToken))).toBe('NOT_TRIGGER_OWNER');
    expect(codeOf(await callTool('webhook_delete', { id }, aliceToken))).toBeUndefined();
  });

  it('the MODED workspace_* tools really run their ownership check with auth on (round 1 defect (b))', async () => {
    const started = await callTool('run_start', { name: WF }, aliceToken);
    const runId = ((started['result'] ?? started) as { runId?: string }).runId ?? started['runId'] as string;
    expect(typeof runId).toBe('string');

    // `key: null` + `ownership:'run'` used to resolve to subject `undefined` ⇒ "does not exist" ⇒ OK.
    expect(codeOf(await callTool('workspace_list', { runId }, bobToken))).toBe('NOT_RUN_OWNER');
    expect(codeOf(await callTool('workspace_delete', { runId, paths: ['a.txt'] }, bobToken))).toBe('NOT_RUN_OWNER');
    // ...and the workflow-scope mode keys off `workflow`, refusing a non-owner of the WORKFLOW.
    expect(codeOf(await callTool('workspace_list', { workflow: WF, kind: 'skill' }, bobToken))).toBe('NOT_WORKFLOW_OWNER');
    expect(codeOf(await callTool('workspace_push', { workflow: WF, kind: 'skill', name: 'n', files: [] }, bobToken))).toBe('NOT_WORKFLOW_OWNER');
    // The owner is not refused (the check runs, it does not simply reject everyone).
    expect(codeOf(await callTool('workspace_list', { runId }, aliceToken))).toBeUndefined();
  });

  it('an admin cross-principal read of run_result is ALLOWED and AUDITED, and the owner sees it in run_status.adminReads[]', async () => {
    // DES-151 puts `run_result` in the audited set, but its TOOL_SPECS row carried no
    // `adminCrossRead`, so `authorize()` never raised the flag and the facade's audited branch was
    // unreachable in production — the cross-read happened, silently. This is the pin.
    const started = await callTool('run_start', { name: WF }, aliceToken);
    const runId = ((started['result'] ?? started) as { runId?: string }).runId ?? started['runId'] as string;
    for (let i = 0; i < 40; i++) {
      const st = await callTool('run_status', { runId }, aliceToken);
      if (((st['result'] ?? st) as { status?: string }).status === 'completed') break;
      await new Promise((r) => setTimeout(r, 50));
    }
    // bob (author, not the owner, not admin) is refused outright.
    expect(codeOf(await callTool('run_result', { runId }, bobToken))).toBe('NOT_RUN_OWNER');
    // root (admin) is allowed...
    expect(codeOf(await callTool('run_result', { runId }, rootToken))).toBeUndefined();
    // ...and the owner is told about it.
    const status = await callTool('run_status', { runId }, aliceToken);
    const adminReads = (status['adminReads'] ?? (status['result'] as { adminReads?: unknown[] })?.adminReads) as Array<{ actor?: string; action?: string }> | undefined;
    expect(adminReads).toBeDefined();
    expect(adminReads!.some((e) => e.actor === ROOT && e.action === 'run_result')).toBe(true);
  });

  it('a claimed workflow deregistered under a live schedule refuses CLAIMED_WORKFLOW_MISSING at fire time (recorded, not silent)', async () => {
    // The fire-path policy gate's OTHER arm, through the real driver: `resolveScheduleTarget`'s
    // `catalog.resolve` throw. The schedule is created while the workflow is published (creation
    // runs the same release check), then the workflow goes away underneath the live claim.
    const WF2 = 'it124-doomed';
    const reg = await callTool('workflow_register', { name: WF2, script: 'return "x";', mermaid: 'graph TD;' }, aliceToken);
    await callTool('workflow_publish', { name: WF2, version: `v${reg['version'] as number}`, channel: 'release' }, aliceToken);
    const created = await callTool('schedule_create', { workflow: WF2, kind: 'once', at: new Date(Date.now() + 1500).toISOString() }, aliceToken);
    const id = ((created['result'] ?? created) as { id?: string }).id;
    expect(codeOf(await callTool('workflow_deregister', { name: WF2 }, aliceToken))).toBeUndefined();

    type Row = { id: string; refusalCount?: number; lastRefusalReason?: string; lastRunId?: string };
    let row: Row | undefined;
    for (let i = 0; i < 60; i++) {
      const rows = (await callTool('schedule_list', {}, aliceToken))['result'] as Row[];
      row = rows.find((r) => r.id === id);
      if ((row?.refusalCount ?? 0) > 0 || row?.lastRunId) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(row?.lastRunId).toBeUndefined();          // nothing was dispatched
    expect(row?.lastRefusalReason).toBe('CLAIMED_WORKFLOW_MISSING');
    expect(row?.refusalCount).toBe(1);               // ADR-031 coalescing: one row per due instant
  });

  it('a schedule created by an authenticated principal still FIRES — the driver resolves the CLAIM, not the creator', async () => {
    // REGRESSION PIN. `resolveScheduleTarget` used to read `scheduler.ownerOf()` as "the claimed
    // workflow". Once `ownerOf` became `createdBy`, that resolved a PRINCIPAL ID as a workflow name
    // and refused every authenticated user's schedule CLAIMED_WORKFLOW_MISSING — invisible to the
    // rest of the suite, which is auth-disabled (`createdBy` null) and so takes the fallback door.
    const created = await callTool('schedule_create', { workflow: WF, kind: 'once', at: new Date(Date.now() - 1000).toISOString() }, aliceToken);
    const id = ((created['result'] ?? created) as { id?: string }).id;
    expect(typeof id).toBe('string');
    // A schedule created from the row's OWN advertised shape (no `enabled` key) is born ENABLED —
    // `tick()` only ever selects `enabled = 1`, so the opposite default registered a trigger that
    // could never fire, in silence. Asserted before the poll so a failure names the real cause.
    expect(((created['result'] ?? created) as { enabled?: boolean }).enabled).toBe(true);

    // The real RealTicker(500ms) drives it; poll the row rather than sleep a fixed amount. The
    // schedule-started RUN carries no principal, so `run_list` (principal-scoped) is the wrong
    // observation point — the schedule's own row records both outcomes, which is exactly what makes
    // "fired" and "refused" distinguishable here.
    type Row = { id: string; lastRunId?: string; refusalCount?: number; lastRefusalReason?: string };
    let row: Row | undefined;
    for (let i = 0; i < 40; i++) {
      const rows = (await callTool('schedule_list', {}, aliceToken))['result'] as Row[];
      row = rows.find((r) => r.id === id);
      if (row?.lastRunId || (row?.refusalCount ?? 0) > 0) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    // Fired for real, and never refused. Before the fix this row read
    // {refusalCount:1, lastRefusalReason:'CLAIMED_WORKFLOW_MISSING'} and lastRunId stayed unset.
    expect(row?.lastRefusalReason).toBeUndefined();
    expect(row?.refusalCount ?? 0).toBe(0);
    expect(typeof row?.lastRunId).toBe('string');
  });
});
