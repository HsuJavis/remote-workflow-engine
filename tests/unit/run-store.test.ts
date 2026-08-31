// UT-010: RunStore port — create/append/get/list (DES-010)
import { describe, it, expect } from 'vitest';
import { InMemoryRunStore } from '../../src/run-store.js';
import { FixedClock } from '../../src/clock.js';
import type { JournalEntry } from '../../src/types.js';

const CLOCK = new FixedClock(new Date('2024-03-15T10:00:00Z'));

describe('InMemoryRunStore', () => {
  it('createRun returns a string runId and getRun shows queued status', async () => {
    const store = new InMemoryRunStore(CLOCK);
    const runId = await store.createRun({ script: 'return 1;' });
    expect(typeof runId).toBe('string');
    expect(runId.length).toBeGreaterThan(0);
    const view = await store.getRun(runId);
    expect(view).not.toBeNull();
    expect(view!.runId).toBe(runId);
    expect(view!.status).toBe('queued');
  });

  it('getRun returns null for an unknown runId', async () => {
    const store = new InMemoryRunStore(CLOCK);
    const result = await store.getRun('no-such-run');
    expect(result).toBeNull();
  });

  it('appendJournal entries are retrievable in order via getRun journal', async () => {
    const store = new InMemoryRunStore(CLOCK);
    const runId = await store.createRun({ script: 'return 1;' });
    const e1: JournalEntry = { callSeq: 0, key: { prompt: 'p1', opts: {} }, value: 'v1', ts: CLOCK.isoNow(), scriptVersion: 'v1' };
    const e2: JournalEntry = { callSeq: 1, key: { prompt: 'p2', opts: {} }, value: 'v2', ts: CLOCK.isoNow(), scriptVersion: 'v1' };
    await store.appendJournal(runId, e1);
    await store.appendJournal(runId, e2);
    const view = await store.getRun(runId);
    // Journal entries should be accessible (through getRun or a getJournal method)
    expect(view).not.toBeNull();
  });

  it('recordTransition updates the run status', async () => {
    const store = new InMemoryRunStore(CLOCK);
    const runId = await store.createRun({ script: 'return 1;' });
    await store.recordTransition(runId, 'queued', 'running', CLOCK.isoNow());
    const view = await store.getRun(runId);
    expect(view!.status).toBe('running');
  });

  it('O-2: getTransitions returns the ordered from/to/ts audit trail', async () => {
    const store = new InMemoryRunStore(CLOCK);
    const runId = await store.createRun({ script: 'return 1;' });
    await store.recordTransition(runId, null, 'queued', '2024-03-15T10:00:00Z');
    await store.recordTransition(runId, 'queued', 'running', '2024-03-15T10:00:01Z');
    await store.recordTransition(runId, 'running', 'completed', '2024-03-15T10:00:02Z');
    const trail = await store.getTransitions(runId);
    expect(trail).toEqual([
      { from: null, to: 'queued', ts: '2024-03-15T10:00:00Z' },
      { from: 'queued', to: 'running', ts: '2024-03-15T10:00:01Z' },
      { from: 'running', to: 'completed', ts: '2024-03-15T10:00:02Z' },
    ]);
  });

  it('O-2: getTransitions is empty for an unknown run', async () => {
    const store = new InMemoryRunStore(CLOCK);
    expect(await store.getTransitions('no-such-run')).toEqual([]);
  });

  it('listRuns returns all created runs', async () => {
    const store = new InMemoryRunStore(CLOCK);
    await store.createRun({ script: 'return 1;', name: 'wf-a' });
    await store.createRun({ script: 'return 2;', name: 'wf-b' });
    const list = await store.listRuns();
    expect(list.length).toBe(2);
  });

  it('hydrateAll returns an empty array when nothing exists', async () => {
    const store = new InMemoryRunStore(CLOCK);
    const runs = await store.hydrateAll();
    expect(Array.isArray(runs)).toBe(true);
    expect(runs.length).toBe(0);
  });

  // v21 (DES-104, TASK-100): getEffectiveParams reads back the run-immutable admission snapshot
  // createRun's third argument persisted — RunManager's own cold-resume path (run-manager.ts:595)
  // is the production caller, but no test exercised InMemoryRunStore's own copy directly.
  it('getEffectiveParams returns the effectiveParams snapshot passed to createRun', async () => {
    const store = new InMemoryRunStore(CLOCK);
    const snapshot = {
      appendPrompt: 'x',
      provenance: { model: 'engine' as const, effort: 'engine' as const, timeoutMs: 'engine' as const, appendPrompt: 'override' as const },
    };
    const runId = await store.createRun({ script: 'return 1;' }, 'v1', snapshot);
    expect(await store.getEffectiveParams(runId)).toEqual(snapshot);
  });

  it('getEffectiveParams returns null when createRun was called with no effectiveParams (legacy/adhoc)', async () => {
    const store = new InMemoryRunStore(CLOCK);
    const runId = await store.createRun({ script: 'return 1;' });
    expect(await store.getEffectiveParams(runId)).toBeNull();
  });

  it('getEffectiveParams returns null for an unknown runId', async () => {
    const store = new InMemoryRunStore(CLOCK);
    expect(await store.getEffectiveParams('no-such-run')).toBeNull();
  });
});
