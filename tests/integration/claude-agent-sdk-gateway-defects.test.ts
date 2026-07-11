// IT-017: D-F5 route-back — real-CLI companion to UT-019, against a genuine local stub
// /v1/messages HTTP server (mock policy DES-015: integration tier fakes only the third-party
// network boundary; the real @anthropic-ai/claude-agent-sdk package + its CLI subprocess, if
// present, run as-is — same pattern as IT-015).
//
// Case A (defect 1, opts.model forwarding): asserts what the STUB ITSELF RECEIVES on the wire —
// the outbound /v1/messages request body's own `model` field — when agent() is called with a
// resolved opts.model alias. Today's src never sets options.model, so the stub receives the CLI's
// own internal default instead of the caller's alias.
//
// Case B (defect 2, is_error handling): the stub returns an HTTP error status (an Anthropic-
// Messages-shaped error body), which the real CLI's own transport turns into a
// `{type:'result',subtype:'success',is_error:true,result:'API Error: ...'}` message (confirmed
// empirically while authoring this test — this is the actual real wire shape a genuine upstream API
// error produces, not a synthetic invention). Runs through AgentExecutor.run() (not just the bare
// GatewayClient) so the assertion is exactly the task's own framing: "agent() resolves null after
// bounded retries" — never surfaced as literal error text.
//
// Hermeticity guard (same convention as IT-015): if the local stub never receives any request
// within a bounded window (CLI genuinely absent from PATH, or a nested-agent host that intercepts
// query() before any real outbound HTTP call), the case SKIPS with an explicit reason rather than
// failing on an environment limitation that is not the production code's fault. It never skips
// silently once the stub DOES receive traffic.
//
// Red reason: both cases fail against current src (confirmed via `npx vitest run` before this file
// is registered in 05-tests.md) — case A because options.model is never set (stub sees the CLI's
// own default, not 'haiku-alias'); case B because AgentExecutor.run() resolves { kind: 'text' }
// with the literal error string instead of { kind: 'null' }.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { AgentExecutor } from '../../src/agent-executor.js';

const STUB_PORT_A = 38220;
const STUB_PORT_B = 38221;

interface CapturedRequest {
  body: Record<string, unknown>;
}

function startTextStub(port: number): { server: HttpServer; requests: CapturedRequest[]; baseUrl: string } {
  const requests: CapturedRequest[] = [];
  const server = createHttpServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(raw);
      } catch {
        // leave body as {}
      }
      requests.push({ body });
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      send('message_start', { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'stub-model', content: [], stop_reason: null, usage: { input_tokens: 5, output_tokens: 0 } } });
      send('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
      send('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'pong' } });
      send('content_block_stop', { type: 'content_block_stop', index: 0 });
      send('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 4 } });
      send('message_stop', { type: 'message_stop' });
      res.end();
    });
  });
  return { server, requests, baseUrl: `http://127.0.0.1:${port}` };
}

/** Always answers with an Anthropic-Messages-shaped HTTP error — the real wire shape an invalid
 *  model id / auth failure / rate limit produces. */
function startErrorStub(port: number): { server: HttpServer; requests: CapturedRequest[]; baseUrl: string } {
  const requests: CapturedRequest[] = [];
  const server = createHttpServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(raw);
      } catch {
        // leave body as {}
      }
      requests.push({ body });
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'model: haiku-alias is not a valid model ID' } }));
    });
  });
  return { server, requests, baseUrl: `http://127.0.0.1:${port}` };
}

/** Bounded wait for the stub to receive at least one request — same skip-guard shape as IT-015. */
async function waitForRequest(requests: CapturedRequest[], timeoutMs = 20000): Promise<boolean> {
  return new Promise((resolve) => {
    const check = setInterval(() => {
      if (requests.length > 0) {
        clearInterval(check);
        resolve(true);
      }
    }, 200);
    setTimeout(() => {
      clearInterval(check);
      resolve(false);
    }, timeoutMs);
  });
}

describe('ClaudeAgentSdkGatewayClient — D-F5 route-back defects, real CLI + local stub (IT-017)', () => {
  let textStub: ReturnType<typeof startTextStub>;
  let errorStub: ReturnType<typeof startErrorStub>;

  beforeAll(async () => {
    textStub = startTextStub(STUB_PORT_A);
    errorStub = startErrorStub(STUB_PORT_B);
    await Promise.all([
      new Promise<void>((resolve) => textStub.server.listen(STUB_PORT_A, '127.0.0.1', resolve)),
      new Promise<void>((resolve) => errorStub.server.listen(STUB_PORT_B, '127.0.0.1', resolve)),
    ]);
  });

  afterAll(async () => {
    await Promise.all([
      new Promise<void>((resolve) => textStub.server.close(() => resolve())),
      new Promise<void>((resolve) => errorStub.server.close(() => resolve())),
    ]);
  });

  it(
    'agent() with opts.model alias -> the stub receives that model id in the outbound request body',
    async () => {
      const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
      const client = new ClaudeAgentSdkGatewayClient({ baseUrl: textStub.baseUrl });

      const resultPromise = client.invoke({ prompt: 'say pong', opts: { model: 'haiku-alias' }, runId: 'it-017-a', agentId: 'agent-a' });

      const reached = await waitForRequest(textStub.requests);
      if (!reached) {
        console.warn('IT-017 case A SKIPPED: no request reached the local stub within 20s — SDK CLI genuinely absent or unable to run an isolated headless session in this environment.');
        return;
      }

      await resultPromise;

      const messagesReq = textStub.requests.find((r) => typeof r.body['model'] === 'string');
      expect(messagesReq).toBeDefined();
      // The caller's alias reaches the wire as its proxy-facing name (proxyModelName): the prefix
      // stops the CLI from expanding a bare shorthand into a dated Anthropic id the LiteLLM proxy
      // could not match. This is the exact model id the proxy keys its model_name list on.
      expect(messagesReq?.body['model']).toBe('rwe-proxy-haiku-alias');
    },
    30000,
  );

  it(
    'an is_error upstream response -> agent() (via AgentExecutor, bounded retry) resolves null, never the raw error text as success',
    async () => {
      const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
      const client = new ClaudeAgentSdkGatewayClient({ baseUrl: errorStub.baseUrl });
      const executor = new AgentExecutor({ gateway: client });

      const outcomePromise = executor.run({
        runId: 'it-017-b',
        agentId: 'agent-b',
        prompt: 'say pong',
        opts: { model: 'haiku-alias' },
        workspace: '/tmp/it-017-b-ws',
        signal: new AbortController().signal,
      });

      const reached = await waitForRequest(errorStub.requests);
      if (!reached) {
        console.warn('IT-017 case B SKIPPED: no request reached the local stub within 20s — SDK CLI genuinely absent or unable to run an isolated headless session in this environment.');
        return;
      }

      const outcome = await outcomePromise;

      // Forcing red: today's src only checks `subtype !== 'success'`; an is_error:true result on a
      // 'success'-shaped message is returned as { kind: 'text', value: 'API Error: ...' } instead.
      expect(outcome.kind).toBe('null');
    },
    30000,
  );
});
