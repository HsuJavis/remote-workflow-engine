// issue #94 (owner decision): `stopped` is a TRUE terminal state — `run_resume`/`RunManager.resume()`
// must refuse it (ILLEGAL_TRANSITION "stopped → running"), dispatch NOTHING, and leave NOTHING
// cached. Two paths need separate coverage because they go through different code:
//   (a) same-process (cached): `stop()` leaves the RunEntry sitting in `_runs`, so a later `resume()`
//       call finds it via the cache short-circuit in `_requireLive` and must refuse it there.
//   (b) after a restart (rehydrated): the run isn't in `_runs` at all; `_requireLive` must refuse
//       BEFORE ever rehydrating (no catalog resolve, no spec read, no sandbox construction, no
//       `_runs.set`) — proved here by spying on `RunStore.getSpec`, the one read `_requireLive` makes
//       only on the rehydration path.
import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunManager } from '../../src/run-manager.js';
import { WorkflowCatalog } from '../../src/workflow-catalog.js';
import { SqliteRunStore } from '../../src/store/sqlite-run-store.js';
import { FixedClock } from '../../src/clock.js';
import { startScript } from '../helpers/workflow-fixtures.js';
import type { GatewayClient } from '../../src/gateway/client.js';

describe('issue #94 — resume() refuses a stopped run, no dispatch, no cached trace', () => {
  it('(a) same-process: stop() then resume() is refused ILLEGAL_TRANSITION, and the gateway is never re-invoked', async () => {
    let invokeCount = 0;
    let invokeCalled!: () => void;
    const invokeCalledPromise = new Promise<void>((resolve) => { invokeCalled = resolve; });
    const gateway: GatewayClient = {
      invoke: async (req) => {
        invokeCount++;
        invokeCalled();
        const signal = (req as unknown as { signal?: AbortSignal }).signal;
        await new Promise<void>((resolve) => {
          if (signal) signal.addEventListener('abort', () => resolve(), { once: true });
          else setTimeout(resolve, 3000);
        });
        return { ok: false, provider: 'fake', reason: 'terminal' };
      },
    };
    const mgr = new RunManager({ gateway });
    const runId = await startScript(mgr, `return await agent('slow-call', {});`);

    await invokeCalledPromise; // the ONE in-flight dispatch the run itself made
    expect(invokeCount).toBe(1);

    await mgr.stop(runId);
    const stopped = await mgr.status(runId);
    expect(stopped.status).toBe('stopped');

    await expect(mgr.resume(runId)).rejects.toMatchObject({
      code: 'ILLEGAL_TRANSITION',
      message: expect.stringContaining('stopped → running'),
    });

    // No new dispatch — the gateway was never re-invoked by the refused resume().
    expect(invokeCount).toBe(1);
    // No state change — the run is still stopped.
    const after = await mgr.status(runId);
    expect(after.status).toBe('stopped');
  }, 10000);

  it('(b) after a restart: a stopped run rehydrated via a fresh RunManager instance refuses resume() WITHOUT rehydrating at all', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-it94-restart-'));
    try {
      const clock = new FixedClock(new Date('2026-09-28T00:00:00Z'));
      const store = new SqliteRunStore(join(dir, 'store'), clock);
      const catalog = new WorkflowCatalog(join(dir, 'catalog'), clock);

      // mgr1: register, run, stop — a normal in-process lifecycle.
      const mgr1 = new RunManager({ store, catalog, clock, workRoot: dir });
      const runId = await startScript(mgr1, 'return 1;');
      await mgr1.stop(runId);
      expect((await mgr1.status(runId)).status).toBe('stopped');

      // mgr2: a FRESH instance over the SAME store/catalog — simulates a process restart. Its
      // `_runs` map is empty, so any resume() attempt must go through `_requireLive`'s rehydration
      // check.
      const getSpecSpy = vi.spyOn(store, 'getSpec');
      const mgr2 = new RunManager({ store, catalog, clock, workRoot: dir });

      await expect(mgr2.resume(runId)).rejects.toMatchObject({
        code: 'ILLEGAL_TRANSITION',
        message: expect.stringContaining('stopped → running'),
      });

      // The refusal happened before `_requireLive` ever tried to rebuild a RunEntry — `getSpec` is
      // the one store read that only happens on the rehydration path, past the eligibility check.
      expect(getSpecSpy).not.toHaveBeenCalled();

      // Re-affirm no state change, on the SAME (restart-simulating) instance.
      const after = await mgr2.status(runId);
      expect(after.status).toBe('stopped');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20000);
});
