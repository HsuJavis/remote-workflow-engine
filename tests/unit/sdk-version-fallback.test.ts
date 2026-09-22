// UT-326 (DES-256, ARCH-178, TASK-253, REQ-218) — Gate 6.5+7 coverage-gap closure: `resolveSdkVersion()`'s
// own `catch { return 'unknown'; }` arm (src/gateway/claude-agent-sdk-client.ts) is deliberately
// defensive ("unreadable for any reason -> 'unknown' — a log line must never be the thing that fails a
// run", the function's own doc comment) but was 0/2 lines hit in the Gate 6.5+7 coverage run
// (coverage/coverage-final.json) — no test made `resolveSdkVersion()` actually throw. `SDK_VERSION`
// is computed ONCE at module load (`const SDK_VERSION = resolveSdkVersion();`), so this test mocks
// `node:module`'s `createRequire` to return a resolver that throws BEFORE importing the module (fresh
// module registry via `vi.resetModules()` + dynamic import — the only way to re-run that top-level
// line under a broken resolver, isolated to this one file so no other test's real `createRequire`
// is affected).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const createRequireMock = vi.fn();
vi.mock('node:module', () => ({ createRequire: createRequireMock }));

const queryMock = vi.fn();
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: queryMock }));

function okSession(): AsyncGenerator<unknown> {
  return (async function* () {
    yield { type: 'result', subtype: 'success', is_error: false, result: 'ok', usage: { input_tokens: 1, output_tokens: 1 } };
  })();
}

describe('UT-326 resolveSdkVersion() falls back to "unknown" when the installed package cannot be resolved', () => {
  beforeEach(() => {
    vi.resetModules();
    createRequireMock.mockReset();
    queryMock.mockReset();
    queryMock.mockReturnValue(okSession());
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('agent.confinement.sdkVersion is "unknown" when nodeRequire.resolve() throws at module load', async () => {
    createRequireMock.mockReturnValue({
      resolve: () => {
        throw new Error('MODULE_NOT_FOUND: simulated — package not resolvable on this host');
      },
    });
    type FakeEvent = { kind: string; [k: string]: unknown };
    const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
    const client = new ClaudeAgentSdkGatewayClient({ baseUrl: 'http://127.0.0.1:4000' });
    const events: FakeEvent[] = [];
    (client as unknown as { bindEventSink: (sink: (ev: FakeEvent) => void) => void }).bindEventSink((ev) => events.push(ev));
    await client.invoke({ prompt: 'ping', opts: {}, runId: 'run-1', agentId: 'agent-1', workspace: '/tmp/remote-workflow-runs/_adhoc/run-e' });
    const ev = events.find((e) => e.kind === 'agent.confinement');
    expect(ev?.['sdkVersion']).toBe('unknown');
  });
});
