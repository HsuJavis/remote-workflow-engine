// UT-067: startedBy provenance coalesce + read model (DES-063, ARCH-041)
//
// TASK-066 adds `startedBy:{type,id?}` to RunSpec and surfaces it on RunStatusView/RunSummary.
// The read model MUST coalesce absent/legacy absent column → {type:'unknown'} (total, never throws).
// The `chain` enum value is required (not just client|webhook|schedule) so a chained run never crashes.
//
// Mock policy (unit): InMemoryRunStore (real in-memory store, no network, no disk).
// Red reason: RunSpec has no `startedBy` field; RunStatusView has no `startedBy` field.
//   store.createRun ignores it; getRun returns no startedBy → assertions fail.
import { describe, it, expect } from 'vitest';
import { InMemoryRunStore } from '../../src/run-store.js';
import { FixedClock } from '../../src/clock.js';
import type { RunSpec, RunStatusView } from '../../src/types.js';

const CLOCK = new FixedClock(new Date('2024-01-01T00:00:00Z'));

// Cast helper — startedBy is a field being ADDED by TASK-066; not yet on RunSpec type.
function spec(overrides: Partial<RunSpec> & { startedBy?: { type: string; id?: string } }): RunSpec {
  return overrides as unknown as RunSpec;
}

describe('startedBy provenance coalesce (UT-067, DES-063)', () => {
  it('a run started with type:client → RunStatusView.startedBy is {type:"client"}', async () => {
    const store = new InMemoryRunStore(CLOCK);
    const runId = await store.createRun(spec({ script: 'return 1;', startedBy: { type: 'client' } }));
    const view = await store.getRun(runId);
    // TASK-066: startedBy must be surfaced on RunStatusView.
    expect(view).not.toBeNull();
    expect((view as unknown as { startedBy?: { type: string } }).startedBy?.type).toBe('client');
  });

  it('a run started with type:webhook+id → RunStatusView.startedBy carries both fields', async () => {
    const store = new InMemoryRunStore(CLOCK);
    const runId = await store.createRun(spec({ script: 'return 1;', startedBy: { type: 'webhook', id: 'wh-42' } }));
    const view = await store.getRun(runId) as unknown as { startedBy?: { type: string; id?: string } } | null;
    expect(view?.startedBy?.type).toBe('webhook');
    expect(view?.startedBy?.id).toBe('wh-42');
  });

  it('chain enum value is accepted (not only client|webhook|schedule) — required by ARCH-041', async () => {
    const store = new InMemoryRunStore(CLOCK);
    const runId = await store.createRun(spec({ script: 'return 1;', startedBy: { type: 'chain', id: 'parent-run-id' } }));
    const view = await store.getRun(runId) as unknown as { startedBy?: { type: string; id?: string } } | null;
    expect(view?.startedBy?.type).toBe('chain');
    expect(view?.startedBy?.id).toBe('parent-run-id');
  });

  it('absent startedBy (legacy row / internal start()) coalesces to {type:"unknown"} — total, never throws', async () => {
    // A run created WITHOUT startedBy (the legacy / internal path) must return {type:'unknown'},
    // never undefined/null/throw (DES-063 "total" invariant).
    const store = new InMemoryRunStore(CLOCK);
    const runId = await store.createRun({ script: 'return 1;' });
    const view = await store.getRun(runId) as unknown as { startedBy?: { type: string } } | null;
    // Must coalesce to unknown — never be missing entirely.
    expect(view?.startedBy?.type).toBe('unknown');
  });

  it('RunSummary (listRuns) also carries startedBy.type', async () => {
    const store = new InMemoryRunStore(CLOCK);
    await store.createRun(spec({ script: 'return 1;', name: 'mywf', startedBy: { type: 'schedule', id: 'daily' } }));
    const list = await store.listRuns();
    expect(list.length).toBe(1);
    const summary = list[0] as unknown as { startedBy?: { type: string; id?: string } };
    expect(summary.startedBy?.type).toBe('schedule');
    expect(summary.startedBy?.id).toBe('daily');
  });
});
