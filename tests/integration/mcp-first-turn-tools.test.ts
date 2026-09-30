// Issue #106 (HIGH): stdio MCP tools never reached the model on the FIRST turn.
//
// Root cause (scratch triage, 2026-10-01): with the real https://api.anthropic.com base URL the
// bundled CLI (2.1.199) turns on "optimistic tool search" and sends turn 1 WITHOUT waiting for
// stdio MCP servers to connect; the gateway's explicit `tools` list (never containing ToolSearch)
// then disables tool search, so the MCP tools only appear from turn 2 — a single-turn agent
// (`allowedTools: []` + `mcp: [...]`) never sees them at all.
//
// Why a plain local stub could NOT see this (and why #105's stub-based check passed): for a
// non-first-party base URL the CLI disables optimistic tool search and DOES wait for MCP. The CLI's
// own internal switch `_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL=1` makes it treat the stub as
// api.anthropic.com, i.e. take the production code path. That switch is not something the gateway
// forwards (buildSubprocessEnv is an allowlist), so this test injects it through the `queryImpl`
// seam: a wrapper that adds it to `options.env`, records the options, and delegates to the REAL
// SDK `query` (which spawns the REAL bundled CLI). Everything else is real: the gateway's options,
// the CLI, and a hermetic stdio MCP server written by this test (no npx, no network). Only the
// model is fake: a local Anthropic-Messages SSE stub that records every request's tool names.
//
// The CANARY below proves the switch still has effect: with the fix undone (no
// ENABLE_TOOL_SEARCH=false, no alwaysLoad) the first request must LACK the MCP tools. If a future
// SDK/CLI drops the switch (or fixes the race itself) the canary fails loudly, instead of the
// regression test silently reverting to a vacuous pass.
//
// Skipped (with the reason) when the SDK's bundled native CLI binary is not installed — the SDK
// never falls back to a `claude` on PATH, so PATH is irrelevant here.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import type { Options } from '@anthropic-ai/claude-agent-sdk';
import { ClaudeAgentSdkGatewayClient } from '../../src/gateway/claude-agent-sdk-client.js';
import type { HarnessDescriptor } from '../../src/types.js';

const nodeRequire = createRequire(import.meta.url);

function bundledCliPath(): string | undefined {
  const base = `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`;
  for (const pkg of [base, `${base}-musl`]) {
    try {
      return nodeRequire.resolve(`${pkg}/claude`);
    } catch {
      // try the next variant
    }
  }
  return undefined;
}
const CLI = bundledCliPath();
const WHY = CLI !== undefined ? '' : ' [SKIPPED: the SDK\'s bundled native claude binary is not installed]';

const SDK_MCP_JS = nodeRequire.resolve('@modelcontextprotocol/sdk/server/mcp.js');
const SDK_STDIO_JS = nodeRequire.resolve('@modelcontextprotocol/sdk/server/stdio.js');
const ZOD_JS = nodeRequire.resolve('zod');

function stdioServerScript(): string {
  return [
    `const { McpServer } = require(${JSON.stringify(SDK_MCP_JS)});`,
    `const { StdioServerTransport } = require(${JSON.stringify(SDK_STDIO_JS)});`,
    `const { z } = require(${JSON.stringify(ZOD_JS)});`,
    `const server = new McpServer({ name: 'rwe-i106-stub', version: '1.0.0' });`,
    `server.tool('echo', { message: z.string() }, async ({ message }) => ({ content: [{ type: 'text', text: 'ECHOED:' + message }] }));`,
    // A short, real startup delay: the race is "turn 1 leaves before connect finishes"; the delay
    // makes the losing side of the race deterministic rather than scheduler-dependent.
    `setTimeout(() => server.connect(new StdioServerTransport()), 700);`,
  ].join('\n');
}

function sseText(res: http.ServerResponse, text: string): void {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const ev = (e: string, d: unknown): void => { res.write(`event: ${e}\ndata: ${JSON.stringify(d)}\n\n`); };
  ev('message_start', { type: 'message_start', message: { id: 'msg_stub', type: 'message', role: 'assistant', model: 'stub', content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 1 } } });
  ev('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
  ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } });
  ev('content_block_stop', { type: 'content_block_stop', index: 0 });
  ev('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } });
  ev('message_stop', { type: 'message_stop' });
  res.end();
}

let workDir: string;
let serverScriptPath: string;
let stub: http.Server;
/** Every /v1/messages request that carried a test marker in its messages, in arrival order. */
const requests: Array<{ marker: string; sideRequest: boolean; tools: string[] }> = [];
const HAD_ANTHROPIC_API_KEY = 'ANTHROPIC_API_KEY' in process.env;

beforeAll(async () => {
  if (!HAD_ANTHROPIC_API_KEY) process.env['ANTHROPIC_API_KEY'] = 'sk-it106-dummy-not-real';
  workDir = mkdtempSync(join(tmpdir(), 'rwe-it106-'));
  serverScriptPath = join(workDir, 'stdio-echo-server.cjs');
  writeFileSync(serverScriptPath, stdioServerScript());
  stub = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => { body += c.toString(); });
    req.on('end', () => {
      if ((req.url ?? '').includes('count_tokens')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"input_tokens":1}');
        return;
      }
      const j = JSON.parse(body || '{}') as { tools?: Array<{ name: string }>; messages?: unknown; system?: unknown };
      const msgs = JSON.stringify(j.messages ?? '');
      const marker = /rwe-i106-[a-z]+/.exec(msgs)?.[0];
      // On the first-party path the CLI also fires a side request that asks the model for a session
      // TITLE (it quotes the prompt inside <session> tags and carries no tools) — not an agent turn.
      const sideRequest = /session>/.test(msgs) && /title/i.test(JSON.stringify(j.system ?? ''));
      if (marker !== undefined) requests.push({ marker, sideRequest, tools: (j.tools ?? []).map((t) => t.name) });
      sseText(res, 'stub-ok');
    });
  });
  await new Promise<void>((r) => stub.listen(0, '127.0.0.1', () => r()));
});

