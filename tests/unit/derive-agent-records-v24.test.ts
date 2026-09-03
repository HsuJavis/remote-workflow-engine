// UT-162 (DES-161, v24): deriveAgentRecords fills AgentRecord.label from the descriptor — the
// first DURABLE source (today it's only ever set on the transient live path, lost on restart).
// Written test-first (Gate 5, RED) — deriveAgentRecords never reads descriptor.label at all.
import { describe, it, expect } from 'vitest';
import { deriveAgentRecords } from '../../src/run-store.js';
import type { TranscriptEvent } from '../../src/types.js';

function harnessEvent(label: string): TranscriptEvent {
  return { kind: 'harness', data: { descriptor: { model: 'sonnet-5', provider: 'anthropic', label } } } as unknown as TranscriptEvent;
}

function usageEventWithLabelSource(label: string): TranscriptEvent[] {
  return [harnessEvent(label), { kind: 'usage', data: { tokens: { input: 1, output: 1 }, model: 'sonnet-5', provider: 'anthropic' } } as unknown as TranscriptEvent];
}

describe('deriveAgentRecords — v24 label fill (UT-162, DES-161)', () => {
  it('a running (non-terminal) agent whose harness event carries descriptor.label reports that label', () => {
    const transcripts = new Map([['agent-1', [harnessEvent('plan')]]]);
    const records = deriveAgentRecords(transcripts, 'running');
    expect(records[0]).toMatchObject({ agentId: 'agent-1', label: 'plan' });
  });

  it('on the terminal (usage) branch, label is copied from the LATEST harness event of the same agent', () => {
    const transcripts = new Map([['agent-1', usageEventWithLabelSource('review')]]);
    const records = deriveAgentRecords(transcripts, 'running');
    expect(records[0]).toMatchObject({ agentId: 'agent-1', label: 'review' });
  });

  it('a pre-v24 transcript with no descriptor.label leaves the key ABSENT, never defaulted', () => {
    const noLabelHarness = { kind: 'harness', data: { descriptor: { model: 'sonnet-5', provider: 'anthropic' } } } as unknown as TranscriptEvent;
    const transcripts = new Map([['agent-1', [noLabelHarness]]]);
    const records = deriveAgentRecords(transcripts, 'running');
    expect('label' in records[0]!).toBe(false);
  });
});
