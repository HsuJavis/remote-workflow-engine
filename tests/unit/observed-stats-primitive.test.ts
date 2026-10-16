// UT-352 (DES-273, ARCH-191/192, TASK-270): `loadFacts` reads `kind = data.primitive` (checked
// BEFORE the harness-descriptor tools/prose rule) so a decide/image usage event lands in its own
// `AgentCallFact.kind` bucket ('decide'/'image'), never folded into 'tools'/'prose'.
//
// Mock policy (unit): a fake `ObservedStatsSource` (no real SQLite — this file tests the pure fold).
// Red reason: `loadFacts` has no branch reading `data.primitive` yet — every fact derived from a
// primitive usage event comes back `kind:'prose'` (no harness tools descriptor), not `'decide'`/
// `'image'`.
import { describe, it, expect } from 'vitest';
import { loadFacts, aggregateFacts, type ObservedStatsSource, type AgentCallFact } from '../../src/models/observed-stats.js';
import type { TranscriptEvent } from '../../src/types.js';

function fakeSource(transcripts: Map<string, TranscriptEvent[]>): ObservedStatsSource {
  return {
    terminalRunIdsSince: () => ['run-1'],
    settledCallEvents: () => transcripts,
  } as unknown as ObservedStatsSource;
}

function decideEvents(): TranscriptEvent[] {
  return [
    { ts: '2026-10-01T00:00:00Z', kind: 'harness', data: { descriptor: { model: 'typesafe/jev-1.13', provider: 'openrouter', label: 'gate' } } },
    {
      ts: '2026-10-01T00:00:01Z', kind: 'usage',
      data: { primitive: 'decide', label: 'gate', agentKey: 'gate', provider: 'openrouter', model: 'typesafe/jev-1.13', startedAt: '2026-10-01T00:00:00Z', costUSD: 0.001, unpriced: false, tokens: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 } },
    },
  ];
}

describe('UT-352: loadFacts kind bucket for primitives (DES-273)', () => {
  it('a decide usage event produces a fact with kind:"decide", not "prose"/"tools"', () => {
    const transcripts = new Map([['agent-1', decideEvents()]]);
    const facts = loadFacts(fakeSource(transcripts), '2026-10-01T00:00:00Z');
    expect(facts).toHaveLength(1);
    expect(facts[0]?.kind).toBe('decide');
  });

  it('an image usage event produces a fact with kind:"image"', () => {
    const events: TranscriptEvent[] = [
      { ts: '2026-10-01T00:00:00Z', kind: 'harness', data: { descriptor: { model: 'black-forest-labs/flux-1.1-pro', provider: 'openrouter', label: 'hero' } } },
      { ts: '2026-10-01T00:00:01Z', kind: 'usage', data: { primitive: 'image', label: 'hero', agentKey: 'hero', provider: 'openrouter', model: 'black-forest-labs/flux-1.1-pro', startedAt: '2026-10-01T00:00:00Z', costUSD: 0.03, unpriced: false } },
    ];
    const transcripts = new Map([['agent-2', events]]);
    const facts = loadFacts(fakeSource(transcripts), '2026-10-01T00:00:00Z');
    expect(facts[0]?.kind).toBe('image');
  });

  it('a chat agent usage event (no data.primitive) still falls back to prose/tools exactly as before', () => {
    const events: TranscriptEvent[] = [
      { ts: '2026-10-01T00:00:00Z', kind: 'harness', data: { descriptor: { model: 'claude-sonnet-5', provider: 'anthropic', label: 'summarize' } } },
      { ts: '2026-10-01T00:00:01Z', kind: 'usage', data: { label: 'summarize', provider: 'anthropic', model: 'claude-sonnet-5', startedAt: '2026-10-01T00:00:00Z', tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } } },
    ];
    const transcripts = new Map([['agent-3', events]]);
    const facts = loadFacts(fakeSource(transcripts), '2026-10-01T00:00:00Z');
    expect(facts[0]?.kind).toBe('prose');
  });
});

// UT-359 (DES-273, ARCH-191/192, ruling R-7, TASK-270): `aggregateFacts` buckets decide/image facts
// into their OWN `decide`/`image` CallStats — never folded into `prose`/`tools`. CHARACTERIZATION
// (green at the time of writing — the bucketing landed in the Gate 6 WIP commit 0c31a63 without a
// direct test); the perturbation case proves the assertion can fail.
describe('UT-359: aggregateFacts decide/image buckets (R-7; characterization)', () => {
  const fact = (kind: AgentCallFact['kind'], ref = 'openrouter/typesafe/jev-1.13', success = true): AgentCallFact => ({
    ref, kind, success, startedAt: '2026-10-01T00:00:00.000Z', endedAt: '2026-10-01T00:00:00.400Z',
    inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.001,
  });

  it('decide-only facts fill `decide`; prose/tools/image stay null', () => {
    const b = aggregateFacts([fact('decide'), fact('decide', undefined, false)]).get('openrouter/typesafe/jev-1.13');
    expect(b?.decide?.calls).toBe(2);
    expect(b?.decide?.successRate).toBe(0.5);
    expect(b?.prose).toBeNull();
    expect(b?.tools).toBeNull();
    expect(b?.image).toBeNull();
  });

  it('image facts fill `image` only, per ref', () => {
    const m = aggregateFacts([fact('image', 'openrouter/acme/pixel-1'), fact('prose', 'openrouter/acme/chat-1')]);
    expect(m.get('openrouter/acme/pixel-1')?.image?.calls).toBe(1);
    expect(m.get('openrouter/acme/pixel-1')?.prose).toBeNull();
    expect(m.get('openrouter/acme/chat-1')?.image).toBeNull();
  });

  it('perturbation guard: a prose fact DOES land in prose (so the null assertions above can fail)', () => {
    const b = aggregateFacts([fact('prose')]).get('openrouter/typesafe/jev-1.13');
    expect(b?.prose?.calls).toBe(1);
    expect(b?.decide).toBeNull();
  });
});
