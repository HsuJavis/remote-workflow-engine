// dash-auth-spec.md section C (2026-09-30): `deriveAgentRecords` (run-store.ts) is the restart
// reconstruction path — the one a genuinely crashed process (no terminal snapshot ever written)
// falls back to, `getRun()`'s own doc. It must rebuild an ABORTED call's record byte-identical to
// the live one `AgentTranscriptSink.capture()` builds (DES-188's derived≡snapshot lock), off
// EXACTLY the two transcript events `capture()`'s failed branch persists: the `harness` event
// `markHarness` already wrote (real provider/model, from before the abort) and the `usage` event
// `_finalizeAborted`'s capture() call appends (`reason:'aborted'`, and — after this slice's repair
// — the MERGED provider, not `''` raw).
//
// This is deliberately a pure unit test over a hand-built transcript (not a real RunManager run):
// `RunManager.stop()`'s terminal-snapshot write races the in-flight abort's own capture() (the
// pre-existing, deliberately-unfixed #53/adjudication #9 I-2 race —
// tests/integration/aborted-agent-record-finalized.test.ts's own top comment), so asserting the
// restart path through a live run would be non-deterministic for reasons outside this slice's scope.
//
// Red reason (measured): `AgentRecord.failReason` does not exist yet; before the agent-executor.ts
// repair, a `usage` event for an aborted call carried `provider: ''` (raw `result.provider`, not the
// `prev?.provider || result.provider` merge), so `deriveAgentRecords` derived `provider: 'unknown'`
// (the `data.provider ?? 'unknown'` fallback never fires on `''`, so it read back the empty string,
// not even the fallback) regardless of what the harness event had already recorded.
import { describe, it, expect } from 'vitest';
import { deriveAgentRecords } from '../../src/run-store.js';
import type { TranscriptEvent } from '../../src/types.js';

describe('deriveAgentRecords reconstructs an aborted call byte-identical to the live record (dash-auth-spec C)', () => {
  it('provider/model come from the harness event; failReason mirrors the usage event verbatim', () => {
    const events: TranscriptEvent[] = [
      {
        ts: '2026-09-30T00:00:00.000Z', kind: 'harness',
        data: {
          agentId: 'agent-1',
          descriptor: { model: 'claude-abort-1', provider: 'anthropic', prompt: 'p', tools: [], skills: [], mcpServers: [], surfaceType: 'none' },
        },
      },
      {
        ts: '2026-09-30T00:00:05.000Z', kind: 'usage',
        // exactly what capture()'s failed branch now persists for `_finalizeAborted`'s result —
        // `provider` is the MERGED value (agent-executor.ts's repair), never `''`.
        data: { reason: 'aborted', provider: 'anthropic', detail: 'ABORTED: the run was suspended or stopped while this call was in flight' },
      },
    ];
    const transcripts = new Map<string, TranscriptEvent[]>([['agent-1', events]]);
    const [rec] = deriveAgentRecords(transcripts, 'stopped');
    expect(rec).toBeDefined();
    expect(rec!.state).toBe('failed');
    expect(rec!.provider).toBe('anthropic');
    expect(rec!.model).toBe('claude-abort-1');
    expect(rec!.failReason).toBe('aborted');
    expect(rec!.detail).toMatch(/aborted/i);
  });

  it('a genuine gateway timeout keeps failReason:"timeout", distinct from an abort', () => {
    const events: TranscriptEvent[] = [
      {
        ts: '2026-09-30T00:00:00.000Z', kind: 'harness',
        data: {
          agentId: 'agent-2',
          descriptor: { model: 'm', provider: 'ollama', prompt: 'p', tools: [], skills: [], mcpServers: [], surfaceType: 'none' },
        },
      },
      { ts: '2026-09-30T00:00:05.000Z', kind: 'usage', data: { reason: 'timeout', provider: 'ollama' } },
    ];
    const transcripts = new Map<string, TranscriptEvent[]>([['agent-2', events]]);
    const [rec] = deriveAgentRecords(transcripts, 'failed');
    expect(rec!.failReason).toBe('timeout');
  });

  it('a pre-this-slice usage event with no `reason` leaves failReason absent, never a guessed value', () => {
    const events: TranscriptEvent[] = [
      { ts: '2026-09-30T00:00:05.000Z', kind: 'usage', data: { provider: 'anthropic' } },
    ];
    const transcripts = new Map<string, TranscriptEvent[]>([['agent-3', events]]);
    const [rec] = deriveAgentRecords(transcripts, 'failed');
    expect(rec!.failReason).toBeUndefined();
  });
});
