// issue #152: a REAL child (pi-child/entry.ts, real session-runner.ts, real pi-ai dispatch) talking
// to a fake OpenRouter server that streams a first chunk and then goes silent forever (no
// finish_reason, no usage chunk, no [DONE] — "slowly past the timeout", per the issue's own ask) —
// proving the gateway's timeout/kill path on a REAL subprocess, not just the `spawnChild` fake-child
// unit-tier seam `pi-gateway-client-attempts.test.ts` already covers. Before the #152 fix, this
// scenario reported tokens:{0,0,0,0} with NO `partial` flag and NO `detail` at all; `failureMessage`
// (run-manager.ts) would have fallen back to the opaque "no failure detail recorded" for it.
//
// Mirrors pi-harness-openrouter-fake-server.test.ts's own recording-fake-server technique (slice i).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import type { Server as HttpServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PiGatewayClient } from '../../src/gateway/pi-gateway-client.js';

/** Writes real SSE headers plus one legitimate streaming chunk (so pi-ai's openai-completions
 *  client genuinely starts consuming a real response, exactly like a slow/overloaded provider would),
 *  then never writes anything else and never ends the response — the request hangs until something
 *  external (the gateway's own timeoutMs kill) tears down the connection. */
function startSlowFakeOpenRouterServer(): Promise<{ server: HttpServer; port: number; requestCount: () => number }> {
  let count = 0;
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      count += 1;
      const id = 'chatcmpl-fake-slow';
      const created = Math.floor(Date.now() / 1000);
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      const chunk1 = { id, object: 'chat.completion.chunk', created, model: 'fake-model', choices: [{ index: 0, delta: { role: 'assistant', content: 'still working' }, finish_reason: null }] };
      res.write(`data: ${JSON.stringify(chunk1)}\n\n`);
      // Deliberately never writes a finish_reason/usage chunk, `[DONE]`, or `res.end()` — the request
      // stalls until the client (or its killer) tears down the socket.
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
      resolve({ server, port, requestCount: () => count });
    });
  });
}

describe('pi harness v1 — a real child timed out against a slow/hanging fake OpenRouter stream (issue #152)', () => {
  let fake: { server: HttpServer; port: number; requestCount: () => number };
  let ws: string;

  beforeAll(async () => {
    fake = await startSlowFakeOpenRouterServer();
    ws = mkdtempSync(join(tmpdir(), 'rwe-pi-timeout-fake-or-'));
  });

  afterAll(async () => {
    await new Promise((r) => fake.server.close(() => r(undefined)));
    rmSync(ws, { recursive: true, force: true });
  });

  it('reports reason:"timeout", a non-empty detail naming the attempt/bound, and partial:true even though nothing completed', async () => {
    const gw = new PiGatewayClient({
      secretSource: { resolve: (name) => (name === 'OPENROUTER_API_KEY' ? 'fake-key-not-real' : undefined) },
      timeoutMs: 3000,
      openrouterBaseUrl: `http://127.0.0.1:${fake.port}/api/v1`,
    });
    const result = await gw.invoke({
      prompt: 'hi',
      opts: { model: 'openrouter/anthropic/claude-3.5-sonnet', allowedTools: [] },
      runId: 'timeout-fake-or-r1',
      agentId: 'timeout-fake-or-a1',
      workspace: ws,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('timeout');
      expect(result.transport).toBe('pi');
      // The REAL fallback this fixes: before #152 this would have been undefined, and run-manager.ts's
      // failureMessage() would have shown the opaque "no failure detail recorded" to a caller.
      expect(result.detail).toBeDefined();
      expect(result.detail).toContain('attempt 1/1');
      expect(result.detail).toContain('timed out after 3000ms');
      // Marked partial:true even though the known figure is 0 — never a misleading exact-zero spend.
      expect(result.partial).toBe(true);
      expect(result.tokens).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
    }
    expect(fake.requestCount()).toBeGreaterThan(0);
  }, 20_000);
});
