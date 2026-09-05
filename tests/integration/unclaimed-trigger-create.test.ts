// IT-128 (v24 Gate 7.5 defects D-1 and D-1b, REQ-115 / ARCH-099 / ADR-026): the owner-ruled
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

async function registerPublish(name: string, triggers?: string[]): Promise<void> {
  // v24 adjudication #8 (H-2): `triggers` is the ONLY door that binds a trigger to a workflow —
  // `schedule_create({workflow})` / `webhook_create({workflow})` are refused INVALID_ARGUMENT.
  const reg = await call('workflow_register', { name, script: "return 'ok';", mermaid: 'graph TD;', ...(triggers ? { triggers } : {}) });
  expect(reg.error, `register ${name}: ${JSON.stringify(reg.error)}`).toBeUndefined();
  const pub = await call('workflow_publish', { name, version: reg.result.version as string, channel: 'release' });
  expect(pub.error, `publish ${name}: ${JSON.stringify(pub.error)}`).toBeUndefined();
}

const runsOf = async (name: string): Promise<unknown[]> => ((await call('run_list', { workflow: name })).result ?? []) as unknown[];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-it128-'));
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir });
});
afterAll(async () => { await server?.close(); rmSync(tmpDir, { recursive: true, force: true }); });

describe('triggers are created UNCLAIMED and claimed at registration (IT-128, D-1, REQ-115)', () => {
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

    const name = 'it128-claimer';
    const reg = await call('workflow_register', { name, script: "return 'ok';", mermaid: 'graph TD;', triggers: [id] });
    expect(reg.error, `register with triggers: ${JSON.stringify(reg.error)}`).toBeUndefined();
    const row = ((await call('webhook_list')).result as Array<{ id: string; workflow?: string | null }>).find((r) => r.id === id);
    expect(row?.workflow).toBe(name);

    // …and the claim is exclusive: a second workflow naming the same id is refused.
    const clash = await call('workflow_register', { name: 'it128-clash', script: "return 'ok';", mermaid: 'graph TD;', triggers: [id] });
    expect((clash.code ?? clash.error?.code)).toBe('TRIGGER_ALREADY_CLAIMED');
  });
});

