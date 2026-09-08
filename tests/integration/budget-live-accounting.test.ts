// IT-018: script-visible budget.spent()/remaining() reflect live RunGuard accounting (D-F8, REQ-002
// 3rd acceptance — user-approved and binding).
//
// 08-validation.md round-2/3 VAL-002: src/sandbox/child-entry.ts lines 82-86 hard-code the
// script-facing budget accessors (`spent: () => 0`, `remaining: () => total`) — never threading the
// parent process's real live RunGuard._spent counter back to the sandboxed child over IPC. Real
// repro: budget.spent() read AFTER a real, token-consuming agent() call still returns 0, even though
// run_status.agents[0].tokens on the same run shows real nonzero accounting.
//
// D-F8 (binding): script-visible budget.spent()/remaining() must reflect live RunGuard accounting
// via IPC (piggyback usage on agent() IPC responses and/or a budget query message); no hard-coded
// stubs.
//
// Mock policy (DES-015, integration tier): real RunManager/RunGuard/AgentExecutor/sandbox child
// process (real IPC, real OS subprocess); only the GatewayClient (third-party network) is faked,
// with a KNOWN fixed token cost so the expected post-call value is exact and deterministic — no live
// provider/credentials needed.
import { describe, it, expect } from 'vitest';
import { RunManager } from '../../src/run-manager.js';
import type { GatewayClient } from '../../src/gateway/client.js';
import { startScript } from '../helpers/workflow-fixtures.js';

async function pollUntilSettled(mgr: RunManager, runId: string) {
  let view = await mgr.status(runId);
  for (let i = 0; i < 60 && view.status === 'running'; i++) {
    await new Promise((r) => setTimeout(r, 50));
    view = await mgr.status(runId);
  }
  return view;
}

describe('Live budget accounting observable in-script (IT-018, D-F8)', () => {
  it('budget.spent()/remaining() read AFTER a completed agent() call match the real RunGuard accounting, not a hard-coded stub', async () => {
    const gateway: GatewayClient = {
      invoke: async () => ({
        ok: true,
        provider: 'fake',
        model: 'fake-model',
        tokens: { input: 20, output: 10 }, // known fixed cost: 30 tokens combined (DES-008 delta)
        content: 'ok',
      }),
    };
    const mgr = new RunManager({ gateway });

    // v26 (owner ruling Q5, ADR-037, DES-182): `budget.total`/`spent()`/`remaining()` are USD; the
    // four TOKEN columns are read through `budget.tokens()`. This run arms a TOKEN limit (500), so
    // `tokens().sum` is the counter that must move from 0 to the fake gateway's known fixed cost —
    // exactly the property D-F8/REQ-002 put here ("no hard-coded stubs; the script sees the real
    // parent-side RunGuard accounting"), read through the accessor that now carries that number.
    // The USD accessors are asserted too, in their unarmed state, so a future unit slip that makes
    // `spent()` silently mean tokens again fails HERE.
    const runId = await startScript(mgr, `
        const before = budget.tokens().sum;
        await agent('hi', {});
        const after = budget.tokens().sum;
        return {
          before, after,
          remaining: budget.limits.tokens - after,
          usdSpent: budget.spent(),
          usdRemaining: budget.remaining(),
        };
      `, {
      budget: 500,
    });

    const view = await pollUntilSettled(mgr, runId);
    expect(view.status).toBe('completed');
    const result = await mgr.result(runId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { before, after, remaining, usdSpent, usdRemaining } = result.value as {
      before: number; after: number; remaining: number; usdSpent: number; usdRemaining: number | null;
    };

    expect(before).toBe(0);
    // The original red: child-entry.ts's accessors were hard-coded stubs that always returned 0,
    // regardless of the real parent-side RunGuard accounting (input 20 + output 10 = 30 tokens).
    expect(after).toBe(30);
    expect(remaining).toBe(500 - 30);
    // The fake gateway's model is not in any price book, so the USD arm is genuinely 0 spent, and
    // `remaining()` is `null` — no USD limit armed — never `Infinity` (SandboxBudget's own doc).
    expect(usdSpent).toBe(0);
    expect(usdRemaining).toBeNull();
  }, 20000);
});
