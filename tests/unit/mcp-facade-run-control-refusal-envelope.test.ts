// issue #98 item 9 — `run_resume`/`run_suspend`/`run_stop` used to answer a refusal (ILLEGAL_TRANSITION
// and any other coded error) with an envelope shaped `{runId, status:<the RUN's own status>, error}`
// (e.g. `{status:'completed', error}`) instead of the standard failed-refusal envelope every other
// tool uses (`{runId, status:'failed', error}` — `run_start`/`workflow_register`/etc. via `toErrEnvelope`).
// A caller branching on `status === 'failed'` to detect a refusal silently missed every run-control
// refusal. These are unit tests: a stub `RunManager` that rejects, so the envelope-shaping code in
// `lifecycle()`/`runResume()` is exercised in isolation, without a real transition ever happening.
import { describe, it, expect, vi } from 'vitest';
import { McpFacade } from '../../src/mcp-facade.js';
import { InMemoryRunStore } from '../../src/run-store.js';
import { IllegalTransitionError } from '../../src/errors.js';
import type { Clock } from '../../src/clock.js';

const ANCHOR = new Date('2026-09-26T00:00:00.000Z');
const CLOCK: Clock = { now: () => ANCHOR.getTime(), isoNow: () => ANCHOR.toISOString() };
const PRINCIPAL = { kind: 'auth-disabled' } as const;

// Each test seeds a run whose STORED status is deliberately something OTHER than 'failed' (and
// other than the call's own target status), so a result that came back `status: <that status>`
// could only be reading the pre-fix `view.status` echo, never a coincidence.
function facadeWith(store: InMemoryRunStore, runManager: unknown): McpFacade {
  return new McpFacade({ runManager, store } as never);
}

describe('issue #98 item 9 — run control refusal envelope matches the standard {runId, status:"failed", error} shape', () => {
  it('run_suspend: a refusal reports status "failed", not the run\'s own status', async () => {
    const store = new InMemoryRunStore(CLOCK);
    const runId = await store.createRun({ name: 'wf', args: {}, origin: 'local' } as never);
    await store.recordTransition(runId, null, 'queued', CLOCK.isoNow());
    await store.recordTransition(runId, 'queued', 'completed', CLOCK.isoNow());
    const suspend = vi.fn().mockRejectedValue(new IllegalTransitionError('completed', 'suspended'));
    const facade = facadeWith(store, { suspend });

    const result = await facade.runSuspend({ runId }, PRINCIPAL);

    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('ILLEGAL_TRANSITION');
    expect(result.runId).toBe(runId);
  });

  it('run_stop: a refusal reports status "failed", not the run\'s own status', async () => {
    const store = new InMemoryRunStore(CLOCK);
    const runId = await store.createRun({ name: 'wf', args: {}, origin: 'local' } as never);
    await store.recordTransition(runId, null, 'queued', CLOCK.isoNow());
    await store.recordTransition(runId, 'queued', 'completed', CLOCK.isoNow());
    const stop = vi.fn().mockRejectedValue(new IllegalTransitionError('completed', 'stopped'));
    const facade = facadeWith(store, { stop });

    const result = await facade.runStop({ runId }, PRINCIPAL);

    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('ILLEGAL_TRANSITION');
    expect(result.runId).toBe(runId);
  });

  it('run_resume: a refusal (RunManager.resume() throws) reports status "failed" — issue #94\'s "stopped → running" case', async () => {
    const store = new InMemoryRunStore(CLOCK);
    const runId = await store.createRun({ name: 'wf', args: {}, origin: 'local' } as never);
    await store.recordTransition(runId, null, 'queued', CLOCK.isoNow());
    await store.recordTransition(runId, 'queued', 'stopped', CLOCK.isoNow());
    const resume = vi.fn().mockRejectedValue(new IllegalTransitionError('stopped', 'running'));
    const facade = facadeWith(store, { resume, catalog: undefined });

    const result = await facade.runResume({ runId }, PRINCIPAL);

    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('ILLEGAL_TRANSITION');
    expect(result.error?.message).toContain('stopped → running');
    expect(result.runId).toBe(runId);
  });

  it('run_resume: the CONFINEMENT_UNAVAILABLE remote-admission refusal ALSO reports status "failed", not the run\'s own status', async () => {
    const store = new InMemoryRunStore(CLOCK);
    const runId = await store.createRun({ name: 'wf', args: {}, origin: 'local' } as never);
    await store.recordTransition(runId, null, 'queued', CLOCK.isoNow());
    await store.recordTransition(runId, 'queued', 'suspended', CLOCK.isoNow());
    const resume = vi.fn().mockResolvedValue(undefined);
    const facade = new McpFacade({ runManager: { resume, catalog: undefined }, store, confinementPosture: 'unconfined' } as never);

    const result = await facade.runResume({ runId }, PRINCIPAL, true);

    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('CONFINEMENT_UNAVAILABLE');
    expect(resume).not.toHaveBeenCalled();
  });
});
