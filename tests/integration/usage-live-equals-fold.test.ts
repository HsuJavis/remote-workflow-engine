// IT-167 (DES-194, ARCH-127, ADR-052, TASK-199, REQ-141/132/133): the INV-V27-1 lock, two clauses,
// over REAL SQLite + REAL HTTP — `/api/runs[i].costUSD` MUST equal `/api/runs/:id.usage.costUSD`
// for the SAME run (one precedence chain, read by both routes, per ARCH-127). This IS v27's
// real-tier validation path for REQ-141 (04-design.md names no separate browser file for it) and
// doubles as VAL-205.
//
// Mock policy (integration): real createServer(), real MCP HTTP, real SqliteRunStore; only the
// third-party model provider is faked (an injected GatewayClient), same convention as
// dag-masking-auth.test.ts.
//
// Red reason (measured): `/api/runs` (server.ts:387) still reads `store.listRuns()` directly with
// no usage projection at all — every `RunSummary` in the array carries no `costUSD` today, so it is
// `undefined`, never equal to the detail route's real `usage.costUSD` number.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import type { GatewayClient } from '../../src/gateway/client.js';
import { registerPublishedVia } from '../helpers/workflow-fixtures.js';

// One priced (known model) + one deliberately unpriced (unrecognized model) call per run — the two
// cases that split the folds last time (v26 R-1), per DES-194's own oracle.
const FAKE_GATEWAY: GatewayClient = {
  invoke: async (req) => {
    if (req.opts.label === 'unpriced') {
      return { ok: true, provider: 'anthropic', model: 'totally-unrecognized-test-model-xyz', tokens: { input: 5, output: 5 }, content: 'x' };
    }
    return { ok: true, provider: 'anthropic', model: 'claude-3-5-sonnet-20241022', tokens: { input: 10, output: 4 }, content: 'x' };
  },
};

let server: Server;
let tmpDir: string;
let baseUrl: string;

async function mcpCall(name: string, args: unknown): Promise<any> {
  const res = await fetch(`${baseUrl}/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = (await res.json()) as { result?: { content: Array<{ text: string }> } };
  return JSON.parse(body.result!.content[0]!.text);
}

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-it167-'));
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir, gateway: FAKE_GATEWAY });
  baseUrl = `http://127.0.0.1:${server.port}`;
});

afterAll(async () => {
  await server?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

async function runAndWait(name: string, script: string): Promise<string> {
  await registerPublishedVia(mcpCall, name, script);
  const started = await mcpCall('run_start', { name });
  const runId = started.runId as string;
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const s = await mcpCall('run_status', { runId });
    if (['completed', 'failed'].includes(s.status)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  return runId;
}

describe('/api/runs[i].costUSD equals /api/runs/:id.usage.costUSD for the SAME run (IT-167, INV-V27-1, VAL-205)', () => {
  it('a run holding both a priced and an unpriced call: the summary and the detail agree, via ONE fold', async () => {
    const runId = await runAndWait('it167-priced-and-unpriced', `
      await agent('priced', { prompt: 'p' });
      await agent('unpriced', { prompt: 'p' });
      return 'ok';
    `);
    const detailRes = await fetch(`${baseUrl}/api/runs/${runId}`);
    const detail = (await detailRes.json()) as { usage?: { costUSD?: number; unpricedCalls?: number } };
    expect(detail.usage?.unpricedCalls).toBeGreaterThanOrEqual(1); // sanity: at least the unrecognized model is unpriced

    const listRes = await fetch(`${baseUrl}/api/runs`);
    const list = (await listRes.json()) as Array<{ runId: string; costUSD?: number }>;
    const summary = list.find((r) => r.runId === runId);
    expect(summary?.costUSD).toBe(detail.usage?.costUSD);
  }, 30000);

  it('a run that completed having made ZERO agent() calls: the summary omits all four fields, and the detail folds over zero records', async () => {
    const runId = await runAndWait('it167-zero-agents', `return 'no agents here';`);
    const detailRes = await fetch(`${baseUrl}/api/runs/${runId}`);
    const detail = (await detailRes.json()) as { usage?: { costUSD?: number; tokens?: { input: number; output: number } } };
    expect(detail.usage?.costUSD).toBe(0);
    expect(detail.usage?.tokens?.input).toBe(0);

    const listRes = await fetch(`${baseUrl}/api/runs`);
    const list = (await listRes.json()) as Array<{ runId: string; costUSD?: number; tokensTotal?: number; agentCount?: number }>;
    const summary = list.find((r) => r.runId === runId);
    expect(summary?.costUSD).toBeUndefined();
    expect(summary?.tokensTotal).toBeUndefined();
    expect(summary?.agentCount).toBeUndefined();
  }, 30000);
});
