// E2E-008 (DES-149, v24, Gate 7.5 scope): a crash between claim and insertVersion leaves the
// trigger UNCLAIMED after restart — the compensation window closed by the register sequence.
// Gate 5 scope: real file-backed SQLite stores (WorkflowCatalog + SqliteSchedulerPort) driven
// in-process with a forced `insertVersion` throw simulating the crash, then a FRESH pair of
// store instances constructed against the SAME db files (simulating process restart). True
// OS-level process-kill fidelity (RWE_TEST_CRASH_AFTER_CLAIM=1 against the real spawned engine)
// is Gate 7.5's job per DES-149's own scope note — this is the reproducible in-process floor.
//
// v24 MIGRATION (TASK-152). The oracle is unchanged; the mechanism is re-pointed at what shipped:
//  * `catalog.register({…, __forceCrashBeforeInsert:true})` — the crash hook this file was written
//    against was never implemented (`grep -n __forceCrashBeforeInsert src/` is empty), so
//    `register()` simply returned `{version:'v1'}` and `.rejects.toThrow()` failed on a SUCCESS.
//  * The claim→insert→compensate sequence is not `catalog.register()`'s at all: DES-149 puts it in
//    `McpFacade.workflowRegister` (`validateRegistration` → `claim` each id → `insertVersion` → on
//    throw, `release` exactly the ids THIS call claimed). `catalog.register()` is documented in
//    workflow-catalog.ts:531 as the convenience path "for a direct (non-facade) caller with NO
//    triggers to claim" — it can never exercise a claim window. The crash is therefore injected at
//    the one seam the design names (step 4, `insertVersion`) and driven through the real facade,
//    against the real file-backed catalog and the real SqliteSchedulerPort.
//  * `scheduler.create({kind:'once', at, enabled})` is now the shipped shape (a trigger created
//    with no `workflow` is born UNCLAIMED — scheduler.ts:233), so the `@ts-expect-error` that used
//    to cover it is gone.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkflowCatalog } from '../../src/workflow-catalog.js';
import { SqliteSchedulerPort } from '../../src/scheduler.js';
import { RunManager } from '../../src/run-manager.js';
import { McpFacade } from '../../src/mcp-facade.js';
import { FixedClock } from '../../src/clock.js';

describe('register crash window — trigger stays unclaimed after a crash before insertVersion (E2E-008, DES-149)', () => {
  it('a schedule claimed then a forced insertVersion throw leaves the schedule unclaimed after "restart"', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-crash-window-'));
    try {
      const clock = new FixedClock(new Date('2026-01-01T00:00:00Z'));
      const scheduler = new SqliteSchedulerPort({
        clock,
        catalog: { resolve: async () => ({ ok: false, code: 'VERSION_NOT_FOUND' }) } as never,
        runManager: { start: async () => ({ runId: 'r1' }) } as never,
        dbPath: join(dir, 'schedules.db'),
      });
      // create() returns a {result, error} envelope (scheduler.ts:58-61), not {id} directly —
      // same test-fixture defect class as trigger-claims.test.ts (adjudication v24 #2 A-7).
      const { result } = await scheduler.create({ kind: 'once', at: '2026-06-01T00:00:00Z', enabled: true });
      const id = result!.id;
      expect(scheduler.ownerOf(id)).toBeNull(); // born unclaimed

      const catalog = new WorkflowCatalog(dir, clock);
      const facade = new McpFacade({
        runManager: new RunManager({ clock, workRoot: dir, catalog }),
        schedulerClaims: scheduler,
      });

      // THE CRASH. Injected at the exact step DES-149 names ("(4) insertVersion; (5) on throw,
      // release exactly the ids whose claim returned 'claimed'") — everything before it (validate,
      // locate, claim) is the real sequence against the real stores.
      catalog.insertVersion = async () => { throw new Error('simulated crash before insertVersion completed'); };

      const res = await facade.workflowRegister(
        { name: 'wf-crash', script: 'return 1;', mermaid: 'graph TD', triggers: [id] },
        { kind: 'auth-disabled' },
      );
      expect(res['status']).toBe('failed');

      // "restart": fresh instances over the SAME db files
      const schedulerAfterRestart = new SqliteSchedulerPort({
        clock,
        catalog: { resolve: async () => ({ ok: false, code: 'VERSION_NOT_FOUND' }) } as never,
        runManager: { start: async () => ({ runId: 'r1' }) } as never,
        dbPath: join(dir, 'schedules.db'),
      });
      expect(schedulerAfterRestart.ownerOf(id)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
