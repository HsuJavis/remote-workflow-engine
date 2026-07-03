// UT-026: the spawned CLI subprocess's env is an explicit ALLOWLIST (PATH/HOME/necessary keys +
// overridden ANTHROPIC_* only), never the full host process.env (Gate 8 review D-G8-5,
// adversarial.md finding V5, MEDIUM security — D-R2 hermeticity).
//
// Bug (review evidence, src/gateway/claude-agent-sdk-client.ts:129-133):
//   env: { ...process.env, ANTHROPIC_BASE_URL: this._config.baseUrl, ANTHROPIC_API_KEY: DUMMY_API_KEY }
// Only `ANTHROPIC_API_KEY` is actually overridden; every OTHER host variable (OPENAI_API_KEY,
// GEMINI_API_KEY, cloud credentials, tokens, ...) is spread verbatim into the spawned `claude` CLI
// subprocess — contradicting the file's own header comment ("this class never reads or forwards a
// real host credential", D-R2), true only for ANTHROPIC_API_KEY.
//
// Unit tier (DES-015): mocks the third-party SDK module itself via vi.mock (same seam UT-018
// already uses) — everything else (the real ClaudeAgentSdkGatewayClient under test) is real.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AgentOpts } from '../../src/types.js';

const queryMock = vi.fn();
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: queryMock }));

function fakeSession(resultText: string) {
  return (async function* () {
    yield {
      type: 'result',
      subtype: 'success',
      result: resultText,
      usage: { input_tokens: 1, output_tokens: 1 },
    };
  })();
}

function req(opts: AgentOpts = {}) {
  return { prompt: 'ping', opts, runId: 'run-1', agentId: 'agent-1' };
}

describe('ClaudeAgentSdkGatewayClient: spawned CLI subprocess env is an explicit allowlist (UT-026, D-G8-5)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    queryMock.mockReset();
    queryMock.mockReturnValue(fakeSession('pong'));
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('never forwards arbitrary host env vars (e.g. OPENAI_API_KEY, an unrelated host secret) to the spawned session', async () => {
    process.env['OPENAI_API_KEY'] = 'sk-should-not-leak';
    process.env['GEMINI_API_KEY'] = 'gem-should-not-leak-either';
    process.env['SOME_UNRELATED_HOST_SECRET'] = 'leaked-value';

    const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
    const client = new ClaudeAgentSdkGatewayClient({ baseUrl: 'http://127.0.0.1:4000' });

    const result = await client.invoke(req());
    expect(result.ok).toBe(true);

    expect(queryMock).toHaveBeenCalledTimes(1);
    const [[call]] = queryMock.mock.calls as [[{ options?: { env?: Record<string, string> } }]];
    const env = call.options?.env ?? {};

    // Forcing red today: the current implementation spreads the ENTIRE process.env, so every one
    // of these host variables (set above, present in process.env at call time) leaks straight
    // through into the spawned subprocess's own env.
    expect(env['OPENAI_API_KEY']).toBeUndefined();
    expect(env['GEMINI_API_KEY']).toBeUndefined();
    expect(env['SOME_UNRELATED_HOST_SECRET']).toBeUndefined();
  });

  it('still forwards the necessary allowlisted keys (PATH, HOME, the overridden ANTHROPIC_*)', async () => {
    const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
    const client = new ClaudeAgentSdkGatewayClient({ baseUrl: 'http://127.0.0.1:4321' });

    await client.invoke(req());

    const [[call]] = queryMock.mock.calls as [[{ options?: { env?: Record<string, string> } }]];
    const env = call.options?.env ?? {};

    expect(env['ANTHROPIC_BASE_URL']).toBe('http://127.0.0.1:4321');
    expect(env['ANTHROPIC_API_KEY']).toBeTruthy();
    expect(env['ANTHROPIC_API_KEY']).not.toBe(process.env['ANTHROPIC_API_KEY']); // D-R2: never the real host credential
    if (process.env['PATH'] !== undefined) expect(env['PATH']).toBe(process.env['PATH']);
    if (process.env['HOME'] !== undefined) expect(env['HOME']).toBe(process.env['HOME']);
  });
});