// v24 orchestrator adjudication #8 (H-2, issue #56): the create-time binding door is CLOSED. v22's
// H4 put a release-resolution check on `schedule_create({workflow})`; REQ-115 MOVED that check to
// `workflow_register` ("it does not disappear, it changes site") — and v24 Gate 7.5's D-1 fix removed
// the old check while leaving the argument, so the old door stayed open validating nothing:
// `schedule_create({kind:'cron', cron:'0 6 * * *', workflow:'definitely-does-not-exist'})` returned
// `claimedBy:'definitely-does-not-exist'`, a phantom claim on a name that will never exist, which
// `workflow_register` can then never claim. Both rows' own descriptions already said "Name no
// workflow — hand the id to workflow_register({triggers:[id]})", and ARCH-099's `create(spec)` takes
// no workflow. The argument is removed from both inputSchemas and refused by name, ahead of ajv, with
// the migration answer — the `run_resume({overrides})` precedent in call-tool.ts, for the same reason
// stated there: `schema()` declares no `additionalProperties:false`, so a merely-undeclared key would
// be admitted by ajv and spread into the store exactly as before, silently and now undocumented.
describe('the create-time binding door is CLOSED — `workflow` is refused, not honoured (IT-128, adjudication #8 H-2, issue #56, REQ-115, ARCH-099)', () => {
  it('schedule_create({workflow}) -> INVALID_ARGUMENT, and NO schedule row is created', async () => {
    const before = ((await call('schedule_list')).result as unknown[]).length;
    const created = await call('schedule_create', { kind: 'cron', cron: '0 6 * * *', workflow: 'it128-definitely-does-not-exist' });
    expect(created.code ?? created.error?.code, `schedule_create({workflow}) was not refused: ${JSON.stringify(created)}`).toBe('INVALID_ARGUMENT');
    // The refusal must name the replacement door, not just say no (the run_start/run_resume standard).
    expect(String(created.error?.message ?? '')).toContain('workflow_register');
    const rows = (await call('schedule_list')).result as Array<{ claimedBy?: string | null }>;
    expect(rows.length, 'a refused create still wrote a row').toBe(before);
    expect(rows.some((r) => (r.claimedBy ?? null) === 'it128-definitely-does-not-exist'), 'the phantom claim survived the refusal').toBe(false);
  });

  it('webhook_create({workflow}) -> INVALID_ARGUMENT, and NO webhook row is created', async () => {
    const before = ((await call('webhook_list')).result as unknown[]).length;
    const created = await call('webhook_create', { workflow: 'it128-definitely-does-not-exist' });
    expect(created.code ?? created.error?.code, `webhook_create({workflow}) was not refused: ${JSON.stringify(created)}`).toBe('INVALID_ARGUMENT');
    expect(String(created.error?.message ?? '')).toContain('workflow_register');
    const rows = (await call('webhook_list')).result as Array<{ workflow?: string | null }>;
    expect(rows.length, 'a refused create still wrote a row').toBe(before);
    expect(rows.some((r) => (r.workflow ?? null) === 'it128-definitely-does-not-exist')).toBe(false);
  });

  it('neither create row ADVERTISES `workflow` any more — the schema and the description agree', async () => {
    const res = await fetch(`${base()}/mcp`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    const body = await res.json() as { result?: { tools?: Array<{ name: string; inputSchema?: { properties?: Record<string, unknown> } }> } };
    for (const name of ['schedule_create', 'webhook_create']) {
      const tool = body.result?.tools?.find((t) => t.name === name);
      expect(tool, `${name} missing from tools/list`).toBeDefined();
      expect(Object.keys(tool!.inputSchema?.properties ?? {}), `${name} still advertises \`workflow\``).not.toContain('workflow');
    }
  });
});

// v24 orchestrator adjudication #8 (H-2, issue #56) MIGRATION: D-1b's subject was a trigger bound
// AT CREATION (`schedule_create({workflow})`) — the only kind D-1 left creatable at the time — which
// `workflow_deregister` failed to release because it releases the ids the VERSION rows declare and a
// create-time binding never entered any version's `triggers[]`. That door is now closed, so the same
// two cases are driven through the surviving door (`workflow_register({triggers:[id]})`); the
// property under test is unchanged and still the one ADR-026 exists for — deregister releases, and a
// same-name re-registration inherits no firing. The create-time binding itself survives only as a
// PRE-v24 legacy row, where the port-level `create({workflow})` (untouched by this ruling) still
// covers it in webhook-registry.test.ts.
describe('deregister releases a claimed trigger — no phantom fire (IT-128, D-1b, ADR-026, adjudication #8 H-2)', () => {
  const WF = 'it128-phantom';

  it('a once-schedule claimed at registration fires for its OWN workflow (the positive control)', async () => {
    const created = await call('schedule_create', { kind: 'once', at: new Date(Date.now() + 3_000).toISOString() });
    expect(created.error).toBeUndefined();
    const id = ((created.result ?? created) as { id?: string }).id!;
    await registerPublish(WF, [id]);
    for (let i = 0; i < 100 && (await runsOf(WF)).length === 0; i++) await sleep(100);
    expect((await runsOf(WF)).length, 'the schedule never fired — a later "it did not fire" assertion would be vacuous').toBe(1);
  }, 20000);

  it('after deregister the claim is released, and a same-name re-registration inherits NO firing', async () => {
    // A fresh workflow name, its own claimed schedule, due ~5 s out.
    const name = 'it128-phantom-2';
    const created = await call('schedule_create', { kind: 'once', at: new Date(Date.now() + 5_000).toISOString() });
    const id = ((created.result ?? created) as { id?: string }).id!;
    await registerPublish(name, [id]);

    // Deregister BEFORE it is due: the binding must come back as an unclaimed trigger.
    const dereg = await call('workflow_deregister', { name });
    expect(dereg.error, `deregister: ${JSON.stringify(dereg.error)}`).toBeUndefined();
    expect(dereg.result.releasedTriggers, 'the claimed trigger was not reported as released').toContain(id);
    const row = ((await call('schedule_list')).result as Array<{ id: string; claimedBy?: string | null; workflow?: string | null }>).find((r) => r.id === id);
    expect(row?.claimedBy ?? null, 'claimedBy still points at the deleted workflow').toBeNull();
    expect(row?.workflow ?? null, 'the legacy workflow column still points at the deleted workflow — the fire path falls back to it').toBeNull();


    // Someone re-registers the freed name and publishes it.
    await registerPublish(name);

    // Wait past the due instant plus several ticks: the released trigger must NOT fire for the
    // re-registered workflow — nobody has claimed it.
    await sleep(7_000);
    expect(await runsOf(name), 'a released trigger fired for a re-registration of the same name (the ADR-026 phantom)').toEqual([]);
  }, 30000);
});