afterAll(async () => {
  if (!HAD_ANTHROPIC_API_KEY) delete process.env['ANTHROPIC_API_KEY'];
  await new Promise<void>((r) => stub?.close(() => r()));
  rmSync(workDir, { recursive: true, force: true });
});

type Wrap = (options: Options) => Options;

async function dispatch(tag: string, wrap: Wrap): Promise<{ options: Options; harness: HarnessDescriptor[]; ok: boolean; firstTools: string[] }> {
  const marker = `rwe-i106-${tag}`;
  const runWorkspace = join(workDir, tag);
  mkdirSync(runWorkspace, { recursive: true });
  const stubUrl = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
  let seen: Options | undefined;
  const queryImpl = ((args: { prompt: string; options?: Options }) => {
    const options = wrap({ ...(args.options as Options), env: { ...(args.options?.env ?? {}), _CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL: '1' } });
    seen = options;
    return sdkQuery({ prompt: args.prompt, options });
  }) as typeof sdkQuery;
  const client = new ClaudeAgentSdkGatewayClient({
    baseUrl: stubUrl,
    anthropicBaseUrl: stubUrl,
    timeoutMs: 60000,
    queryImpl,
    // Deliberately WITHOUT alwaysLoad — exactly what a workspace_push'd config looks like.
    resolveMcp: async () => ({ configs: { stubserver: { type: 'stdio', command: process.execPath, args: [serverScriptPath] } }, missing: [] }),
  });
  const harness: HarnessDescriptor[] = [];
  const r = await client.invoke({
    prompt: `${marker}: reply with one word.`,
    // `allowedTools: []` + one declared MCP server: the single-turn shape that never saw its tools.
    opts: { model: 'anthropic/claude-haiku-4-5-20251001', allowedTools: [] } as never,
    runId: `run-${tag}`,
    agentId: 'agent-1',
    workspace: runWorkspace,
    assets: { roots: { workflow: workDir, global: workDir }, declared: { skills: [], mcp: ['stubserver'] }, workflow: 'wf-it106' },
    onHarness: async (h) => { harness.push(structuredClone(h)); },
  });
  const first = requests.find((q) => q.marker === marker && !q.sideRequest);
  expect(first, `no agent-turn /v1/messages request carrying ${marker} reached the stub`).toBeDefined();
  return { options: seen as Options, harness, ok: r.ok, firstTools: first!.tools };
}

describe('issue #106: declared MCP tools are on the wire from the FIRST turn (first-party code path)', () => {
  it.skipIf(CLI === undefined)(`regression: turn 1 carries the stdio MCP server's tools; init status is recorded${WHY}`, async () => {
    const { options, harness, ok, firstTools } = await dispatch('fixed', (o) => o);
    expect(ok).toBe(true);
    // THE pin: the first API request (the only turn this agent gets) carries the MCP tool.
    expect(firstTools).toContain('mcp__stubserver__echo');
    // The two engine-side settings that close the race.
    expect(options.env?.['ENABLE_TOOL_SEARCH']).toBe('false');
    expect((options.mcpServers as Record<string, { alwaysLoad?: boolean }>)['stubserver']?.alwaysLoad).toBe(true);
    // Observability: the init snapshot reached the harness record; no warning on a healthy session.
    const last = harness[harness.length - 1];
    expect(last.mcpStatus).toEqual([{ server: 'stubserver', status: 'connected', tools: ['mcp__stubserver__echo'] }]);
    expect(last.warnings ?? []).toEqual([]);
  }, 90000);

  it.skipIf(CLI === undefined)(`canary: with the fix undone, the internal first-party switch still reproduces the race (turn 1 lacks the MCP tools) and the engine warns MCP_SERVER_NOT_CONNECTED${WHY}`, async () => {
    const undo: Wrap = (o) => {
      const env = { ...(o.env ?? {}) };
      delete env['ENABLE_TOOL_SEARCH'];
      const mcpServers = Object.fromEntries(Object.entries(o.mcpServers ?? {}).map(([k, v]) => {
        const { alwaysLoad: _drop, ...rest } = v as Record<string, unknown>;
        return [k, rest];
      })) as Options['mcpServers'];
      return { ...o, env, mcpServers };
    };
    const { options, harness, firstTools } = await dispatch('canary', undo);
    expect(options.env?.['ENABLE_TOOL_SEARCH']).toBeUndefined();
    expect(options.env?.['_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL']).toBe('1');
    // If this ever contains the MCP tool, the switch (or the race) is gone: the regression test
    // above no longer proves anything on this SDK — re-derive the reproduction before trusting it.
    expect(firstTools.filter((n) => n.startsWith('mcp__'))).toEqual([]);
    const last = harness[harness.length - 1];
    expect(last.mcpStatus?.[0]?.server).toBe('stubserver');
    expect(last.mcpStatus?.[0]?.status).not.toBe('connected');
    expect(last.warnings?.map((w) => [w.code, w.server])).toEqual([['MCP_SERVER_NOT_CONNECTED', 'stubserver']]);
  }, 90000);
});
