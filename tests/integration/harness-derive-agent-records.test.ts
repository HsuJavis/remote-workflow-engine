// IT-065: run-status-aware deriveAgentRecords (DES-066, ARCH-044, TASK-069)
//
// The REQUIRED fix to deriveAgentRecords (DES-066 / TASK-069):
//   - harness event with NO later usage event + IN-PROCESS parent  → state:'running'
//   - harness event with NO later usage event + INTERRUPTED parent  → state:'queued'
//   - harness event + usage event → state:'done' or 'failed' (existing behavior preserved)
//   - No events (never dispatched)            → not in derived records
//   - Latest-wins dedupe: two harness events for same agentId → last one wins
//
// The current implementation has `if (!usage) continue` which drops the first two cases.
//
// Mock policy (integration): real deriveAgentRecords (exported from run-store.ts) + real
// InMemoryRunStore; no network. We call deriveAgentRecords directly with fixture transcripts,
// and test the run-status-aware behavior via the parent RunStatus parameter.
//
// Red reason: deriveAgentRecords currently drops agents with no usage event (if(!usage)continue).
//   Cases 1 and 2 fail because the agent is absent from the result.
//   Cases 4 and 5 also fail (harness event type not yet in TranscriptEvent.kind union).
import { describe, it, expect } from 'vitest';
import { deriveAgentRecords } from '../../src/run-store.js';
import type { TranscriptEvent } from '../../src/types.js';

function harnessEvent(agentId: string, seq: number = 1): TranscriptEvent {
  return {
    ts: new Date(seq * 1000).toISOString(),
    kind: 'harness' as TranscriptEvent['kind'], // new kind — not yet in union
    data: {
      agentId,
      descriptor: {
        model: 'rwe-proxy-claude-opus-4-8',
        provider: 'ollama',
        prompt: 'Do the thing',
        tools: ['bash'],
        skills: [],
        mcpServers: [],
        surfaceType: 'curated',
      },
    },
  };
}

function usageEvent(agentId: string, failed = false): TranscriptEvent {
  return {
    ts: new Date().toISOString(),
    kind: 'usage',
    data: failed
      ? { provider: 'p', model: 'm' } // no tokens → failed
      : { tokens: { input: 10, output: 5 }, provider: 'p', model: 'm', reason: 'stop' },
  };
}

describe('run-status-aware deriveAgentRecords (IT-065, DES-066)', () => {
  it('harness event + no usage + parent status running → agent state:"running"', () => {
    const transcripts = new Map<string, TranscriptEvent[]>([
      ['agent-1', [harnessEvent('agent-1')]],
    ]);
    // Parent is an in-process run (status='running') → agent appears as 'running'
    const records = deriveAgentRecords(transcripts, 'running');
    const rec = records.find((r) => r.agentId === 'agent-1');
    expect(rec).toBeDefined();
    expect(rec?.state).toBe('running');
    // #20: a restart-reconstructed running agent surfaces its backend from the harness descriptor,
    // not a blank model / 'unknown' provider.
    expect(rec?.model).toBe('rwe-proxy-claude-opus-4-8');
    expect(rec?.provider).toBe('ollama');
  });

  it('harness event + no usage + parent status interrupted → agent state:"queued" (will re-dispatch on resume)', () => {
    const transcripts = new Map<string, TranscriptEvent[]>([
      ['agent-2', [harnessEvent('agent-2')]],
    ]);
    // Parent is interrupted (crashed/restarted) → must not show running spinner; show queued
    const records = deriveAgentRecords(transcripts, 'interrupted');
    const rec = records.find((r) => r.agentId === 'agent-2');
    expect(rec).toBeDefined();
    expect(rec?.state).toBe('queued');
  });

  it('harness event + no usage + parent status suspended → agent state:"queued"', () => {
    const transcripts = new Map<string, TranscriptEvent[]>([
      ['agent-s', [harnessEvent('agent-s')]],
    ]);
    const records = deriveAgentRecords(transcripts, 'suspended');
    const rec = records.find((r) => r.agentId === 'agent-s');
    expect(rec).toBeDefined();
    expect(rec?.state).toBe('queued');
  });

  it('harness + usage event → state:"done" (existing terminal behavior preserved)', () => {
    const transcripts = new Map<string, TranscriptEvent[]>([
      ['agent-3', [harnessEvent('agent-3'), usageEvent('agent-3')]],
    ]);
    const records = deriveAgentRecords(transcripts, 'completed');
    const rec = records.find((r) => r.agentId === 'agent-3');
    expect(rec).toBeDefined();
    expect(rec?.state).toBe('done');
  });

  it('no events for an agent (never dispatched) → not in derived records', () => {
    // An agent in the schedule but never dispatched has no transcript at all.
    const transcripts = new Map<string, TranscriptEvent[]>([
      ['agent-none', []],
    ]);
    const records = deriveAgentRecords(transcripts, 'running');
    const rec = records.find((r) => r.agentId === 'agent-none');
    expect(rec).toBeUndefined();
  });

  it('latest-wins dedupe: two harness events for same agentId → last one used', () => {
    // The bounded SCHEMA_RETRY_ATTEMPTS loop can build a session more than once.
    const h1 = harnessEvent('agent-retry', 1); // first attempt
    const h2: TranscriptEvent = {
      ts: new Date(2000).toISOString(),
      kind: 'harness' as TranscriptEvent['kind'],
      data: {
        agentId: 'agent-retry',
        descriptor: {
          prompt: 'Retry prompt', // different prompt — latest wins
          tools: ['read_file'],
          skills: [],
          mcpServers: [],
          surfaceType: 'curated',
        },
      },
    };
    const transcripts = new Map<string, TranscriptEvent[]>([
      ['agent-retry', [h1, h2]],
    ]);
    const records = deriveAgentRecords(transcripts, 'running');
    const recs = records.filter((r) => r.agentId === 'agent-retry');
    // Only ONE record (deduplicated), using data from h2 (latest)
    expect(recs.length).toBe(1);
    // The harness data from h2 (if accessible) would be the latest
    // At minimum, state is running (one harness, no usage)
    expect(recs[0]?.state).toBe('running');
  });
});
