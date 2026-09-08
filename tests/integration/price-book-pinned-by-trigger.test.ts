// IT-147 (DES-178, ARCH-116, ADR-038, TASK-178, v26): a run started through the WEBHOOK path (never
// `run_start`) still gets a non-null `price_book` pin at admission — pricing/tracking applies
// "however started," per the owner's own principle (REQ-127). Written test-first (Gate 5, RED): no
// pin exists at all today — `run_result.meta.usage` (DES-183's own field) is absent from every run.
// Mock policy (integration): real createServer(), real webhook ingress HTTP round trip, real
// RunManager/AgentExecutor; the injected `modelCatalog` source stands in for the live OpenRouter/
// Ollama catalog fetch (the one genuinely un-runnable third-party network boundary).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { registerPublishedVia } from '../helpers/workflow-fixtures.js';

let server: Server;
let tmpDir: string;
const base = () => `http://127.0.0.1:${server.port}`;

async function callTool(name: string, args: unknown): Promise<any> {
  const res = await fetch(`${base()}/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = (await res.json()) as { result?: { content?: Array<{ text?: string }> } };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}');
}

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-it147-'));
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir, modelCatalog: async () => [] });
});
afterAll(async () => {
  await server?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('a webhook-started run gets a non-null price_book pin, surfaced via run_result.meta.usage (IT-147, DES-178)', () => {
  it('run_result.meta.usage is present after a webhook-triggered run completes', async () => {
    const created = await callTool('webhook_create', {});
    await registerPublishedVia(callTool, 'it147-on-hook', `return { hooked: args.event };`, {
      triggers: [(created.result as { webhookId: string }).webhookId],
    });
    const { url, secret } = created.result as { url: string; secret: string };
    const body = JSON.stringify({ ping: 'pong' });
    const sig = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-RWE-Signature': sig, 'X-RWE-Timestamp': new Date().toISOString(), 'X-RWE-Delivery': 'd-it147' },
      body,
    });
    expect(res.status).toBe(202);
    const { runId } = (await res.json()) as { runId: string };

    let result: any;
    for (let i = 0; i < 60; i++) {
      result = await callTool('run_result', { runId });
      if (result.status !== undefined || result.error !== undefined) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(result.meta?.usage).toBeDefined();
  }, 20000);
});
