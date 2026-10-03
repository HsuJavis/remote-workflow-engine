// pi harness v1, slice (g): the child's `{t:'mcp_init'}` event (pi has no connection-status API —
// spike S5 — only `getActiveToolNames()` is observable) mapped onto the SAME `summarizeMcpInit` the
// sdk gateway uses for issue #106 parity: a second onHarness call carrying `mcpStatus`/`warnings`,
// and an `agent.mcp_not_connected` eventSink line per warning. Fake child — no real pi/MCP needed;
// the real end-to-end MCP check is tests/acceptance/pi-harness-mcp-real.test.ts.
import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { PiGatewayClient } from '../../src/gateway/pi-gateway-client.js';
import type { AgentOpts } from '../../src/types.js';
import type { EngineEvent } from '../../src/event-log.js';

function fakeChild() {
  const emitter = new EventEmitter() as EventEmitter & { stdin: PassThrough; stdout: PassThrough; stderr: PassThrough; pid: number; kill: () => void };
  emitter.stdin = new PassThrough();
  emitter.stdout = new PassThrough();
  emitter.stderr = new PassThrough();
  emitter.pid = 70001;
  emitter.kill = () => {};
  return {
    child: emitter,
    sendLine: (obj: unknown) => emitter.stdout.write(JSON.stringify(obj) + '\n'),
    exit: (code: number | null = 0) => emitter.emit('exit', code, null),
  };
}

function req(overrides: Partial<Parameters<PiGatewayClient['invoke']>[0]> = {}) {
  return {
    prompt: 'hi',
    opts: { model: 'ollama/qwen2.5:7b', mcp: ['everything'] } as AgentOpts,
    runId: 'r1',
    agentId: 'a1',
    workspace: '/tmp/pi-gw-mcp-init-ws',
    assets: { roots: { workflow: '/wf', global: '/gl' }, declared: { skills: [], mcp: ['everything'] }, workflow: 'wf' },
    ...overrides,
  };
}

describe('PiGatewayClient — mcp_init -> summarizeMcpInit (slice g, issue #106 parity)', () => {
  it('a server whose tools showed up is "connected", no warning, no agent.mcp_not_connected', async () => {
    const f = fakeChild();
    const gw = new PiGatewayClient({
      spawnChild: (() => f.child) as never, entryPath: '/fake/entry.ts',
      resolveMcp: async (_wf, names) => ({ configs: Object.fromEntries(names.map((n) => [n, { type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-everything'] }])), missing: [] }),
    });
    const events: EngineEvent[] = [];
    gw.bindEventSink((ev) => events.push(ev));
    const harnessCalls: unknown[] = [];
    const promise = gw.invoke(req({ onHarness: async (h) => { harnessCalls.push(h); } }));
    await new Promise((r) => setTimeout(r, 10));
    f.sendLine({ t: 'mcp_init', servers: ['everything'], activeTools: ['mcp__everything__echo', 'mcp__everything__add'] });
    f.sendLine({ t: 'final', seq: 1, text: 'ok', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, stopReason: 'stop' });
    f.exit(0);
    await promise;

    expect(harnessCalls.length).toBe(2); // eager + mcp_init-refined
    const refined = harnessCalls[1] as { mcpStatus?: Array<{ server: string; status: string; tools: string[] }>; warnings?: unknown[] };
    expect(refined.mcpStatus).toEqual([{ server: 'everything', status: 'connected', tools: ['mcp__everything__echo', 'mcp__everything__add'] }]);
    expect(refined.warnings).toBeUndefined();
    expect(events.filter((e) => e.kind === 'agent.mcp_not_connected')).toEqual([]);
  });

  it('a server with NO tools active is "unknown", warned, and emits agent.mcp_not_connected', async () => {
    const f = fakeChild();
    const gw = new PiGatewayClient({
      spawnChild: (() => f.child) as never, entryPath: '/fake/entry.ts',
      resolveMcp: async (_wf, names) => ({ configs: Object.fromEntries(names.map((n) => [n, { type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-everything'] }])), missing: [] }),
    });
    const events: EngineEvent[] = [];
    gw.bindEventSink((ev) => events.push(ev));
    const harnessCalls: unknown[] = [];
    const promise = gw.invoke(req({ onHarness: async (h) => { harnessCalls.push(h); } }));
    await new Promise((r) => setTimeout(r, 10));
    f.sendLine({ t: 'mcp_init', servers: ['everything'], activeTools: [] });
    f.sendLine({ t: 'final', seq: 1, text: 'ok', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, stopReason: 'stop' });
    f.exit(0);
    await promise;

    const refined = harnessCalls[1] as { mcpStatus?: Array<{ server: string; status: string }>; warnings?: Array<{ code: string; server: string }> };
    expect(refined.mcpStatus?.[0]).toMatchObject({ server: 'everything', status: 'unknown' });
    expect(refined.warnings).toEqual([{ code: 'MCP_SERVER_NOT_CONNECTED', server: 'everything', status: 'unknown', message: expect.stringContaining('everything') }]);
    const notConnected = events.filter((e): e is Extract<EngineEvent, { kind: 'agent.mcp_not_connected' }> => e.kind === 'agent.mcp_not_connected');
    expect(notConnected).toEqual([{ kind: 'agent.mcp_not_connected', runId: 'r1', agentId: 'a1', attempt: 1, server: 'everything', status: 'unknown', tools: 0 }]);
  });

  it('no mcp_init event at all (no MCP declared) -> onHarness called exactly once, no agent.mcp_not_connected', async () => {
    const f = fakeChild();
    const gw = new PiGatewayClient({ spawnChild: (() => f.child) as never, entryPath: '/fake/entry.ts' });
    const events: EngineEvent[] = [];
    gw.bindEventSink((ev) => events.push(ev));
    const harnessCalls: unknown[] = [];
    const promise = gw.invoke(req({
      opts: { model: 'ollama/qwen2.5:7b' } as AgentOpts,
      assets: undefined,
      onHarness: async (h) => { harnessCalls.push(h); },
    }));
    await new Promise((r) => setTimeout(r, 10));
    f.sendLine({ t: 'final', seq: 1, text: 'ok', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, stopReason: 'stop' });
    f.exit(0);
    await promise;
    expect(harnessCalls.length).toBe(1);
    expect(events.filter((e) => e.kind === 'agent.mcp_not_connected')).toEqual([]);
  });
});
