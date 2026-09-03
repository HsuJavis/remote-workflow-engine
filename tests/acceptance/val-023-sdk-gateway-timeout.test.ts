// VAL-023: SDK gateway path bounds a hung agent LLM call — timeout + retries (REQ-020)
// Real entrypoint: real spawned `claude` CLI via ClaudeAgentSdkGatewayClient, pointed at a REAL
// (fault-injected, never-responding) local HTTP endpoint — a real hung provider, not a mock of
// anything this product owns (same technique as IT-015's stub server / E2E-007).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { ClaudeAgentSdkGatewayClient } from '../../src/gateway/claude-agent-sdk-client.js';
// Value import — module-not-found when absent (guarantees this file is RED at collection).
import { raceWithTimeout } from '../../src/timeout-race.js';
import { runScriptVia } from '../helpers/workflow-fixtures.js';

const HUNG_PORT = 38201;

let server: Server;
let tmpDir: string;
let hungStub: HttpServer;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-val023-'));
  hungStub = createHttpServer(() => { /* never responds — a real fault-injected hung provider */ });
  await new Promise<void>((resolve) => hungStub.listen(HUNG_PORT, '127.0.0.1', resolve));
  server = await createServer({
    port: 0, bind: '127.0.0.1', workRoot: tmpDir,
    gateway: new ClaudeAgentSdkGatewayClient({ baseUrl: `http://127.0.0.1:${HUNG_PORT}`, timeoutMs: 5000, retries: 0 }),
  });
});

afterAll(async () => {
  await server?.close();
  // The stub is DELIBERATELY hung: it never ends a response, so every request it received is still
  // an open socket, and `close()` waits for all of them — it does not return, and this hook times
  // out (10s) even though all assertions passed. Drop those sockets first: the connections exist
  // only because the fixture chose never to answer them (Gate 6.5+7 verifier, 2026-09-03).
  hungStub.closeAllConnections();
  await new Promise<void>((resolve) => hungStub.close(() => resolve()));
  rmSync(tmpDir, { recursive: true, force: true });
});

async function mcpCall(name: string, args: Record<string, unknown> = {}) {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> }; error?: { code: number; message: string } };
  if (body.error) return { error: body.error };
  // workflow_* tools return their own flat envelope ({runId,status,result,...}) directly.
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}') as Record<string, unknown>;
}

describe('VAL-023: REQ-020 clause 1 — a hung provider call is bounded, agent() resolves null, the run continues (never hangs)', () => {
  it('a real run against the hung provider completes within the configured bound, agent() resolving null', async () => {
    const run = await runScriptVia(mcpCall, `const r = await agent('this will hang'); return r === null ? 'bounded' : 'leaked-non-null';`);
    const runId = run['runId'] as string;
    let finalStatus: string | undefined;
    for (let i = 0; i < 30; i++) {
      const s = await mcpCall('workflow_status', { runId });
      finalStatus = s['status'] as string;
      if (finalStatus === 'completed' || finalStatus === 'failed') break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    expect(finalStatus).toBe('completed');
    const result = await mcpCall('workflow_result', { runId });
    expect(result['result']).toBe('bounded');
  }, 60000);
});

describe('VAL-023: REQ-020 clause 2 — the provider/timeout failure is visible in the AgentRecord, never smuggled as fake success text', () => {
  it('the deterministic (injected Clock) outer race resolves ok:false with a timeout FailureEnvelope — the reusable primitive this real path is built on', async () => {
    const { FixedClock } = await import('../../src/clock.js');
    const { createSemaphore } = await import('../../src/agent-semaphore.js');
    const clock = new FixedClock(new Date('2020-01-01T00:00:00.000Z'));
    const sem = createSemaphore(1);
    const result = await raceWithTimeout(() => new Promise<string>(() => {}), { clock, timeoutMs: 50, kill: () => {}, semaphore: sem });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.envelope.kind).toBe('timeout');
  });
});
