// issue #53 (root cause A): an externally-aborted agent call must never be retried.
//
// Reproduced on the real engine 10/10: on run_suspend/run_stop a SECOND attempt started 1–4 ms after
// the abort, ran a full model generation outside accounting and outlived the run. The retry loops in
// BOTH gateways only broke on `retryable === false`, and an external abort surfaced as a plain
// `reason:'timeout'` — so the loop dispatched attempt 2 against a signal that was already aborted
// (whose `abort` listener therefore never fires again).
//
// Criteria: once the request's signal is aborted, no further attempt may start in either gateway; an
// attempt that begins with an already-aborted signal dispatches nothing. A genuine timeout still
// retries (UT-021 / claude-agent-sdk-gateway-timeout.test.ts stays the witness for that).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ClaudeAgentSdkGatewayClient } from '../../src/gateway/claude-agent-sdk-client.js';
import { LiteLLMGatewayClient, type AliasMap } from '../../src/gateway/client.js';

/** A session that hangs until the SDK's own abortController fires, then ends WITHOUT a result —
 *  and settles only AFTER the abort (the repro's shape: the attempt resolves after the external
 *  abort, and the loop decides what to do next). */
function sessionUntilAborted(options: { abortController?: AbortController }): AsyncGenerator<unknown> {
  return (async function* () {
    await new Promise<void>((resolve) => {
      const s = options.abortController?.signal;
      if (!s) return;
      if (s.aborted) resolve();
      else s.addEventListener('abort', () => resolve(), { once: true });
    });
  })();
}

describe('ClaudeAgentSdkGatewayClient — no retry after an external abort (#53)', () => {
  it('an attempt aborted by the caller is not followed by a second attempt', async () => {
    let calls = 0;
    let firstStarted!: () => void;
    const started = new Promise<void>((r) => { firstStarted = r; });
    const client = new ClaudeAgentSdkGatewayClient({
      baseUrl: 'http://127.0.0.1:1',
      // A genuine timeout (300ms) would retry twice more — the abort must not. Short so that, on the
      // unfixed code, the extra attempts time out and the COUNT assertion is what fails (not a hang).
      timeoutMs: 300,
      retries: 2,
      queryImpl: ((args: { options: { abortController?: AbortController } }) => {
        calls += 1;
        firstStarted();
        return sessionUntilAborted(args.options);
      }) as never,
    });
    const ac = new AbortController();
    const p = client.invoke({ prompt: 'hi', opts: {}, runId: 'r1', agentId: 'a1', signal: ac.signal });
    await started;
    ac.abort();
    const result = await p;
    expect(result.ok).toBe(false);
    expect(calls).toBe(1);
  }, 10000);

  it('an attempt that starts with an already-aborted signal dispatches nothing', async () => {
    let calls = 0;
    let harnessCalls = 0;
    const client = new ClaudeAgentSdkGatewayClient({
      baseUrl: 'http://127.0.0.1:1',
      timeoutMs: 300,
      retries: 2,
      queryImpl: ((args: { options: { abortController?: AbortController } }) => { calls += 1; return sessionUntilAborted(args.options); }) as never,
    });
    const ac = new AbortController();
    ac.abort();
    const result = await client.invoke({
      prompt: 'hi', opts: {}, runId: 'r1', agentId: 'a1', signal: ac.signal,
      onHarness: async () => { harnessCalls += 1; },
    });
    expect(result.ok).toBe(false);
    expect(calls).toBe(0);
    expect(harnessCalls).toBe(0);
  }, 10000);

  it('an abort that lands while the session is being built (before query) dispatches nothing', async () => {
    let calls = 0;
    const client = new ClaudeAgentSdkGatewayClient({
      baseUrl: 'http://127.0.0.1:1',
      timeoutMs: 300,
      retries: 2,
      queryImpl: ((args: { options: { abortController?: AbortController } }) => { calls += 1; return sessionUntilAborted(args.options); }) as never,
    });
    const ac = new AbortController();
    const result = await client.invoke({
      prompt: 'hi', opts: {}, runId: 'r1', agentId: 'a1', signal: ac.signal,
      // The await between listener-attach and query(): the run is suspended right here.
      onHarness: async () => { ac.abort(); },
    });
    expect(result.ok).toBe(false);
    expect(calls).toBe(0);
  }, 10000);
});

describe('LiteLLMGatewayClient — no retry after an external abort (#53)', () => {
  const ORIGINAL_KEY = process.env['ANTHROPIC_API_KEY'];
  beforeEach(() => { process.env['ANTHROPIC_API_KEY'] = 'fake-unit-test-key'; });
  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env['ANTHROPIC_API_KEY'];
    else process.env['ANTHROPIC_API_KEY'] = ORIGINAL_KEY;
  });
  const aliases: AliasMap = { default: { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' } };

  /** Hangs until the request's own signal aborts, then rejects AbortError — a real fetch's shape. */
  function hangingFetch(onCall: () => void): typeof fetch {
    return ((_url: string, init: { signal: AbortSignal }) => {
      onCall();
      return new Promise((_resolve, reject) => {
        const fail = () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); };
        if (init.signal.aborted) fail();
        else init.signal.addEventListener('abort', fail, { once: true });
      });
    }) as unknown as typeof fetch;
  }

  it('an attempt aborted by the caller is not followed by a second attempt', async () => {
    let calls = 0;
    let firstStarted!: () => void;
    const started = new Promise<void>((r) => { firstStarted = r; });
    const gw = new LiteLLMGatewayClient({ aliases, timeoutMs: 300, retries: 2, fetchImpl: hangingFetch(() => { calls += 1; firstStarted(); }) });
    const ac = new AbortController();
    const p = gw.invoke({ prompt: 'hi', opts: {}, runId: 'r1', agentId: 'a1', signal: ac.signal });
    await started;
    ac.abort();
    const result = await p;
    expect(result.ok).toBe(false);
    expect(calls).toBe(1);
  }, 10000);

  it('an attempt that starts with an already-aborted signal dispatches nothing', async () => {
    let calls = 0;
    const gw = new LiteLLMGatewayClient({ aliases, timeoutMs: 300, retries: 2, fetchImpl: hangingFetch(() => { calls += 1; }) });
    const ac = new AbortController();
    ac.abort();
    const result = await gw.invoke({ prompt: 'hi', opts: {}, runId: 'r1', agentId: 'a1', signal: ac.signal });
    expect(result.ok).toBe(false);
    expect(calls).toBe(0);
  }, 10000);
});
