// IT-169 (v24 Gate 7.5 defects D-1 and D-1b, REQ-115 / ARCH-099 / ADR-026): the owner-ruled
// trigger model — "create the trigger FIRST, then hand its id to workflow_register" — driven over
// the real MCP surface.
//
// D-1: both create rows declared `workflow` REQUIRED and both ran a create-time catalog check, so
// an UNCLAIMED trigger could not be created at all (`INVALID_ARGUMENT: (root) must have required
// property 'workflow'`) and ADR-026's own scenario S-5 was impossible — while the store had
// supported it since TASK-141.
//
// D-1b: a trigger bound AT CREATION (the only kind D-1 left creatable) was not released by
// `workflow_deregister` — it releases only the ids the VERSION rows declare, and a create-time
// binding never enters a version's `triggers[]`. `claimedBy` kept pointing at the deleted name and
// a same-name re-registration inherited it: live, a real cron fired a run for the re-registered
// workflow 47 s after its previous owner deregistered it. The phantom fire ADR-026 exists to
// prevent.
//
// Mock policy (integration, DES-119): real `createServer()` (real ticker, real SQLite scheduler and
// webhook registry, real catalog), real MCP HTTP. The workflow scripts are pure (`return 'ok'`), so
// no gateway/model is involved — a phantom fire is observable as a real run row either way.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

let server: Server;
let tmpDir: string;
const base = () => `http://127.0.0.1:${server.port}`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function call(name: string, args: Record<string, unknown> = {}): Promise<any> {
  const res = await fetch(`${base()}/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Math.random(), method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> }; error?: { message?: string } };
  if (body.error) throw new Error(`rpc error: ${body.error.message}`);
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}');
}

async function registerPublish(name: string): Promise<void> {
  const reg = await call('workflow_register', { name, script: "return 'ok';", mermaid: 'graph TD;' });
  expect(reg.error, `register ${name}: ${JSON.stringify(reg.error)}`).toBeUndefined();
  const pub = await call('workflow_publish', { name, version: reg.result.version as string, channel: 'release' });
  expect(pub.error, `publish ${name}: ${JSON.stringify(pub.error)}`).toBeUndefined();
}

const runsOf = async (name: string): Promise<unknown[]> => ((await call('run_list', { workflow: name })).result ?? []) as unknown[];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-it169-'));
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir });
});
afterAll(async () => { await server?.close(); rmSync(tmpDir, { recursive: true, force: true }); });

describe('triggers are created UNCLAIMED and claimed at registration (IT-169, D-1, REQ-115)', () => {
  it('schedule_create with no workflow returns an id — ADR-026 scenario S-5', async () => {
    const at = new Date(Date.now() + 3_600_000).toISOString();
    const created = await call('schedule_create', { kind: 'once', at });
    expect(created.error, `schedule_create: ${JSON.stringify(created.error)}`).toBeUndefined();
    const id = ((created.result ?? created) as { id?: string }).id;
    expect(typeof id).toBe('string');
    // Unclaimed: it names no workflow at all.
    const row = ((await call('schedule_list')).result as Array<{ id: string; claimedBy?: string | null; workflow?: string | null }>).find((r) => r.id === id);
    expect(row?.claimedBy ?? null).toBeNull();
  });

  it('webhook_create with no workflow returns an id, and workflow_register claims it', async () => {
    const created = await call('webhook_create', {});
    expect(created.error, `webhook_create: ${JSON.stringify(created.error)}`).toBeUndefined();
    const id = (created.result as { webhookId?: string }).webhookId;
    expect(typeof id).toBe('string');

    const name = 'it169-claimer';
    const reg = await call('workflow_register', { name, script: "return 'ok';", mermaid: 'graph TD;', triggers: [id] });
    expect(reg.error, `register with triggers: ${JSON.stringify(reg.error)}`).toBeUndefined();
    const row = ((await call('webhook_list')).result as Array<{ id: string; workflow?: string | null }>).find((r) => r.id === id);
    expect(row?.workflow).toBe(name);

    // …and the claim is exclusive: a second workflow naming the same id is refused.
    const clash = await call('workflow_register', { name: 'it169-clash', script: "return 'ok';", mermaid: 'graph TD;', triggers: [id] });
    expect((clash.code ?? clash.error?.code)).toBe('TRIGGER_ALREADY_CLAIMED');
  });
});

describe('deregister releases a trigger bound AT CREATION — no phantom fire (IT-169, D-1b, ADR-026)', () => {
  const WF = 'it169-phantom';

  it('a once-schedule bound at creation fires for its OWN workflow (the positive control)', async () => {
    await registerPublish(WF);
    const created = await call('schedule_create', { workflow: WF, kind: 'once', at: new Date(Date.now() + 500).toISOString() });
    expect(created.error).toBeUndefined();
    for (let i = 0; i < 40 && (await runsOf(WF)).length === 0; i++) await sleep(100);
    expect((await runsOf(WF)).length, 'the schedule never fired — a later "it did not fire" assertion would be vacuous').toBe(1);
  }, 20000);

  it('after deregister the claim is released, and a same-name re-registration inherits NO firing', async () => {
    // A fresh workflow name, its own create-time-bound schedule, due ~4 s out.
    const name = 'it169-phantom-2';
    await registerPublish(name);
    const created = await call('schedule_create', { workflow: name, kind: 'once', at: new Date(Date.now() + 4_000).toISOString() });
    const id = ((created.result ?? created) as { id?: string }).id!;

    // Deregister BEFORE it is due: the create-time binding must come back as an unclaimed trigger.
    const dereg = await call('workflow_deregister', { name });
    expect(dereg.error, `deregister: ${JSON.stringify(dereg.error)}`).toBeUndefined();
    expect(dereg.result.releasedTriggers, 'a create-time binding was not reported as released').toContain(id);
    const row = ((await call('schedule_list')).result as Array<{ id: string; claimedBy?: string | null; workflow?: string | null }>).find((r) => r.id === id);
    expect(row?.claimedBy ?? null, 'claimedBy still points at the deleted workflow').toBeNull();
    expect(row?.workflow ?? null, 'the legacy workflow column still points at the deleted workflow — the fire path falls back to it').toBeNull();

    // Someone re-registers the freed name and publishes it.
    await registerPublish(name);

    // Wait past the due instant plus several ticks: the released trigger must NOT fire for the
    // re-registered workflow — nobody has claimed it.
    await sleep(6_000);
    expect(await runsOf(name), 'a released trigger fired for a re-registration of the same name (the ADR-026 phantom)').toEqual([]);
  }, 30000);
});
