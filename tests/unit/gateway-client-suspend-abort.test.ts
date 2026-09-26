// UT-023: D-F10(c) route-back — LiteLLMGatewayClient (the "direct-fetch" opt-out gateway) forwards
// a caller-supplied AbortSignal into the in-flight fetch's own AbortController, so
// `run_suspend` genuinely cancels the outbound provider request instead of merely abandoning it.
//
// D-F10(c) (binding, Gate 7.5 round 3/4, carried-forward, never fixed): `invoke()`'s own declared
// parameter type omits `signal` entirely (`{ prompt, opts, runId, agentId }` — confirmed by reading
// `src/gateway/client.ts`), even though the `GatewayClient` interface itself declares
// `signal?: AbortSignal` (D-F9a). Both `callProvider` and `callViaLiteLLMProxy` build their OWN local
// `AbortController` tied only to `timeoutMs`'s own timer — a caller's abort signal is never listened
// to at all, so the underlying `fetch` keeps running until the provider itself responds or the
// configured `timeoutMs` elapses, exactly the same defect class Gate 7.5 round 4 found (for a
// different root cause) on the SDK-gateway path (UT-022).
//
// Mock policy (DES-015, unit tier): injects `GatewayConfig.fetchImpl` (the existing test seam used by
// IT-005/UT-timeout tests) — no real network. Proving the SAME AbortSignal instance fetch receives
// reacts to the caller's own external abort is exactly the "genuinely kills the call" contract; a real
// socket-level kill is Gate 7.5's job to re-confirm against a live provider.
//
// Red reason: confirmed by reading src — `invoke()`'s parameter type has no `signal` field and
// neither `callProvider` nor `callViaLiteLLMProxy` ever reads one, so the fetch's own AbortSignal is
// wired ONLY to the internal timeoutMs timer; aborting an external caller signal has zero effect on
// it. With a deliberately long timeoutMs (30s) and a hung transport, the external abort below never
// causes the captured fetch signal to fire, and `invoke()` never settles — the test's own bounded
// escape hatch (not a claim about src) is what actually resolves it today.
import { describe, it, expect } from 'vitest';
import { LiteLLMGatewayClient } from '../../src/gateway/client.js';

// A sentinel distinguishable from any real GatewayResult, used only to bound THIS TEST's own wall
// time (not a claim about src's own cancellation behavior) — same convention as UT-021.
const TEST_LEVEL_BOUND = Symbol('ut-023-test-level-bound');

/** A transport that hangs until ITS OWN signal aborts — mirrors real fetch's abort contract exactly
 *  (same shape as claude-agent-sdk-gateway-timeout.test.ts's makeHungFetch). Captures the signal it
 *  was actually invoked with so the test can assert on it directly. */
function makeHungFetch(): { fetchImpl: typeof fetch; capturedSignal: () => AbortSignal | undefined } {
  let captured: AbortSignal | undefined;
  const fetchImpl = ((_url: unknown, init?: { signal?: AbortSignal }) => {
    captured = init?.signal;
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        reject(err);
      });
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, capturedSignal: () => captured };
}

describe('LiteLLMGatewayClient (direct-fetch) suspend-cancel wiring (UT-023, D-F10c)', () => {
  it('a caller-supplied signal genuinely aborts the in-flight fetch, not just the caller\'s own wait', async () => {
    const { fetchImpl, capturedSignal } = makeHungFetch();
    const gw = new LiteLLMGatewayClient({
      // Deliberately long: if the caller's own external signal isn't wired in, nothing else would
      // ever cause this call to settle within this test's bound.
      timeoutMs: 30000,
      retries: 0,
      useLiteLLMProxy: false,
      fetchImpl,
    });
    const external = new AbortController();

    const resultPromise = gw.invoke({
      prompt: 'p',
      opts: { model: 'ollama/qwen2.5:7b' },
      runId: 'r1',
      agentId: 'a1',
      signal: external.signal,
    } as Parameters<LiteLLMGatewayClient['invoke']>[0] & { signal: AbortSignal });

    // Bounded wait for the fetch to have actually been dispatched (deterministic — not a race
    // against sandbox/child-process startup, same technique as IT-019's invokeCalledPromise).
    const deadline = Date.now() + 2000;
    while (capturedSignal() === undefined && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(capturedSignal()).toBeInstanceOf(AbortSignal);

    external.abort();

    const result = await Promise.race([
      resultPromise,
      new Promise((resolve) => setTimeout(() => resolve(TEST_LEVEL_BOUND), 1000)),
    ]);

    // Forcing red: today, aborting `external` has no path into the fetch's own signal at all, so
    // this resolves to the test-level escape-hatch sentinel instead of a real GatewayResult.
    expect(result).not.toBe(TEST_LEVEL_BOUND);
    expect((result as { ok: boolean }).ok).toBe(false);
    // The SAME signal object fetch was actually called with must reflect the external abort — not
    // merely "invoke() gave up waiting" while the real outbound request keeps running unobserved.
    expect(capturedSignal()?.aborted).toBe(true);
  }, 5000);
});
