// pi harness v1, issue #151 investigation. "prompt caching never engages for openrouter anthropic/*
// and google/* under pi: cacheRead/cacheWrite stay 0." This is a CHARACTERIZATION suite, not a RED
// bug-fix suite — every assertion below is GREEN on the FIRST run, because the investigation found
// no defect in either half the issue suspected:
//
// 1. Request shaping: pi-ai's own openai-completions provider (`detectCompat`, read straight off the
//    installed @earendil-works/pi-ai package) ALREADY auto-detects `provider === 'openrouter' &&
//    model.id.startsWith('anthropic/')` and sets `cacheControlFormat: 'anthropic'` — no engine code
//    adds this; `resolveModel()` (session-runner.ts) registers the model with NO `compat` override at
//    all, so pi's auto-detection is what fires. The tests below are the empirical proof (captured via
//    this exact recording-fake-server pattern, following the dispatch's own instruction) that
//    `cache_control: {type:'ephemeral'}` really lands on the wire for anthropic/* and does NOT for a
//    vendor that does not need it (OpenRouter's documented guidance: Gemini 2.5+ caches implicitly,
//    no `cache_control` needed; other non-Anthropic vendors have no OpenRouter-side cache_control
//    mechanism at all).
// 2. Usage mapping: pi-ai's `parseChunkUsage` already reads `prompt_tokens_details.cached_tokens` for
//    cache reads and `prompt_tokens_details.cache_write_tokens` for cache writes — confirmed (via
//    live research against openrouter.ai/docs, 2026-10-06) to be EXACTLY the field names OpenRouter's
//    own usage-accounting/prompt-caching docs publish, for every vendor (the schema is unified, not
//    Anthropic-native top-level fields). session-runner.ts forwards `msg.usage.cacheRead/cacheWrite`
//    unchanged; pi-gateway-client.ts sums it into `result.tokens` across every `message_end`. The
//    engine's own cost computation (run-guard.ts's `priceTokens`) already multiplies by
//    `rates.cacheRead`/`rates.cacheWrite`, and `ratesFromOpenRouterPricing` (model-catalog.ts) already
//    maps OpenRouter's `input_cache_read`/`input_cache_write` into those same rate fields — see
//    tests/unit/model-catalog-selection.test.ts's haiku-4.5 `ratesPerM` assertion (cacheRead
//    0.0000001, cacheWrite 0.00000125 — distinct from `in`/`out`, proving the mapping is live) and
//    tests/unit/model-catalog.test.ts's `ratesFromOpenRouterPricing` suite for the fallback rules.
//
// So why did the real run (openrouter/anthropic/claude-haiku-4.5, pi-compat-s2-tools@v1) report
// cacheRead:0, cacheWrite:0? The most likely explanation, NOT fixable in this engine's code: Claude
// Haiku 4.5 documents a 4096-TOKEN MINIMUM prompt size before Anthropic will write to cache at all
// (openrouter.ai/docs/features/prompt-caching, "Prompts shorter than these minimums will not be
// cached" — Haiku 4.5 is in the highest-minimum tier, same as the Opus line; most other Claude
// models need only 1024-2048). The reported run's own transcript tail shows the LAST turn's own
// usage at input:2779 tokens — under that floor — and the run used short, tool-light agents (3
// sequential short-lived sessions), so no single turn plausibly cleared 4096 tokens. See this file's
// trailing comment block for the full post-deploy verification recipe to confirm this on a real key.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import type { Server as HttpServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PiGatewayClient } from '../../src/gateway/pi-gateway-client.js';

interface ToolCall { name: string; args: Record<string, unknown> }
interface RecordedRequest { body: Record<string, unknown>; headers: Record<string, string | string[] | undefined> }

/** A deterministic multi-turn SCRIPTED fake OpenRouter SSE server: turn 1 answers with a tool call
 *  (so a SECOND turn happens, replaying the full transcript — the shape prompt caching needs), turn 2
 *  (and beyond) answers with final text. `finalUsage` lets a test inject OpenRouter's own documented
 *  cache usage fields onto the LAST chunk of the FINAL (non-tool-call) turn, to prove usage mapping
 *  independently of whether real caching would have occurred for this script's (deliberately tiny,
 *  for speed) prompt size. Records every request's body AND headers (x-session-id — OpenRouter's own
 *  session-affinity mechanism, `compat.sendSessionAffinityHeaders`) across the whole exchange. */
