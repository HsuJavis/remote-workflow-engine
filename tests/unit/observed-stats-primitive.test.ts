// UT-352 (DES-273, ARCH-191/192, TASK-270): `loadFacts` reads `kind = data.primitive` (checked
// BEFORE the harness-descriptor tools/prose rule) so a decide/image usage event lands in its own
// `AgentCallFact.kind` bucket ('decide'/'image'), never folded into 'tools'/'prose'.
//
// Mock policy (unit): a fake `ObservedStatsSource` (no real SQLite — this file tests the pure fold).
// Red reason: `loadFacts` has no branch reading `data.primitive` yet — every fact derived from a
// primitive usage event comes back `kind:'prose'` (no harness tools descriptor), not `'decide'`/
// `'image'`.
import { describe, it, expect } from 'vitest';
import { loadFacts, type ObservedStatsSource } from '../../src/models/observed-stats.js';
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
