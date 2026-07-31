// v8 Defer B (REQ-057): the webhook route on the real server — register via MCP, POST a signed
// delivery to /hooks/:id, assert the pre-bound workflow ran. Real createServer; only time is real.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

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
    // register the target workflow + a webhook bound to it
    await callTool('workflow_register', { name: 'on-hook', script: `return { hooked: args.event };` });
    const created = await callTool('webhook_create', { workflow: 'on-hook' });
    expect(created.result.secret).toBeTruthy();
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

    // the pre-bound workflow really ran with the body as args.event
    let result: any;
    for (let i = 0; i < 25; i++) {
      await new Promise((r) => setTimeout(r, 200));
      result = await callTool('workflow_result', { runId: gotoBody.runId });
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
