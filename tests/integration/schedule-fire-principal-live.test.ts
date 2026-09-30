// Webhook B1 (dash-auth-spec.md §B1): "runs started by webhook deliveries and schedule firings get
// the trigger creator as principal so the creator can read them." This file covers the THIRD call
// site specifically — server.ts's `resolveScheduleTarget`/ticker dispatch for a cron/once schedule
// (distinct from `WebhookRegistry.deliver()`'s webhook path and `SqliteSchedulerPort.trigger()`'s
// resident path, both covered elsewhere). Before this fix, a cron/once-fired run always carried
// `principal: null` (see authz-enforcement-live.test.ts's own note on this exact gap, at its
// "the schedule-started RUN carries no principal, so run_list is the wrong observation point"
// comment) — the creator got NOT_RUN_OWNER reading their own trigger's run via run_list/run_status.
//
// Also proves the regression the fix could introduce: setting a real, non-null `principal` turns
// `actorFromPrincipal` into a NON-bypass actor (`{id, bypass:false}` instead of `{id:null,
// bypass:true}`), which now runs through `canRunResolved`'s real predicate instead of its bypass
// shortcut. Triggers always resolve the `release` channel (no `version`/`channel` on a fire-path
// spec), which `canRunResolved`'s second clause (`resolvedVersion === channels.release`) admits
// UNCONDITIONALLY regardless of ownership — so this must still be admitted, never a fresh
// VERSION_NOT_FOUND. (`workflow_register({triggers:[id]})`'s claim door separately requires the
// CALLER to own the trigger being claimed — a distinct check from workflow ownership — so the
// creator registering her own trigger, as below, is also the realistic shape this takes in
// practice, not an artificial simplification.)
//
// Mock policy: integration tier — real createServer() over real HTTP, real auth-enabled bearers,
// real SQLite scheduler/run store. Nothing at the SUT boundary is mocked.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { TokenStore } from '../../src/auth/token-store.js';

const ALICE = 'alice-sched@example.com';
const BOB = 'bob-sched@example.com';

let server: Server;
let tmpDir: string;
let aliceToken: string;
let bobToken: string;

function mintBearer(workRoot: string, email: string): string {
  const db = new Database(join(workRoot, 'auth-tokens.db'));
  try {
    return new TokenStore(db, { clock: () => Date.now(), csprng: (n: number) => randomBytes(n) })
      .issue(email, 7 * 24 * 3600_000).token;
  } finally {
    db.close();
  }
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

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-sched-principal-'));
  server = await createServer({
    port: 0,
    bind: '127.0.0.1', // real bearer validation, not the D-BIND loopback rescue
    workRoot: tmpDir,
    auth: { enabled: true, issuer: 'http://127.0.0.1:0', googleClientId: 'sp-cid', googleClientSecret: 'sp-cs' },
    principals: { [ALICE]: { role: 'author' }, [BOB]: { role: 'author' } },
  } as never);
  aliceToken = mintBearer(tmpDir, ALICE);
  bobToken = mintBearer(tmpDir, BOB);
});
afterAll(async () => {
  await server?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('a cron/once schedule firing (server.ts ticker) carries its trigger creator as RunSpec.principal', () => {
  it('a due once-schedule created and registered by alice fires a run alice can read via run_list; bob (a different principal) cannot', async () => {
    // alice creates the trigger — she becomes createdBy. Due in the near future so the claim
    // (below, via workflow_register) lands before the firing (a past `at` could self-claim at
    // creation and fire UNCLAIMED first — same ordering note as authz-enforcement-live.test.ts).
    const created = await callTool('schedule_create', { kind: 'once', at: new Date(Date.now() + 2000).toISOString() }, aliceToken);
    const id = ((created['result'] ?? created) as { id?: string }).id;
    expect(typeof id).toBe('string');

    // alice registers+publishes the workflow her OWN trigger claims (workflow_register's claim
    // door requires the caller to own the trigger being claimed — see the file header note).
    const reg = await callTool('workflow_register', { name: 'sched-principal-wf', script: 'return "ok";', mermaid: 'graph LR', triggers: [id] }, aliceToken);
    expect(reg['error'], JSON.stringify(reg)).toBeUndefined();
    const version = (reg['result'] as { version?: string }).version ?? `v${reg['version'] as number}`;
    const pub = await callTool('workflow_publish', { name: 'sched-principal-wf', version, channel: 'release' }, aliceToken);
    expect(pub['error']).toBeUndefined();

    // The real RealTicker(500ms) drives it; poll the schedule row for lastRunId (as alice — her own
    // trigger, principal-scoped schedule_list already covers this).
    type Row = { id: string; lastRunId?: string; refusalCount?: number; lastRefusalReason?: string };
    let row: Row | undefined;
    let runId: string | undefined;
    for (let i = 0; i < 100; i++) {
      const rows = (await callTool('schedule_list', {}, aliceToken))['result'] as Row[];
      row = rows.find((r) => r.id === id);
      if (row?.lastRunId || (row?.refusalCount ?? 0) > 0) { runId = row?.lastRunId; break; }
      await new Promise((r) => setTimeout(r, 100));
    }
    // Admitted for real, never refused — the regression this test also pins: alice (non-owner,
    // now a NON-bypass actor once principal is set) is still allowed onto the release channel.
    expect(row?.lastRefusalReason).toBeUndefined();
    expect(row?.refusalCount ?? 0).toBe(0);
    expect(typeof runId).toBe('string');

    // THE fix: before B1 this run carried principal:null, so alice's OWN run_list (principal-
    // scoped for a non-admin) never showed it. Now it does.
    const aliceRuns = (await callTool('run_list', { workflow: 'sched-principal-wf' }, aliceToken))['result'] as Array<{ runId: string }>;
    expect(aliceRuns.map((r) => r.runId)).toContain(runId);

    // bob (not the trigger's creator) must NOT see it via his own principal-scoped run_list —
    // confirms this is real per-principal attribution, not an accidental "everyone sees everything".
    const bobRuns = (await callTool('run_list', { workflow: 'sched-principal-wf' }, bobToken))['result'] as Array<{ runId: string }>;
    expect(bobRuns.map((r) => r.runId)).not.toContain(runId);
  }, 15000);
});
