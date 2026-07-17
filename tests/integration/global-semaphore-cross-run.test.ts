// V2 (Gate 8 review, adversarial finding — closed by the D-DOS decision, 02-architecture.md §D-DOS):
// the concurrency cap must be a ONE process-global semaphore SHARED by every run, not a fresh per-run
// cap that K runs multiply into a single-node exhaustion surface. This pins the anti-multiplication
// property END-TO-END through the real RunManager: two runs sharing one injected semaphore(total=1)
// never have more than 1 agent() dispatch in flight AT ONCE across BOTH runs. Were the cap per-run
// (the pre-D-DOS bug), two runs would reach inUse=2.
import { describe, it, expect, vi } from 'vitest';
import { RunManager } from '../../src/run-manager.js';
import { createSemaphore } from '../../src/agent-semaphore.js';
import type { GatewayClient } from '../../src/gateway/client.js';

async function pollUntilSettled(mgr: RunManager, runId: string) {
  let view = await mgr.status(runId);
  for (let i = 0; i < 200 && (view.status === 'running' || view.status === 'queued'); i++) {
    await new Promise((r) => setTimeout(r, 20));
    view = await mgr.status(runId);
  }
  return view;
}

describe('global agent semaphore bounds concurrency ACROSS runs (V2 / D-DOS)', () => {
  it('two runs sharing one semaphore(total=1) never exceed 1 concurrent dispatch (no K-multiplication)', async () => {
    const sem = createSemaphore(1);
    let maxInUseObserved = 0;

    const gateway: GatewayClient = {
      invoke: vi.fn(
        () =>
          new Promise((resolve) => {
            // We are INSIDE the semaphore slot here (RunManager wraps the dispatch in withSlot).
            // Sample the shared gauge during the artificial delay: with a shared total=1 it can
            // never read >1, no matter how many runs are concurrently trying to dispatch.
            maxInUseObserved = Math.max(maxInUseObserved, sem.gauge().inUse);
            setTimeout(
              () => resolve({ ok: true, provider: 'fake', model: 'fake', tokens: { input: 1, output: 1 }, content: 'ok' }),
              40,
            );
          }),
      ),
    };

    // One RunManager, ONE injected semaphore — the composition-root wiring every real run shares.
    // Per-run concurrency is generous (5) so, were the cap per-run, each run alone could reach 5.
    const mgr = new RunManager({ gateway, semaphore: sem, concurrency: 5 });

    const script = `
      const thunks = [];
      for (let i = 0; i < 5; i++) thunks.push(async () => agent('c-' + i));
      await parallel(thunks);
      return 'done';
    `;
    const runA = await mgr.start({ script, budget: null });
    const runB = await mgr.start({ script, budget: null });

    const [va, vb] = await Promise.all([pollUntilSettled(mgr, runA), pollUntilSettled(mgr, runB)]);
    expect(va.status).toBe('completed');
    expect(vb.status).toBe('completed');

    // The whole point: the shared global cap held across both runs.
    expect(maxInUseObserved).toBe(1);
    // Both runs really did dispatch all their calls (10 total) — the cap serialized, it didn't drop work.
    expect(gateway.invoke).toHaveBeenCalledTimes(10);
    // And the slot is always released — the gauge returns to baseline after everything settles.
    expect(sem.gauge()).toEqual({ total: 1, inUse: 0, queued: 0 });
  }, 20000);
});
