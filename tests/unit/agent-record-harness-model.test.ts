// #20: a still-running agent's record must surface WHICH model/provider it is waiting on the moment
// the gateway builds the session (onHarness, before the first token) — so workflow_status is not a
// blank model:""/provider:"" that makes a hung/slow backend indistinguishable from progress.
//
// This pins the LIVE path: run-manager assembles live workflow_status from the executor's in-memory
// records (getAllRecords), and onHarness calls sink.markHarness. Mock policy: none — the real
// AgentTranscriptSink, no store/guard.
import { describe, it, expect } from 'vitest';
import { AgentTranscriptSink } from '../../src/agent-executor.js';

describe('AgentTranscriptSink.markHarness surfaces model/provider on the live record (#20)', () => {
  it('a running agent shows blank model/provider until the harness arrives, then the real backend', () => {
    const sink = new AgentTranscriptSink();
    sink.markQueued('agent-1', 'lean:Architecture');
    sink.markRunning('agent-1', '2026-01-01T00:00:00.000Z');

    // Before the session is built, the record is running but the backend is not yet known.
    let rec = sink.getRecord('agent-1')!;
    expect(rec.state).toBe('running');
    expect(rec.model).toBe('');
    expect(rec.provider).toBe('');

    // The gateway builds the session and fires onHarness → markHarness.
    sink.markHarness('agent-1', 'rwe-proxy-claude-opus-4-8', 'ollama');

    rec = sink.getRecord('agent-1')!;
    expect(rec.model).toBe('rwe-proxy-claude-opus-4-8');
    expect(rec.provider).toBe('ollama');
    // Merge, not clobber: state / startedAt / label from markQueued+markRunning are preserved.
    expect(rec.state).toBe('running');
    expect(rec.startedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(rec.label).toBe('lean:Architecture');
  });

  it('markHarness on an unknown agentId is a no-op (never fabricates a phantom record)', () => {
    const sink = new AgentTranscriptSink();
    sink.markHarness('ghost', 'm', 'p');
    expect(sink.getRecord('ghost')).toBeUndefined();
    expect(sink.getAllRecords()).toHaveLength(0);
  });

  it('markActivity bumps lastActivityAt on a running record without clobbering state (#20 progress signal)', () => {
    const sink = new AgentTranscriptSink();
    sink.markQueued('agent-h');
    sink.markRunning('agent-h', '2026-01-01T00:00:00.000Z');
    expect(sink.getRecord('agent-h')!.lastActivityAt).toBeUndefined(); // no events yet → indistinguishable-until-now
    sink.markActivity('agent-h', '2026-01-01T00:00:03.000Z');
    let rec = sink.getRecord('agent-h')!;
    expect(rec.lastActivityAt).toBe('2026-01-01T00:00:03.000Z'); // progress is now observable
    expect(rec.state).toBe('running');
    expect(rec.startedAt).toBe('2026-01-01T00:00:00.000Z');
    sink.markActivity('agent-h', '2026-01-01T00:00:07.000Z'); // advances with each streamed event
    expect(sink.getRecord('agent-h')!.lastActivityAt).toBe('2026-01-01T00:00:07.000Z');
  });

  it('markActivity on an unknown agentId is a no-op', () => {
    const sink = new AgentTranscriptSink();
    sink.markActivity('ghost', '2026-01-01T00:00:00.000Z');
    expect(sink.getRecord('ghost')).toBeUndefined();
  });

  it('a failed/timed-out call preserves the markHarness model (post-mortem: which model failed) — #22', async () => {
    const sink = new AgentTranscriptSink();
    sink.markQueued('agent-x', 'lean:Architecture');
    sink.markRunning('agent-x', '2026-01-01T00:00:00.000Z');
    sink.markHarness('agent-x', 'rwe-proxy-claude-opus-4-8', 'ollama');
    // The gateway call times out (no model of its own on the failure result).
    await sink.capture('run-1', { agentId: 'agent-x', label: 'lean:Architecture' }, { ok: false, provider: 'ollama', reason: 'timeout' }, '2026-01-01T00:05:00.000Z');
    const rec = sink.getRecord('agent-x')!;
    expect(rec.state).toBe('failed');
    expect(rec.model).toBe('rwe-proxy-claude-opus-4-8'); // not wiped to ''
    expect(rec.provider).toBe('ollama');
  });

  it('latest-wins: a schema-retry re-fires markHarness and the newest model/provider wins', () => {
    const sink = new AgentTranscriptSink();
    sink.markQueued('agent-2');
    sink.markRunning('agent-2');
    sink.markHarness('agent-2', 'model-attempt-1', 'openai');
    sink.markHarness('agent-2', 'model-attempt-2', 'anthropic');
    const rec = sink.getRecord('agent-2')!;
    expect(rec.model).toBe('model-attempt-2');
    expect(rec.provider).toBe('anthropic');
  });
});
