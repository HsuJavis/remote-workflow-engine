// UT-007: AgentExecutor outcomes — text / object / null (DES-007)
import { describe, it, expect, vi } from 'vitest';
import { AgentExecutor } from '../../src/agent-executor.js';
import type { GatewayClient, GatewayResult } from '../../src/gateway/client.js';
import type { AgentOpts } from '../../src/types.js';

function fakeGateway(result: GatewayResult): GatewayClient {
  return { invoke: vi.fn().mockResolvedValue(result) };
}

function req(opts: AgentOpts = {}) {
  return {
    runId: 'run-1',
    agentId: 'agent-1',
    prompt: 'do the thing',
    opts,
    workspace: '/tmp/ws',
    signal: new AbortController().signal,
  };
}

describe('AgentExecutor', () => {
  it('no schema → outcome kind:text with the final text', async () => {
    const gw = fakeGateway({ ok: true, provider: 'anthropic', model: 'claude-3', tokens: { input: 10, output: 5 }, content: 'hello' });
    const executor = new AgentExecutor({ gateway: gw });
    const out = await executor.run(req());
    expect(out.kind).toBe('text');
    expect((out as Extract<typeof out, { kind: 'text' }>).value).toBe('hello');
  });

  it('schema present → outcome kind:object with validated object', async () => {
    const gw = fakeGateway({ ok: true, provider: 'anthropic', model: 'claude-3', tokens: { input: 10, output: 8 }, content: { answer: 42 } });
    const executor = new AgentExecutor({ gateway: gw });
    const out = await executor.run(req({ schema: { type: 'object', properties: { answer: { type: 'number' } } } }));
    expect(out.kind).toBe('object');
    expect((out as Extract<typeof out, { kind: 'object' }>).value).toEqual({ answer: 42 });
  });

  it('terminal gateway failure → outcome kind:null (never rejects)', async () => {
    const gw = fakeGateway({ ok: false, provider: 'anthropic', reason: 'terminal' });
    const executor = new AgentExecutor();
    const out = await executor.run(req());
    expect(out.kind).toBe('null');
  });

  it('provider timeout → outcome kind:null (never rejects)', async () => {
    const gw = fakeGateway({ ok: false, provider: 'ollama', reason: 'timeout' });
    const executor = new AgentExecutor();
    const out = await executor.run(req({ model: 'haiku' }));
    expect(out.kind).toBe('null');
  });

  it('AbortSignal fires before completion → run resolves null (never hangs)', async () => {
    const ctrl = new AbortController();
    const executor = new AgentExecutor();
    const p = executor.run({ ...req(), signal: ctrl.signal });
    ctrl.abort();
    const out = await p;
    expect(out.kind).toBe('null');
  });
});
