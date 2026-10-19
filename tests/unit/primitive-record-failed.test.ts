// UT-358 (DES-273/274 v40 Gate 6 delta, ARCH-191/192, ruling R-6, TASK-271): a FAILED
// decide()/generateImage() call's persisted `kind:'usage'` transcript event carries `reason` (the
// record's `failReason`), so the restart-time derivation (`deriveAgentRecords`, which keys `state`
// on the presence of `data.reason`) rebuilds it as `failed` — not `done`.
//
// Mock policy (unit): the REAL `AgentTranscriptSink.recordPrimitive` writes into a capturing fake
// store (only `appendTranscript` is exercised); the REAL pure `deriveAgentRecords` reads it back.
//
// Red reason: `recordPrimitive` writes the usage event without `reason`, so a failed decide derives
// as `state:'done'` after a restart (the live record says `failed`; the rebuilt one disagrees).
import { describe, it, expect } from 'vitest';
import { AgentTranscriptSink } from '../../src/agent-executor.js';
import { deriveAgentRecords } from '../../src/run-store.js';
import type { TranscriptEvent } from '../../src/types.js';

function capturingSink(): { sink: AgentTranscriptSink; transcripts: Map<string, TranscriptEvent[]> } {
  const transcripts = new Map<string, TranscriptEvent[]>();
  const store = {
    appendTranscript: async (_runId: string, agentId: string, ev: TranscriptEvent) => {
      transcripts.set(agentId, [...(transcripts.get(agentId) ?? []), ev]);
    },
  };
  return { sink: new AgentTranscriptSink(undefined, store as never), transcripts };
}

const BASE = {
  kind: 'decide' as const, label: 'gate', model: 'openrouter/typesafe/jev-1.13',
  costUSD: 0, unpriced: true, startedAt: '2026-10-16T00:00:00.000Z', endedAt: '2026-10-16T00:00:01.000Z',
};

describe('UT-358: a failed primitive derives as failed after restart (R-6)', () => {
  it('perturbation guard: a DONE decide derives as done', async () => {
    const { sink, transcripts } = capturingSink();
    await sink.recordPrimitive('run-1', { ...BASE, agentId: 'a-1', state: 'done' });
    const [rec] = deriveAgentRecords(transcripts, 'completed');
    expect(rec).toMatchObject({ agentId: 'a-1', kind: 'decide', state: 'done' });
  });

  it('a FAILED decide (failReason timeout) writes `reason` on its usage event', async () => {
    const { sink, transcripts } = capturingSink();
    await sink.recordPrimitive('run-1', { ...BASE, agentId: 'a-2', state: 'failed', failReason: 'timeout' });
    const usage = transcripts.get('a-2')?.find((e) => e.kind === 'usage');
    expect((usage?.data as { reason?: string } | undefined)?.reason).toBe('timeout');
  });

  it('a FAILED decide derives as state:failed with its failReason (the live record and the rebuilt one agree)', async () => {
    const { sink, transcripts } = capturingSink();
    await sink.recordPrimitive('run-1', { ...BASE, agentId: 'a-3', state: 'failed', failReason: 'terminal' });
    expect(sink.getRecord('a-3')?.state).toBe('failed');
    const [rec] = deriveAgentRecords(transcripts, 'failed');
    expect(rec).toMatchObject({ agentId: 'a-3', kind: 'decide', state: 'failed', failReason: 'terminal' });
  });
});

// UT-372 (DES-273/274 v41 delta, ARCH-192, REQ-231, TASK-277): `primitiveFailReasonFrom` is
// deleted — a failed primitive's `failReason` is now the raw `AttemptReason` word (e.g. `'network'`,
// not the narrower `'unreachable'`), and `recordPrimitive` additionally carries `detail` (the same
// string `run_agent_log`/`agentFailures[].message` surface) onto BOTH the live `AgentRecord` and the
// persisted `kind:'usage'` event's `data.detail` — so a restart-derived record matches the live one
// on `detail` too, not just `failReason`.
//
// Red reason: `AgentTranscriptSink.recordPrimitive` never reads `r.detail` at all today — neither
// the live record nor the usage event carries it, so every assertion below against a real message
// string fails (`undefined !== <message>`).
describe('UT-372: a failed primitive carries `detail` (the script-visible message) live and after restart (v41, REQ-231)', () => {
  it('recordPrimitive writes `detail` onto the live AgentRecord', async () => {
    const { sink } = capturingSink();
    const detail = "decide 'gate' failed: network after 3 attempts";
    await sink.recordPrimitive('run-1', { ...BASE, agentId: 'a-4', state: 'failed', failReason: 'network', detail });
    expect(sink.getRecord('a-4')?.detail).toBe(detail);
  });

  it('recordPrimitive writes `detail` onto the usage event\'s `data.detail`', async () => {
    const { sink, transcripts } = capturingSink();
    const detail = "decide 'gate' failed: network after 3 attempts";
    await sink.recordPrimitive('run-1', { ...BASE, agentId: 'a-5', state: 'failed', failReason: 'network', detail });
    const usage = transcripts.get('a-5')?.find((e) => e.kind === 'usage');
    expect((usage?.data as { detail?: string } | undefined)?.detail).toBe(detail);
  });

  it('a restart-derived record matches the live one on BOTH failReason (the AttemptReason word) and detail', async () => {
    const { sink, transcripts } = capturingSink();
    const detail = "generateImage 'hero' failed: network after 3 attempts";
    await sink.recordPrimitive('run-1', { ...BASE, kind: 'image', agentId: 'a-6', state: 'failed', failReason: 'network', detail });
    const live = sink.getRecord('a-6');
    const [rec] = deriveAgentRecords(transcripts, 'failed');
    expect(rec).toMatchObject({ agentId: 'a-6', kind: 'image', state: 'failed', failReason: 'network', detail });
    expect(rec?.detail).toBe(live?.detail);
    expect(rec?.failReason).toBe(live?.failReason);
  });
});
