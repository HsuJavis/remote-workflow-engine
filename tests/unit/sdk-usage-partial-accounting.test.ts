// issue #127: today every token spent on a call that never reaches a successful `result` message is
// dropped — `_drain` (claude-agent-sdk-client.ts) only ever reads `result.usage`, so an abort
// (run_suspend/run_stop), a timeout, or a terminal failure with no `result` message at all records
// `tokens:undefined` and the budget/cost ledger never sees the real spend. This pins the gateway-level
// fix: `_drain` accumulates usage from every streamed `SDKAssistantMessage`'s own `message.usage`,
// deduped by `message.id` (max per id, never summed twice for the same id), and surfaces it:
//  - on an abort/timeout/no-result failure: the deduped sum, `partial:true` (a lower bound) — and
//    live, via `onUsage`, even before the call settles (the executor may abandon this Promise on abort).
//  - on a non-success `result` message (e.g. `error_max_turns`): that message's OWN `usage` wins —
//    it is the provider's finalized total for the attempt, not an estimate — no `partial` flag.
//  - across `invoke()`'s retry loop: a failed attempt's tokens carry forward and sum into whatever the
//    next attempt reports (success or failure alike), `partial` propagating if any contributor was one.
//
// Mock policy (unit, DES-015): the existing injected `queryImpl` seam stands in for a real SDK
// session — no real process/network involved.
import { describe, it, expect } from 'vitest';
import { ClaudeAgentSdkGatewayClient } from '../../src/gateway/claude-agent-sdk-client.js';
import type { Tokens } from '../../src/types.js';

function usage(input: number, output: number, cacheRead = 0, cacheWrite = 0) {
  return { input_tokens: input, output_tokens: output, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: cacheWrite };
}

function assistantMsg(id: string, u: ReturnType<typeof usage>) {
  return { type: 'assistant', message: { id, usage: u, content: [{ type: 'text', text: 'x' }] }, parent_tool_use_id: null, uuid: id, session_id: 's1' };
}

/** Yields the given assistant frames, then hangs until the session's own AbortController fires —
 *  models a call cut short mid-stream (an external abort, or the gateway's own timeoutMs firing). */
function sessionThenHang(frames: unknown[], options: { abortController?: AbortController }): AsyncGenerator<unknown> {
  return (async function* () {
    for (const f of frames) yield f;
    await new Promise<void>((resolve) => {
      const s = options.abortController?.signal;
      if (!s) return;
      if (s.aborted) resolve();
      else s.addEventListener('abort', () => resolve(), { once: true });
    });
  })();
}

