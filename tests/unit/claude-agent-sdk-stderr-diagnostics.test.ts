// send-back item 2 (verify-b, 2026-09-26): a real repro on the operator's host showed a Bash-capable
// agent() under posture:confined failing with AgentRecord.detail literally "error_during_execution"
// and 0 tokens — undiagnosable from the record alone. Root cause, found by re-reading the SDK's own
// result-message shape (sdk.d.ts SDKResultError): the CLI's real failure text lands on `errors:
// string[]` (plural), but `_drain`'s subtype-branch only ever read `m.result ?? m.error` (singular,
// which does not exist on this shape) — the actual diagnostic text was silently dropped before this
// class ever got a chance to surface it. Separately, the SDK also exposes an `Options.stderr`
// callback (sdk.d.ts ~L1896) that the CLI's own raw stderr flows through — wired here as
// defense-in-depth for a startup crash that never reaches an ordinary `result` message at all.
//
// Mock policy (DES-015, unit tier): vi.mock intercepts only the third-party
// @anthropic-ai/claude-agent-sdk module, matching every sibling claude-agent-sdk-gateway-*.test.ts.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentOpts } from '../../src/types.js';

const queryMock = vi.fn();
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: queryMock }));

type FakeEvent = { kind: string; [k: string]: unknown };
type FakeOptions = { stderr?: (data: string) => void };

function req(opts: AgentOpts = {}) {
  return { prompt: 'ping', opts, runId: 'run-1', agentId: 'agent-1' };
}

describe('ClaudeAgentSdkGatewayClient — CLI stderr/errors[] diagnostics (send-back item 2)', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('an error_during_execution result carrying errors:[...] (the real SDK shape) puts the CLI text in detail, never the bare subtype alone', async () => {
    queryMock.mockReturnValue(
      (async function* () {
        yield {
          type: 'result',
          subtype: 'error_during_execution',
          is_error: true,
          num_turns: 0,
          errors: ['sandbox required but unavailable: sandbox is enabled but dependencies are missing: socat not installed'],
        };
      })(),
    );
    const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
    const client = new ClaudeAgentSdkGatewayClient({ baseUrl: 'http://127.0.0.1:4000' });

    const result = await client.invoke(req());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.detail).toContain('socat not installed');
    // A doomed sandbox cannot be fixed by retrying — same contract as the thrown-exception path
    // (SANDBOX_UNAVAILABLE below) already gets.
    expect(result.retryable).toBe(false);
  });

  it('wires Options.stderr into a bounded buffer and emits it via the event sink on a failed attempt, redacted through the normal EventSink pipeline', async () => {
    let capturedStderr: ((data: string) => void) | undefined;
    queryMock.mockImplementation((args: { options?: FakeOptions }) => {
      capturedStderr = args.options?.stderr;
      return (async function* () {
        capturedStderr?.('sandbox required but unavailable: socat not installed');
        yield { type: 'result', subtype: 'error_during_execution', is_error: true, num_turns: 0, errors: [] };
      })();
    });
    const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
    const client = new ClaudeAgentSdkGatewayClient({ baseUrl: 'http://127.0.0.1:4000' });
    const events: FakeEvent[] = [];
    (client as unknown as { bindEventSink: (sink: (ev: FakeEvent) => void) => void }).bindEventSink((ev) => events.push(ev));

    await client.invoke(req());

    const stderrEvents = events.filter((e) => e.kind === 'agent.stderr');
    expect(stderrEvents).toHaveLength(1);
    expect(stderrEvents[0]?.['tail']).toContain('socat not installed');
  });

  it('bounds the captured stderr buffer to the last 4096 characters, never growing unbounded across many chunks', async () => {
    let capturedStderr: ((data: string) => void) | undefined;
    queryMock.mockImplementation((args: { options?: FakeOptions }) => {
      capturedStderr = args.options?.stderr;
      return (async function* () {
        for (let i = 0; i < 200; i++) capturedStderr?.('x'.repeat(100));
        yield { type: 'result', subtype: 'error_during_execution', is_error: true, num_turns: 0, errors: [] };
      })();
    });
    const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
    const client = new ClaudeAgentSdkGatewayClient({ baseUrl: 'http://127.0.0.1:4000' });
    const events: FakeEvent[] = [];
    (client as unknown as { bindEventSink: (sink: (ev: FakeEvent) => void) => void }).bindEventSink((ev) => events.push(ev));

    await client.invoke(req());

    const tail = events.find((e) => e.kind === 'agent.stderr')?.['tail'] as string | undefined;
    expect(tail).toBeDefined();
    expect(tail!.length).toBeLessThanOrEqual(4096);
  });

  it('a successful call never emits agent.stderr, even when the CLI wrote benign stderr chatter', async () => {
    queryMock.mockImplementation((args: { options?: FakeOptions }) => {
      args.options?.stderr?.('some benign debug chatter');
      return (async function* () {
        yield { type: 'result', subtype: 'success', is_error: false, result: 'ok', usage: { input_tokens: 1, output_tokens: 1 } };
      })();
    });
    const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
    const client = new ClaudeAgentSdkGatewayClient({ baseUrl: 'http://127.0.0.1:4000' });
    const events: FakeEvent[] = [];
    (client as unknown as { bindEventSink: (sink: (ev: FakeEvent) => void) => void }).bindEventSink((ev) => events.push(ev));

    const result = await client.invoke(req());

    expect(result.ok).toBe(true);
    expect(events.some((e) => e.kind === 'agent.stderr')).toBe(false);
  });
});
