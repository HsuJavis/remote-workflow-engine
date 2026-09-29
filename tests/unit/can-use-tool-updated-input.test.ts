// Issue #105 part B (HIGH bug, npx spike evidence): `makeCanUseTool`'s allow branch returned bare
// `{behavior:'allow'}`, with no `updatedInput` — the SDK's own `PermissionResult` type
// (sdk.d.ts:2053) marks that field OPTIONAL, but the bundled CLI's own permission-response
// validator does not accept it missing: every allow response failed there with
// `ZodError: … expected record, received undefined … path: ["updatedInput"]`, observed live via a
// fake-model stub driving one real MCP tool call (npx-spike/drive.out: `mcp__everything__echo`
// answered "Tool permission request failed: ZodError…" instead of a real tool result). Built-in
// tools (Read/Write/Edit/Glob/Grep/Bash) are bare `allowedTools` entries and are auto-approved
// before `canUseTool` is ever consulted (CLAUDE_SDK_CAN_USE_TOOL_SHADOWED) — so a dynamically
// provisioned MCP tool (workspace_push({kind:'mcp'})) was the ONLY caller that ever reached this
// path, and it failed every time, unconditionally.
//
// Mock policy (unit tier, same as claude-agent-sdk-gateway-workspace-boundary.test.ts): vi.mock
// intercepts only the third-party @anthropic-ai/claude-agent-sdk module — this asserts the exact
// shape of what `options.canUseTool` returns, not a real spawned CLI subprocess (that end-to-end
// proof is the real-tier companion, tests/integration/mcp-tool-permission-shape.test.ts).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentOpts } from '../../src/types.js';

const queryMock = vi.fn();
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: queryMock }));

function okSession(): AsyncGenerator<unknown> {
  return (async function* () {
    yield { type: 'result', subtype: 'success', is_error: false, result: 'ok', usage: { input_tokens: 1, output_tokens: 1 } };
  })();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CanUseTool = (toolName: string, input: Record<string, unknown>, options: any) => Promise<any>;

function permOpts(blockedPath?: string) {
  return { signal: new AbortController().signal, toolUseID: 't1', requestId: 'r1', blockedPath };
}

async function invokeAndCaptureCanUseTool(workspace: string): Promise<CanUseTool | undefined> {
  const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
  const client = new ClaudeAgentSdkGatewayClient({ baseUrl: 'http://127.0.0.1:4000' });
  const opts: AgentOpts = {};
  await client.invoke({ prompt: 'ping', opts, runId: 'run-1', agentId: 'agent-1', workspace });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [[call]] = queryMock.mock.calls as [[{ options?: { canUseTool?: CanUseTool } }]];
  return call.options?.canUseTool;
}

describe('canUseTool allow responses carry updatedInput (issue #105 part B, HIGH)', () => {
  beforeEach(() => {
    queryMock.mockReset();
    queryMock.mockReturnValue(okSession());
  });

  it('an allowed call (no path args — an MCP tool shape) carries updatedInput echoing the ORIGINAL input unmodified', async () => {
    const workspace = '/tmp/remote-workflow-runs/_adhoc/run-a';
    const canUseTool = await invokeAndCaptureCanUseTool(workspace);
    expect(typeof canUseTool).toBe('function');

    const input = { query: 'hello', count: 3 };
    const result = await canUseTool!('mcp__everything__echo', input, permOpts());
    expect(result?.behavior).toBe('allow');
    expect(result?.updatedInput).toEqual(input);
    // Echoed, not re-used by reference is not required — equality is what the CLI's validator and
    // the SDK's own contract need; this only pins that no field is dropped or added.
  });

  it('an allowed Read at a path genuinely inside the workspace ALSO carries updatedInput', async () => {
    const workspace = '/tmp/remote-workflow-runs/_adhoc/run-a';
    const canUseTool = await invokeAndCaptureCanUseTool(workspace);
    const input = { file_path: `${workspace}/output.txt` };
    const result = await canUseTool!('Read', input, permOpts());
    expect(result?.behavior).toBe('allow');
    expect(result?.updatedInput).toEqual(input);
  });

  it('a denied call carries NO updatedInput — only the allow branch gained this field', async () => {
    const workspace = '/tmp/remote-workflow-runs/_adhoc/run-a';
    const canUseTool = await invokeAndCaptureCanUseTool(workspace);
    const result = await canUseTool!('Read', { file_path: '/etc/passwd' }, permOpts());
    expect(result?.behavior).toBe('deny');
    expect(result?.updatedInput).toBeUndefined();
    expect(typeof result?.message).toBe('string');
  });

  it('an empty-input allowed call (no path-bearing fields at all) still carries updatedInput as a record, never undefined', async () => {
    const workspace = '/tmp/remote-workflow-runs/_adhoc/run-a';
    const canUseTool = await invokeAndCaptureCanUseTool(workspace);
    const result = await canUseTool!('mcp__everything__get-env', {}, permOpts());
    expect(result?.behavior).toBe('allow');
    // The exact failure mode observed live: `updatedInput` present but `undefined` still fails the
    // CLI's own zod validator ("expected record, received undefined") — it must be an actual {}.
    expect(result?.updatedInput).toEqual({});
    expect(result && 'updatedInput' in result).toBe(true);
  });
});
