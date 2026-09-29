// Issue #105 part B (HIGH bug, real-tier companion to tests/unit/can-use-tool-updated-input.test.ts).
//
// The unit tier pins the exact shape `canUseTool` returns; this file proves the bug end-to-end on
// a REAL spawned `claude` CLI (not a mocked SDK import) talking to a REAL local stdio MCP server —
// the same technique the npx spike used (npx-spike/drive.ts + stub-server.mjs, issue #105 q4),
// reused here with a HERMETIC local server (a Node script written by this test, no `npx` download,
// no network) instead of the spike's `npx @modelcontextprotocol/server-everything`, so the test
// runs offline and deterministically. The only fake is the MODEL: a local SSE stub speaking the
// Anthropic Messages protocol (same technique as docs/evidence/issue-101-read-confinement.md /
// tests/acceptance/val-101-bash-read-confinement.test.ts) issues ONE fixed MCP tool_use once the
// real tool is on the wire, then ends the turn once it sees the tool_result.
//
// Before the fix (npx-spike/drive.out, real repro): the tool_result was
// `Tool permission request failed: ZodError: … expected record, received undefined … path:
// ["updatedInput"]` — the CLI's own permission-response validator rejecting canUseTool's bare
// `{behavior:'allow'}`. After the fix, the SAME call reaches the real stdio MCP server and its
// actual tool output reaches the model.
//
// Skipped (with the reason) when the `claude` CLI binary is not on PATH — this spawns it for real.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaudeAgentSdkGatewayClient } from '../../src/gateway/claude-agent-sdk-client.js';

function cliAvailable(): boolean {
  try {
    execFileSync('which', ['claude'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
const CLI_AVAILABLE = cliAvailable();
const WHY = CLI_AVAILABLE ? '' : ' [SKIPPED: `claude` CLI not found on PATH]';

// The tiny hermetic stdio MCP server this test spawns as a REAL child process of the CLI — one
// tool, `echo`, that returns its input's `message` field prefixed. Written as CommonJS resolving
// @modelcontextprotocol/sdk / zod by their ABSOLUTE on-disk paths (require.resolve'd from THIS
// test's own module resolution) so the generated script works regardless of where the temp dir
// that hosts it sits on disk — no node_modules of its own, no npx, no network.
const SDK_MCP_JS = require.resolve('@modelcontextprotocol/sdk/server/mcp.js');
const SDK_STDIO_JS = require.resolve('@modelcontextprotocol/sdk/server/stdio.js');
const ZOD_JS = require.resolve('zod');

function stdioServerScript(): string {
  return [
    `const { McpServer } = require(${JSON.stringify(SDK_MCP_JS)});`,
    `const { StdioServerTransport } = require(${JSON.stringify(SDK_STDIO_JS)});`,
    `const { z } = require(${JSON.stringify(ZOD_JS)});`,
    `const server = new McpServer({ name: 'rwe-spike-stub', version: '1.0.0' });`,
    `server.tool('echo', { message: z.string() }, async ({ message }) => ({ content: [{ type: 'text', text: 'ECHOED:' + message }] }));`,
    `const transport = new StdioServerTransport();`,
    `server.connect(transport);`,
  ].join('\n');
}

function sse(res: http.ServerResponse, block: Record<string, unknown>, stop: string): void {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const ev = (e: string, d: unknown): void => { res.write(`event: ${e}\ndata: ${JSON.stringify(d)}\n\n`); };
  ev('message_start', { type: 'message_start', message: { id: 'msg_stub', type: 'message', role: 'assistant', model: 'stub', content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 1 } } });
  if (block['type'] === 'text') {
    ev('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
    ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: block['text'] } });
  } else {
    ev('content_block_start', { type: 'content_block_start', index: 0, content_block: { ...block, input: {} } });
    ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(block['input']) } });
  }
  ev('content_block_stop', { type: 'content_block_stop', index: 0 });
  ev('message_delta', { type: 'message_delta', delta: { stop_reason: stop }, usage: { output_tokens: 1 } });
  ev('message_stop', { type: 'message_stop' });
  res.end();
}

let workDir: string;
let serverScriptPath: string;
let stub: http.Server;
let toolResultContent: string | undefined;
// resolveAnthropicAuth (claude-agent-sdk-client.ts) only checks a key/token is PRESENT — the real
// call never leaves localhost (ANTHROPIC_BASE_URL points at the fake stub below), so any non-empty
// string satisfies it. Set only if genuinely absent, restored after, so this never masks (or is
// masked by) a real credential another test file in the same worker relies on.
const HAD_ANTHROPIC_API_KEY = 'ANTHROPIC_API_KEY' in process.env;

