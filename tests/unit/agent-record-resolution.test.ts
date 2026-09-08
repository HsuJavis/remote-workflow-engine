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

// UT-217 (v26 Gate 7.5 round 1, defect D2 second half, REQ-125): a proxy-REFUSED call must not read
// as a completed one. Round 1 reported the `400 no healthy deployments` failure being recorded as
// `state:"done"`; that half did NOT reproduce on this tree — a live scratch engine
// (`gateway:"direct-fetch"`, proxy on, ollama alias, real litellm answering the real 400) recorded
// `state:"failed", tokens 0, transport:"direct-fetch"` on run `6669bad0`. This is the LOCK for
// that, written green-by-construction (Mode C: there is no defect to force red), so the claim can
// never quietly become true: the only writer of `state:'done'` is the `result.ok` branch.
describe('a gateway refusal is never recorded as done (UT-217, defect D2, REQ-125)', () => {
  it('an ok:false terminal from the LiteLLM-proxied direct-fetch arm records state:failed with zero tokens', async () => {
    const sink = new AgentTranscriptSink();
    sink.markQueued('a4');
    sink.markHarness('a4', 'qwen2.5:7b', 'ollama');
    await sink.capture('r1', { agentId: 'a4' }, {
      ok: false, provider: 'ollama', reason: 'terminal', transport: 'direct-fetch',
    } as any, '2026-09-08T00:00:00Z');
    const record = sink.getRecord('a4') as any;
    expect(record.state).toBe('failed');
    expect(record.tokens).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
    expect(record.transport).toBe('direct-fetch');
    expect(record.model).toBe('qwen2.5:7b');
  });
});