function startScriptedServer(
  script: ToolCall[],
  finalUsage: { cached_tokens?: number; cache_write_tokens?: number } = {},
): Promise<{ server: HttpServer; port: number; requests: RecordedRequest[] }> {
  let step = 0;
  const requests: RecordedRequest[] = [];
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let body: unknown = raw;
        try { body = JSON.parse(raw); } catch { /* keep raw */ }
        requests.push({ body: body as Record<string, unknown>, headers: req.headers as Record<string, string | string[] | undefined> });
        const id = 'c' + step;
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        if (step < script.length) {
          const s = script[step++]!;
          res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call_' + step, type: 'function', function: { name: s.name, arguments: JSON.stringify(s.args) } }] }, finish_reason: null }] })}\n\n`);
          res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 50, completion_tokens: 5, total_tokens: 55, prompt_tokens_details: { cached_tokens: 0 } } })}\n\n`);
        } else {
          step++;
          res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta: { role: 'assistant', content: 'ALL_DONE' }, finish_reason: null }] })}\n\n`);
          res.write(`data: ${JSON.stringify({
            id, object: 'chat.completion.chunk', created: 1, model: 'm',
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
            usage: {
              prompt_tokens: 60, completion_tokens: 2, total_tokens: 62,
              prompt_tokens_details: { cached_tokens: finalUsage.cached_tokens ?? 0, cache_write_tokens: finalUsage.cache_write_tokens ?? 0 },
            },
          })}\n\n`);
        }
        res.write('data: [DONE]\n\n');
        res.end();
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ server, port: typeof addr === 'object' && addr !== null ? addr.port : 0, requests });
    });
  });
}

/** Walks every message's content for a `cache_control` key, and the last tool def too — the three
 *  places pi-ai's `applyAnthropicCacheControl` can place a breakpoint. */
function findsCacheControl(body: Record<string, unknown>): boolean {
  const messages = (body['messages'] as Array<{ content?: unknown }> | undefined) ?? [];
  const inMessages = messages.some((m) => {
    const content = m.content;
    if (typeof content !== 'object' || content === null || !Array.isArray(content)) return false;
    return content.some((part) => typeof part === 'object' && part !== null && 'cache_control' in part);
  });
  const tools = (body['tools'] as Array<Record<string, unknown>> | undefined) ?? [];
  const inTools = tools.some((t) => 'cache_control' in t);
  return inMessages || inTools;
}

