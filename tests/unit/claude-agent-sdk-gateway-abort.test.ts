// UT-022: D-F10(c) route-back — ClaudeAgentSdkGatewayClient wires its AbortController to the REAL
// SDK cancellation hook (Options.abortController), not only to its own local await-race.
//
// D-F10(c) (binding, Gate 7.5 round 4 real defect): `_invokeOnce`'s local `controller` (built to race
// `drain` vs a timeout/external-signal bound) is never assigned to `options.abortController` — the
// SDK's own documented cancellation hook (node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1275,
// "Controller for cancelling the query. When aborted, the query will stop and clean up resources.").
// Real repro (08-validation.md round 4): workflow_suspend makes the local Promise race resolve early
// (state machine correct) but the real spawned `claude` CLI subprocess is NOT killed — it runs to its
// own natural completion (observed via `ps aux`: PID alive at t=4s post-suspend, matching an
// unsuspended control run's ~16s completion, not an immediate cancellation).
//
// Mock policy (DES-015, unit tier): vi.mock intercepts only the third-party
// @anthropic-ai/claude-agent-sdk module (same pattern as UT-018/UT-019/UT-020/UT-021) — the assertion
// is entirely about what `options` object THIS client hands to `query()`, which a real subprocess kill
// cannot be observed for at unit tier (that real-process proof is Gate 7.5's job, per the retro memo:
// "wiring gaps must be catchable at unit tier from now on").
//
// Red reason: `src/gateway/claude-agent-sdk-client.ts`'s `_invokeOnce` never sets
// `options.abortController` at all today (confirmed by reading the source — no `abortController` key
// anywhere in the built `Options` object) — `call.options?.abortController` is `undefined` in both
// cases below, not a real `AbortController` instance, let alone one that reflects the caller's own
// abort.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ClaudeAgentSdkGatewayConfig } from '../../src/gateway/claude-agent-sdk-client.js';

const queryMock = vi.fn();
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: queryMock }));

/** A session that never yields and never returns — models a genuinely hung/stuck real SDK session
 *  (the CLI subprocess never responding), so aborting is the ONLY way this test's own await ever
 *  settles. No timers of its own -> no dangling handles if never awaited to completion. */
function hungSession(): AsyncGenerator<unknown> {
  return (async function* () {
    await new Promise(() => {});
  })();
}

describe('ClaudeAgentSdkGatewayClient real cancellation hook wiring (UT-022, D-F10c)', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('assigns a real AbortController to options.abortController when invoke() is given a caller signal', async () => {
    queryMock.mockReturnValue(hungSession());
    const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
    const config: ClaudeAgentSdkGatewayConfig = { baseUrl: 'http://127.0.0.1:4000' };
    const client = new ClaudeAgentSdkGatewayClient(config);
    const external = new AbortController();

    const resultPromise = client.invoke({
      prompt: 'hi',
      opts: {},
      runId: 'r1',
      agentId: 'a1',
      signal: external.signal,
    });

    expect(queryMock).toHaveBeenCalledTimes(1);
    const [[call]] = queryMock.mock.calls as [[{ options?: { abortController?: AbortController } }]];
    // Forcing red: today's src never sets options.abortController — call.options?.abortController
    // is undefined, so this fails before the abort-linkage assertion below is even reachable.
    expect(call.options?.abortController).toBeInstanceOf(AbortController);

    // Not just present — genuinely LINKED: aborting the caller's signal must abort the very
    // AbortController object handed to the real SDK, so the SDK's own documented cleanup runs.
    external.abort();
    await Promise.race([resultPromise, new Promise((r) => setTimeout(r, 500))]);
    expect(call.options?.abortController?.signal.aborted).toBe(true);
  }, 5000);

  it('assigns a real AbortController to options.abortController when bound only by a configured timeoutMs (no external signal)', async () => {
    queryMock.mockReturnValue(hungSession());
    const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
    const config: ClaudeAgentSdkGatewayConfig & { timeoutMs: number; retries: number } = {
      baseUrl: 'http://127.0.0.1:4000',
      timeoutMs: 150,
      retries: 0,
    };
    const client = new ClaudeAgentSdkGatewayClient(config);

    const result = await client.invoke({ prompt: 'hi', opts: {}, runId: 'r1', agentId: 'a1' });

    expect(queryMock).toHaveBeenCalledTimes(1);
    const [[call]] = queryMock.mock.calls as [[{ options?: { abortController?: AbortController } }]];
    // Forcing red: same gap — the timeoutMs-driven local controller is never handed to the SDK
    // either, so a timed-out call resolves the local race but never actually cancels the real session.
    expect(call.options?.abortController).toBeInstanceOf(AbortController);
    expect(call.options?.abortController?.signal.aborted).toBe(true);
    expect(result.ok).toBe(false);
  }, 5000);
});