beforeAll(async () => {
  if (!HAD_ANTHROPIC_API_KEY) process.env['ANTHROPIC_API_KEY'] = 'sk-it105b-dummy-not-real';
  workDir = mkdtempSync(join(tmpdir(), 'rwe-it105b-'));
  serverScriptPath = join(workDir, 'stdio-echo-server.cjs');
  writeFileSync(serverScriptPath, stdioServerScript());

  stub = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => { body += c.toString(); });
    req.on('end', () => {
      const j = JSON.parse(body || '{}') as { tools?: Array<{ name: string }>; messages?: { content?: unknown }[] };
      const last = j.messages?.[j.messages.length - 1]?.content;
      const tr = Array.isArray(last) ? (last as { type: string; content?: unknown }[]).find((c) => c.type === 'tool_result') : undefined;
      if (tr) {
        toolResultContent = typeof tr.content === 'string' ? tr.content : JSON.stringify(tr.content);
        sse(res, { type: 'text', text: 'done' }, 'end_turn');
        return;
      }
      const mcpTool = (j.tools ?? []).find((t) => t.name.startsWith('mcp__') && t.name.endsWith('__echo'));
      if (mcpTool) {
        sse(res, { type: 'tool_use', id: 'toolu_it105b', name: mcpTool.name, input: { message: 'hello-from-stub' } }, 'tool_use');
        return;
      }
      // No MCP tool on the wire yet (e.g. the CLI's own first internal turn) — answer plain text
      // so the session doesn't hang; the assertion below fails loudly if this is the ONLY turn.
      sse(res, { type: 'text', text: 'no mcp tool yet' }, 'end_turn');
    });
  });
  await new Promise<void>((r) => stub.listen(0, '127.0.0.1', () => r()));
});

afterAll(async () => {
  if (!HAD_ANTHROPIC_API_KEY) delete process.env['ANTHROPIC_API_KEY'];
  await new Promise<void>((r) => stub?.close(() => r()));
  rmSync(workDir, { recursive: true, force: true });
});

describe('a real dispatch reaches a real stdio MCP tool through canUseTool (issue #105 part B, HIGH)', () => {
  it.skipIf(!CLI_AVAILABLE)(`the tool_result carries the MCP server's real output, not a ZodError permission failure${WHY}`, async () => {
    toolResultContent = undefined;
    const runWorkspace = join(workDir, 'run-a');
    mkdirSync(runWorkspace, { recursive: true });

    // model 'anthropic/stub' routes through the ANTHROPIC-direct branch of buildSubprocessEnv
    // (provider === 'anthropic'), which reads ANTHROPIC_BASE_URL from `anthropicBaseUrl`, NOT
    // `baseUrl` (that field only backs the LiteLLM-proxy route for openrouter/ollama) — same
    // config key the npx spike's rwe.config.json used to point this same model prefix at its own
    // fake-model stub.
    const stubUrl = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
    const client = new ClaudeAgentSdkGatewayClient({
      baseUrl: stubUrl,
      anthropicBaseUrl: stubUrl,
      timeoutMs: 60000,
      resolveMcp: async () => ({
        configs: { stubserver: { type: 'stdio', command: process.execPath, args: [serverScriptPath], alwaysLoad: true } as never },
        missing: [],
      }),
    });

    const r = await client.invoke({
      prompt: 'call the echo tool',
      opts: { model: 'anthropic/stub', allowedTools: [] } as never,
      runId: 'run-a',
      agentId: 'agent-1',
      workspace: runWorkspace,
      assets: { roots: { workflow: workDir, global: workDir }, declared: { skills: [], mcp: ['stubserver'] }, workflow: 'wf-it105b' },
    });

    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(toolResultContent, 'no tool_result ever reached the stub — the MCP tool call never completed').toBeDefined();
    // THE pin: before the fix, this was `Tool permission request failed: ZodError: … updatedInput …`.
    expect(toolResultContent).not.toContain('ZodError');
    expect(toolResultContent).not.toContain('Tool permission request failed');
    expect(toolResultContent).toContain('ECHOED:hello-from-stub');
  }, 90000);
});
