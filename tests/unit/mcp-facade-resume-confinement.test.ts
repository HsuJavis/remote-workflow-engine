// issue #93 item 2 — `McpFacade.runResume()` is now the SOLE cover for a remote peer resuming a
// run whose PINNED version is intact (call-tool.ts's own early door, which used to be that cover,
// is removed — see call-tool-confinement-door.test.ts's header). `RunManager.resume()` itself only
// gates the legacy-substitution case (INV-V37-5(c): "the pinned path stays ungated" is a
// deliberate owner ruling). Checked AFTER `runResume`'s own RUN_NOT_FOUND existence check, and
// BEFORE `RunManager.resume()` is ever called — proved here via a spy, never a real resume.
import { describe, it, expect, vi } from 'vitest';
import { McpFacade } from '../../src/mcp-facade.js';
import { InMemoryRunStore } from '../../src/run-store.js';
import type { Clock } from '../../src/clock.js';

const ANCHOR = new Date('2026-09-26T00:00:00.000Z');
const CLOCK: Clock = { now: () => ANCHOR.getTime(), isoNow: () => ANCHOR.toISOString() };
const PRINCIPAL = { kind: 'auth-disabled' } as const;

async function seededFacade(confinementPosture?: 'confined' | 'unconfined'): Promise<{ facade: McpFacade; runId: string; resume: ReturnType<typeof vi.fn> }> {
  const store = new InMemoryRunStore(CLOCK);
  const runId = await store.createRun({ name: 'wf', args: {}, origin: 'local' } as never);
  const resume = vi.fn().mockResolvedValue(undefined);
  const runManager = { resume, catalog: undefined } as never;
  const facade = new McpFacade({ runManager, store, confinementPosture } as never);
  return { facade, runId, resume };
}

describe('issue #93 item 2 — McpFacade.runResume() confinement door', () => {
  it('[LOAD-BEARING] nonexistent runId => RUN_NOT_FOUND, never CONFINEMENT_UNAVAILABLE, even remote+unconfined', async () => {
    const { facade, resume } = await seededFacade('unconfined');
    const result = await facade.runResume({ runId: 'does-not-exist' }, PRINCIPAL, true);
    expect(result.error?.code).toBe('RUN_NOT_FOUND');
    expect(resume).not.toHaveBeenCalled();
  });

  it('[LOAD-BEARING] existing run, remote + unconfined => CONFINEMENT_UNAVAILABLE; RunManager.resume() never called (no side effect)', async () => {
    const { facade, runId, resume } = await seededFacade('unconfined');
    const result = await facade.runResume({ runId }, PRINCIPAL, true);
    expect(result.error?.code).toBe('CONFINEMENT_UNAVAILABLE');
    expect(resume).not.toHaveBeenCalled();
  });

  it('existing run, LOCAL (isRemoteSubmission false/omitted), unconfined => reaches RunManager.resume()', async () => {
    const { facade, runId, resume } = await seededFacade('unconfined');
    await facade.runResume({ runId }, PRINCIPAL);
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it('existing run, remote + confined => reaches RunManager.resume() (the door only closes when the posture is degraded)', async () => {
    const { facade, runId, resume } = await seededFacade('confined');
    await facade.runResume({ runId }, PRINCIPAL, true);
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it('existing run, remote + posture omitted (fail-open, matches every other confinement-gated surface) => reaches RunManager.resume()', async () => {
    const { facade, runId, resume } = await seededFacade(undefined);
    await facade.runResume({ runId }, PRINCIPAL, true);
    expect(resume).toHaveBeenCalledTimes(1);
  });
});
