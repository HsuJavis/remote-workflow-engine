// pi harness v1, rest of slice (f): error classification against a REAL HTTP response from a
// recording/responding fake server standing in for OpenRouter — not a fabricated child event. Proves
// the full path: fake server returns a real non-2xx HTTP response -> pi-ai's openai-completions
// client throws -> session-runner.ts's `session.prompt()` catch turns it into `{t:'error'}` ->
// PiGatewayClient.classifyPiErrorMessage reads the SAME string the real openai/pi-ai error-body
// normalization produced -> retryable is set correctly, and the outer attemptsFor loop actually
// re-requests the fake server for a retryable status (count proves the retry happened, not just the
// classification).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import type { Server as HttpServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PiGatewayClient } from '../../src/gateway/pi-gateway-client.js';

function startFakeServerReturning(status: number, body: unknown): Promise<{ server: HttpServer; port: number; requestCount: () => number }> {
  let count = 0;
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        count += 1;
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
      resolve({ server, port, requestCount: () => count });
    });
  });
}

describe('pi harness v1 — error classification against a real fake-server HTTP status (rest of slice f)', () => {
  let ws: string;
  beforeAll(() => { ws = mkdtempSync(join(tmpdir(), 'rwe-pi-errclass-')); });
  afterAll(() => { rmSync(ws, { recursive: true, force: true }); });

  it('401 is terminal — exactly ONE request reaches the fake server even with retries configured', async () => {
    const fake = await startFakeServerReturning(401, { error: { message: 'Invalid API key' } });
    try {
      const gw = new PiGatewayClient({
        secretSource: { resolve: () => 'fake-key-not-real' },
        timeoutMs: 15_000,
        retries: 2,
        openrouterBaseUrl: `http://127.0.0.1:${fake.port}/api/v1`,
      });
      const result = await gw.invoke({
        prompt: 'hi',
        opts: { model: 'openrouter/anthropic/claude-3.5-sonnet', allowedTools: [] },
        runId: 'errclass-401',
        agentId: 'errclass-a1',
        workspace: ws,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.retryable).toBe(false);
      expect(fake.requestCount()).toBe(1);
    } finally {
      await new Promise((r) => fake.server.close(() => r(undefined)));
    }
  }, 30_000);

  it('429 is retryable — the fake server sees 1+retries requests', async () => {
    const fake = await startFakeServerReturning(429, { error: { message: 'Rate limit exceeded' } });
    try {
      const gw = new PiGatewayClient({
        secretSource: { resolve: () => 'fake-key-not-real' },
        timeoutMs: 15_000,
        retries: 2,
        openrouterBaseUrl: `http://127.0.0.1:${fake.port}/api/v1`,
      });
      const result = await gw.invoke({
        prompt: 'hi',
        opts: { model: 'openrouter/anthropic/claude-3.5-sonnet', allowedTools: [] },
        runId: 'errclass-429',
        agentId: 'errclass-a2',
        workspace: ws,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.retryable).not.toBe(false);
      expect(fake.requestCount()).toBe(3);
    } finally {
      await new Promise((r) => fake.server.close(() => r(undefined)));
    }
  }, 30_000);

  it('500 is retryable — the fake server sees 1+retries requests', async () => {
    const fake = await startFakeServerReturning(500, { error: { message: 'internal server error' } });
    try {
      const gw = new PiGatewayClient({
        secretSource: { resolve: () => 'fake-key-not-real' },
        timeoutMs: 15_000,
        retries: 1,
        openrouterBaseUrl: `http://127.0.0.1:${fake.port}/api/v1`,
      });
      const result = await gw.invoke({
        prompt: 'hi',
        opts: { model: 'openrouter/anthropic/claude-3.5-sonnet', allowedTools: [] },
        runId: 'errclass-500',
        agentId: 'errclass-a3',
        workspace: ws,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.retryable).not.toBe(false);
      expect(fake.requestCount()).toBe(2);
    } finally {
      await new Promise((r) => fake.server.close(() => r(undefined)));
    }
  }, 30_000);
});

/** residual fix (#127): a real SSE stream that sends real content tokens and THEN ends in an error
 *  finish_reason (`content_filter` -> pi-ai's own `mapStopReason`: `stopReason:'error'`) WITH a real
 *  `usage` chunk attached — proves the usage is not silently dropped, through the REAL child process,
 *  not a fabricated `{t:'error',usage:...}` child event. */
function startFakeServerStreamingThenErroring(): Promise<{ server: HttpServer; port: number; requestCount: () => number }> {
  let count = 0;
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        count += 1;
        const id = 'chatcmpl-fake-err-1';
        const created = Math.floor(Date.now() / 1000);
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
        const chunk1 = { id, object: 'chat.completion.chunk', created, model: 'fake-model', choices: [{ index: 0, delta: { role: 'assistant', content: 'partial tokens before the error' }, finish_reason: null }] };
        const chunk2 = { id, object: 'chat.completion.chunk', created, model: 'fake-model', choices: [{ index: 0, delta: {}, finish_reason: 'content_filter' }], usage: { prompt_tokens: 17, completion_tokens: 4, total_tokens: 21 } };
        res.write(`data: ${JSON.stringify(chunk1)}\n\n`);
        res.write(`data: ${JSON.stringify(chunk2)}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
      resolve({ server, port, requestCount: () => count });
    });
  });
}

describe('pi harness v1 — usage on a streamed-then-errored message is not dropped (residual fix, #127)', () => {
  it('real tokens streamed before a content_filter error are folded into the reported usage, marked partial', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'rwe-pi-errusage-'));
    const fake = await startFakeServerStreamingThenErroring();
    try {
      const gw = new PiGatewayClient({
        secretSource: { resolve: () => 'fake-key-not-real' },
        timeoutMs: 15_000,
        openrouterBaseUrl: `http://127.0.0.1:${fake.port}/api/v1`,
      });
      const usages: unknown[] = [];
      const result = await gw.invoke({
        prompt: 'hi',
        opts: { model: 'openrouter/anthropic/claude-3.5-sonnet', allowedTools: [] },
        runId: 'errusage-r1',
        agentId: 'errusage-a1',
        workspace: ws,
        onUsage: (u) => usages.push({ ...u }),
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.tokens).toEqual({ input: 17, output: 4, cacheRead: 0, cacheWrite: 0 });
        expect(result.partial).toBe(true);
      }
      expect(usages).toContainEqual({ input: 17, output: 4, cacheRead: 0, cacheWrite: 0 });
    } finally {
      rmSync(ws, { recursive: true, force: true });
      await new Promise((r) => fake.server.close(() => r(undefined)));
    }
  }, 30_000);
});
