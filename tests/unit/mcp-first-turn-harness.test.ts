// Issue #106: the engine-side half of the first-turn MCP fix, and its observability.
//
// The real-CLI proof that turn 1 now carries the MCP tools lives in
// tests/integration/mcp-first-turn-tools.test.ts. This file pins, without a CLI:
//   - the two dispatch settings (ENABLE_TOOL_SEARCH=false in the CLI env; alwaysLoad:true per MCP
//     server, an operator's explicit value winning);
//   - the `system/init` snapshot -> harness.mcpStatus + MCP_SERVER_NOT_CONNECTED warning (and the
//     journal line), re-emitted as a second (latest-wins) harness descriptor;
//   - the warning's path onto AgentRecord.warnings (live AND restart-derived, which must agree) and
//     its roll-up onto run_status.warnings.
// Mock policy (unit): the injected `queryImpl` seam stands in for the SDK.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaudeAgentSdkGatewayClient, summarizeMcpInit } from '../../src/gateway/claude-agent-sdk-client.js';
import { AgentTranscriptSink } from '../../src/agent-executor.js';
import { deriveAgentRecords } from '../../src/run-store.js';
import { summarizeAgentWarnings } from '../../src/run-manager.js';
import type { EngineEvent } from '../../src/event-log.js';
import type { HarnessDescriptor, HarnessWarning, TranscriptEvent } from '../../src/types.js';

describe('summarizeMcpInit (issue #106)', () => {
  it('a connected server whose tools are in the init tool list: recorded, no warning', () => {
    const r = summarizeMcpInit(['everything'], { tools: ['Bash', 'mcp__everything__echo', 'mcp__everything__add', 'mcp__other__x'], mcp_servers: [{ name: 'everything', status: 'connected' }] });
    expect(r.mcpStatus).toEqual([{ server: 'everything', status: 'connected', tools: ['mcp__everything__echo', 'mcp__everything__add'] }]);
    expect(r.warnings).toEqual([]);
  });

  it('a pending server (the #106 race) warns MCP_SERVER_NOT_CONNECTED with its status', () => {
    const r = summarizeMcpInit(['everything'], { tools: ['Bash'], mcp_servers: [{ name: 'everything', status: 'pending' }] });
    expect(r.mcpStatus).toEqual([{ server: 'everything', status: 'pending', tools: [] }]);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatchObject({ code: 'MCP_SERVER_NOT_CONNECTED', server: 'everything', status: 'pending' });
    expect(r.warnings[0]!.message).toContain("first turn");
  });

  it('a server the init message does not list at all is `absent` and warns', () => {
    const r = summarizeMcpInit(['mem'], { tools: [], mcp_servers: [] });
    expect(r.mcpStatus).toEqual([{ server: 'mem', status: 'absent', tools: [] }]);
    expect(r.warnings.map((w) => [w.server, w.status])).toEqual([['mem', 'absent']]);
  });

  it('connected but no tools in the init list still warns (a resources/prompts-only server is named as the expected case)', () => {
    const r = summarizeMcpInit(['docs'], { tools: ['Bash'], mcp_servers: [{ name: 'docs', status: 'connected' }] });
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]!.message).toMatch(/resources\/prompts/);
  });

  it('matches the CLI-normalized server name in tool names and bounds the recorded list', () => {
    const many = Array.from({ length: 100 }, (_, i) => `mcp__my_srv__t${i}`);
    const r = summarizeMcpInit(['my.srv'], { tools: many, mcp_servers: [{ name: 'my.srv', status: 'connected' }] });
    expect(r.warnings).toEqual([]);
    expect(r.mcpStatus[0]!.tools).toHaveLength(64);
  });

  it('a malformed init message never throws — every declared server reads as absent', () => {
    const r = summarizeMcpInit(['x'], { tools: 'nope', mcp_servers: null });
    expect(r.mcpStatus).toEqual([{ server: 'x', status: 'absent', tools: [] }]);
  });
});

