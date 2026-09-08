// IT-005: GatewayClient provider-down circuit breaker path (ARCH-005 / D-G)
//
// D-R1 retime (2026-07-03): originally exercised real network (a real Ollama daemon / real
// Anthropic endpoint) directly, which was non-deterministic (depended on whether a local Ollama
// happened to be running) and, once the production default flips to the LiteLLM proxy path
// (D-R1, IT-013), would otherwise require a real `litellm` subprocess cold start just to prove
// breaker semantics that have nothing to do with Python startup time. Refactored to inject
// GatewayConfig.fetchImpl (the actual outbound HTTP call) and a LiteLLMProxyManager whose own
// spawnImpl/fetchImpl are faked (so proxy.start() resolves instantly, no real subprocess) — this
// tests the breaker (bounded timeout -> retry -> null), not Python cold-start. Real-subprocess
// proof belongs to Gate 7.5 with environment caveats (D-R3).
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events'; // a real ChildProcess IS an EventEmitter — the fake must be too (v23 adjudication #6 V-2)
import type { ChildProcess } from 'node:child_process';
import { LiteLLMGatewayClient } from '../../src/gateway/client.js';
import { LiteLLMProxyManager } from '../../src/gateway/litellm-proxy.js';

const ALIASES = { default: { provider: 'anthropic' as const, model: 'claude-3-5-haiku-20241022' } };

function makeFakeProxyManager() {
  const fakeSpawn = vi.fn(() => (Object.assign(new EventEmitter(), { exitCode: null, kill: vi.fn() })) as unknown as ChildProcess);
  const fakeHealthFetch = vi.fn(async () => ({ ok: true }) as unknown as Response);
  return new LiteLLMProxyManager(ALIASES, {
    spawnImpl: fakeSpawn as unknown as typeof import('node:child_process').spawn,
    fetchImpl: fakeHealthFetch as unknown as typeof fetch,
  });
}

/** A transport that never settles until aborted — mimics a genuinely hung provider (respects
 *  AbortSignal like real fetch does, so the code under test's own timeout actually fires). */
function makeHungFetch(): typeof fetch {
  return ((_url: unknown, init?: { signal?: AbortSignal }) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        reject(err);
      });
    })) as unknown as typeof fetch;
}

describe('GatewayClient provider-down handling (ARCH-005, D-R1 retimed via injected fakes)', () => {
  it('a hung provider triggers timeout and returns ok:false (never hangs)', async () => {
    const gw = new LiteLLMGatewayClient({
      aliases: ALIASES,
      timeoutMs: 200,
      retries: 0,
      useLiteLLMProxy: true,
      proxyManager: makeFakeProxyManager(),
      fetchImpl: makeHungFetch(),
    });

    const start = Date.now();
    const result = await gw.invoke({ prompt: 'test', opts: {}, runId: 'r1', agentId: 'a1' });
    const elapsed = Date.now() - start;

    expect(result.ok).toBe(false);
    // Bounded by the injected 200ms timeout + slack — not real network flakiness.
    expect(elapsed).toBeLessThan(2000);
    if (!result.ok) {
      expect(['timeout', 'unreachable', 'terminal']).toContain(result.reason);
    }
  }, 10000);

  it('retries the configured number of times before giving up', async () => {
    const failingFetch = vi.fn(async () => ({ ok: false, status: 503 }) as unknown as Response) as unknown as typeof fetch;
    const gw = new LiteLLMGatewayClient({
      aliases: ALIASES,
      timeoutMs: 500,
      retries: 2,
      useLiteLLMProxy: true,
      proxyManager: makeFakeProxyManager(),
      fetchImpl: failingFetch,
    });

    const result = await gw.invoke({ prompt: 'p', opts: {}, runId: 'r1', agentId: 'a1' });

    expect(result.ok).toBe(false);
    // 1 initial attempt + 2 retries = exactly 3 calls to the transport — observable and exact,
    // not just "eventually gives up".
    expect(failingFetch).toHaveBeenCalledTimes(3);
  }, 10000);

  it('successful provider call returns ok:true with provider, model, tokens, content', async () => {
    const okFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ content: [{ text: 'hello' }], usage: { input_tokens: 5, output_tokens: 2 } }),
    }) as unknown as Response) as unknown as typeof fetch;
    const gw = new LiteLLMGatewayClient({
      aliases: ALIASES,
      timeoutMs: 5000,
      retries: 1,
      useLiteLLMProxy: true,
      proxyManager: makeFakeProxyManager(),
      fetchImpl: okFetch,
    });

    const result = await gw.invoke({ prompt: 'say hello', opts: {}, runId: 'r1', agentId: 'a1' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(typeof result.provider).toBe('string');
      expect(typeof result.model).toBe('string');
      // v26 (DES-180, TASK-180): tokens widened to four columns — cacheRead/cacheWrite are a KNOWN
      // 0 here (the fixture's `usage` carries no cache fields).
      expect(result.tokens).toEqual({ input: 5, output: 2, cacheRead: 0, cacheWrite: 0 });
      expect(result.content).toBe('hello');
    }
  });
});
