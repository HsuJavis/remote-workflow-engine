// UT (issue #131): the sdk gateway now emits the SAME `agent.host_shared_tmpdir_present` warning
// event the pi gateway already emitted (see tests/unit/pi-gateway-agentdir-isolation.test.ts's own
// "hostSharedTmpdirPresent() only WARNS" describe block) when `/tmp/claude` exists at dispatch
// time — a non-blocking VISIBILITY check, never a refusal. The actual control
// (`denyWrite:['/tmp/claude']`, unconditional in both postures) is pinned separately in
// bash-confinement.test.ts / bash-readonly-gateway.test.ts / project-config-guard.test.ts, against
// the shared `buildBashConfinement()` both gateways now get it from.
// Mock policy (unit): the SDK module AND the host-existence check are both faked — this file never
// touches a real `/tmp/claude`.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentOpts } from '../../src/types.js';

const queryMock = vi.fn();
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: queryMock }));

const hostSharedTmpdirPresentMock = vi.fn();
vi.mock('../../src/gateway/host-shared-tmpdir.js', () => ({ hostSharedTmpdirPresent: () => hostSharedTmpdirPresentMock() }));

function okSession(): AsyncGenerator<unknown> {
  return (async function* () {
    yield { type: 'result', subtype: 'success', is_error: false, result: 'ok', usage: { input_tokens: 1, output_tokens: 1 } };
  })();
}

type FakeEvent = { kind: string; [k: string]: unknown };

describe('issue #131 — sdk gateway agent.host_shared_tmpdir_present (parity with the pi gateway)', () => {
  beforeEach(() => {
    queryMock.mockReset();
    queryMock.mockReturnValue(okSession());
    hostSharedTmpdirPresentMock.mockReset();
  });

  async function invoke(confinementPosture: 'confined' | 'unconfined' | undefined, opts: AgentOpts = {}) {
    const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
    const client = new ClaudeAgentSdkGatewayClient({
      baseUrl: 'http://127.0.0.1:4000',
      ...(confinementPosture !== undefined ? { confinementPosture } : {}),
    } as any);
    const events: FakeEvent[] = [];
    (client as unknown as { bindEventSink: (sink: (ev: FakeEvent) => void) => void }).bindEventSink((ev) => events.push(ev));
    const result = await client.invoke({ prompt: 'ping', opts, runId: 'run-1', agentId: 'agent-1', workspace: '/tmp/remote-workflow-runs/_adhoc/run-131' });
    return { result, events };
  }

  it('a pre-existing /tmp/claude emits agent.host_shared_tmpdir_present with the literal path (confined only) — never a refusal', async () => {
    hostSharedTmpdirPresentMock.mockReturnValue(true);
    const { result, events } = await invoke('confined');
    expect(result.ok).toBe(true);
    const warnings = events.filter((e) => e.kind === 'agent.host_shared_tmpdir_present');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.['path']).toBe('/tmp/claude');
    expect(warnings[0]?.['runId']).toBe('run-1');
    expect(warnings[0]?.['agentId']).toBe('agent-1');
  });

  it('an absent /tmp/claude emits nothing', async () => {
    hostSharedTmpdirPresentMock.mockReturnValue(false);
    const { events } = await invoke('confined');
    expect(events.some((e) => e.kind === 'agent.host_shared_tmpdir_present')).toBe(false);
  });

  it('an unconfined posture never checks (buildBashConfinement is not even called) or emits, even if /tmp/claude exists', async () => {
    hostSharedTmpdirPresentMock.mockReturnValue(true);
    const { events } = await invoke('unconfined');
    expect(events.some((e) => e.kind === 'agent.host_shared_tmpdir_present')).toBe(false);
    expect(hostSharedTmpdirPresentMock).not.toHaveBeenCalled();
  });
});