describe('the gateway dispatch settings and the init snapshot (issue #106)', () => {
  let root: string;
  let workspace: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'rwe-i106-unit-'));
    workspace = join(root, 'ws');
    mkdirSync(workspace, { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  async function dispatch(configs: Record<string, Record<string, unknown>>, initStatus: string | undefined) {
    async function* session() {
      if (initStatus !== undefined) {
        yield { type: 'system', subtype: 'init', tools: initStatus === 'connected' ? ['mcp__srv__echo'] : [], mcp_servers: Object.keys(configs).map((name) => ({ name, status: initStatus })) };
      }
      yield { type: 'result', subtype: 'success', is_error: false, result: 'ok', usage: { input_tokens: 1, output_tokens: 1 } };
    }
    const queryImpl = vi.fn(() => session());
    const events: EngineEvent[] = [];
    const client = new ClaudeAgentSdkGatewayClient({
      baseUrl: 'http://127.0.0.1:1',
      queryImpl: queryImpl as never,
      resolveMcp: async () => ({ configs: configs as never, missing: [] }),
    });
    client.bindEventSink((e) => { events.push(e); });
    const harness: HarnessDescriptor[] = [];
    const result = await client.invoke({
      prompt: 'hi',
      opts: { allowedTools: [] },
      runId: 'r1',
      agentId: 'a1',
      workspace,
      assets: { roots: { workflow: join(root, 'wf'), global: join(root, 'gl') }, declared: { skills: [], mcp: Object.keys(configs) }, workflow: 'wf' },
      onHarness: async (h) => { harness.push(h); },
    });
    expect(result.ok).toBe(true);
    const options = (queryImpl.mock.calls[0] as unknown as [{ options: { env: Record<string, string>; mcpServers?: Record<string, Record<string, unknown>> } }])[0].options;
    return { options, harness, events };
  }

  it('ENABLE_TOOL_SEARCH=false is in the CLI env and every MCP server is dispatched with alwaysLoad:true', async () => {
    const { options } = await dispatch({ srv: { type: 'stdio', command: 'npx', args: ['-y', 'pkg'] } }, 'connected');
    expect(options.env['ENABLE_TOOL_SEARCH']).toBe('false');
    expect(options.mcpServers).toEqual({ srv: { alwaysLoad: true, type: 'stdio', command: 'npx', args: ['-y', 'pkg'] } });
  });

  it("an operator's explicit alwaysLoad in the pushed config is not overwritten", async () => {
    const { options } = await dispatch({ srv: { type: 'stdio', command: 'npx', alwaysLoad: false } }, 'connected');
    expect(options.mcpServers?.['srv']?.['alwaysLoad']).toBe(false);
  });

  it('ENABLE_TOOL_SEARCH=false is set even with no MCP server (the explicit tools list never carries ToolSearch)', async () => {
    const { options, harness } = await dispatch({}, undefined);
    expect(options.env['ENABLE_TOOL_SEARCH']).toBe('false');
    expect(options.mcpServers).toBeUndefined();
    expect(harness).toHaveLength(1); // no init re-emission without MCP servers
  });

  it('a healthy init re-emits the harness with mcpStatus and no warnings, and journals nothing', async () => {
    const { harness, events } = await dispatch({ srv: { type: 'stdio', command: 'npx' } }, 'connected');
    expect(harness).toHaveLength(2);
    expect(harness[0]!.mcpStatus).toBeUndefined();
    expect(harness[1]!.mcpStatus).toEqual([{ server: 'srv', status: 'connected', tools: ['mcp__srv__echo'] }]);
    expect(harness[1]!.warnings).toBeUndefined();
    expect(harness[1]!.model).toBe(harness[0]!.model); // same descriptor, only the init fields added
    expect(events.filter((e) => e.kind === 'agent.mcp_not_connected')).toEqual([]);
  });

  it('a pending server at init: harness warning + agent.mcp_not_connected journal line', async () => {
    const { harness, events } = await dispatch({ srv: { type: 'stdio', command: 'npx' } }, 'pending');
    expect(harness[1]!.warnings?.map((w) => [w.code, w.server, w.status])).toEqual([['MCP_SERVER_NOT_CONNECTED', 'srv', 'pending']]);
    expect(events.filter((e) => e.kind === 'agent.mcp_not_connected')).toEqual([{ kind: 'agent.mcp_not_connected', runId: 'r1', agentId: 'a1', attempt: 1, server: 'srv', status: 'pending', tools: 0 }]);
  });
});

