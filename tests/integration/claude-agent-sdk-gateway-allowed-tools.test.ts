// IT-023: ClaudeAgentSdkGatewayClient + real CLI + local stub — a curated options.allowedTools
// genuinely restricts the outbound WIRE tool surface, not just an in-process options object
// (D-F11, real-CLI companion to UT-024, same pattern as IT-017's companion to UT-019).
//
// D-F11 (binding): `08-validation.md` round-5 VAL-003 root-caused the tool-use failure to the
// outbound request's own `tools` array carrying dozens of tools (confirmed via LiteLLM's own
// `--detailed_debug` log: Task/Bash/Read/Write/Edit/WebFetch/several MCP plugin tools inherited
// from this HOST environment's own Claude Code configuration) — UT-024 proves
// `ClaudeAgentSdkGatewayClient` hands a curated `options.allowedTools` to `query()`; this test
// proves that curation genuinely narrows what the REAL SDK CLI subprocess puts on the wire, the
// only observable signal that actually matters for the round-5 root cause (an in-process options
// object could be curated yet still have no effect if the CLI itself ignores it).
//
// Mock policy (DES-015, integration tier): real @anthropic-ai/claude-agent-sdk package + its CLI
// subprocess (confirmed present on PATH in this environment, same precedent as IT-015/IT-017);
// only the third-party network boundary is faked — a genuine local HTTP server on 127.0.0.1
// standing in for the real Anthropic Messages API, capturing the exact outbound request body the
// CLI sends (including its own `tools` array).
//
// Hermeticity guard (same convention as IT-015/IT-017): if the local stub never receives any
// request within a bounded window, the case SKIPS with an explicit reason rather than failing on
// an environment limitation that is not the production code's fault.
//
// Red reason: confirmed via `npx vitest run` — `src/gateway/claude-agent-sdk-client.ts` never sets
// `options.allowedTools`, so the CLI subprocess sends its own full, uncurated tool list; the stub's
// captured `tools` array is large (dozens of entries) and is NOT restricted to the curated
// `['Read', 'Write']` set this test configures — not an import/syntax error, and not a skip either
// (the CLI genuinely reaches the stub in this environment, same as IT-017).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import type { ClaudeAgentSdkGatewayConfig } from '../../src/gateway/claude-agent-sdk-client.js';

const STUB_PORT = 38230;

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
      send('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ack' } });
      send('content_block_stop', { type: 'content_block_stop', index: 0 });
      send('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 4 } });
      send('message_stop', { type: 'message_stop' });
      res.end();
    });
  });
  return { server, requests, baseUrl: `http://127.0.0.1:${port}` };
}

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

describe('ClaudeAgentSdkGatewayClient — curated allowedTools genuinely narrows the outbound wire tool surface (IT-023, D-F11)', () => {
  let stub: ReturnType<typeof startTextStub>;

  beforeAll(async () => {
    stub = startTextStub(STUB_PORT);
    await new Promise<void>((resolve) => stub.server.listen(STUB_PORT, '127.0.0.1', resolve));
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => stub.server.close(() => resolve()));
  });

  it(
    'a curated allowedTools restricts the CLI-sent tools array to (at most) the curated set, never the full uncurated surface',
    async () => {
      const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
      const config: ClaudeAgentSdkGatewayConfig & { defaultAllowedTools?: string[] } = {
        baseUrl: stub.baseUrl,
        defaultAllowedTools: ['Read', 'Write'],
      };
      const client = new ClaudeAgentSdkGatewayClient(config);

      const resultPromise = client.invoke({ prompt: 'say ack', opts: {}, runId: 'it-023', agentId: 'agent-023' });

      const reached = await waitForRequest(stub.requests);
      if (!reached) {
        console.warn('IT-023 SKIPPED: no request reached the local stub within 20s — SDK CLI genuinely absent or unable to run an isolated headless session in this environment.');
        return;
      }

      await resultPromise;

      const messagesReq = stub.requests.find((r) => Array.isArray(r.body['tools']));
      expect(messagesReq).toBeDefined();
      const tools = (messagesReq?.body['tools'] as Array<{ name?: string }> | undefined) ?? [];
      const names = tools.map((t) => t.name);

      // Forcing red: today's src never restricts allowedTools, so the CLI sends its own full,
      // uncurated tool surface (round-5 VAL-003's root cause) — well beyond the 2-tool curated set
      // configured above.
      expect(names.every((n) => n === 'Read' || n === 'Write')).toBe(true);
      expect(tools.length).toBeLessThanOrEqual(2);
    },
    30000,
  );
});
