// IT-314 (REQ-230, DES-274 "hot path", TASK-271): engine overhead on a single decide() call —
// (script-observed elapsed) − (provider-observed elapsed) — p95 <= 200ms over 100 calls, against a
// stub provider with a FIXED, injected (non-wall-clock) provider-side delay.
//
// Mock policy (integration): real RunManager/sandbox fork; stub provider with a deterministic fixed
// latency (not a real network call — REQ-230 is an ENGINE overhead measurement, the provider leg is
// the one deliberately-fixed input, not the thing under test).
//
// Red reason: the feature is unimplemented (decide() is not a sandbox global) — the run never
// completes once, so it cannot be driven 100 times to compute a p95 at all. Asserting completion is
// the honest red (same discipline as IT-312): no percentile can be computed over zero successful
// samples.
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

describe('IT-314: engine overhead p95 <= 200ms over 100 decide() calls (REQ-230)', () => {
  it('100 sequential decide() calls each complete (precondition this feature does not meet today)', async () => {
    const steps = Array.from({ length: 100 }, () => ({ status: 200, body: { answers: { ok: { type: 'noul', noul: 0.5 } } } }));
    const stub = makeStubFetch(steps);
    const store = new InMemoryRunStore(new FixedClock(new Date('2026-10-01T00:00:00Z')));
    const mgr = new RunManager({ store, directDeps: { fetch: stub.fetch } } as any);
    const calls = Array.from({ length: 100 }, (_, i) => `await decide('gate', { state: { i: ${i} }, questions: { ok: { type: 'bool', instructions: 'i', criteria: { true: 't', false: 'f' } } } });`).join('\n');
    const runId = await startScript(mgr, `${META}\n${calls}\nreturn 'done';`, {});
    const view = await pollStatus(mgr, runId, 10, 500);
    expect(view.status).toBe('completed');
    expect(stub.calls).toHaveLength(100);
    // Once the feature completes, the real p95 measurement goes here (script-observed minus
    // providerMsTotal, read off the primitive.call terminal event's `engineMs`). Deferred until the
    // precondition above is green — see this file's header note.
  });
});
