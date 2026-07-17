// IT-027: AgentTranscriptSink captures the SDK message/tool_call/tool_result event stream —
// workflow_agent_log returns a real reasoning/tool trace, not only a terminal usage summary
// (Gate 8 review D-G8-2, quality-dimensions.md finding O-1, HIGH — ARCH-004 rationale, REQ-007).
//
// Bug (review evidence): `src/types.ts:94` declares `TranscriptEvent.kind` as
// `'message' | 'tool_call' | 'tool_result' | 'usage'`, but `AgentTranscriptSink.capture()`
// (src/agent-executor.ts) only ever emits `kind: 'usage'` — never the other three. Separately,
// `ClaudeAgentSdkGatewayClient._drain` (src/gateway/claude-agent-sdk-client.ts) iterates the real
// SDK session's own async-generator message stream (assistant/tool_use/tool_result turns) and
// explicitly discards every message except the final `type: 'result'` one
// (`if (msg.type !== 'result') continue;`) — nothing forwards the intermediate messages anywhere.
// Net effect: `workflow_agent_log` (built for exactly this purpose) can only ever show one summary
// token-count line per agent call, never the actual reasoning/tool-call trace.
//
// Mock policy (DES-015, integration tier): real McpFacade + real RunManager + real
// InMemoryRunStore + real AgentExecutor/AgentTranscriptSink + real sandbox child process + real
// ClaudeAgentSdkGatewayClient; only the third-party `@anthropic-ai/claude-agent-sdk` `query` export
// is faked (same seam UT-018/IT-015 already use) — the fake session emits a realistic
// assistant-text -> tool_use -> tool_result -> result message sequence, exactly what a real
// tool-using agent turn produces.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentOpts } from '../../src/types.js';

const queryMock = vi.fn();
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: queryMock }));

/** A realistic multi-message SDK session: an assistant reasoning turn, a tool_use turn, the
 *  corresponding tool_result, then the final result message — mirrors a real tool-using agent
 *  loop turn-by-turn (the exact shape `_drain` today discards everything but the last of). */
function fakeToolUseSession() {
  return (async function* () {
    yield {
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Let me check the file.' }] },
      parent_tool_use_id: null,
      uuid: 'u1',
      session_id: 's1',
    };
    yield {
      type: 'assistant',
      message: { content: [{ type: 'tool_use', id: 'tu-1', name: 'Read', input: { path: 'foo.txt' } }] },
      parent_tool_use_id: null,
      uuid: 'u2',
      session_id: 's1',
    };
    yield {
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 'tu-1', content: 'file contents' }] },
      parent_tool_use_id: null,
      uuid: 'u3',
      session_id: 's1',
    };
    yield {
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'Done reading the file.',
      usage: { input_tokens: 5, output_tokens: 5 },
    };
  })();
}

function req(opts: AgentOpts = {}) {
  return { prompt: 'read foo.txt', opts, runId: 'run-1', agentId: 'agent-1' };
}

describe('AgentTranscriptSink captures the SDK message/tool_call/tool_result stream (IT-027, D-G8-2)', () => {
  beforeEach(() => {
    queryMock.mockReset();
    queryMock.mockReturnValue(fakeToolUseSession());
  });

  it('workflow_agent_log returns message/tool_call/tool_result events (in order), not only a terminal usage line', async () => {
    const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
    const { McpFacade } = await import('../../src/mcp-facade.js');
    const { RunManager } = await import('../../src/run-manager.js');
    const { InMemoryRunStore } = await import('../../src/run-store.js');
    const { FixedClock } = await import('../../src/clock.js');

    const clock = new FixedClock(new Date('2024-01-01T00:00:00Z'));
    const gateway = new ClaudeAgentSdkGatewayClient({ baseUrl: 'http://127.0.0.1:4000' });
    const store = new InMemoryRunStore(clock);
    const runManager = new RunManager({ store, clock, gateway });
    const facade = new McpFacade({ clock, store, runManager });

    const run = await facade.workflow_run({ script: `return agent('read foo.txt');` });
    const runId = run.result!.runId;

    let status = await facade.workflow_status({ runId });
    for (let i = 0; i < 60 && (status.status === 'running' || status.status === 'queued'); i++) {
      await new Promise((r) => setTimeout(r, 50));
      status = await facade.workflow_status({ runId });
    }
    expect(status.status).toBe('completed');

    const agents = status.result!.agents as Array<{ agentId: string }>;
    expect(agents.length).toBeGreaterThan(0);
    const agentId = agents[0].agentId;

    const log = await facade.workflow_agent_log({ runId, agentId });
    expect(log.error).toBeUndefined();
    const events = log.result ?? [];

    // Forcing red today: capture() only ever appends a single `kind: 'usage'` event — the real
    // SDK message/tool_use/tool_result turns above are never forwarded anywhere.
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain('message');
    expect(kinds).toContain('tool_call');
    expect(kinds).toContain('tool_result');

    // Order matters (a reasoning/tool trace, not just a bag of events): the reasoning turn comes
    // before the tool call, which comes before its own result.
    expect(kinds.indexOf('message')).toBeLessThan(kinds.indexOf('tool_call'));
    expect(kinds.indexOf('tool_call')).toBeLessThan(kinds.indexOf('tool_result'));

    // The captured events must carry the real content, not empty stubs.
    const toolCallEvent = events[kinds.indexOf('tool_call')];
    expect(JSON.stringify(toolCallEvent.data)).toContain('Read');
    const toolResultEvent = events[kinds.indexOf('tool_result')];
    expect(JSON.stringify(toolResultEvent.data)).toContain('file contents');
  }, 15000);
});
