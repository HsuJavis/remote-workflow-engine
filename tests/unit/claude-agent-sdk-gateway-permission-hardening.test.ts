// UT-039: ClaudeAgentSdkGatewayClient must NOT construct the SDK session with
// permissionMode:'bypassPermissions' (binding D-V2G8-1(a)), and its DEFAULT tool surface is the
// confined file+search+shell set Read/Write/Edit/Glob/Grep/Bash (D-V3M-3, user directive 2026-07-11,
// dynamic-workflow-compat §5 parity).
//
// History: D-V2G8-1(b) (Gate 8 v2 review, adversarial.md V3 HIGH) originally EXCLUDED Bash from the
// default because at that time there was no fs jail — a Bash default + bypassPermissions would drive
// a fully-privileged shell anywhere in the parent trust zone. Both halves have since changed:
// permissionMode is 'default' (not bypass), and D-V2G8-1(d)'s realpath workspace boundary now jails
// every call (canUseTool + PreToolUse on a Bash command's own blockedPath / a file_path) with cwd
// re-scoped to the run workspace. With the jail in place the user re-enabled Bash-in-default,
// confined to the workspace — this test now pins the confined default set (Bash INCLUDED) and that
// web-egress/sub-agent tools stay opt-in; the escape-is-denied half is pinned in the
// workspace-boundary test.
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

  it('the DEFAULT tool surface (no per-call allowedTools, no configured defaultAllowedTools) is the confined file+search+shell set — Bash INCLUDED but workspace-jailed', async () => {
    // D-V3M-3 (user directive 2026-07-11, supersedes D-V2G8-1(b)'s Bash-from-default exclusion):
    // the default now carries Read/Write/Edit/Glob/Grep/Bash so an unspecified agent() has the real
    // dynamic-workflow working surface. Bash-in-default is safe ONLY because the fs jail that was
    // missing when D-V2G8-1(b) was written now exists: D-V2G8-1(d)'s realpath workspace boundary is
    // enforced for every call (canUseTool + PreToolUse, a Bash command's own blockedPath) with cwd
    // re-scoped to the run workspace — the escape is DENIED (asserted in the workspace-boundary
    // test). Web egress / sub-agent tools stay OUT of the default.
    const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
    const client = new ClaudeAgentSdkGatewayClient({ baseUrl: 'http://127.0.0.1:4321' });

    await client.invoke(req({}));

    const [[call]] = queryMock.mock.calls as [[{ options?: { allowedTools?: string[]; tools?: string[] } }]];
    const expected = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'];
    expect(call.options?.allowedTools).toEqual(expected);
    expect(call.options?.tools).toEqual(expected);
    // Web egress + sub-agent spawning remain opt-in (workspace-confinement / orchestration-model reasons).
    for (const excluded of ['WebFetch', 'WebSearch', 'Task', 'Agent']) {
      expect(call.options?.allowedTools ?? []).not.toContain(excluded);
    }
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