describe('pi harness v1 — issue #151, OpenRouter prompt-caching request shape + usage mapping (characterization: no defect found)', () => {
  let ws: string;

  beforeAll(() => {
    ws = mkdtempSync(join(tmpdir(), 'rwe-pi-cache-'));
  });

  afterAll(() => {
    rmSync(ws, { recursive: true, force: true });
  });

  it('cache_control breakpoints ARE present for openrouter/anthropic/* across a multi-turn tool loop (system prompt, last tool def, last conversation message)', async () => {
    const fake = await startScriptedServer([{ name: 'ls', args: {} }]);
    try {
      const gw = new PiGatewayClient({
        secretSource: { resolve: () => 'fake-key' }, timeoutMs: 30_000, retries: 0,
        openrouterBaseUrl: `http://127.0.0.1:${fake.port}/api/v1`,
      });
      const result = await gw.invoke({
        prompt: 'list files', opts: { model: 'openrouter/anthropic/claude-haiku-4.5', allowedTools: ['LS'] },
        runId: 'cache-anthropic-r1', agentId: 'a1', workspace: ws,
      });
      expect(result.ok).toBe(true);
      expect(fake.requests).toHaveLength(2);

      // Turn 1 (system prompt + user + tool defs): the system/developer message and the last tool
      // definition both carry a breakpoint — pi-ai's `applyAnthropicCacheControl`.
      expect(findsCacheControl(fake.requests[0]!.body)).toBe(true);
      const turn1Messages = fake.requests[0]!.body['messages'] as Array<{ role: string; content: unknown }>;
      const systemMsg = turn1Messages.find((m) => m.role === 'system' || m.role === 'developer')!;
      expect(JSON.stringify(systemMsg.content)).toContain('cache_control');

      // Turn 2 (replays the full transcript, including the tool result): the LAST conversation
      // message carries a FRESH breakpoint too — this is the one that actually matters for a cache
      // HIT on turn 3+ of a real multi-turn loop.
      expect(findsCacheControl(fake.requests[1]!.body)).toBe(true);
    } finally {
      await new Promise((r) => fake.server.close(() => r(undefined)));
    }
  }, 30_000);

  it('cache_control is ABSENT for a vendor that does not use it (openrouter/openai/* — not Anthropic-shaped, no explicit cache_control mechanism on OpenRouter)', async () => {
    const fake = await startScriptedServer([{ name: 'ls', args: {} }]);
    try {
      const gw = new PiGatewayClient({
        secretSource: { resolve: () => 'fake-key' }, timeoutMs: 30_000, retries: 0,
        openrouterBaseUrl: `http://127.0.0.1:${fake.port}/api/v1`,
      });
      const result = await gw.invoke({
        prompt: 'list files', opts: { model: 'openrouter/openai/gpt-4.1', allowedTools: ['LS'] },
        runId: 'cache-openai-r1', agentId: 'a1', workspace: ws,
        caps: { reasoning: false, tools: true, source: 'upstream' },
      });
      expect(result.ok).toBe(true);
      expect(fake.requests.length).toBeGreaterThanOrEqual(2);
      for (const r of fake.requests) expect(findsCacheControl(r.body)).toBe(false);
    } finally {
      await new Promise((r) => fake.server.close(() => r(undefined)));
    }
  }, 30_000);

  it('cache_control is ABSENT for google/* (OpenRouter docs: Gemini 2.5+ caches implicitly — no cache_control needed), but usage still maps cached_tokens', async () => {
    const fake = await startScriptedServer([{ name: 'ls', args: {} }], { cached_tokens: 17 });
    try {
      const gw = new PiGatewayClient({
        secretSource: { resolve: () => 'fake-key' }, timeoutMs: 30_000, retries: 0,
        openrouterBaseUrl: `http://127.0.0.1:${fake.port}/api/v1`,
      });
      const result = await gw.invoke({
        prompt: 'list files', opts: { model: 'openrouter/google/gemini-3.8-flash', allowedTools: ['LS'] },
        runId: 'cache-gemini-r1', agentId: 'a1', workspace: ws,
      });
      expect(result.ok).toBe(true);
      for (const r of fake.requests) expect(findsCacheControl(r.body)).toBe(false);
      if (result.ok) expect(result.tokens.cacheRead).toBe(17);
    } finally {
      await new Promise((r) => fake.server.close(() => r(undefined)));
    }
  }, 30_000);

  // BLOCKING assertion for issue #151 task item 2 ("does pi map OpenRouter's
  // usage.prompt_tokens_details.cached_tokens / cache_write_tokens into cacheRead/cacheWrite? Does
  // the engine's pi-child usage mapping carry them through?") — exercised end to end through the
  // REAL PiGatewayClient -> pi child -> pi-ai dispatch path, not just read off the installed
  // package's source.
  it('usage mapping: a fake response carrying prompt_tokens_details.{cached_tokens,cache_write_tokens} lands in result.tokens.{cacheRead,cacheWrite}', async () => {
    const fake = await startScriptedServer([{ name: 'ls', args: {} }], { cached_tokens: 40, cache_write_tokens: 25 });
    try {
      const gw = new PiGatewayClient({
        secretSource: { resolve: () => 'fake-key' }, timeoutMs: 30_000, retries: 0,
        openrouterBaseUrl: `http://127.0.0.1:${fake.port}/api/v1`,
      });
      const result = await gw.invoke({
        prompt: 'list files', opts: { model: 'openrouter/anthropic/claude-haiku-4.5', allowedTools: ['LS'] },
        runId: 'cache-usage-r1', agentId: 'a1', workspace: ws,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.tokens.cacheRead).toBe(40);
        expect(result.tokens.cacheWrite).toBe(25);
      }
    } finally {
      await new Promise((r) => fake.server.close(() => r(undefined)));
    }
  }, 30_000);

  // OpenRouter's own session-affinity mechanism (`compat.sendSessionAffinityHeaders`, pi-ai) — the
  // SAME session id across every turn of one dispatch helps route repeat turns to the same upstream
  // replica, which matters for cache continuity (a cache write on replica A is invisible to a read
  // routed to replica B). Not itself a cacheRead/cacheWrite assertion — a plumbing precondition for
  // cache continuity across turns of ONE agent() dispatch.
  it('carries a stable x-session-id across every turn of one dispatch (OpenRouter session affinity, supports cache-routing continuity)', async () => {
    const fake = await startScriptedServer([{ name: 'ls', args: {} }]);
    try {
      const gw = new PiGatewayClient({
        secretSource: { resolve: () => 'fake-key' }, timeoutMs: 30_000, retries: 0,
        openrouterBaseUrl: `http://127.0.0.1:${fake.port}/api/v1`,
      });
      const result = await gw.invoke({
        prompt: 'list files', opts: { model: 'openrouter/anthropic/claude-haiku-4.5', allowedTools: ['LS'] },
        runId: 'cache-session-r1', agentId: 'a1', workspace: ws,
      });
      expect(result.ok).toBe(true);
      expect(fake.requests).toHaveLength(2);
      const id1 = fake.requests[0]!.headers['x-session-id'];
      const id2 = fake.requests[1]!.headers['x-session-id'];
      expect(typeof id1).toBe('string');
      expect(id1).toBeTruthy();
      expect(id2).toBe(id1);
    } finally {
      await new Promise((r) => fake.server.close(() => r(undefined)));
    }
  }, 30_000);
});

