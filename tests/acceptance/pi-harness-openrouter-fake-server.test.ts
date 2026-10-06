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

/** rest-of-slice-(f) finding: pi-ai's openai-completions client always sends `stream:true`
 *  (openai-completions.js:575) — a plain non-streaming JSON body (what this helper used to send)
 *  makes the real `openai` client fail parsing with "Stream ended without finish_reason". Before the
 *  `erroredOut` fix in session-runner.ts (pi-child/session-runner.ts — a real defect this same
 *  iteration's error-classification work found and fixed: an assistant message with
 *  `stopReason:'error'` did not stop `runPiChildSession` from ALSO emitting a `{t:'final'}` event
 *  right after, so the parent's `settled` was silently overwritten from the real failure into a fake
 *  `ok:true`/empty-content "success"), this test was GREEN by accident — it verified the OUTBOUND
 *  request shape correctly, but never actually proved a real completion came back, because one never
 *  did. Responding with a real OpenAI-shaped SSE stream (not a single JSON object) is both the
 *  correct fix and makes this test's `result.ok` assertion test something real. */
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
        const id = 'chatcmpl-fake-1';
        const created = Math.floor(Date.now() / 1000);
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
        const chunk1 = { id, object: 'chat.completion.chunk', created, model: 'fake-model', choices: [{ index: 0, delta: { role: 'assistant', content: 'FAKE_RESPONSE_OK' }, finish_reason: null }] };
        const chunk2 = { id, object: 'chat.completion.chunk', created, model: 'fake-model', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 } };
        res.write(`data: ${JSON.stringify(chunk1)}\n\n`);
        res.write(`data: ${JSON.stringify(chunk2)}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
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
      // A REAL completion came back (the point of the SSE-shaped fake response above, not just a
      // request-shape capture) — proves the erroredOut fix: before it, this field was '' because the
      // real "Stream ended without finish_reason" failure was silently overwritten into a fake
      // ok:true/empty-content success.
      expect(result.content).toBe('FAKE_RESPONSE_OK');
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

  // issue #142: OpenRouter publicly lists `anthropic/claude-sonnet-5.5` and `anthropic/claude-
  // haiku-4.5` with live endpoints, but both 404'd (probe and a real agent dispatch). Root cause:
  // pi's own BUILTIN openrouter catalog (providers/openrouter.js + its generated data) catalogues
  // exactly these ids under an 'anthropic-messages' api shape (Anthropic Messages wire format,
  // dispatched via an Anthropic SDK client), while every other vendor's ids use 'openai-completions'
  // (OpenAI chat-completions wire format). `registerProvider()`'s composition looks up per-model
  // DEFAULTS by matching our one-model registration's id against that SAME builtin catalog first —
  // so an id that collides with one of the 15 'anthropic-messages' ids silently inherited that api
  // shape and dispatched against the WRONG path (`<baseUrl>/v1/messages`, doubling the already-
  // versioned OpenRouter baseUrl's own `/v1` segment) with an Anthropic-shaped body instead of
  // OpenAI's `/chat/completions` + flat `messages`. `claude-3.5-sonnet` above is NOT one of the 15
  // colliding ids, so it always worked — masking the bug for every id except this vendor's.
  it('an id that collides with pi\'s builtin anthropic-messages catalog still dispatches OpenAI-completions-shaped (issue #142)', async () => {
    for (const modelId of ['anthropic/claude-sonnet-5.5', 'anthropic/claude-haiku-4.5']) {
      fake.requests.length = 0;
      const gw = new PiGatewayClient({
        secretSource: { resolve: () => 'fake-key-not-real' },
        timeoutMs: 15_000,
        openrouterBaseUrl: `http://127.0.0.1:${fake.port}/api/v1`,
      });
      // Not asserting result.ok: the fake server always answers with an OpenAI-shaped SSE stream,
      // so a dispatch that (wrongly) went out Anthropic-Messages-shaped would fail to parse it as a
      // completion — the point of this test is the OUTBOUND request shape, not the response.
      await gw.invoke({
        prompt: 'hi',
        opts: { model: `openrouter/${modelId}`, allowedTools: [] },
        runId: `fake-or-anthropic-ns-${modelId}`,
        agentId: 'fake-or-a3',
        workspace: ws,
      });
      expect(fake.requests.length).toBeGreaterThan(0);
      const request = fake.requests[0]!;
      const body = request.body as Record<string, unknown>;
      // OpenAI-completions' own path — never the Anthropic SDK client's `/v1/messages` (which would
      // double up the OpenRouter baseUrl's own already-present `/v1` segment: `/api/v1/v1/messages`,
      // a real, reproduced 404 against the actual recording fake server before this fix).
      expect(request.url).toBe('/api/v1/chat/completions');
      expect(body['model']).toBe(modelId);
      // OpenAI chat-completions' own flat message shape, never Anthropic's separate top-level
      // `system` + `thinking` fields.
      expect(Array.isArray(body['messages'])).toBe(true);
      expect(body['system']).toBeUndefined();
      expect(body['thinking']).toBeUndefined();
    }
  }, 30_000);

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

  // issue #139(b): an effort-less dispatch (the probe's own prose/tools legs; any agent() call that
  // never sets `effort`) used to ALWAYS send `reasoning.effort:'none'` under pi — a mandatory-
  // reasoning endpoint (OpenRouter's own `reasoning.mandatory`, e.g. glm-5.3-flash, gemini-3.8-flash)
  // rejects that with a terminal 400 ("Reasoning is mandatory for this endpoint and cannot be
  // disabled"). `req.caps.reasoningMandatory:true` (the SAME pinned `Caps` a real run threads through
  // `agent-executor.ts`, or `runProbe`'s own `opts.caps`) must make this gateway synthesize the floor
  // effort level instead.
  it('a mandatory-reasoning model with NO requested effort gets a real floor level, never "none" (issue #139b)', async () => {
    fake.requests.length = 0;
    const gw = new PiGatewayClient({
      secretSource: { resolve: () => 'fake-key-not-real' },
      timeoutMs: 15_000,
      openrouterBaseUrl: `http://127.0.0.1:${fake.port}/api/v1`,
    });
    const result = await gw.invoke({
      prompt: 'hi',
      opts: { model: 'openrouter/z-ai/glm-5.3-flash', allowedTools: [] },
      runId: 'fake-or-mandatory-r1',
      agentId: 'fake-or-mandatory-a1',
      workspace: ws,
      caps: { reasoning: true, tools: true, source: 'upstream', reasoningMandatory: true },
    });
    expect(result.ok).toBe(true);
    expect(fake.requests.length).toBeGreaterThan(0);
    const body = fake.requests[0]!.body as Record<string, unknown>;
    expect((body['reasoning'] as { effort?: string } | undefined)?.effort).toBe('low');
  }, 20_000);

  it('a mandatory-reasoning model picks the lowest level the catalog actually lists, when supplied', async () => {
    fake.requests.length = 0;
    const gw = new PiGatewayClient({
      secretSource: { resolve: () => 'fake-key-not-real' },
      timeoutMs: 15_000,
      openrouterBaseUrl: `http://127.0.0.1:${fake.port}/api/v1`,
    });
    const result = await gw.invoke({
      prompt: 'hi',
      opts: { model: 'openrouter/z-ai/glm-5.3-flash', allowedTools: [] },
      runId: 'fake-or-mandatory-r2',
      agentId: 'fake-or-mandatory-a2',
      workspace: ws,
      // 'low' is not advertised — the lowest one this model DOES advertise wins instead.
      caps: { reasoning: true, tools: true, source: 'upstream', reasoningMandatory: true, reasoningEfforts: ['medium', 'high'] },
    });
    expect(result.ok).toBe(true);
    const body = fake.requests[0]!.body as Record<string, unknown>;
    expect((body['reasoning'] as { effort?: string } | undefined)?.effort).toBe('medium');
  }, 20_000);

  it('an EXPLICITLY requested effort always wins over the mandatory-reasoning floor', async () => {
    fake.requests.length = 0;
    const gw = new PiGatewayClient({
      secretSource: { resolve: () => 'fake-key-not-real' },
      timeoutMs: 15_000,
      openrouterBaseUrl: `http://127.0.0.1:${fake.port}/api/v1`,
    });
    const result = await gw.invoke({
      prompt: 'hi',
      opts: { model: 'openrouter/z-ai/glm-5.3-flash', allowedTools: [], effort: 'high' },
      runId: 'fake-or-mandatory-r3',
      agentId: 'fake-or-mandatory-a3',
      workspace: ws,
      caps: { reasoning: true, tools: true, source: 'upstream', reasoningMandatory: true },
    });
    expect(result.ok).toBe(true);
    const body = fake.requests[0]!.body as Record<string, unknown>;
    expect((body['reasoning'] as { effort?: string } | undefined)?.effort).toBe('high');
  }, 20_000);

  // issue #150: `run_agent_log.harness.effortApplied` used to claim `{param:'thinkingLevel', value}`
  // for EVERY openrouter call, including a model the pinned catalog says has NO reasoning dial at all
  // (openrouter/openai/gpt-4.1 — OpenRouter's own `supported_parameters` omits 'reasoning', so
  // `ModelBook`'s `capsFromRow` pins `caps.reasoning:false`). Real end-to-end proof (not just the
  // internal `reasoningSupported` plumbing tests/unit/pi-gateway-client.test.ts already covers): a
  // `caps.reasoning:false` dispatch must never put a `reasoning` field on the wire at all — "ideally
  // don't send reasoning at all" per the issue — because `buildModelConfig()`'s `reasoning` flag is
  // now `false` for this model, and pi-ai's openai-completions provider gates every reasoning-shaped
  // branch (including the plain openrouter `reasoning.effort` shape) on `model.reasoning`.
  it('an openrouter model the catalog says has no reasoning dial gets NO reasoning field at all on the wire, even with effort requested (issue #150)', async () => {
    fake.requests.length = 0;
    const gw = new PiGatewayClient({
      secretSource: { resolve: () => 'fake-key-not-real' },
      timeoutMs: 15_000,
      openrouterBaseUrl: `http://127.0.0.1:${fake.port}/api/v1`,
    });
    let appliedSeen: { applied: boolean; reason?: string } | undefined;
    const result = await gw.invoke({
      prompt: 'hi',
      opts: { model: 'openrouter/openai/gpt-4.1', effort: 'high', allowedTools: [] },
      runId: 'fake-or-no-reasoning-r1',
      agentId: 'fake-or-no-reasoning-a1',
      workspace: ws,
      caps: { reasoning: false, tools: true, source: 'upstream' },
      onHarness: async (h, applied) => { appliedSeen = applied as { applied: boolean; reason?: string } | undefined; },
    });
    expect(result.ok).toBe(true);
    expect(fake.requests.length).toBeGreaterThan(0);
    const body = fake.requests[0]!.body as Record<string, unknown>;
    expect(body['reasoning']).toBeUndefined();
    expect(appliedSeen).toEqual({ applied: false, reason: 'model does not support reasoning' });
  }, 20_000);
});
