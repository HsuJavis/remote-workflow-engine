// issue #20: the gateway streams each transcript event live (onEvent) so agent_log grows and the
// agent record's lastActivityAt advances DURING the call — a progressing agent is now distinguishable
// from a hung one (which never streams an event, so lastActivityAt stays absent). Verifies the
// executor wires onEvent to (a) the transcript store and (b) the record, and that a streamed event is
// NOT re-emitted at terminal (no duplicates).
//
// Mock policy (integration): a fake GatewayClient that calls the injected onEvent hook mid-"call"
// then returns ok with empty events (exactly what ClaudeAgentSdkGatewayClient does when streaming);
// real AgentExecutor + real InMemoryRunStore; no LLM.
import { describe, it, expect, beforeEach } from 'vitest';
import { AgentExecutor } from '../../src/agent-executor.js';
import { InMemoryRunStore } from '../../src/run-store.js';
import { FixedClock } from '../../src/clock.js';
import type { GatewayClient, GatewayResult } from '../../src/gateway/client.js';
import type { TranscriptEvent } from '../../src/types.js';
import { defaultRunParams } from '../../src/params/resolve.js';

const clock = new FixedClock(new Date('2026-02-02T00:00:00.000Z'));

/** A fake gateway that streams two live events via onEvent (like a real SDK session's message +
 *  tool_call turns), then returns ok with events:[] — the streaming contract (events already emitted
 *  live, so the result must not carry them again). */
function makeStreamingGateway(): GatewayClient {
  return {
    async invoke(req): Promise<GatewayResult> {
      if (req.onEvent) {
        await req.onEvent({ ts: '2026-02-02T00:00:01.000Z', kind: 'message', data: { type: 'text', text: 'thinking…' } });
        await req.onEvent({ ts: '2026-02-02T00:00:02.000Z', kind: 'tool_call', data: { type: 'tool_use', name: 'Bash' } });
      }
      return { ok: true, provider: 'fake', model: 'm', tokens: { input: 3, output: 4 }, content: 'done', events: [] };
    },
  };
}

describe('live transcript-event streaming (#20)', () => {
  let store: InMemoryRunStore;
  let runId: string;
  const agentId = 'agent-stream-1';

  beforeEach(async () => {
    store = new InMemoryRunStore(clock);
    runId = await store.createRun({ origin: 'local', script: 'return 1;' }, 'v1');
  });

  it('streams events to the transcript live and does not duplicate them at terminal', async () => {
    const executor = new AgentExecutor({ gateway: makeStreamingGateway(), store, clock });
    executor.markQueued(agentId);
    executor.markRunning(agentId, '2026-02-02T00:00:00.000Z');
    await executor.run({ runId, agentId, prompt: 'go', opts: {}, signal: new AbortController().signal, workspace: '', runParams: defaultRunParams(undefined) });

    const events = await store.getTranscript(runId, agentId);
    const messages = events.filter((e) => e.kind === 'message' && (e.data as { type?: string }).type === 'text');
    const toolCalls = events.filter((e) => e.kind === 'tool_call');
    expect(messages).toHaveLength(1);   // streamed exactly once — NOT re-emitted from result.events
    expect(toolCalls).toHaveLength(1);
    // the terminal usage event still lands after the streamed turns
    expect(events.filter((e) => e.kind === 'usage')).toHaveLength(1);
  });

  it("advances the record's lastActivityAt as events stream (progress observable mid-call)", async () => {
    const executor = new AgentExecutor({ gateway: makeStreamingGateway(), store, clock });
    executor.markQueued(agentId);
    executor.markRunning(agentId, '2026-02-02T00:00:00.000Z');
    await executor.run({ runId, agentId, prompt: 'go', opts: {}, signal: new AbortController().signal, workspace: '', runParams: defaultRunParams(undefined) });

    const rec = executor.getAllRecords().find((r) => r.agentId === agentId)!;
    // lastActivityAt reflects the most recent streamed event (00:00:02), strictly after startedAt.
    expect(rec.lastActivityAt).toBe('2026-02-02T00:00:02.000Z');
    expect(rec.startedAt).toBe('2026-02-02T00:00:00.000Z');
  });

  it('a gateway that never streams an event leaves lastActivityAt absent (a hung call is visibly stalled)', async () => {
    const silent: GatewayClient = { async invoke(): Promise<GatewayResult> { return { ok: true, provider: 'fake', model: 'm', tokens: { input: 1, output: 1 }, content: 'x', events: [] }; } };
    const executor = new AgentExecutor({ gateway: silent, store, clock });
    executor.markQueued(agentId);
    executor.markRunning(agentId, '2026-02-02T00:00:00.000Z');
    await executor.run({ runId, agentId, prompt: 'go', opts: {}, signal: new AbortController().signal, workspace: '', runParams: defaultRunParams(undefined) });
    const rec = executor.getAllRecords().find((r) => r.agentId === agentId)!;
    expect(rec.lastActivityAt).toBeUndefined(); // no progress signal — this is what a hung agent looks like
  });
});