describe('issue #127: partial usage accounting in ClaudeAgentSdkGatewayClient', () => {
  it('abort mid-call after N assistant messages records the deduped sum, marked partial', async () => {
    const client = new ClaudeAgentSdkGatewayClient({
      baseUrl: 'http://127.0.0.1:1',
      queryImpl: ((args: { options: { abortController?: AbortController } }) =>
        sessionThenHang(
          [assistantMsg('msg_1', usage(10, 5)), assistantMsg('msg_2', usage(8, 6))],
          args.options,
        )) as never,
    });
    const ac = new AbortController();
    const live: Tokens[] = [];
    const p = client.invoke({ prompt: 'hi', opts: {}, runId: 'r1', agentId: 'a1', signal: ac.signal, onUsage: (t) => live.push(t) });
    await new Promise((r) => setTimeout(r, 30));
    ac.abort();
    const result = await p;
    expect(result.ok).toBe(false);
    expect((result as { tokens?: unknown }).tokens).toEqual({ input: 18, output: 11, cacheRead: 0, cacheWrite: 0 });
    expect((result as { partial?: unknown }).partial).toBe(true);
    // the live callback already carried the final cumulative sum before the Promise itself settled —
    // a caller that abandons `p` on abort (AgentExecutor's own race) still saw it.
    expect(live.length).toBeGreaterThan(0);
    expect(live[live.length - 1]).toEqual({ input: 18, output: 11, cacheRead: 0, cacheWrite: 0 });
  }, 10000);

  it('a genuine timeout with partial streamed usage records the same deduped sum, marked partial', async () => {
    const client = new ClaudeAgentSdkGatewayClient({
      baseUrl: 'http://127.0.0.1:1',
      timeoutMs: 150,
      retries: 0,
      queryImpl: ((args: { options: { abortController?: AbortController } }) =>
        sessionThenHang([assistantMsg('msg_1', usage(12, 4))], args.options)) as never,
    });
    const result = await client.invoke({ prompt: 'hi', opts: {}, runId: 'r1', agentId: 'a1' });
    expect(result.ok).toBe(false);
    expect((result as { reason?: string }).reason).toBe('timeout');
    expect((result as { tokens?: unknown }).tokens).toEqual({ input: 12, output: 4, cacheRead: 0, cacheWrite: 0 });
    expect((result as { partial?: unknown }).partial).toBe(true);
  }, 10000);

  it("a non-success result message's own usage wins over the per-turn accumulated sum (not partial)", async () => {
    async function* session() {
      yield assistantMsg('msg_1', usage(999, 999));
      yield {
        type: 'result', subtype: 'error_max_turns', is_error: true, num_turns: 5,
        errors: ['ran out of turns'], usage: usage(50, 20, 1, 2), modelUsage: {},
      };
    }
    const client = new ClaudeAgentSdkGatewayClient({ baseUrl: 'http://127.0.0.1:1', queryImpl: (() => session()) as never });
    const result = await client.invoke({ prompt: 'hi', opts: {}, runId: 'r1', agentId: 'a1' });
    expect(result.ok).toBe(false);
    expect((result as { tokens?: unknown }).tokens).toEqual({ input: 50, output: 20, cacheRead: 1, cacheWrite: 2 });
    expect((result as { partial?: unknown }).partial).toBeUndefined();
  });

  it('two frames sharing the same message.id are deduped (kept once, by max) — not summed twice', async () => {
    const client = new ClaudeAgentSdkGatewayClient({
      baseUrl: 'http://127.0.0.1:1',
      queryImpl: ((args: { options: { abortController?: AbortController } }) =>
        sessionThenHang(
          [assistantMsg('msg_1', usage(10, 5)), assistantMsg('msg_1', usage(10, 8))],
          args.options,
        )) as never,
    });
    const ac = new AbortController();
    const p = client.invoke({ prompt: 'hi', opts: {}, runId: 'r1', agentId: 'a1', signal: ac.signal });
    await new Promise((r) => setTimeout(r, 30));
    ac.abort();
    const result = await p;
    expect((result as { tokens?: unknown }).tokens).toEqual({ input: 10, output: 8, cacheRead: 0, cacheWrite: 0 });
  }, 10000);

  it('retry: attempt 1 fails with partial usage, attempt 2 succeeds — total sums both, marked partial', async () => {
    let call = 0;
    const queryImpl = ((args: { options: { abortController?: AbortController } }) => {
      call += 1;
      if (call === 1) return sessionThenHang([assistantMsg('msg_a1', usage(10, 4))], args.options);
      return (async function* () {
        yield { type: 'result', subtype: 'success', is_error: false, result: 'ok', usage: usage(20, 9) };
      })();
    }) as never;
    const client = new ClaudeAgentSdkGatewayClient({ baseUrl: 'http://127.0.0.1:1', queryImpl, timeoutMs: 150, retries: 1 });
    const result = await client.invoke({ prompt: 'hi', opts: {}, runId: 'r1', agentId: 'a1' });
    expect(result.ok).toBe(true);
    expect((result as { tokens?: unknown }).tokens).toEqual({ input: 30, output: 13, cacheRead: 0, cacheWrite: 0 });
    expect((result as { partial?: unknown }).partial).toBe(true);
    expect(call).toBe(2);
  }, 10000);

  it('a healthy single-attempt call never gains a tokens/partial field from this change', async () => {
    async function* session() {
      yield { type: 'result', subtype: 'success', is_error: false, result: 'ok', usage: usage(3, 2) };
    }
    const client = new ClaudeAgentSdkGatewayClient({ baseUrl: 'http://127.0.0.1:1', queryImpl: (() => session()) as never });
    const result = await client.invoke({ prompt: 'hi', opts: {}, runId: 'r1', agentId: 'a1' });
    expect(result.ok).toBe(true);
    expect((result as { partial?: unknown }).partial).toBeUndefined();
  });
});
