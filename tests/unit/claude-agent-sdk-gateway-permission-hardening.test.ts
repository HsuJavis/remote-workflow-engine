// UT-039: ClaudeAgentSdkGatewayClient must NOT construct the SDK session with
// permissionMode:'bypassPermissions', and its DEFAULT tool surface (no per-call opts.allowedTools,
// no configured defaultAllowedTools — i.e. no agentType opted in) must exclude 'Bash' (Gate 8 v2
// review, adversarial.md finding V3 HIGH; binding D-V2G8-1(a)(b)).
//
// Bug (review evidence, src/gateway/claude-agent-sdk-client.ts:222): `permissionMode:
// 'bypassPermissions'` is hard-coded on every call — headless never-block tool approval, but paired
// with a Bash-capable default tool set and no fs jail this lets ANY agent() call drive a
// fully-privileged shell in the parent trust zone (ARCH-007's confinement INV, ARCH-005's key-custody
// claim). `BUILT_IN_CORE_TOOLS = ['Read','Write','Bash']` (:115) includes 'Bash' unconditionally in
// the fallback default, with no agentType-opt-in gate at all.
//
// Mock policy (DES-015, unit tier): vi.mock intercepts only the third-party
// @anthropic-ai/claude-agent-sdk module (same seam UT-018/024/026 already use) — everything else
// (the real ClaudeAgentSdkGatewayClient under test) is real.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentOpts } from '../../src/types.js';
import type { ClaudeAgentSdkGatewayConfig } from '../../src/gateway/claude-agent-sdk-client.js';

const queryMock = vi.fn();
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: queryMock }));

function okSession(): AsyncGenerator<unknown> {
  return (async function* () {
    yield {
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'ok',
      usage: { input_tokens: 1, output_tokens: 1 },
    };
  })();
}

function req(opts: AgentOpts = {}) {
  return { prompt: 'ping', opts, runId: 'run-1', agentId: 'agent-1' };
}

describe('ClaudeAgentSdkGatewayClient: permission/tool-surface hardening (UT-039, D-V2G8-1a/b)', () => {
  beforeEach(() => {
    queryMock.mockReset();
    queryMock.mockReturnValue(okSession());
  });

  it('never constructs the session with permissionMode: bypassPermissions', async () => {
    const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
    const client = new ClaudeAgentSdkGatewayClient({ baseUrl: 'http://127.0.0.1:4000' });

    await client.invoke(req());

    expect(queryMock).toHaveBeenCalledTimes(1);
    const [[call]] = queryMock.mock.calls as [[{ options?: { permissionMode?: string } }]];
    // Forcing red today: the current implementation hard-codes 'bypassPermissions' unconditionally.
    expect(call.options?.permissionMode).not.toBe('bypassPermissions');
  });

  it('the DEFAULT tool surface (no per-call allowedTools, no configured defaultAllowedTools — no agentType opt-in) excludes Bash', async () => {
    const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
    const client = new ClaudeAgentSdkGatewayClient({ baseUrl: 'http://127.0.0.1:4321' });

    await client.invoke(req({}));

    const [[call]] = queryMock.mock.calls as [[{ options?: { allowedTools?: string[]; tools?: string[] } }]];
    // Forcing red today: BUILT_IN_CORE_TOOLS = ['Read','Write','Bash'] includes Bash unconditionally
    // in both options.allowedTools and options.tools with no opt-in gate.
    expect(call.options?.allowedTools ?? []).not.toContain('Bash');
    expect(call.options?.tools ?? []).not.toContain('Bash');
  });

  it('an agentType that explicitly opts in (curated allowedTools carries Bash) still gets Bash — opt-in path stays available', async () => {
    const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
    const config: ClaudeAgentSdkGatewayConfig = { baseUrl: 'http://127.0.0.1:4322' };
    const client = new ClaudeAgentSdkGatewayClient(config);

    await client.invoke(
      req({
        // @ts-expect-error — allowedTools is a verifier-authored AgentOpts extension (same precedent
        // as UT-024) representing an agentType's own explicit opt-in curation.
        allowedTools: ['Read', 'Write', 'Bash'],
      }),
    );

    const [[call]] = queryMock.mock.calls as [[{ options?: { allowedTools?: string[] } }]];
    expect(call.options?.allowedTools).toContain('Bash');
  });
});
