// v8 Defer B (REQ-057): the webhook route on the real server — register via MCP, POST a signed
// delivery to /hooks/:id, assert the pre-bound workflow ran. Real createServer; only time is real.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { registerPublishedVia, DEFAULT_FIXTURE_MODEL } from '../helpers/workflow-fixtures.js';

let server: Server;
let tmpDir: string;
const base = () => `http://127.0.0.1:${server.port}`;

async function callTool(name: string, args: unknown): Promise<any> {
  const res = await fetch(`${base()}/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}');
}

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-wh-http-'));
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir });
});
afterAll(async () => {
  await server?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('webhook ingress POST /hooks/:id (v8 Defer B, REQ-057)', () => {
  it('a correctly-signed delivery fires the pre-bound workflow; a bad signature does not', async () => {
    // Create the webhook UNCLAIMED, then register+publish the target workflow claiming its id —
    // v24 orchestrator adjudication #8 (H-2, issue #56) closed `webhook_create({workflow})`, so
    // `workflow_register({triggers:[id]})` is the only binding door. Same end state as the pre-fix
    // `webhook_create({workflow:'on-hook'})`: one webhook bound to one published workflow.
    const created = await callTool('webhook_create', {});
    expect(created.result.secret).toBeTruthy();
    await registerPublishedVia(callTool, 'on-hook', `return { hooked: args.event };`, {
      triggers: [(created.result as { webhookId: string }).webhookId],
    });
    expect(created.result.url).toContain('/hooks/');
    const { url, secret } = created.result as { url: string; secret: string };

    const body = JSON.stringify({ ping: 'pong' });
    const sig = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');

    // bad signature → 401, no run
    const bad = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-RWE-Signature': 'sha256=deadbeef', 'X-RWE-Timestamp': new Date().toISOString(), 'X-RWE-Delivery': 'd-bad' },
      body,
    });
    expect(bad.status).toBe(401);

    // good signature → 202 with a runId
    const good = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-RWE-Signature': sig, 'X-RWE-Timestamp': new Date().toISOString(), 'X-RWE-Delivery': 'd-good' },
      body,
    });
    expect(good.status).toBe(202);
    const gotoBody = await good.json() as { runId?: string };
    expect(typeof gotoBody.runId).toBe('string');

    // issue #88: the SAME delivery id, retried (real sender behavior on a dropped ack), replays
    // the ORIGINAL outcome — 200 {replayed:true, runId}, not a second run — over real HTTP.
    const replay = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-RWE-Signature': sig, 'X-RWE-Timestamp': new Date().toISOString(), 'X-RWE-Delivery': 'd-good' },
      body,
    });
    expect(replay.status).toBe(200);
    const replayBody = await replay.json() as { replayed?: boolean; runId?: string };
    expect(replayBody).toEqual({ replayed: true, runId: gotoBody.runId });

    // the pre-bound workflow really ran with the body as args.event
    let result: any;
    for (let i = 0; i < 25; i++) {
      await new Promise((r) => setTimeout(r, 200));
      result = await callTool('run_result', { runId: gotoBody.runId });
      if (result.status === 'completed') break;
    }
    expect(result.status).toBe('completed');
    expect(result.result).toEqual({ hooked: { ping: 'pong' } });

    // webhook_list shows a fingerprint, never the secret
    const list = await callTool('webhook_list', {});
    expect(list.result[0].secretFingerprint).toBeTruthy();
    expect(JSON.stringify(list.result)).not.toContain(secret);
  }, 20000);
});

// Webhook B2 (dash-auth-spec.md §B2): a real, observable member of ADMISSION_PERMANENT_CODES —
// `MCP_NOT_PROVISIONED` — reached through the REAL server, no mock in the loop. Registration only
// WARNS about a declared-but-unprovisioned mcp name (issue #103a); admission REFUSES it inside
// `RunManager.start()`, exactly on the webhook delivery path this suite drives end to end. Mirrors
// `schedule-firing-mcp-provisioning.test.ts`'s own real-HTTP proof for the schedule-firing twin of
// this same admission door.
function scriptDeclaringMcp(mcp: string[]): string {
  return [
    "export const meta = { params: { agents: { a: {",
    `  model: { type: 'string', default: ${JSON.stringify(DEFAULT_FIXTURE_MODEL)} },`,
    "  effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' },",
    "  timeoutMs: { type: 'number', default: 60000 },",
    `  mcp: ${JSON.stringify(mcp)},`,
    "} } } };",
    "phase('Work');",
    "await agent('a', {});",
    "return 'ok';",
  ].join('\n');
}
const MCP_MERMAID = 'graph LR\nsubgraph "Work"\nn0(["a"])\nend';

describe('webhook B2: an admission-time MCP_NOT_PROVISIONED refusal is 409, recorded, and replayed (real HTTP)', () => {
  it('the delivery is refused 409 before any run starts, replays the SAME 409 for the SAME deliveryId, and webhook_list shows refusalCount 1', async () => {
    const created = await callTool('webhook_create', {});
    const { webhookId, url, secret } = created.result as { webhookId: string; url: string; secret: string };

    const reg = await callTool('workflow_register', {
      name: 'wh-mcp-refuse', script: scriptDeclaringMcp(['echo-mcp']), mermaid: MCP_MERMAID, triggers: [webhookId],
    });
    expect(reg.error, JSON.stringify(reg)).toBeUndefined();
    const version = (reg.result as { version?: string }).version;
    const pub = await callTool('workflow_publish', { name: 'wh-mcp-refuse', version, channel: 'release' });
    expect(pub.error).toBeUndefined();

    const body = '{}';
    const sig = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
    const headers = { 'Content-Type': 'application/json', 'X-RWE-Signature': sig, 'X-RWE-Timestamp': new Date().toISOString(), 'X-RWE-Delivery': 'd-mcp-refuse' };

    const first = await fetch(url, { method: 'POST', headers, body });
    expect(first.status).toBe(409);
    const firstBody = await first.json() as { code?: string; error?: string };
    expect(firstBody.code).toBe('MCP_NOT_PROVISIONED');

    // SAME deliveryId → the SAME 409/code, not an upgraded 2xx (issue #88 permanent-refusal replay).
    const replay = await fetch(url, { method: 'POST', headers, body });
    expect(replay.status).toBe(409);
    const replayBody = await replay.json() as { code?: string };
    expect(replayBody.code).toBe('MCP_NOT_PROVISIONED');

    const list = await callTool('webhook_list', {});
    const row = (list.result as Array<{ id: string; refusalCount: number; lastRefusalReason?: string }>).find((w) => w.id === webhookId);
    expect(row?.refusalCount).toBe(1); // a replay is not a new admission decision
    expect(row?.lastRefusalReason).toBe('MCP_NOT_PROVISIONED');

    // no run was ever started for this delivery
    expect((await callTool('run_list', { workflow: 'wh-mcp-refuse' })).result).toEqual([]);
  }, 20000);
});
