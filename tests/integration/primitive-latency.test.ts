// IT-314 (REQ-230, DES-274 "hot path", TASK-271): engine overhead on a single decide() call —
// (script-observed elapsed) − (provider-observed elapsed) — p95 <= 200ms over 100 calls, against a
// stub provider with a FIXED, injected (non-wall-clock) provider-side delay.
//
// Mock policy (integration): real RunManager/sandbox fork; stub provider with a deterministic fixed
// latency (not a real network call — REQ-230 is an ENGINE overhead measurement, the provider leg is
// the one deliberately-fixed input, not the thing under test).
//
// v40 Gate 6 ruling R-19: the REQ-230 bound is now actually asserted. Script-side `Date.now()` is
// refused by the sandbox determinism guard, and the run's `FixedClock` makes event-log timestamps
// useless for timing, so EVERY timestamp is taken stub-side (performance.now() in the test process):
// for 101 sequential decide() calls, call i's provider leg is `end[i] - start[i]` (the stub's own
// fixed delay, measured), and the engine overhead around it is the inter-call gap
// `start[i+1] - end[i]` = engine return leg of call i + script continuation + engine dispatch leg of
// call i+1 — i.e. the script-observed cycle minus the provider-observed time. 100 gaps → p95 <= 200ms.
//
// Red reason: until the core decide() path completes end-to-end, the run ends `failed` — the
// `status === 'completed'` assertion fails first (never "no samples" or a timing artefact).
import { describe, it, expect } from 'vitest';
import { RunManager } from '../../src/run-manager.js';
import { InMemoryRunStore } from '../../src/run-store.js';
import { FixedClock } from '../../src/clock.js';
import { startScript } from '../helpers/workflow-fixtures.js';
import { makeStubFetch } from '../helpers/stub-fetch.js';

async function pollStatus(mgr: RunManager, runId: string, ms = 10, maxIter = 150): Promise<any> {
  for (let i = 0; i < maxIter; i++) {
    const v = await mgr.status(runId);
    if (['completed', 'failed', 'stopped'].includes(v.status)) return v;
    await new Promise((r) => setTimeout(r, ms));
  }
  return mgr.status(runId);
}

const META = `export const meta = { phases: [], params: {
  decisions: { gate: { model: { type: 'string', default: 'openrouter/typesafe/jev-1.13' }, timeoutMs: { type: 'number', default: 5000 }, retries: { type: 'number', default: 0 } } }
} };`;

const FIXED_PROVIDER_MS = 20;
const CALLS = 101; // 101 sequential calls → 100 inter-call gaps (one overhead sample per gap)

/** Wraps the shared stub with a fixed, real provider-side delay and stub-side timestamps. */
function timedStub(inner: typeof fetch): { fetch: typeof fetch; start: number[]; end: number[] } {
  const start: number[] = [];
  const end: number[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    start.push(performance.now());
    await new Promise((r) => setTimeout(r, FIXED_PROVIDER_MS));
    const res = await inner(input, init);
    end.push(performance.now());
    return res;
  }) as typeof fetch;
  return { fetch: f, start, end };
}

function p95(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)]!;
}

describe('IT-314: engine overhead p95 <= 200ms over 100 decide() calls (REQ-230)', () => {
  it('p95(script-observed cycle - provider-observed time) <= 200ms over 100 calls, stub-side timestamps', async () => {
    const steps = Array.from({ length: CALLS }, () => ({ status: 200, body: { answers: { ok: { type: 'noul', noul: 0.5 } } } }));
    const stub = makeStubFetch(steps);
    const timed = timedStub(stub.fetch);
    const store = new InMemoryRunStore(new FixedClock(new Date('2026-10-01T00:00:00Z')));
    const mgr = new RunManager({ store, directDeps: { fetch: timed.fetch, resolveKey: () => 'sk-test' } } as any);
    const calls = Array.from({ length: CALLS }, (_, i) => `await decide('gate', { state: { i: ${i} }, questions: { ok: { type: 'bool', instructions: 'i', criteria: { true: 't', false: 'f' } } } });`).join('\n');
    const runId = await startScript(mgr, `${META}\n${calls}\nreturn 'done';`, {});
    const view = await pollStatus(mgr, runId, 10, 2000);
    expect(view.status, JSON.stringify(view.error ?? view.result ?? null)).toBe('completed');
    expect(stub.calls).toHaveLength(CALLS);
    expect(timed.start).toHaveLength(CALLS);
    expect(timed.end).toHaveLength(CALLS);
    // Sanity: the provider leg really is the fixed delay (guards against a stub that never waited).
    for (let i = 0; i < CALLS; i++) expect(timed.end[i]! - timed.start[i]!).toBeGreaterThanOrEqual(FIXED_PROVIDER_MS - 1);
    const overhead = Array.from({ length: CALLS - 1 }, (_, i) => timed.start[i + 1]! - timed.end[i]!);
    expect(overhead).toHaveLength(100);
    expect(p95(overhead)).toBeLessThanOrEqual(200);
  }, 60000);
});
