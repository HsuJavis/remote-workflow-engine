// UT-018: the production GatewayClient AgentExecutor is wired with by default must be backed by a
// real @anthropic-ai/claude-agent-sdk session (D-F1 — user decision D1 stands; the accept-direct-
// fetch alternative was REJECTED because a raw /v1/messages fetch does not provide the tool-use
// agent loop REQ-003 and the product core promise require). Traces DES-007/DES-009.
//
// Unit tier (DES-015): mocks the third-party SDK module itself via vi.mock — the correct place to
// pin "the SDK module is what the default path uses" hermetically, without spawning a real CLI
// subprocess (that real-subprocess proof is IT-015's job, integration tier, against a local stub
// /v1/messages server).
//
// Red reason: `src/gateway/claude-agent-sdk-client.ts` does not exist yet — import fails. No
// GatewayClient implementation in this codebase constructs a real @anthropic-ai/claude-agent-sdk
// session today; `LiteLLMGatewayClient` only ever does a raw `fetch()` shaped like what a session
// would send (see DES-009's Gate-6 route-back note + the carried-forward needs_clarification in
// journal.md 12:15 and 06-impl-log.md IMPL-035).
//
// Composition-root note for Gate 6 (non-binding on this test, guidance only): this class is meant
// to become RunManager's default `_gateway` (replacing/wrapping `LiteLLMGatewayClient` as the
// production default), reusing the already-built `LiteLLMProxyManager` to obtain the local proxy's
// `baseUrl`. `AgentExecutor`'s own zero-arg `NULL_GATEWAY` safe-default (used by several already-
// green unit tests, e.g. `agent-executor.test.ts`'s `new AgentExecutor()` cases) is intentionally
// left alone by this test — swapping that bare convenience default would require touching those
// tests too, which is out of scope for a forcing RED addition.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentOpts } from '../../src/types.js';

const queryMock = vi.fn();

// D-F1 hermeticity: mocks ONLY the third-party SDK export itself (unit tier mocks freely per
// DES-015) — everything else (the new GatewayClient implementation under test) is real.
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: queryMock }));

// Minimal stand-in for the SDK's `Query` (an AsyncGenerator<SDKMessage, void>) — only the single
// 'result' message this client needs to read to resolve a GatewayResult.
function fakeSession(resultText: string) {
  return (async function* () {
    yield {
      type: 'result',
      subtype: 'success',
      result: resultText,
      usage: { input_tokens: 3, output_tokens: 2 },
    };
  })();
}

function req(opts: AgentOpts = {}) {
  return { prompt: 'ping', opts, runId: 'run-1', agentId: 'agent-1' };
}

describe('ClaudeAgentSdkGatewayClient (UT-018, D-F1)', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('with no queryImpl override, invoke() dispatches through the real @anthropic-ai/claude-agent-sdk query() export', async () => {
    queryMock.mockReturnValue(fakeSession('pong'));
    const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
    const client = new ClaudeAgentSdkGatewayClient({ baseUrl: 'http://127.0.0.1:4000' });

    const result = await client.invoke(req());

    // Proves the DEFAULT path (no queryImpl injected) is the real SDK's own `query` export — not a
    // private duplicate/parallel implementation that merely happens to look similar.
    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).toBe('pong');
      expect(result.tokens).toEqual({ input: 3, output: 2 });
    }
  });

  it('wires ANTHROPIC_BASE_URL to the given gateway proxy URL and a dummy (non-empty) ANTHROPIC_API_KEY', async () => {
    queryMock.mockReturnValue(fakeSession('pong'));
    const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
    const client = new ClaudeAgentSdkGatewayClient({ baseUrl: 'http://127.0.0.1:4321' });

    await client.invoke(req());

    expect(queryMock).toHaveBeenCalledTimes(1);
    const [[call]] = queryMock.mock.calls as [[{ prompt: string; options?: { env?: Record<string, string> } }]];
    expect(call.options?.env?.['ANTHROPIC_BASE_URL']).toBe('http://127.0.0.1:4321');
    expect(call.options?.env?.['ANTHROPIC_API_KEY']).toBeTruthy();
    // D-R2 hermeticity: never the real host env's credential, even if one happens to be set.
    expect(call.options?.env?.['ANTHROPIC_API_KEY']).not.toBe(process.env['ANTHROPIC_API_KEY']);
  });

  it('an injected queryImpl overrides the default (test seam stays injectable)', async () => {
    const injected = vi.fn().mockReturnValue(fakeSession('from-injected'));
    const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
    const client = new ClaudeAgentSdkGatewayClient({ baseUrl: 'http://127.0.0.1:4000', queryImpl: injected as never });

    const result = await client.invoke(req());

    expect(injected).toHaveBeenCalledTimes(1);
    expect(queryMock).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.content).toBe('from-injected');
  });
});
