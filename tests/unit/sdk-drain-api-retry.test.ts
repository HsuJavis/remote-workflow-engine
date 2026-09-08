// UT-177 (DES-171, ARCH-111, ADR-040, TASK-176, v26, issue #65): `_drain` reads `system/api_retry`
// messages — a RETRY classification streams a scalar event and lets the CLI's own backoff continue;
// a TERMINAL classification ends the attempt immediately with `retryable:false`, instead of waiting
// out `timeoutMs × (1+retries)` on a provider that already said no. Also: the AbortController is
// created UNCONDITIONALLY (even with no configured timeout) and is always aborted once the race
// settles. Written test-first (Gate 5, RED): today `system` messages fall into the `msg.type !==
// 'result'` branch, `extractEvents` returns [] for a system message (no `message.content` array), so
// the loop silently drops api_retry and keeps waiting for a `result` that never comes — the session
// either exhausts the CLI's own retries or the test-level timeout, never settling in ~1s.
// Mock policy (unit): the already-existing injected queryImpl seam stands in for a real SDK session.
import { describe, it, expect } from 'vitest';
import type { ClaudeAgentSdkGatewayConfig } from '../../src/gateway/claude-agent-sdk-client.js';

function apiRetryMsg(status: number | null, attempt: number) {
  return {
    type: 'system', subtype: 'api_retry', attempt, max_retries: 10, retry_delay_ms: 500,
    error_status: status, error: 'authentication_failed', uuid: `u${attempt}`, session_id: 's1',
  };
}
function resultMsg(usage = { input_tokens: 3, output_tokens: 5 }) {
  return { type: 'result', subtype: 'success', is_error: false, result: 'ok', usage };
}

describe('_drain reads system/api_retry via invoke() (UT-177, DES-171)', () => {
  it('three 401 api_retry messages, never a result: terminal within 1s of wall time, retryable:false, one error event, non-empty detail', async () => {
    async function* session() {
      yield apiRetryMsg(401, 1);
      yield apiRetryMsg(401, 2);
      yield apiRetryMsg(401, 3);
      // never yields a result — models the CLI giving up on a terminal auth failure
    }
    const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
    const client = new ClaudeAgentSdkGatewayClient({ baseUrl: 'http://127.0.0.1:1', queryImpl: (() => session()) as never });

    const start = Date.now();
    const result = await Promise.race([
      client.invoke({ prompt: 'hi', opts: {}, runId: 'r1', agentId: 'a1' }),
      new Promise((resolve) => setTimeout(() => resolve({ TIMED_OUT: true }), 3000)),
    ]);
    const elapsed = Date.now() - start;

    expect(result).not.toEqual({ TIMED_OUT: true });
    expect(elapsed).toBeLessThan(1000);
    const r = result as any;
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('terminal');
    expect(r.retryable).toBe(false);
    expect(typeof r.detail).toBe('string');
    expect(r.detail.length).toBeGreaterThan(0);
    expect((r.events ?? []).filter((e: any) => e.data?.type === 'error')).toHaveLength(1);
  });

  it('with an onEvent sink, the sink sees exactly one event and the returned events array is empty (no duplicate)', async () => {
    async function* session() {
      yield apiRetryMsg(401, 1);
    }
    const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
    const client = new ClaudeAgentSdkGatewayClient({ baseUrl: 'http://127.0.0.1:1', queryImpl: (() => session()) as never });
    const seen: unknown[] = [];
    const result = await client.invoke({ prompt: 'hi', opts: {}, runId: 'r1', agentId: 'a1', onEvent: (ev) => { seen.push(ev); } });
    expect(seen).toHaveLength(1);
    expect((result as any).events ?? []).toHaveLength(0);
  });

  it('a retryable api_retry(503) followed by a success result yields ok:true with one retry event', async () => {
    async function* session() {
      yield { type: 'system', subtype: 'api_retry', attempt: 1, max_retries: 10, retry_delay_ms: 100, error_status: 503, error: 'overloaded', uuid: 'u1', session_id: 's1' };
      yield resultMsg();
    }
    const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
    const client = new ClaudeAgentSdkGatewayClient({ baseUrl: 'http://127.0.0.1:1', queryImpl: (() => session()) as never });
    const result = await client.invoke({ prompt: 'hi', opts: {}, runId: 'r1', agentId: 'a1' });
    expect((result as any).ok).toBe(true);
  });

  it('the AbortController is created even with NO timeout configured, and is aborted once the call settles', async () => {
    let capturedOptions: any;
    async function* session() {
      yield resultMsg();
    }
    const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
    const client = new ClaudeAgentSdkGatewayClient({
      baseUrl: 'http://127.0.0.1:1',
      queryImpl: ((req: { options: unknown }) => { capturedOptions = req.options; return session(); }) as never,
    });
    await client.invoke({ prompt: 'hi', opts: {}, runId: 'r1', agentId: 'a1' });
    expect(capturedOptions?.abortController).toBeInstanceOf(AbortController);
    expect(capturedOptions.abortController.signal.aborted).toBe(true);
  });

  it('a healthy run with no unmapped system message yields unmappedMessages: {} on the result', async () => {
    async function* session() {
      yield resultMsg();
    }
    const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
    const client = new ClaudeAgentSdkGatewayClient({ baseUrl: 'http://127.0.0.1:1', queryImpl: (() => session()) as never });
    const result = await client.invoke({ prompt: 'hi', opts: {}, runId: 'r1', agentId: 'a1' });
    expect((result as any).unmapped ?? []).toEqual([]);
  });

  it('an injected unknown system subtype is counted, never stored as a payload', async () => {
    async function* session() {
      yield { type: 'system', subtype: 'a-future-sdk-subtype-nobody-mapped-yet', uuid: 'u1', session_id: 's1', secretLookingField: 'sk-should-not-appear' };
      yield resultMsg();
    }
    const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
    const client = new ClaudeAgentSdkGatewayClient({ baseUrl: 'http://127.0.0.1:1', queryImpl: (() => session()) as never });
    const result = await client.invoke({ prompt: 'hi', opts: {}, runId: 'r1', agentId: 'a1' });
    const unmapped = (result as any).unmapped ?? [];
    expect(unmapped).toContain('a-future-sdk-subtype-nobody-mapped-yet');
    expect(JSON.stringify(result)).not.toContain('secretLookingField');
  });
});
