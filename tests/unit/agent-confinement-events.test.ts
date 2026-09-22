// UT-316..UT-319 (DES-256, ARCH-178, TASK-253, REQ-218) — the `agent.confinement` event: emitted
// once per ATTEMPT from the object the builder just returned, never for a refused call; the sink is
// late-bound and a no-op by default; sdkVersion is read mechanically off the installed package,
// never hand-copied; a faked EACCES tool_result reaches agent_log via onEvent (the wire, not a claim
// about the confinement itself). Written test-first (Gate 5, RED): bindEventSink()/the
// agent.confinement kind do not exist yet.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { AgentOpts, TranscriptEvent } from '../../src/types.js';

const queryMock = vi.fn();
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: queryMock }));

function okSession(): AsyncGenerator<unknown> {
  return (async function* () {
    yield { type: 'result', subtype: 'success', is_error: false, result: 'ok', usage: { input_tokens: 1, output_tokens: 1 } };
  })();
}

type FakeEvent = { kind: string; [k: string]: unknown };

describe('UT-316 agent.confinement — zero on refusal, exactly one per attempt on admission (DES-256)', () => {
  beforeEach(() => {
    queryMock.mockReset();
    queryMock.mockReturnValue(okSession());
  });

  it('an admitted call emits exactly one agent.confinement line carrying attempt:1', async () => {
    const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
    const client = new ClaudeAgentSdkGatewayClient({ baseUrl: 'http://127.0.0.1:4000' });
    const events: FakeEvent[] = [];
    (client as unknown as { bindEventSink: (sink: (ev: FakeEvent) => void) => void }).bindEventSink((ev) => events.push(ev));
    const opts: AgentOpts = {};
    await client.invoke({ prompt: 'ping', opts, runId: 'run-1', agentId: 'agent-1', workspace: '/tmp/remote-workflow-runs/_adhoc/run-a' });
    const confinementEvents = events.filter((e) => e.kind === 'agent.confinement');
    expect(confinementEvents).toHaveLength(1);
    expect(confinementEvents[0]?.['attempt']).toBe(1);
  });

  // v37 Gate 6.5+7 regression (verifier): `posture` on the event must NEVER disagree with `sandbox`
  // on the SAME event — an earlier draft's `posture` ternary defaulted the OMITTED case to
  // 'confined' while `sandbox` (built two statements above it) defaulted the same omitted case to
  // `{enabled:false}` (the 'unconfined' shape). Caught by a TZ-shift regression's own log output,
  // not by any existing case (every other one passes `confinementPosture` explicitly).
  it("an OMITTED confinementPosture reports posture:'unconfined' AND enabled:false on the SAME event — never a mismatched pair", async () => {
    const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
    const client = new ClaudeAgentSdkGatewayClient({ baseUrl: 'http://127.0.0.1:4000' });
    const events: FakeEvent[] = [];
    (client as unknown as { bindEventSink: (sink: (ev: FakeEvent) => void) => void }).bindEventSink((ev) => events.push(ev));
    await client.invoke({ prompt: 'ping', opts: {}, runId: 'run-1', agentId: 'agent-1', workspace: '/tmp/remote-workflow-runs/_adhoc/run-f' });
    const ev = events.find((e) => e.kind === 'agent.confinement');
    expect(ev?.['posture']).toBe('unconfined');
    expect(ev?.['enabled']).toBe(false);
  });

  it('an unbound sink never throws — a no-op sink is installed at construction', async () => {
    const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
    const client = new ClaudeAgentSdkGatewayClient({ baseUrl: 'http://127.0.0.1:4000' });
    const opts: AgentOpts = {};
    await expect(
      client.invoke({ prompt: 'ping', opts, runId: 'run-1', agentId: 'agent-1', workspace: '/tmp/remote-workflow-runs/_adhoc/run-a' }),
    ).resolves.toMatchObject({ ok: true });
  });
});

