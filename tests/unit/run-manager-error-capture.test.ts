// UT (DES-232, ARCH-142, TASK-236, REQ-205): the failure path — redact at capture, bound, persist,
// THEN flip the terminal status (`try/finally`, INV-V35-1: reason before status). Written test-first
// (Gate 5, RED) — `RunStore.recordError` does not exist, so the ordering/throw-safety guarantees
// below cannot be observed yet.
//
// Mock policy (unit): a REAL RunManager driving the REAL sandbox (a script that genuinely throws)
// against a spy wrapping `InMemoryRunStore` (a real port implementation, not a mock of the SUT) —
// the only way to reach the private `_runLive` dispatch continuation this DES pins.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunManager } from '../../src/run-manager.js';
import { InMemoryRunStore } from '../../src/run-store.js';
import { FixedClock } from '../../src/clock.js';
import type { RunStatus } from '../../src/types.js';
import { registerPublished } from '../helpers/workflow-fixtures.js';

const clock = new FixedClock(new Date('2026-09-21T00:00:00.000Z'));

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'rwe-ut232-'));
  dirs.push(d);
  return d;
}
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

async function waitForStatus(mgr: RunManager, runId: string, want: RunStatus, maxIters = 120): Promise<void> {
  for (let i = 0; i < maxIters; i++) {
    const view = await mgr.status(runId);
    if (view.status === want) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`waitForStatus: run ${runId} never reached ${want} in time`);
}

/** A spy `RunStore` recording the ORDER `recordError`/`recordTransition` are called in, with an
 *  optional injected throw on `recordError` (DES-232's try/finally case). */
class OrderingSpyStore extends InMemoryRunStore {
  readonly order: string[] = [];
  throwOnRecordError = false;
  private readonly _errors = new Map<string, { code: string; message: string }>();

  async recordError(runId: string, err: { code: string; message: string }): Promise<void> {
    this.order.push('recordError');
    if (this.throwOnRecordError) throw new Error('injected recordError failure');
    this._errors.set(runId, err);
  }

  async getError(runId: string): Promise<{ code: string; message: string } | null> {
    return this._errors.get(runId) ?? null;
  }

  async recordTransition(runId: string, from: RunStatus | null, to: RunStatus, ts: string): Promise<void> {
    this.order.push(`recordTransition:${to}`);
    return super.recordTransition(runId, from, to, ts);
  }
}

describe('RunManager failure path ordering (DES-232, UT)', () => {
  it('recordError is called STRICTLY BEFORE recordTransition(..., "failed")', async () => {
    const store = new OrderingSpyStore(clock);
    const dir = tempDir();
    const mgr = new RunManager({ store, clock, workRoot: dir } as never);
    const name = 'ut232-order';
    await registerPublished(mgr.catalog, name, "throw new Error('boom, UT-232 order');");
    const runId = await mgr.start({ origin: 'local', name });
    await waitForStatus(mgr, runId, 'failed');

    const errIdx = store.order.indexOf('recordError');
    const transIdx = store.order.indexOf('recordTransition:failed');
    expect(errIdx).toBeGreaterThanOrEqual(0);
    expect(transIdx).toBeGreaterThan(errIdx);
  });

  it('a THROWING recordError still reaches "failed" (try/finally) and leaves no unhandled rejection', async () => {
    const store = new OrderingSpyStore(clock);
    store.throwOnRecordError = true;
    const dir = tempDir();
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      const mgr = new RunManager({ store, clock, workRoot: dir } as never);
      const name = 'ut232-throw';
      await registerPublished(mgr.catalog, name, "throw new Error('boom, UT-232 throw');");
      const runId = await mgr.start({ origin: 'local', name });
      await waitForStatus(mgr, runId, 'failed');
      // give any straggler microtask/unhandledRejection a chance to fire before asserting
      await new Promise((r) => setTimeout(r, 50));
      // recordError must actually have been ATTEMPTED (and thrown) for this assertion to mean
      // anything — otherwise an unwired recordError makes this pass vacuously.
      expect(store.order).toContain('recordError');
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});
