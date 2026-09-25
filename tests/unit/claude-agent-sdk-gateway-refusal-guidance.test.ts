// Issue #77: a Write-only agent tried 25 absolute paths and gave up — the SDK's own Write
// description says the path "must be absolute", and the refusal was only
// `path outside run workspace: <path>`, which never said where the workspace IS or that a relative
// path (e.g. `proof/write.txt`) resolves inside it and works. The refusal now says both, through
// BOTH seams that carry it (canUseTool and the PreToolUse hook share `toolUsePreCheck`).
//
// Disclosure check: the workspace root is not new information to the agent (its cwd IS the root,
// and a successful Write's own tool_result already echoes the absolute path it wrote into the run's
// transcript). The refusal scopes its claim to the file tools' path arguments — it must not read as
// a filesystem sandbox, which is posture-dependent for Bash (v37, bash-confinement.ts).
//
// Mock policy (unit, DES-015): vi.mock intercepts only @anthropic-ai/claude-agent-sdk.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentOpts } from '../../src/types.js';

const queryMock = vi.fn();
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: queryMock }));

function okSession(): AsyncGenerator<unknown> {
  return (async function* () {
    yield { type: 'result', subtype: 'success', is_error: false, result: 'ok', usage: { input_tokens: 1, output_tokens: 1 } };
  })();
}

type CanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  options: { signal: AbortSignal; toolUseID: string; requestId: string; blockedPath?: string },
) => Promise<{ behavior: 'allow' | 'deny'; message?: string } | null>;
type Hook = (input: Record<string, unknown>) => Promise<{ hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string } }>;

const WORKSPACE = '/tmp/remote-workflow-runs/_adhoc/run-a';

async function capture(): Promise<{ canUseTool: CanUseTool; hook: Hook }> {
  const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
  const client = new ClaudeAgentSdkGatewayClient({ baseUrl: 'http://127.0.0.1:4000' });
  const opts: AgentOpts = { allowedTools: ['Write'] };
  await client.invoke({ prompt: 'ping', opts, runId: 'run-1', agentId: 'agent-1', workspace: WORKSPACE });
  const [[call]] = queryMock.mock.calls as [[{ options: { canUseTool: CanUseTool; hooks: { PreToolUse: Array<{ hooks: Hook[] }> } } }]];
  return { canUseTool: call.options.canUseTool, hook: call.options.hooks.PreToolUse[0]!.hooks[0]! };
}

function expectGuidance(message: string | undefined): void {
  expect(message).toContain('path outside run workspace: /home/elsewhere/proof/write.txt');
  expect(message).toContain(WORKSPACE);
  expect(message).toMatch(/relative path/i);
  expect(message).not.toMatch(/sandbox/i);
}

describe('#77 — the file-tool path refusal tells the agent how to succeed', () => {
  beforeEach(() => {
    queryMock.mockReset();
    queryMock.mockReturnValue(okSession());
  });

  it('canUseTool: a Write to an absolute path outside is denied with the workspace root and the relative-path rule', async () => {
    const { canUseTool } = await capture();
    const r = await canUseTool('Write', { file_path: '/home/elsewhere/proof/write.txt', content: 'x' }, { signal: new AbortController().signal, toolUseID: 't', requestId: 'r' });
    expect(r?.behavior).toBe('deny');
    expectGuidance(r?.message);
  });

  it('PreToolUse hook: the same reason reaches the model through the hook seam', async () => {
    const { hook } = await capture();
    const out = await hook({ hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: '/home/elsewhere/proof/write.txt', content: 'x' } });
    expect(out.hookSpecificOutput?.permissionDecision).toBe('deny');
    expectGuidance(out.hookSpecificOutput?.permissionDecisionReason);
  });

  it('the relative path the refusal recommends is in fact allowed', async () => {
    const { canUseTool } = await capture();
    const r = await canUseTool('Write', { file_path: 'proof/write.txt', content: 'x' }, { signal: new AbortController().signal, toolUseID: 't', requestId: 'r' });
    expect(r?.behavior).toBe('allow');
  });
});