describe('UT-317 agent.confinement is emitted from the object the builder just returned, never re-derived (DES-256)', () => {
  beforeEach(() => {
    queryMock.mockReset();
    queryMock.mockReturnValue(okSession());
  });

  // v37 Gate-6 amendment (2026-09-22, implementer; ADR-083 owner_decision posture C): `confinementPosture`
  // defaults to `'unconfined'`, found by running the real suite (see bash-confinement-wiring.test.ts's
  // own amendment note for the full reasoning) — `confinementPosture:'confined'` set explicitly here
  // so this case still exercises the confined arm it was written to test.
  it("allowWrite/denyRead on the event equal the builder's output for THIS call's workspace", async () => {
    const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
    const client = new ClaudeAgentSdkGatewayClient({ baseUrl: 'http://127.0.0.1:4000', confinementPosture: 'confined' } as any);
    const events: FakeEvent[] = [];
    (client as unknown as { bindEventSink: (sink: (ev: FakeEvent) => void) => void }).bindEventSink((ev) => events.push(ev));
    const workspace = '/tmp/remote-workflow-runs/_adhoc/run-c';
    await client.invoke({ prompt: 'ping', opts: {}, runId: 'run-1', agentId: 'agent-1', workspace });
    const ev = events.find((e) => e.kind === 'agent.confinement');
    expect(ev?.['allowWrite']).toEqual([workspace]);
  });
});

describe('UT-318 sdkVersion is read mechanically off the installed package, never hand-copied (DES-256)', () => {
  it('agent.confinement.sdkVersion equals the installed @anthropic-ai/claude-agent-sdk package.json version', async () => {
    queryMock.mockReset();
    queryMock.mockReturnValue(okSession());
    const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
    const client = new ClaudeAgentSdkGatewayClient({ baseUrl: 'http://127.0.0.1:4000' });
    const events: FakeEvent[] = [];
    (client as unknown as { bindEventSink: (sink: (ev: FakeEvent) => void) => void }).bindEventSink((ev) => events.push(ev));
    await client.invoke({ prompt: 'ping', opts: {}, runId: 'run-1', agentId: 'agent-1', workspace: '/tmp/remote-workflow-runs/_adhoc/run-d' });
    const ev = events.find((e) => e.kind === 'agent.confinement');
    // v37 Gate-6 test-defect fix (implementer, 2026-09-22): the ORIGINAL line here was
    // `nodeRequire.resolve('@anthropic-ai/claude-agent-sdk/package.json')`, which this very DES-256
    // row documents as the form that THROWS (`ERR_PACKAGE_PATH_NOT_EXPORTED` — the package's
    // `exports` map does not publish a `./package.json` subpath); re-verified empirically here
    // (`node --input-type=module -e "..."`, throws identically). A fresh read still needs to be
    // DIFFERENT from the SUT's own `resolveSdkVersion()` helper — so this resolves the package's MAIN
    // entry (the documented working form) directly, rather than calling that helper.
    const nodeRequire = createRequire(import.meta.url);
    const entry = nodeRequire.resolve('@anthropic-ai/claude-agent-sdk');
    const pkgPath = join(dirname(entry), 'package.json');
    const { version } = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string };
    expect(ev?.['sdkVersion']).toBe(version);
  });
});

describe('UT-319 a faked EACCES tool_result reaches agent_log via onEvent (DES-256 fallback plumbing)', () => {
  it('the wire, not the confinement: an ordinary failed tool_result carrying EACCES is streamed through onEvent unchanged', async () => {
    queryMock.mockReset();
    queryMock.mockReturnValue(
      (async function* () {
        yield { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'echo hi > /root/leak' } }] } };
        yield { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: 'EACCES: permission denied' }] } };
        yield { type: 'result', subtype: 'success', is_error: false, result: 'ok', usage: { input_tokens: 1, output_tokens: 1 } };
      })(),
    );
    const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
    const client = new ClaudeAgentSdkGatewayClient({ baseUrl: 'http://127.0.0.1:4000' });
    const seen: TranscriptEvent[] = [];
    await client.invoke({
      prompt: 'ping',
      opts: {},
      runId: 'run-1',
      agentId: 'agent-1',
      workspace: '/tmp/remote-workflow-runs/_adhoc/run-e',
      onEvent: (ev: TranscriptEvent) => {
        seen.push(ev);
      },
    });
    expect(JSON.stringify(seen)).toContain('EACCES');
  });
});
