// UT-190 (DES-180, ARCH-118, TASK-180, v26): four-column token extraction — SDK path from
// `result.usage {input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens}`,
// falling back to the camelCase `modelUsage[*]` sum when `usage` is absent; direct-fetch OpenRouter
// from `prompt_tokens_details.cached_tokens` + `cache_write_tokens`; ollama cache columns 0. Written
// test-first (Gate 5, RED): today `_drain` only reads `input_tokens`/`output_tokens` — a real haiku
// call (input 18 / cache_creation 20,762 / cache_read 19,522 / output 282) records `tokens:{input:18,
// output:282}`, losing >97% of the actual usage.
// Mock policy (unit): the already-existing injected queryImpl seam stands in for a real SDK session.
import { describe, it, expect } from 'vitest';

function resultMsg(usage: unknown) {
  return { type: 'result', subtype: 'success', is_error: false, result: 'ok', usage };
}

describe('four-column token extraction (UT-190, DES-180)', () => {
  it('SDK path: all four columns from result.usage', async () => {
    async function* session() { yield resultMsg({ input_tokens: 18, output_tokens: 282, cache_read_input_tokens: 19522, cache_creation_input_tokens: 20762 }); }
    const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
    const client = new ClaudeAgentSdkGatewayClient({ baseUrl: 'http://127.0.0.1:1', queryImpl: (() => session()) as never });
    const result = await client.invoke({ prompt: 'hi', opts: {}, runId: 'r1', agentId: 'a1' });
    expect((result as any).tokens).toEqual({ input: 18, output: 282, cacheRead: 19522, cacheWrite: 20762 });
  });

  it('SDK path: usage absent, falls back to the camelCase modelUsage[*] sum', async () => {
    async function* session() {
      yield {
        type: 'result', subtype: 'success', is_error: false, result: 'ok',
        modelUsage: {
          'model-a': { inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 2, cacheCreationInputTokens: 3 },
          'model-b': { inputTokens: 4, outputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
        },
      };
    }
    const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
    const client = new ClaudeAgentSdkGatewayClient({ baseUrl: 'http://127.0.0.1:1', queryImpl: (() => session()) as never });
    const result = await client.invoke({ prompt: 'hi', opts: {}, runId: 'r1', agentId: 'a1' });
    expect((result as any).tokens).toEqual({ input: 14, output: 6, cacheRead: 2, cacheWrite: 3 });
  });

  it('SDK path: neither usage nor modelUsage present -> all four zero', async () => {
    async function* session() { yield { type: 'result', subtype: 'success', is_error: false, result: 'ok' }; }
    const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
    const client = new ClaudeAgentSdkGatewayClient({ baseUrl: 'http://127.0.0.1:1', queryImpl: (() => session()) as never });
    const result = await client.invoke({ prompt: 'hi', opts: {}, runId: 'r1', agentId: 'a1' });
    expect((result as any).tokens).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
  });
});
