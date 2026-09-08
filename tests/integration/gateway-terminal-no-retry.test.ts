// IT-142 (DES-171, ARCH-111, ADR-040, TASK-176, v26, issue #65): once a single attempt classifies
// terminal, `invoke()`'s own retry loop (`if (!last.ok && last.retryable === false) break;`) must
// not run a second attempt — even when a `timeoutMs`+`retries` bound is configured. Today `invoke()`
// retries any non-ok result up to `1 + retries` times regardless of why it failed, so a 401 costs a
// full `timeoutMs × (1+retries)` against a provider that already said no. Written test-first (Gate 5,
// RED): `GatewayResult`'s failure arm carries no `retryable` field yet, so this branch cannot exist.
// Mock policy (integration, real adjacent components): the real ClaudeAgentSdkGatewayClient with an
// injected queryImpl standing in for the one genuinely un-runnable third-party network boundary.
import { describe, it, expect } from 'vitest';

describe('a terminal classification stops the retry loop (IT-142, DES-171)', () => {
  it('a configured timeout+retries bound still invokes queryImpl exactly ONCE for a terminal 401', async () => {
    let calls = 0;
    async function* session() {
      calls += 1;
      yield { type: 'system', subtype: 'api_retry', attempt: 1, max_retries: 10, retry_delay_ms: 100, error_status: 401, error: 'authentication_failed', uuid: 'u1', session_id: 's1' };
      // never yields a result — the session ends without one, same as a real CLI giving up
    }
    const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
    const client = new ClaudeAgentSdkGatewayClient({
      baseUrl: 'http://127.0.0.1:1',
      queryImpl: (() => session()) as never,
      timeoutMs: 5000,
      retries: 3,
    });
    const result = await client.invoke({ prompt: 'hi', opts: {}, runId: 'r1', agentId: 'a1' });
    expect((result as any).ok).toBe(false);
    expect((result as any).retryable).toBe(false);
    expect(calls).toBe(1);
  });

  it('a RETRYABLE first-attempt failure (no retryable:false) still retries up to the configured bound', async () => {
    let calls = 0;
    async function* session() {
      calls += 1;
      // no message at all — session ends immediately -> reason:'unreachable', no retryable field set
    }
    const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
    const client = new ClaudeAgentSdkGatewayClient({
      baseUrl: 'http://127.0.0.1:1',
      queryImpl: (() => session()) as never,
      timeoutMs: 5000,
      retries: 2,
    });
    await client.invoke({ prompt: 'hi', opts: {}, runId: 'r1', agentId: 'a1' });
    expect(calls).toBe(3); // 1 + 2 retries — unchanged legacy behavior for a non-terminal failure
  });
});
