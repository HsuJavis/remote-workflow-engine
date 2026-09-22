// UT-314/UT-315 (DES-253/DES-259, ARCH-176/178, TASK-253, REQ-218) — the ONE `options.sandbox`
// field at Options assembly: identity with buildBashConfinement()'s own output (never a
// re-computation), and the sandbox-unavailable failure surface's drift-locked label.
// Mock policy (unit tier): vi.mock intercepts only the third-party @anthropic-ai/claude-agent-sdk
// module — same convention as claude-agent-sdk-gateway-workspace-boundary.test.ts.
// Written test-first (Gate 5, RED): claude-agent-sdk-client.ts never sets options.sandbox today,
// and SANDBOX_UNAVAILABLE does not exist yet.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentOpts } from '../../src/types.js';

const queryMock = vi.fn();
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: queryMock }));

function okSession(): AsyncGenerator<unknown> {
  return (async function* () {
    yield { type: 'result', subtype: 'success', is_error: false, result: 'ok', usage: { input_tokens: 1, output_tokens: 1 } };
  })();
}

describe("UT-314 options.sandbox is the builder's own output, at every construction (DES-253)", () => {
  beforeEach(() => {
    queryMock.mockReset();
    queryMock.mockReturnValue(okSession());
  });

  // v37 Gate-6 amendment (2026-09-22, implementer; ADR-083 owner_decision posture C — found by
  // running the real suite, not by design): `confinementPosture` DEFAULTS TO `'unconfined'`, not
  // `'confined'` as this describe block originally assumed — the `'confined'` default broke every
  // real-CLI-spawning test in the suite (`val-023-sdk-gateway-timeout.test.ts` and siblings), which
  // never set `confinementPosture` and started hitting `SANDBOX_UNAVAILABLE` at CLI startup instead
  // of testing what they were written to test. The three cases below now set `confinementPosture:
  // 'confined'` explicitly to keep testing the confined arm; a fourth case pins the corrected default.
  it('deep-equals buildBashConfinement() for the SAME input, via a real workspace + confinement config (confinementPosture explicitly confined)', async () => {
    const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
    const { buildBashConfinement, DENY_READ_MODE } = await import('../../src/gateway/bash-confinement.js');
    const workRoot = '/var/lib/rwe-data';
    // v37 Gate-6 (DES-257): nested under workRoot the way every real run workspace is
    // (`workRoot/workflows/<name>/runs/<runId>`, run-manager.ts) — a workspace path unrelated to
    // workRoot now genuinely trips the re-walk's containment check (a real symlink-escape signal),
    // which this case is not testing; only the confinement-build identity is.
    const workspace = `${workRoot}/workflows/wf/runs/run-a`;
    const grant = '/srv/shared-cache';
    const protectedFiles = ['/home/op/rwe.config.json', `${workRoot}/auth-tokens.db`];
    const client = new ClaudeAgentSdkGatewayClient({
      baseUrl: 'http://127.0.0.1:4000',
      confinementPosture: 'confined',
      confinement: { allowHostPaths: [grant], protectedFiles, workRoot },
    } as any);
    const opts: AgentOpts = {};
    await client.invoke({ prompt: 'ping', opts, runId: 'run-1', agentId: 'agent-1', workspace });
    const [[call]] = queryMock.mock.calls as [[{ options?: { sandbox?: unknown } }]];
    const expected = buildBashConfinement({ root: workspace, grantedHostPaths: [grant], protectedFiles, workRoot, denyReadMode: DENY_READ_MODE });
    expect(call.options?.sandbox).toEqual(expected);
  });

  it('confinementPosture:"confined" + confinement absent ⇒ the workspace-only posture is still built, NEVER sandbox:undefined', async () => {
    const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
    const client = new ClaudeAgentSdkGatewayClient({ baseUrl: 'http://127.0.0.1:4000', confinementPosture: 'confined' } as any);
    const opts: AgentOpts = {};
    const workspace = '/tmp/remote-workflow-runs/_adhoc/run-b';
    await client.invoke({ prompt: 'ping', opts, runId: 'run-2', agentId: 'agent-1', workspace });
    const [[call]] = queryMock.mock.calls as [[{ options?: { sandbox?: { enabled?: boolean; filesystem?: { allowWrite?: string[] } } } }]];
    expect(call.options?.sandbox).toBeDefined();
    expect(call.options?.sandbox?.enabled).toBe(true);
    expect(call.options?.sandbox?.filesystem?.allowWrite).toEqual([workspace]);
  });

  it('confinementPosture:"confined" + an absent root (no workspace, no configured cwd) still emits a sandbox object with allowWrite:[] — never an absent sandbox (ARCH-176 bug-class regression guard)', async () => {
    const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
    const client = new ClaudeAgentSdkGatewayClient({ baseUrl: 'http://127.0.0.1:4000', confinementPosture: 'confined' } as any);
    const opts: AgentOpts = {};
    await client.invoke({ prompt: 'ping', opts, runId: 'run-3', agentId: 'agent-1' });
    const [[call]] = queryMock.mock.calls as [[{ options?: { sandbox?: { filesystem?: { allowWrite?: string[] } } } }]];
    expect(call.options?.sandbox?.filesystem?.allowWrite).toEqual([]);
  });

  it('confinementPosture omitted entirely ⇒ unconfined by default: options.sandbox is {enabled:false}, buildBashConfinement() never called', async () => {
    const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
    const client = new ClaudeAgentSdkGatewayClient({ baseUrl: 'http://127.0.0.1:4000' });
    const opts: AgentOpts = {};
    await client.invoke({ prompt: 'ping', opts, runId: 'run-4', agentId: 'agent-1', workspace: '/tmp/remote-workflow-runs/_adhoc/run-d' });
    const [[call]] = queryMock.mock.calls as [[{ options?: { sandbox?: unknown } }]];
    expect(call.options?.sandbox).toEqual({ enabled: false });
  });
});

describe('UT-315 the sandbox-unavailable failure is labelled with SANDBOX_UNAVAILABLE (DES-259, ADR-083)', () => {
  it("the exported constant is the exact literal ADR-083's revisit trigger quotes — a drift-lock, not a re-derivation", async () => {
    const { SANDBOX_UNAVAILABLE } = await import('../../src/gateway/claude-agent-sdk-client.js');
    // Pinned to 02-architecture.md ADR-083: "an operator reports a run refused for `sandbox
    // unavailable`" — a rename on either side must break this test.
    expect(SANDBOX_UNAVAILABLE).toBe('sandbox unavailable');
  });
});
