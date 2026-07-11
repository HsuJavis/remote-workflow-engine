// UT-050: ClaudeAgentSdkGatewayClient's workspace-boundary `canUseTool` callback must deny a
// symlink escape, not just a plain `../` string escape (DES-025/ARCH-016 hardening, REQ-018).
//
// Gap this closes: UT-040 (the pre-existing boundary suite) proved `isInsideWorkspace` denies a
// path that TEXTUALLY leaves the workspace, but it never plants a real symlink — a plain
// `resolve()`/`startsWith()` string check is fooled by a symlink whose OWN path sits inside the
// workspace (so the string check says "inside") while its REAL (symlink-resolved) target escapes
// it. This test plants a real symlink inside a real run workspace pointing OUTSIDE it (at a
// sibling directory standing in for the LiteLLM proxy config / a sibling run's journal) and
// asserts the client's own `canUseTool` boundary DENIES a Read through that symlink.
//
// Mock policy (DES-015, unit tier): vi.mock intercepts only the third-party
// @anthropic-ai/claude-agent-sdk module (same convention as UT-040) — the assertion is about what
// `options.canUseTool` decides. The symlink itself is REAL (real `node:fs.symlinkSync`, real
// tmpdir), since a faked filesystem could not exercise the real `realpathSync` resolution this
// hardening depends on.
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, symlinkSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

function permOpts() {
  return { signal: new AbortController().signal, toolUseID: 't1', requestId: 'r1' };
}

async function invokeAndCaptureCanUseTool(workspace: string): Promise<CanUseTool | undefined> {
  const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
  const client = new ClaudeAgentSdkGatewayClient({ baseUrl: 'http://127.0.0.1:4000' });
  const opts: AgentOpts = {};
  await client.invoke({ prompt: 'ping', opts, runId: 'run-1', agentId: 'agent-1', workspace });
  const [[call]] = queryMock.mock.calls as [[{ options?: { canUseTool?: CanUseTool } }]];
  return call.options?.canUseTool;
}

describe("ClaudeAgentSdkGatewayClient: canUseTool denies a planted-symlink escape (UT-050, DES-025/ARCH-016)", () => {
  let root: string;
  let workspace: string;
  let outside: string;

  beforeEach(() => {
    queryMock.mockReset();
    queryMock.mockReturnValue(okSession());
    root = mkdtempSync(join(tmpdir(), 'rwe-ut050-'));
    workspace = join(root, 'run-a');
    outside = join(root, 'secret-sibling');
    mkdirSync(workspace, { recursive: true });
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, 'journal.jsonl'), '{"secret":true}\n');
  });

  afterAll(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("denies a Read whose path sits INSIDE the workspace but is a symlink whose REAL target escapes it", async () => {
    const linkPath = join(workspace, 'innocuous-looking-file.txt');
    symlinkSync(join(outside, 'journal.jsonl'), linkPath);

    const canUseTool = await invokeAndCaptureCanUseTool(workspace);
    expect(typeof canUseTool).toBe('function');

    const result = await canUseTool!('Read', { file_path: linkPath }, permOpts());
    expect(result?.behavior).toBe('deny');
  });

  it('still allows a genuine (non-symlinked) Read inside the workspace (regression floor)', async () => {
    const realFile = join(workspace, 'output.txt');
    writeFileSync(realFile, 'hello');

    const canUseTool = await invokeAndCaptureCanUseTool(workspace);
    const result = await canUseTool!('Read', { file_path: realFile }, permOpts());
    expect(result?.behavior).toBe('allow');
  });
});
