// IT-161 (H-2 send-back repair, ARCH-111, ADR-040, REQ-122, issue #65): the direct-fetch transport
// (`LiteLLMGatewayClient`) never set `retryable`, never carried `detail`/status, and the retry loop
// had no terminal break — `grep -n retryable src/gateway/client.ts` returned only the type
// declaration. A revoked key burned `timeoutMs × (1 + retries)` per call while holding a `RunGuard`
// slot and a host `AgentSemaphore` permit, and a 401 vs 403 vs 404 vs 400 were indistinguishable in
// the record. The SDK transport already had exactly this contract (IT-142). This is its direct-fetch
// twin, run through the REAL `AgentExecutor` so the AgentRecord surface is proven, not just the
// gateway's own return value.
//
// Mock policy (integration, real adjacent components): the real `AgentExecutor` + real
// `LiteLLMGatewayClient`; only `fetchImpl` (the actual outbound HTTP call) is faked — the one
// genuinely un-runnable third-party network boundary (DES-091).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentExecutor } from '../../src/agent-executor.js';
import { LiteLLMGatewayClient } from '../../src/gateway/client.js';
import type { GatewayConfig } from '../../src/gateway/client.js';
import { FixedClock } from '../../src/clock.js';
import type { RunParams } from '../../src/params/resolve.js';

// v24 (DES-146): `AgentExecutor.run` resolves `model` off `req.runParams`, never off
// `req.opts.model` directly (the per-call tunable rung is retired) — so the alias to dispatch on
// has to travel via a RunParams snapshot, same as a real registered run's admission would produce.
const sonnetRunParams: RunParams = {
  model: 'anthropic/claude-3-5-sonnet-20241022',
  provenance: { model: 'engine', effort: 'engine', timeoutMs: 'engine', appendPrompt: 'engine' },
};

const clock = new FixedClock(new Date('2026-01-01T00:00:00.000Z'));

const ORIGINAL_KEY = process.env['ANTHROPIC_API_KEY'];
beforeEach(() => { process.env['ANTHROPIC_API_KEY'] = 'fake-unit-test-key'; });
afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env['ANTHROPIC_API_KEY'];
  else process.env['ANTHROPIC_API_KEY'] = ORIGINAL_KEY;
});

function make401Fetch(): { fetchImpl: typeof fetch; calls: number } {
  const counter = { calls: 0 };
  const fetchImpl = (async () => {
    counter.calls += 1;
    return { ok: false, status: 401, statusText: 'Unauthorized', json: async () => ({}) };
  }) as unknown as typeof fetch;
  return { fetchImpl, calls: counter.calls } as { fetchImpl: typeof fetch; calls: number };
}

describe('direct-fetch transport ends a terminal 401 attempt immediately, with a named detail (IT-161, H-2)', () => {
  it('a configured retries bound still hits fetchImpl exactly ONCE for a terminal 401', async () => {
    const counter = { calls: 0 };
    const fetchImpl = (async () => {
      counter.calls += 1;
      return { ok: false, status: 401, statusText: 'Unauthorized', json: async () => ({}) };
    }) as unknown as typeof fetch;
    const gw = new LiteLLMGatewayClient({ timeoutMs: 5000, retries: 3, fetchImpl });

    const result = await gw.invoke({ prompt: 'hi', opts: { model: 'anthropic/claude-3-5-sonnet-20241022' }, runId: 'r1', agentId: 'a1' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.retryable).toBe(false);
      expect(result.detail).toContain('401');
    }
    expect(counter.calls).toBe(1); // not 1 + 3 retries
  });

  it('a RETRYABLE first-attempt failure (5xx, no retryable:false) still retries up to the configured bound', async () => {
    const counter = { calls: 0 };
    const fetchImpl = (async () => {
      counter.calls += 1;
      return { ok: false, status: 500, statusText: 'Internal Server Error', json: async () => ({}) };
    }) as unknown as typeof fetch;
    const gw = new LiteLLMGatewayClient({ timeoutMs: 5000, retries: 2, fetchImpl });

    await gw.invoke({ prompt: 'hi', opts: { model: 'anthropic/claude-3-5-sonnet-20241022' }, runId: 'r1', agentId: 'a1' });

    expect(counter.calls).toBe(3); // 1 + 2 retries — unchanged legacy behavior for a non-terminal failure
  });

  it('the resulting AgentRecord (run_status.agents[] surface) carries state:"failed" and a detail naming the status', async () => {
    const { fetchImpl } = make401Fetch();
    const gw = new LiteLLMGatewayClient({ timeoutMs: 5000, retries: 3, fetchImpl });
    const executor = new AgentExecutor({ gateway: gw, clock });

    const agentId = 'agent-401';
    await executor.run({
      runId: 'r1', agentId, prompt: 'hi', opts: { model: 'anthropic/claude-3-5-sonnet-20241022' }, workspace: '/tmp',
      signal: new AbortController().signal,
      runParams: sonnetRunParams,
    });

    const record = executor.getRecord(agentId);
    expect(record?.state).toBe('failed');
    expect(record?.detail).toContain('401');
  });
});
