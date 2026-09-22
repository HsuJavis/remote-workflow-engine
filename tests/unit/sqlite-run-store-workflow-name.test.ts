// Gate 6.5+7 coverage gate (v23, TASK-126/DES-128/ARCH-078): `SqliteRunStore.getWorkflowName` — the
// SYNC `TriggerPorts.runs` read `getTriggerBindings` uses for the chain-upstream join. It shipped
// with ZERO direct coverage (0/3 lines): the composition root wires it, and every describe/analyzer
// test in the suite runs with a ports object whose `runs.getWorkflowName` is a stub, so the real
// SQL was never executed. The two answers it must distinguish are exactly the two a wrong query
// blurs together — a real upstream name, and a purged/unknown run, which must be a first-class
// `null` and never an invented name (DES-128).
//
// Mock policy (unit, DES-119): a REAL `SqliteRunStore` on real on-disk sqlite under a tmpdir — the
// point of the test is the query, so an in-memory fake would prove nothing.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FixedClock } from '../../src/clock.js';
import { SqliteRunStore } from '../../src/store/sqlite-run-store.js';

const CLOCK = new FixedClock(new Date('2026-09-03T10:00:00.000Z'));
let dir: string;
let store: SqliteRunStore;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'rwe-runstore-name-')); store = new SqliteRunStore(join(dir, 'store'), CLOCK); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('SqliteRunStore.getWorkflowName — the chain-upstream join (v23, DES-128, ARCH-078)', () => {
  it('returns the registered workflow name of an existing run', async () => {
    const runId = await store.createRun({ origin: 'local', name: 'upstream-wf', script: 'return 1;' });
    expect(store.getWorkflowName(runId)).toBe('upstream-wf');
  });

  it('an unknown runId is a first-class null, never an invented name', () => {
    expect(store.getWorkflowName('no-such-run')).toBeNull();
  });

  it('a run submitted with no workflow name (inline script) is null, not the empty string', async () => {
    const runId = await store.createRun({ origin: 'local', script: 'return 1;' });
    expect(store.getWorkflowName(runId)).toBeNull();
  });
});
