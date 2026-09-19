// UT-277 (v31, REQ-186, R30-A1): a call that has not reported usage yet has NO token figure —
// absent, not zero.
//
// Found by running a real three-phase workflow against a live engine, after two independent
// audits had both recorded the same coverage hole: nothing had ever rendered a RUNNING agent, so
// nothing had ever asked what its usage reads. The wire answered
// `tokens:{input:0,output:0,cacheRead:0,cacheWrite:0}` while the call was still in flight, and the
// dashboard faithfully printed `0 tok` on three surfaces. The same agent finished at 2861 tokens.
//
// The two states that change are `queued` and `running`. `failed` and `refused` keep their zeros:
// DES-188 rules "a failed call moves no counter", and those are TERMINAL — nobody is waiting for
// their figure to arrive. This is the distinction the fix turns on, not a blanket rule.
import { describe, it, expect } from 'vitest';
import { deriveAgentRecords } from '../../src/run-store.js';
import type { TranscriptEvent } from '../../src/types.js';

const harness = (label: string): TranscriptEvent =>
  ({ kind: 'harness', data: { descriptor: { model: 'qwen2.5:7b', provider: 'ollama', label } } } as unknown as TranscriptEvent);

// `deriveAgentRecords` takes a Map<agentId, events>, not a bare array.
const one = (events: TranscriptEvent[]): Map<string, TranscriptEvent[]> => new Map([['agent-1', events]]);

describe('deriveAgentRecords: an un-measured call has no token figure (UT-277, REQ-186)', () => {
  it('a harness-only record (running) omits tokens rather than zero-filling them', () => {
    const [rec] = deriveAgentRecords(one([harness('triage')]), 'running');
    expect(rec!.state).toBe('running');
    expect(rec!.tokens, 'a running agent reported a measured zero').toBeUndefined();
  });

  it('the same record on an interrupted parent (queued) also omits them', () => {
    const [rec] = deriveAgentRecords(one([harness('triage')]), 'interrupted');
    expect(rec!.state).toBe('queued');
    expect(rec!.tokens).toBeUndefined();
  });

  it('a FAILED call keeps its zeros — DES-188: it moved no counter, which is a measurement', () => {
    const events = [
      harness('triage'),
      { kind: 'usage', data: { failed: true, provider: 'ollama' } } as unknown as TranscriptEvent,
    ];
    const [rec] = deriveAgentRecords(one(events), 'running');
    expect(rec!.state).toBe('failed');
    expect(rec!.tokens).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
  });

  it('a done call still carries its real figures', () => {
    const events = [
      harness('triage'),
      { kind: 'usage', data: { tokens: { input: 2, output: 3 }, model: 'qwen2.5:7b', provider: 'ollama' } } as unknown as TranscriptEvent,
    ];
    const [rec] = deriveAgentRecords(one(events), 'running');
    expect(rec!.state).toBe('done');
    expect(rec!.tokens).toMatchObject({ input: 2, output: 3 });
  });
});
