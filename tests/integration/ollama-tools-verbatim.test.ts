// IT-144 (DES-173, ARCH-112, TASK-174, v26, issue #66): the load-bearing paired behavioural
// assertion for deleting `curateToolsForProvider` — REQ-123's own named acceptance, over a plain
// `ollama/qwen2.5:7b` full ref (2026-09-26: no alias table any more). An ollama-routed `agent()` call
// must reach the session with the caller's `allowedTools` UNCHANGED: no `Read` removed, no `Bash`
// force-added. Written test-first (Gate 5, RED): today `curateToolsForProvider` strips `Read` for
// any non-anthropic provider (`NON_ANTHROPIC_EXCLUDED_TOOLS = new Set(['Read'])`,
// claude-agent-sdk-client.ts) — an ollama call with `allowedTools:['Read','Bash']` reaches the
// session with only `['Bash']`.
// Mock policy (integration, real adjacent components): the real ClaudeAgentSdkGatewayClient with an
// injected queryImpl standing in for the SDK subprocess (the one genuinely un-runnable third-party
// boundary at this tier).
import { describe, it, expect } from 'vitest';

describe('ollama preserves the caller allowedTools verbatim (IT-144, DES-173, REQ-123)', () => {
  it('Read stays present and nothing is added for an ollama-routed call', async () => {
    let captured: string[] | undefined;
    async function* session() {
      yield { type: 'result', subtype: 'success', is_error: false, result: 'ok', usage: { input_tokens: 1, output_tokens: 1 } };
    }
    const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
    const client = new ClaudeAgentSdkGatewayClient({
      baseUrl: 'http://127.0.0.1:1',
      queryImpl: ((req: { options: { allowedTools?: string[] } }) => { captured = req.options.allowedTools; return session(); }) as never,
    });
    await client.invoke({ prompt: 'hi', opts: { model: 'ollama/qwen2.5:7b', allowedTools: ['Read', 'Bash'] }, runId: 'r1', agentId: 'a1' });
    expect(captured).toEqual(['Read', 'Bash']);
  });
});
