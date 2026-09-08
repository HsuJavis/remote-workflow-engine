// IT-093, v24 Gate 7.5 REWRITE (defect D-1, REQ-115's last clause).
//
// What this file used to pin: the v22 H4 send-back moved `Scheduler.create()`'s front door from
// "the name exists" to "the name resolves on `release`", so a schedule created against a
// registered-but-unpublished draft was refused CHANNEL_UNPUBLISHED AT CREATION.
//
// Why it is rewritten rather than deleted: REQ-115 makes the create-then-claim model the contract
// ("Given `schedule_create`/`webhook_create` Then they create an UNCLAIMED trigger and return its
// id, without naming any workflow"), and its last clause says the H4 check MOVES to registration —
// "the check does not disappear, it changes site, and everything that described its old site must
// be updated with it". Gate 7.5 found the create-time check still in place, which is what forced
// `workflow` to stay REQUIRED on the tool row and made an unclaimed trigger impossible to create
// over MCP (D-1). Adjudication (v24) #5 E-4 ruled that a defect, not an undocumented design change.
//
// So the check's real site is now the FIRE path: at creation there is routinely no workflow to
// resolve, while at firing time the answer is both knowable and still true. `resolveScheduleTarget`
// (server.ts) refuses UNCLAIMED / CLAIMED_WORKFLOW_MISSING / CHANNEL_UNPUBLISHED / NOT_IN_RELEASE
// and RECORDS the refusal on the row — REQ-115's own "a trigger that fires while unclaimed is
// REFUSED and the refusal is recorded". Both halves are asserted below.
//
// Mock policy (integration, DES-119): a REAL `createServer()` — the refusal ladder lives in the
// composition root's driver, so a hand-built `SqliteSchedulerPort` (this file's pre-v24 shape)
// cannot exercise it at all. Real ticker, real SQLite, real catalog; the fixture script is pure.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

let server: Server;
let workRoot: string;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function call(name: string, args: Record<string, unknown> = {}): Promise<any> {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Math.random(), method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}');
}

interface Row { id: string; claimedBy?: string | null; refusalCount?: number; lastRefusalReason?: string; lastRunId?: string }
const rowFor = async (id: string): Promise<Row | undefined> =>
  ((await call('schedule_list')).result as Row[]).find((r) => r.id === id);

async function until<T>(read: () => Promise<T>, ok: (v: T) => boolean, ms = 8000): Promise<T> {
  const deadline = Date.now() + ms;
  let last = await read();
  while (!ok(last) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
    last = await read();
  }
  return last;
}

beforeEach(async () => {
  workRoot = mkdtempSync(join(tmpdir(), 'rwe-it093-'));
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot });
});
afterEach(async () => {
  await server?.close();
  rmSync(workRoot, { recursive: true, force: true });
});

// v24 orchestrator adjudication #8 (H-2, issue #56) MIGRATION: every case below used to reach its
// claimed state through `schedule_create({workflow})`. That door is closed — the ruling completes
// REQ-115's move by deleting the argument, so a schedule is created UNCLAIMED and bound by
// `workflow_register({triggers:[id]})`. The cases are migrated, not weakened: each still creates
// first, reaches the SAME claimed state through the new door, and asserts the same fire-path
// refusal. The claim is taken BEFORE the due instant (`at` is set seconds out, registration happens
// immediately) so the refusal under test is the one named, never a stray UNCLAIMED from firing
// during the gap.
//
// One case changes REASON as a direct consequence of the ruling: "a schedule naming a workflow that
// does not exist AT ALL" was the phantom claim issue #56 reports and is now unconstructible over
// MCP — `workflow_register` cannot claim a name that does not exist because registering CREATES it,
// and `workflow_deregister` releases claims rather than orphaning them. So that case becomes the
// refusal REQ-115 actually specifies for it (UNCLAIMED, recorded). `CLAIMED_WORKFLOW_MISSING` stays
// reachable only for a PRE-v24 legacy row whose `workflow` column outlived its target, and keeps its
// coverage at the port level in webhook-registry.test.ts (a direct `create({workflow})`, unchanged
// by this ruling) and in scheduler-refusal.test.ts.
describe('the release-resolution check lives on the FIRE path, not on schedule_create (IT-093 v24, REQ-115, D-1, adjudication #8 H-2)', () => {
  it("a schedule CLAIMED by a REGISTERED but UNPUBLISHED workflow is created and claimed — REQ-097's draft state is not a creation error any more", async () => {
    const created = await call('schedule_create', { kind: 'cron', cron: '0 3 * * *' });
    expect(created.error).toBeUndefined();
    const id = ((created.result ?? created) as { id?: string }).id;
    expect(id).toBeTruthy();

    const reg = await call('workflow_register', { name: 'h4-unpublished', script: 'return 1;', mermaid: 'graph LR', triggers: [id] });
    expect(reg.error).toBeUndefined(); // registered, published to NO channel — and it claimed anyway

    expect((await rowFor(id!))?.claimedBy).toBe('h4-unpublished');
  });

  it('when that schedule comes due it is REFUSED CHANNEL_UNPUBLISHED, the refusal is recorded, and no run starts', async () => {
    const created = await call('schedule_create', { kind: 'once', at: new Date(Date.now() + 3_000).toISOString() });
    const id = ((created.result ?? created) as { id: string }).id;
    const reg = await call('workflow_register', { name: 'h4-unpublished-fire', script: 'return 1;', mermaid: 'graph LR', triggers: [id] });
    expect(reg.error, `claim: ${JSON.stringify(reg.error)}`).toBeUndefined();

    const row = await until(() => rowFor(id), (r) => (r?.refusalCount ?? 0) > 0, 12000);
    expect(row?.lastRefusalReason).toBe('CHANNEL_UNPUBLISHED');
    expect(row?.lastRunId).toBeUndefined();
    expect((await call('run_list', { workflow: 'h4-unpublished-fire' })).result ?? []).toEqual([]);
  }, 20000);

  it('a schedule nobody ever claimed is likewise created, then refused UNCLAIMED when due — the refusal is recorded, not silent', async () => {
    const created = await call('schedule_create', {
      kind: 'once', at: new Date(Date.now() + 300).toISOString(),
    });
    expect(created.error).toBeUndefined();
    const id = ((created.result ?? created) as { id: string }).id;

    const row = await until(() => rowFor(id), (r) => (r?.refusalCount ?? 0) > 0);
    expect(row?.lastRefusalReason).toBe('UNCLAIMED');
    expect(row?.lastRunId).toBeUndefined();
  }, 20000);

  it('GREEN PIN: a PUBLISHED workflow that claims a schedule still fires it', async () => {
    const created = await call('schedule_create', { kind: 'once', at: new Date(Date.now() + 3_000).toISOString() });
    expect(created.error).toBeUndefined();
    const id = ((created.result ?? created) as { id: string }).id;

    const reg = await call('workflow_register', { name: 'h4-published', script: 'return 1;', mermaid: 'graph LR', triggers: [id] });
    expect(reg.error, `claim: ${JSON.stringify(reg.error)}`).toBeUndefined();
    await call('workflow_publish', { name: 'h4-published', version: reg.result.version as string, channel: 'release' });

    const row = await until(() => rowFor(id), (r) => r?.lastRunId !== undefined, 12000);
    expect(row?.lastRunId, 'a published, claimed schedule must still fire').toBeTruthy();
    expect(row?.refusalCount ?? 0).toBe(0);
  }, 20000);
});
