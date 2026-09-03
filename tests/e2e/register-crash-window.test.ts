// E2E-008 (DES-149, v24, Gate 7.5 scope): a crash between claim and insertVersion leaves the
// trigger UNCLAIMED after restart — the compensation window closed by the register sequence.
// Gate 5 scope: real file-backed SQLite stores (WorkflowCatalog + SqliteSchedulerPort) driven
// in-process with a forced `insertVersion` throw simulating the crash, then a FRESH pair of
// store instances constructed against the SAME db files (simulating process restart). True
// OS-level process-kill fidelity (RWE_TEST_CRASH_AFTER_CLAIM=1 against the real spawned engine)
// is Gate 7.5's job per DES-149's own scope note — this is the reproducible in-process floor.
// Written test-first (Gate 5, RED) — claim()/release() do not exist on SqliteSchedulerPort yet.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkflowCatalog } from '../../src/workflow-catalog.js';
import { SqliteSchedulerPort } from '../../src/scheduler.js';
import { FixedClock } from '../../src/clock.js';

describe('register crash window — trigger stays unclaimed after a crash before insertVersion (E2E-008, DES-149)', () => {
  it('a schedule claimed then a forced insertVersion throw leaves the schedule unclaimed after "restart"', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-crash-window-'));
    try {
      const clock = new FixedClock(new Date('2026-01-01T00:00:00Z'));
      const scheduler = new SqliteSchedulerPort({
        clock,
        catalog: { resolve: async () => ({ ok: false, code: 'UNKNOWN_VERSION' }) } as never,
        runManager: { start: async () => ({ runId: 'r1' }) } as never,
        dbPath: join(dir, 'schedules.db'),
      });
      // @ts-expect-error — create() still binds workflow at creation today (v24 makes it unclaimed)
      const { id } = await scheduler.create({ kind: 'once', at: '2026-06-01T00:00:00Z' });

      const catalog = new WorkflowCatalog(dir);
      // @ts-expect-error — claim() does not exist yet
      await scheduler.claim(id, 'wf-crash');
      await expect(
        // @ts-expect-error — v24 register() shape + a forced crash before insertVersion completes
        catalog.register({ name: 'wf-crash', script: 'workflow(() => {});', mermaid: 'graph TD', triggers: [id], __forceCrashBeforeInsert: true }),
      ).rejects.toThrow();

      // "restart": fresh instances over the SAME db files
      const schedulerAfterRestart = new SqliteSchedulerPort({
        clock,
        catalog: { resolve: async () => ({ ok: false, code: 'UNKNOWN_VERSION' }) } as never,
        runManager: { start: async () => ({ runId: 'r1' }) } as never,
        dbPath: join(dir, 'schedules.db'),
      });
      // @ts-expect-error — ownerOf() does not exist yet
      expect(await schedulerAfterRestart.ownerOf(id)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