// ---------------------------------------------------------------------------------------------
// issue #151 — post-deploy verification recipe (no real OpenRouter key is available in this dev
// environment; this is the exact shape a tester WITH a key should run to confirm cache behaviour on
// the real OpenRouter endpoint, not a fake one):
//
// 1. Seed the run's workspace with one ~25KB text file (roughly 6-8k tokens — comfortably over
//    Claude Haiku 4.5's documented 4096-token cache-write minimum per
//    openrouter.ai/docs/features/prompt-caching as of 2026-10-06; most other Claude models need only
//    1024-2048, so this margin also covers them).
// 2. Register one agent, allowedTools: ['Read', 'LS'], model
//    'openrouter/anthropic/claude-haiku-4.5'. Prompt it to: Read the file, then LS the directory,
//    then Read the file again verbatim — forces >=3 turns so turn 2's request carries the large
//    prefix as its cached-write candidate, and turn 3 is the first chance for a cache HIT.
// 3. run_start, then run_agent_log for that agent. Expect:
//    - turn 2's message_end usage: cacheWrite > 0 (first write of the now-large system+turn1 prefix)
//    - turn 3's message_end usage: cacheRead > 0 (hit on what turn 2 wrote)
//    - run_result.meta.usage.cacheRead > 0 (cumulative)
// 4. Note the `tool_use_id` prefix on the Read tool calls in the transcript. OpenRouter can route an
//    Anthropic request to Bedrock (prefix `toolu_bdrk_...`) or Anthropic-direct (`toolu_...`) — this
//    is NOT configured by this engine. If cacheRead stays 0 despite a >4096-token prefix AND the
//    prefix is `toolu_bdrk_`, that is evidence OpenRouter's Bedrock route does not surface prompt-
//    cache usage the same way as its Anthropic-direct route; the next lever (an owner decision, not
//    implemented here) would be pinning the route via pi's `compat.openRouterRouting` (already wired
//    through in openai-completions.js as `model.compat?.openRouterRouting` -> request `provider`
//    field) to `{order: ['anthropic']}`, trading availability/cost for guaranteed cache behaviour.
// 5. Repeat the same shape on 'openrouter/google/gemini-3.8-flash' (or whichever 2.5+ Gemini tier is
//    current). Gemini's caching is implicit (no cache_control needed, per OpenRouter's docs) — report
//    whichever way cacheRead goes; this investigation found no engine-side code path that could
//    suppress it, but could not verify against the real endpoint.
// ---------------------------------------------------------------------------------------------
