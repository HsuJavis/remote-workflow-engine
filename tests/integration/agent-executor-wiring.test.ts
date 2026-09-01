// IT-004: AgentExecutor wires GatewayClient + TranscriptSink (ARCH-004)
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentExecutor } from '../../src/agent-executor.js';
import { RunGuard } from '../../src/run-guard.js';
import { InMemoryRunStore } from '../../src/run-store.js';
import { FixedClock } from '../../src/clock.js';
import type { GatewayClient } from '../../src/gateway/client.js';
import { defaultRunParams } from '../../src/params/resolve.js';

const CLOCK = new FixedClock(new Date('2024-01-01T00:00:00Z'));

function makeGateway(result: Awaited<ReturnType<GatewayClient['invoke']>>): GatewayClient {
  return { invoke: vi.fn().mockResolvedValue(result) };
}

describe('AgentExecutor integration wiring (ARCH-004)', () => {
  it('gateway invoke receives prompt and runId/agentId for correlation', async () => {
    const gw = makeGateway({ ok: true, provider: 'anthropic', model: 'claude-3', tokens: { input: 5, output: 3 }, content: 'ok' });
    const executor = new AgentExecutor({ gateway: gw });

    await executor.run({
      runId: 'r-1',
      agentId: 'a-1',
      prompt: 'hello',
      opts: {},
      workspace: '/tmp/ws',
      signal: new AbortController().signal,
      runParams: defaultRunParams(undefined),
    });

    expect(gw.invoke).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'r-1', agentId: 'a-1', prompt: 'hello' }),
    );
  });

  it('token delta from gateway is added to RunGuard exactly once', async () => {
    const gw = makeGateway({ ok: true, provider: 'anthropic', model: 'claude-3', tokens: { input: 20, output: 10 }, content: 'r' });
    const guard = new RunGuard({ concurrency: 4, budget: 1000 });
    const addSpy = vi.spyOn(guard, 'addTokens');

    const executor = new AgentExecutor({ gateway: gw, guard });

    await executor.run({
      runId: 'r-2', agentId: 'a-2', prompt: 'q', opts: {},
      workspace: '/tmp/ws', signal: new AbortController().signal,
      runParams: defaultRunParams(undefined),
    });

    // Called once with combined token count
    expect(addSpy).toHaveBeenCalledTimes(1);
    expect(addSpy).toHaveBeenCalledWith(30);
  });

  it('transcript is appended to RunStore after agent completion', async () => {
    const gw = makeGateway({ ok: true, provider: 'anthropic', model: 'claude-3', tokens: { input: 5, output: 5 }, content: 'done' });
    const store = new InMemoryRunStore(CLOCK);
    const appendSpy = vi.spyOn(store, 'appendTranscript');

    const executor = new AgentExecutor({ gateway: gw, store });

    await executor.run({
      runId: 'r-3', agentId: 'a-3', prompt: 'q', opts: {},
      workspace: '/tmp/ws', signal: new AbortController().signal,
      runParams: defaultRunParams(undefined),
    });

    expect(appendSpy).toHaveBeenCalled();
  });

  // v21 (ARCH-068, DES-105, TASK-101): a run without overrides dispatches with the run's
  // registered default model (REQ-092 wiring repair) — CallKey byte-identical to an equivalent
  // call with no runParams at all (ADR-002: nothing v21 resolves may enter CallKey).
  it('a run registered with defaults.model dispatches with that model when no per-call opts.model is set', async () => {
    const gw = makeGateway({ ok: true, provider: 'anthropic', model: 'claude-3', tokens: { input: 1, output: 1 }, content: 'ok' });
    const executor = new AgentExecutor({ gateway: gw });

    await executor.run({
      runId: 'r-4', agentId: 'a-4', prompt: 'q', opts: {},
      workspace: '/tmp/ws', signal: new AbortController().signal,
      runParams: { model: 'registered-default-model', provenance: { model: 'default', effort: 'engine', timeoutMs: 'engine', appendPrompt: 'engine' } },
    } as unknown as Parameters<typeof executor.run>[0]);

    expect(gw.invoke).toHaveBeenCalledWith(expect.objectContaining({ opts: expect.objectContaining({ model: 'registered-default-model' }) }));
  });
});
