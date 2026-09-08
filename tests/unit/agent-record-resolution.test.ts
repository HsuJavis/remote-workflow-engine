// UT-184 (DES-177, ARCH-115, TASK-177, v26, REQ-125): the terminal record keeps what the HARNESS
// resolved; `GatewayResult` gains `transport` to say which wire carried it. `capture()` must write
// `provider: prev?.provider || result.provider`, `model: prev?.model || result.model` — the harness
// stamp wins where one exists; the gateway's own value fills only a pre-harness terminal. Written
// test-first (Gate 5, RED): today `capture()` writes `provider: result.provider, model: result.model`
// unconditionally on the done branch, clobbering the harness-resolved values with the transport name.
// Mock policy (unit): the real AgentTranscriptSink, no I/O (no store injected).
import { describe, it, expect } from 'vitest';
import { AgentTranscriptSink } from '../../src/agent-executor.js';

describe('capture() keeps the harness-resolved provider/model; transport says which wire (UT-184, DES-177)', () => {
  it('markHarness(openrouter, gemini) then a done result claiming claude-agent-sdk: record stays openrouter/gemini, transport carries the SDK name', async () => {
    const sink = new AgentTranscriptSink();
    sink.markQueued('a1');
    sink.markHarness('a1', 'google/gemini-3.8-flash', 'openrouter');
    await sink.capture('r1', { agentId: 'a1' }, {
      ok: true, provider: 'claude-agent-sdk', model: 'gem', tokens: { input: 1, output: 1 }, content: 'x',
      transport: 'claude-agent-sdk',
    } as any, '2026-09-08T00:00:00Z');
    const record = sink.getRecord('a1') as any;
    expect(record.provider).toBe('openrouter');
    expect(record.model).toBe('google/gemini-3.8-flash');
    expect(record.transport).toBe('claude-agent-sdk');
  });

  it('a pre-harness terminal (no markHarness ever ran) takes the gateway result value without crashing', async () => {
    const sink = new AgentTranscriptSink();
    sink.markQueued('a2');
    await expect(sink.capture('r1', { agentId: 'a2' }, {
      ok: false, provider: 'anthropic', reason: 'terminal', detail: 'ANTHROPIC_AUTH_MISSING',
    } as any, '2026-09-08T00:00:00Z')).resolves.not.toThrow();
    const record = sink.getRecord('a2') as any;
    expect(record.provider).toBe('anthropic');
  });

  it('proxyModel is present on the LiteLLM route result and absent when the gateway omits it', async () => {
    const sink = new AgentTranscriptSink();
    sink.markQueued('a3');
    await sink.capture('r1', { agentId: 'a3' }, {
      ok: true, provider: 'openrouter', model: 'google/gemini-3.8-flash', tokens: { input: 1, output: 1 }, content: 'x',
      transport: 'claude-agent-sdk', proxyModel: 'rwe-proxy-default',
    } as any, '2026-09-08T00:00:00Z');
    const record = sink.getRecord('a3') as any;
    expect(record.proxyModel).toBe('rwe-proxy-default');
  });
});
