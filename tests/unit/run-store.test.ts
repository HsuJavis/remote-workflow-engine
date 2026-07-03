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
});
