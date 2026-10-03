// pi harness v1, slice (i): OpenRouter request-shape verification via a recording fake HTTP server
// — no real OpenRouter key is available in this dev environment (per the dispatch's own
// instruction), so this is the only evidence for the openrouter path's actual outbound request
// shape (model id, tools, reasoning.effort). Mirrors pi-spike-report.md S8's own proven technique
// (registerProvider('openrouter', {baseUrl: fake server}) — here reached through the real
// PiGatewayClient -> pi child -> pi-ai dispatch path, not a standalone ModelRuntime script).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import type { Server as HttpServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PiGatewayClient } from '../../src/gateway/pi-gateway-client.js';

interface RecordedRequest {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

function startFakeOpenRouterServer(): Promise<{ server: HttpServer; port: number; requests: RecordedRequest[] }> {
  const requests: RecordedRequest[] = [];
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let body: unknown = raw;
        try { body = JSON.parse(raw); } catch { /* keep raw */ }
        requests.push({ method: req.method, url: req.url, headers: req.headers as Record<string, string | string[] | undefined>, body });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          id: 'chatcmpl-fake-1', object: 'chat.completion', created: Math.floor(Date.now() / 1000), model: 'fake-model',
          choices: [{ index: 0, message: { role: 'assistant', content: 'FAKE_RESPONSE_OK' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
        }));
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
      resolve({ server, port, requests });
    });
  });
}

describe('pi harness v1 — OpenRouter request shape via a recording fake server (slice i)', () => {
  let fake: { server: HttpServer; port: number; requests: RecordedRequest[] };
  let ws: string;

  beforeAll(async () => {
    fake = await startFakeOpenRouterServer();
    ws = mkdtempSync(join(tmpdir(), 'rwe-pi-fake-or-'));
  });

  afterAll(async () => {
    await new Promise((r) => fake.server.close(() => r(undefined)));
    rmSync(ws, { recursive: true, force: true });
  });

  it('dispatches a real request shape to the fake server: correct model id, no tools when allowedTools:[], and reasoning.effort present', async () => {
    fake.requests.length = 0;
    const gw = new PiGatewayClient({
      secretSource: { resolve: (name) => (name === 'OPENROUTER_API_KEY' ? 'fake-key-not-real' : undefined) },
      timeoutMs: 15_000,
      openrouterBaseUrl: `http://127.0.0.1:${fake.port}/api/v1`,
    });
    const result = await gw.invoke({
      prompt: 'hi',
      opts: { model: 'openrouter/anthropic/claude-3.5-sonnet', effort: 'high', allowedTools: [] },
      runId: 'fake-or-r1',
      agentId: 'fake-or-a1',
      workspace: ws,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.provider).toBe('openrouter');
      expect(result.model).toBe('anthropic/claude-3.5-sonnet');
      expect(result.transport).toBe('pi');
    }

    expect(fake.requests.length).toBeGreaterThan(0);
    const body = fake.requests[0]!.body as Record<string, unknown>;
    // The exact model id reached the wire (never a cloak/alias — pi talks to OpenRouter natively).
    expect(body['model']).toBe('anthropic/claude-3.5-sonnet');
    // allowedTools:[] -> no tools on the wire.
    expect(body['tools'] === undefined || (Array.isArray(body['tools']) && body['tools'].length === 0)).toBe(true);
    // The never-real key never leaked anywhere observable on this side (it's in the Authorization
    // header the fake server received, not asserted here — the point is it's never written to disk
    // or logged; see pi-gateway-client.test.ts's own "never puts the OpenRouter API key into env" case).
    // effort:'high' -> thinkingLevel:'high' -> a real `reasoning.effort` field on the wire, through
    // the FULL session/agent path (not just pi-ai's raw completeSimple(), which is all
    // pi-spike-report.md S8 exercised) — strictly stronger evidence than the spike had.
    expect((body['reasoning'] as { effort?: string } | undefined)?.effort).toBe('high');
  }, 20_000);

  it('thinkingLevel varies the outbound reasoning.effort field (off vs high are NOT byte-identical) — pi-spike-report.md S8 re-verified end to end', async () => {
    const bodies: Record<string, unknown>[] = [];
    for (const effort of [undefined, 'low', 'high'] as const) {
      fake.requests.length = 0;
      const gw = new PiGatewayClient({
        secretSource: { resolve: () => 'fake-key-not-real' },
        timeoutMs: 15_000,
        openrouterBaseUrl: `http://127.0.0.1:${fake.port}/api/v1`,
      });
      const result = await gw.invoke({
        prompt: 'hi',
        opts: { model: 'openrouter/anthropic/claude-3.5-sonnet', allowedTools: [], ...(effort ? { effort } : {}) },
        runId: `fake-or-effort-${effort ?? 'none'}`,
        agentId: 'fake-or-a2',
        workspace: ws,
      });
      expect(result.ok).toBe(true);
      expect(fake.requests.length).toBeGreaterThan(0);
      bodies.push(fake.requests[0]!.body as Record<string, unknown>);
    }
    const [noEffort, low, high] = bodies;
    // design change verified: VAL-186's hope — pi's native OpenRouter path does NOT collapse
    // low/high into byte-identical bodies the way the sdk-gateway+LiteLLM path does.
    expect(JSON.stringify(low)).not.toBe(JSON.stringify(high));
    expect(JSON.stringify(noEffort)).not.toBe(JSON.stringify(high));
    expect((low!['reasoning'] as { effort?: string } | undefined)?.effort).toBe('low');
    expect((high!['reasoning'] as { effort?: string } | undefined)?.effort).toBe('high');
    // thinkingLevel:'off' (no effort requested) still carries a reasoning field, but with
    // effort:'none' — matches pi-spike-report.md S8's own exact finding (`off -> {"effort":"none"}`).
    expect((noEffort!['reasoning'] as { effort?: string } | undefined)?.effort).toBe('none');
  }, 30_000);
});