describe('AgentRecord.warnings: live and restart-derived agree, and roll up onto run_status (issue #106)', () => {
  const W: HarnessWarning = { code: 'MCP_SERVER_NOT_CONNECTED', server: 'srv', status: 'pending', message: 'm' };
  const base = { model: 'claude-haiku-4-5-20251001', provider: 'anthropic', prompt: 'p', tools: [], skills: [], mcpServers: ['srv'], surfaceType: 'curated' as const, label: 'caller' };

  it('markHarness stamps the LATEST descriptor warnings (absent clears) and capture() keeps them', async () => {
    const sink = new AgentTranscriptSink();
    sink.markQueued('a1', { label: 'caller' });
    sink.markRunning('a1', '2026-01-01T00:00:00.000Z');
    sink.markHarness('a1', base.model, base.provider);
    expect(sink.getRecord('a1')!.warnings).toBeUndefined();
    sink.markHarness('a1', base.model, base.provider, [W]);
    expect(sink.getRecord('a1')!.warnings).toEqual([W]);
    await sink.capture('r1', { agentId: 'a1', label: 'caller' }, { ok: true, provider: 'anthropic', model: base.model, tokens: { input: 1, output: 1 }, content: 'ok' }, '2026-01-01T00:00:05.000Z');
    expect(sink.getRecord('a1')!.warnings).toEqual([W]);
    sink.markQueued('a2');
    sink.markHarness('a2', base.model, base.provider, [W]);
    sink.markHarness('a2', base.model, base.provider, undefined);
    expect(sink.getRecord('a2')!.warnings).toBeUndefined();
  });

  it('deriveAgentRecords reads the latest harness event warnings on the terminal and in-flight branches', () => {
    const harness = (ts: string, extra: Partial<HarnessDescriptor>): TranscriptEvent => ({ ts, kind: 'harness', data: { agentId: 'a1', descriptor: { ...base, ...extra } } });
    const inFlight = new Map<string, TranscriptEvent[]>([['a1', [harness('t1', {}), harness('t2', { warnings: [W] })]]]);
    expect(deriveAgentRecords(inFlight, 'running')[0]!.warnings).toEqual([W]);
    const done = new Map<string, TranscriptEvent[]>([['a1', [harness('t1', {}), harness('t2', { warnings: [W] }), { ts: 't3', kind: 'usage', data: { tokens: { input: 1, output: 1 }, provider: 'anthropic', model: base.model, costUSD: 0, unpriced: false } }]]]);
    expect(deriveAgentRecords(done, 'completed')[0]!.warnings).toEqual([W]);
    const healthy = new Map<string, TranscriptEvent[]>([['a1', [harness('t1', {}), harness('t2', { mcpStatus: [] })]]]);
    expect('warnings' in deriveAgentRecords(healthy, 'running')[0]!).toBe(false);
  });

  it('summarizeAgentWarnings names each warning\'s agent and is absent when there are none', () => {
    expect(summarizeAgentWarnings([{ agentId: 'a0', state: 'done', provider: 'p', model: 'm' }])).toEqual({});
    expect(summarizeAgentWarnings([
      { agentId: 'a0', state: 'done', provider: 'p', model: 'm' },
      { agentId: 'a1', label: 'caller', state: 'done', provider: 'p', model: 'm', warnings: [W] },
    ])).toEqual({ warnings: [{ label: 'caller', agentId: 'a1', ...W }] });
  });
});
