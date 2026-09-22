// IT-302 (DES-263, ARCH-182, ADR-086, TASK-258, REQ-218) — the SCHEDULE admission route: a
// resident trigger created by a REMOTE submission (`createdRemote`) is refused when the engine is
// measured `unconfined`, while a LOCALLY-created trigger still fires. Proves SqliteSchedulerPort
// correctly stamps `origin` from the trigger row's own stored `createdRemote` column and maps a
// thrown admission refusal into ScheduleResult's typed `error`, per DES-263's own testability note:
// a fake RunManagerPort that itself applies admissionRefusal(), no HTTP server / ticker / clock.
// Written test-first (RED): NewSchedule/Schedule carry no `createdRemote` field (TS error), and
// `Scheduler.trigger()` neither stamps `origin` nor wraps `_runManager.start()` in a try/catch — a
// thrown coded error today escapes `trigger()`'s own Promise<ScheduleResult<T>> as a rejection.
import { describe, it, expect } from 'vitest';
import { FixedClock } from '../../src/clock.js';
import { SqliteSchedulerPort } from '../../src/scheduler.js';
import { codedError } from '../../src/errors.js';

const CLOCK = new FixedClock(new Date('2020-03-01T10:00:00.000Z'));

function fakeCatalog(names: string[]) {
  return { exists: async (n: string) => names.includes(n) };
}

// Mirrors src/run-manager.ts's own admissionRefusal({posture:'unconfined', origin}) rather than
// re-deriving a different rule — this test proves the WIRING (does the scheduler stamp the right
// origin and map the refusal correctly), not the predicate itself (that is UT-329's job).
function fakeUnconfinedRunManager() {
  let n = 0;
  return {
    async start(spec: { origin: 'local' | 'remote' }) {
      if (spec.origin === 'remote') {
        throw codedError('CONFINEMENT_UNAVAILABLE', 'CONFINEMENT_UNAVAILABLE: refused on this unconfined host');
      }
      return `run-${++n}`;
    },
  };
}

describe('IT-302 schedule admission route (DES-263)', () => {
  it('[LOAD-BEARING] a resident schedule created with createdRemote:true is refused when triggered on an unconfined host', async () => {
    const port = new SqliteSchedulerPort({ clock: CLOCK, catalog: fakeCatalog(['remote-wf']), runManager: fakeUnconfinedRunManager(), dbPath: ':memory:' });
    const created = await port.create({ kind: 'resident', workflow: 'remote-wf', enabled: true, createdRemote: true });
    expect(created.error).toBeUndefined();
    const result = await port.trigger('remote-wf');
    expect(result.error?.code).toBe('CONFINEMENT_UNAVAILABLE');
    expect(result.result).toBeUndefined();
  });

  it('a resident schedule created WITHOUT createdRemote (local) still fires on the same unconfined host', async () => {
    const port = new SqliteSchedulerPort({ clock: CLOCK, catalog: fakeCatalog(['local-wf']), runManager: fakeUnconfinedRunManager(), dbPath: ':memory:' });
    const created = await port.create({ kind: 'resident', workflow: 'local-wf', enabled: true });
    expect(created.error).toBeUndefined();
    const result = await port.trigger('local-wf');
    expect(result.error).toBeUndefined();
    expect(result.result?.runId).toBeTruthy();
  });
});
