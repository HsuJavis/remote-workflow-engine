// UT-008: AgentTranscriptSink — token accounting feeds RunGuard (DES-008)
import { describe, it, expect, vi } from 'vitest';
import { AgentExecutor } from '../../src/agent-executor.js';
import { RunGuard } from '../../src/run-guard.js';
import type { GatewayClient, GatewayResult } from '../../src/gateway/client.js';
import { defaultRunParams } from '../../src/params/resolve.js';

function fakeGateway(result: GatewayResult): GatewayClient {
  return { invoke: vi.fn().mockResolvedValue(result) };
}

describe('AgentTranscriptSink + token accounting', () => {
  it('token usage from gateway result calls RunGuard.addTokens', async () => {
    const guard = new RunGuard({ concurrency: 4, budget: 1000 });
    const addSpy = vi.spyOn(guard, 'addTokens');

    const gw = fakeGateway({
      ok: true,
      provider: 'anthropic',
      model: 'claude-3-sonnet',
      tokens: { input: 50, output: 30 },
      content: 'response text',
    });

    const executor = new AgentExecutor({ gateway: gw, guard });
    await executor.run({
      runId: 'run-1',
      agentId: 'a-1',
      prompt: 'p',
      opts: {},
      workspace: '/tmp/ws',
      signal: new AbortController().signal,
      runParams: defaultRunParams(undefined),
    });

    // addTokens should be called with the combined token delta
    expect(addSpy).toHaveBeenCalledWith(expect.any(Number));
    const delta = addSpy.mock.calls[0][0] as number;
    expect(delta).toBe(80); // 50 input + 30 output
  });

  it('AgentRecord after run has the real provider and model from the gateway', async () => {
    const gw = fakeGateway({
      ok: true,
      provider: 'ollama',
      model: 'llama3:8b',
      tokens: { input: 10, output: 5 },
      content: 'local response',
    });

    const executor = new AgentExecutor({ gateway: gw });
    const out = await executor.run({
      runId: 'run-1',
      agentId: 'a-local',
      prompt: 'local query',
      opts: { model: 'haiku' },
      workspace: '/tmp/ws',
      signal: new AbortController().signal,
      runParams: defaultRunParams(undefined),
    });

    // After the run, the executor should have recorded the real provider/model
    // Access through the transcript sink or a getRecord() method
    const record = (executor as unknown as { getRecord(id: string): unknown }).getRecord('a-local');
    expect((record as { provider: string }).provider).toBe('ollama');
    expect((record as { model: string }).model).toBe('llama3:8b');
  });
});
