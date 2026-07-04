// UT-040: ClaudeAgentSdkGatewayClient must wire a real path-boundary enforcement seam (the SDK's own
// documented `Options.canUseTool` hook, sdk.d.ts:1328) so a tool call attempting to read/write a path
// OUTSIDE the run's own workspace root is DENIED at the tool layer — not silently allowed through a
// bare `cwd` (Gate 8 v2 review, adversarial.md finding V3 HIGH; binding D-V2G8-1(d)).
//
// Bug (review evidence, src/gateway/claude-agent-sdk-client.ts:219-249): the ONLY filesystem
// confinement set on `options` today is `cwd: req.workspace` — no `canUseTool`, no `tools`-level path
// check, nothing that inspects a tool call's OWN path argument (a Read/Write `file_path`, or a Bash
// `blockedPath`) against the workspace root. `cwd` is not a jail: a script's `agent()` prompt can ask
// the CLI to `cat` an absolute path anywhere on the host (the LiteLLM proxy's own config.yaml under
// os.tmpdir(), or a SIBLING run's workspace/journal under the same default workRoot — both literally
// reachable via `../` from a run's own cwd since `RunManager`'s default workRoot places every run's
// workspace as a sibling directory) and the CLI happily reads/returns it.
//
// Mock policy (DES-015, unit tier): vi.mock intercepts only the third-party
// @anthropic-ai/claude-agent-sdk module — the assertion is entirely about what `options.canUseTool`
// callback this client wires and how IT decides, not about a real spawned CLI subprocess (that
// end-to-end proof belongs to a later integration/E2E round once the seam exists).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentOpts } from '../../src/types.js';

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

type CanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  options: { signal: AbortSignal; toolUseID: string; requestId: string; blockedPath?: string },
) => Promise<{ behavior: 'allow' | 'deny'; message?: string } | null>;

function permOpts(blockedPath?: string) {
  return { signal: new AbortController().signal, toolUseID: 't1', requestId: 'r1', blockedPath };
}

async function invokeAndCaptureCanUseTool(workspace: string): Promise<CanUseTool | undefined> {
  const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
  const client = new ClaudeAgentSdkGatewayClient({ baseUrl: 'http://127.0.0.1:4000' });
  const opts: AgentOpts = {};
  await client.invoke({ prompt: 'ping', opts, runId: 'run-1', agentId: 'agent-1', workspace });
  const [[call]] = queryMock.mock.calls as [[{ options?: { canUseTool?: CanUseTool } }]];
  return call.options?.canUseTool;
}

describe('ClaudeAgentSdkGatewayClient: path-boundary enforcement at the tool layer (UT-040, D-V2G8-1d)', () => {
  beforeEach(() => {
    queryMock.mockReset();
    queryMock.mockReturnValue(okSession());
  });

  it('wires a canUseTool boundary callback (not left unset)', async () => {
    const canUseTool = await invokeAndCaptureCanUseTool('/tmp/remote-workflow-runs/_adhoc/run-a');
    // Forcing red today: options.canUseTool is never set anywhere in _invokeOnce.
    expect(typeof canUseTool).toBe('function');
  });

  it('denies a Read attempt at an absolute path outside the run workspace root (e.g. the LiteLLM proxy config)', async () => {
    const workspace = '/tmp/remote-workflow-runs/_adhoc/run-a';
    const canUseTool = await invokeAndCaptureCanUseTool(workspace);
    expect(typeof canUseTool).toBe('function');

    const result = await canUseTool!('Read', { file_path: '/tmp/rwe-litellm-abc123/config.yaml' }, permOpts());
    expect(result?.behavior).toBe('deny');
  });

  it("denies a Read attempt at another run's workspace (sibling directory escape)", async () => {
    const workspace = '/tmp/remote-workflow-runs/_adhoc/run-a';
    const canUseTool = await invokeAndCaptureCanUseTool(workspace);
    expect(typeof canUseTool).toBe('function');

    const result = await canUseTool!(
      'Read',
      { file_path: '/tmp/remote-workflow-runs/_adhoc/run-b/journal.jsonl' },
      permOpts(),
    );
    expect(result?.behavior).toBe('deny');
  });

  it('denies a Bash command whose own blockedPath escapes the workspace via ../', async () => {
    const workspace = '/tmp/remote-workflow-runs/_adhoc/run-a';
    const canUseTool = await invokeAndCaptureCanUseTool(workspace);
    expect(typeof canUseTool).toBe('function');

    const result = await canUseTool!(
      'Bash',
      { command: 'cat ../run-b/journal.jsonl' },
      permOpts('/tmp/remote-workflow-runs/_adhoc/run-b/journal.jsonl'),
    );
    expect(result?.behavior).toBe('deny');
  });

  it('allows a Read attempt at a path genuinely inside the run workspace root', async () => {
    const workspace = '/tmp/remote-workflow-runs/_adhoc/run-a';
    const canUseTool = await invokeAndCaptureCanUseTool(workspace);
    expect(typeof canUseTool).toBe('function');

    const result = await canUseTool!('Read', { file_path: `${workspace}/output.txt` }, permOpts());
    expect(result?.behavior).toBe('allow');
  });
});
