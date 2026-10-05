// Issue #138 (follow-up to #137's smoke report): `run_agent_log`'s `harness` object (the
// `HarnessDescriptor` each `GatewayClient.invoke()` hands to `onHarness`) carried no `transport`
// field of its own, even though the sibling `record` object right beside it did (`AgentRecord.
// transport`, populated straight from `GatewayResult.transport`) — a reader had to cross-reference
// two objects to see which gateway actually ran a call. All three `GatewayClient` implementations
// now stamp `descriptor.transport` with their own fixed literal, at the same site they already
// build the rest of the descriptor.
//
// Mock policy (unit): each gateway's own third-party transport is faked (no real SDK CLI spawn, no
// real HTTP, no real pi child process) — same seams the pre-existing per-gateway suites already use
// (`sdk-gateway-skill-exposure.test.ts`'s `queryImpl`, `gateway-client.test.ts`'s `fetchImpl`,
// `pi-gateway-client-attempts.test.ts`'s `fakeChild`).
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { ClaudeAgentSdkGatewayClient } from '../../src/gateway/claude-agent-sdk-client.js';
import { LiteLLMGatewayClient } from '../../src/gateway/client.js';
import { PiGatewayClient } from '../../src/gateway/pi-gateway-client.js';
import type { AgentOpts, HarnessDescriptor } from '../../src/types.js';

describe('issue #138 — HarnessDescriptor.transport, one literal per GatewayClient', () => {
  it('claude-agent-sdk gateway stamps transport:"claude-agent-sdk"', async () => {
    async function* okSession() {
      yield { type: 'result', subtype: 'success', is_error: false, result: 'ok', usage: { input_tokens: 1, output_tokens: 1 } };
    }
    const queryImpl = vi.fn(() => okSession());
    const client = new ClaudeAgentSdkGatewayClient({ baseUrl: 'http://127.0.0.1:1', queryImpl: queryImpl as never });
    let descriptor: HarnessDescriptor | undefined;
    const result = await client.invoke({
      prompt: 'hi', opts: {} as AgentOpts, runId: 'r1', agentId: 'a1', workspace: '/tmp/rwe-harness-transport-sdk',
      onHarness: async (h) => { descriptor = h; },
    });
    expect(result.ok).toBe(true);
    expect(descriptor?.transport).toBe('claude-agent-sdk');
  });

  it('direct-fetch gateway (LiteLLMGatewayClient) stamps transport:"direct-fetch"', async () => {
    const fetchImpl = (async () => ({
      ok: true, status: 200,
      json: async () => ({ content: [{ text: 'ok' }], usage: { input_tokens: 1, output_tokens: 1 } }),
    })) as unknown as typeof fetch;
    const client = new LiteLLMGatewayClient({ timeoutMs: 5000, retries: 1, fetchImpl });
    let descriptor: HarnessDescriptor | undefined;
    const result = await client.invoke({
      prompt: 'hi', opts: { model: 'ollama/qwen2.5:7b' }, runId: 'r1', agentId: 'a1',
      onHarness: async (h) => { descriptor = h; },
    });
    expect(result.ok).toBe(true);
    expect(descriptor?.transport).toBe('direct-fetch');
  });

  it('pi gateway stamps transport:"pi"', async () => {
    function fakeChild() {
      const emitter = new EventEmitter() as EventEmitter & { stdin: PassThrough; stdout: PassThrough; stderr: PassThrough; pid: number; kill: ReturnType<typeof vi.fn> };
      emitter.stdin = new PassThrough();
      emitter.stdout = new PassThrough();
      emitter.stderr = new PassThrough();
      emitter.pid = 12345;
      emitter.kill = vi.fn();
      return {
        child: emitter,
        sendLine: (obj: unknown) => emitter.stdout.write(JSON.stringify(obj) + '\n'),
        exit: (code: number | null = 0) => emitter.emit('exit', code, null),
      };
    }
    const f = fakeChild();
    const spawnChild = vi.fn(() => f.child as never);
    const gw = new PiGatewayClient({ spawnChild: spawnChild as never, entryPath: '/fake/entry.ts' });
    let descriptor: HarnessDescriptor | undefined;
    const promise = gw.invoke({
      prompt: 'hi', opts: { model: 'ollama/qwen2.5:7b' } as AgentOpts, runId: 'r1', agentId: 'a1', workspace: '/tmp/rwe-harness-transport-pi',
      onHarness: async (h) => { descriptor = h; },
    });
    await new Promise((r) => setTimeout(r, 10));
    f.sendLine({ t: 'final', seq: 1, text: 'ok', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, stopReason: 'stop' });
    f.exit(0);
    const result = await promise;
    expect(result.ok).toBe(true);
    expect(descriptor?.transport).toBe('pi');
  });
});
