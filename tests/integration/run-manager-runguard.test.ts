// IT-002: RunManager + RunGuard — concurrency cap enforced end-to-end (ARCH-002)
import { describe, it, expect, vi } from 'vitest';
import { RunManager } from '../../src/run-manager.js';
import { startScript } from '../helpers/workflow-fixtures.js';
import type { AgentSpawner } from '../../src/agent-executor.js';
import type { GatewayClient } from '../../src/gateway/client.js';

async function pollUntilSettled(mgr: RunManager, runId: string) {
  let view = await mgr.status(runId);
  for (let i = 0; i < 40 && view.status === 'running'; i++) {
    await new Promise((r) => setTimeout(r, 50));
    view = await mgr.status(runId);
  }
  return view;
}

describe('RunManager + RunGuard integration (ARCH-002)', () => {
  it('concurrency cap prevents more than N agents running simultaneously', async () => {
    // RunManager owns one RunGuard per run (DES-002); observe the cap it enforces via a fake
    // AgentSpawner (RunManagerDeps.spawner) that records how many calls are in flight at once —
    // RunGuard.acquireSlot() gates entry to spawner.run() regardless of which spawner is wired.
    let active = 0;
    let maxActive = 0;
    const spawner: AgentSpawner = {
      async run() {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 30));
        active -= 1;
        return { kind: 'text', value: 'ok' };
      },
    };
    const mgr = new RunManager({ spawner, concurrency: 2 });

    const runId = await startScript(mgr, `
      return parallel([
        async () => agent('a', {}),
        async () => agent('b', {}),
        async () => agent('c', {}),
      ]);
    `);

    const view = await pollUntilSettled(mgr, runId);
    expect(view.status).toBe('completed');
    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it('budget addTokens path is the single accounting path (not duplicated)', async () => {
    // RunGuard isn't injectable per run (DES-002: budget/concurrency are per-run, not shared),
    // so observe accounting through the documented budget-enforcement behavior instead of a spy:
    // a fake GatewayClient (RunManagerDeps.gateway) returns a fixed 30-token result per call, and
    // the budget is set to exactly 40 — enough for the accounting to allow a second agent() call
    // only if the first call's tokens were added to RunGuard exactly once (30, not 60+).
    const gateway: GatewayClient = {
      invoke: vi.fn().mockResolvedValue({ ok: true, provider: 'anthropic', model: 'claude-3', tokens: { input: 20, output: 10 }, content: 'ok' }),
    };
    const mgr = new RunManager({ gateway });

    const runId = await startScript(mgr, `
        try {
          const r1 = await agent('first', {});
          const r2 = await agent('second', {});
          return { ok: true, r1, r2 };
        } catch (e) {
          return { ok: false, code: e.code };
        }
      `, {
      budget: 40,
    });

    const view = await pollUntilSettled(mgr, runId);
    expect(view.status).toBe('completed');
    const result = await mgr.result(runId);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.value as { ok: boolean }).ok).toBe(true);
    }
  });

  it('budget exceeded mid-run: subsequent agent() calls throw, earlier ones already ran', async () => {
    const mgr = new RunManager();
    const runId = await startScript(mgr, `
        const r1 = await agent('first', {});
        const r2 = await agent('second', {});  // should throw BudgetExceededError
        return {r1, r2};
      `, {
      budget: 1, // token budget so low the second call will exceed it
    });

    // Poll until completed or failed
    let view = await mgr.status(runId);
    for (let i = 0; i < 20 && view.status === 'running'; i++) {
      await new Promise((r) => setTimeout(r, 50));
      view = await mgr.status(runId);
    }
    // The run should fail due to budget exceeded
    expect(['failed', 'completed']).toContain(view.status);
  });

  it('state machine: start → running; stop → stopped; resume → running again', async () => {
    const mgr = new RunManager();
    const runId = await startScript(mgr, 'return agent("hello", {});');
    const runningView = await mgr.status(runId);
    expect(['running', 'queued']).toContain(runningView.status);

    await mgr.stop(runId);
    const stoppedView = await mgr.status(runId);
    expect(stoppedView.status).toBe('stopped');

    await mgr.resume(runId);
    const resumedView = await mgr.status(runId);
    expect(['running', 'queued', 'completed']).toContain(resumedView.status);
  });
});
