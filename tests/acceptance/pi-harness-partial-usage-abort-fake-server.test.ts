// issue #160 BUG-4: a REAL child (pi-child/entry.ts, real session-runner.ts, real pi-ai dispatch)
// talking to a fake OpenRouter server that streams an EARLY usage chunk (some providers populate
// `usage` on an intermediate chunk, not only the final one — OpenAI's own `stream_options.
// include_usage` spec only guarantees the final chunk, but this engine must not assume every
// provider behind OpenRouter follows that), then goes silent forever and is aborted (run_suspend's
// own real signal) mid-turn — proving the real child forwards that provider-reported figure
// end-to-end (session-runner.ts's `usage_update` wire event -> pi-gateway-client.ts's
// `liveInFlightUsage`) instead of charging the unconditional 0 this reported before the fix.
//
// Mirrors pi-harness-timeout-fake-server.test.ts's own real-subprocess technique.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import type { Server as HttpServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PiGatewayClient } from '../../src/gateway/pi-gateway-client.js';

/** Writes real SSE headers, a content chunk, then an EARLY chunk that carries `usage` (mimicking a
 *  provider that reports a running usage total mid-stream) with NO finish_reason — the turn is
 *  still open — then never writes anything else and never ends the response. */
function startEarlyUsageFakeOpenRouterServer(): Promise<{ server: HttpServer; port: number; requestCount: () => number }> {
  let count = 0;
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      count += 1;
      const id = 'chatcmpl-fake-earlyusage';
      const created = Math.floor(Date.now() / 1000);
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      const chunk1 = { id, object: 'chat.completion.chunk', created, model: 'fake-model', choices: [{ index: 0, delta: { role: 'assistant', content: 'still working' }, finish_reason: null }] };
      // A real running total, on a chunk with NO finish_reason — the turn has not ended.
      const chunk2 = { id, object: 'chat.completion.chunk', created, model: 'fake-model', choices: [{ index: 0, delta: {}, finish_reason: null }], usage: { prompt_tokens: 42, completion_tokens: 7, total_tokens: 49 } };
      res.write(`data: ${JSON.stringify(chunk1)}\n\n`);
      res.write(`data: ${JSON.stringify(chunk2)}\n\n`);
      // Deliberately never writes a finish_reason, `[DONE]`, or `res.end()` — the request stalls
      // until the client (or its killer) tears down the socket.
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
      resolve({ server, port, requestCount: () => count });
    });
  });
}

describe('pi harness v1 — a real child aborted mid-turn after an early provider usage chunk (issue #160 BUG-4)', () => {
  let fake: { server: HttpServer; port: number; requestCount: () => number };
  let ws: string;

  beforeAll(async () => {
    fake = await startEarlyUsageFakeOpenRouterServer();
    ws = mkdtempSync(join(tmpdir(), 'rwe-pi-earlyusage-fake-or-'));
  });

  afterAll(async () => {
    await new Promise((r) => fake.server.close(() => r(undefined)));
    rmSync(ws, { recursive: true, force: true });
  });

  it('charges the provider\'s own mid-turn usage figure on abort, never an unconditional 0', async () => {
    const gw = new PiGatewayClient({
      secretSource: { resolve: (name) => (name === 'OPENROUTER_API_KEY' ? 'fake-key-not-real' : undefined) },
      openrouterBaseUrl: `http://127.0.0.1:${fake.port}/api/v1`,
    });
    const ac = new AbortController();
    const liveUsage: unknown[] = [];
    const promise = gw.invoke({
      prompt: 'hi',
      opts: { model: 'openrouter/anthropic/claude-3.5-sonnet', allowedTools: [] },
      runId: 'earlyusage-fake-or-r1',
      agentId: 'earlyusage-fake-or-a1',
      workspace: ws,
      signal: ac.signal,
      onUsage: (t) => liveUsage.push(t),
    });
    // Give the real child time to actually receive and parse the early usage chunk before suspending.
    await new Promise((r) => setTimeout(r, 2000));
    ac.abort();
    const result = await promise;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('aborted');
      expect(result.transport).toBe('pi');
      expect(result.partial).toBe(true);
      // The real fake-server figure, forwarded end-to-end through the real child — never the
      // unconditional 0 this reported before the fix.
      expect(result.tokens).toEqual({ input: 42, output: 7, cacheRead: 0, cacheWrite: 0 });
    }
    expect(liveUsage).toContainEqual({ input: 42, output: 7, cacheRead: 0, cacheWrite: 0 });
    expect(fake.requestCount()).toBeGreaterThan(0);
  }, 20_000);
});
