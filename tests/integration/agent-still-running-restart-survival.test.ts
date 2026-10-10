// issue #165 reverify-2 (independent-verifier finding, 2026-10-10): AGENT_STILL_RUNNING
// (agent-still-running-warning.test.ts, issue #162(1)) can become PERMANENT after an engine
// restart. `agentStillRunningWarning` used to count `queued`/`running` entries straight off
// `view.agents`/`merged.agents` — the run's PERSISTED terminal snapshot. That snapshot can
// legitimately show a fire-and-forget agent() call still `queued`/`running` the instant the run
// went terminal (the documented, deliberate gap #162 D's own back-fill closes once that call
// settles IN-PROCESS). But once the engine process that owned it restarts, that call's sandbox
// child was SIGKILLed with it (`sweepOrphanSandboxChildren`, main.ts) and nothing will EVER settle
// it again — a fresh process's RunManager has no in-memory RunEntry for that old, already-terminal
// run, so `_maybeRefoldLateUsage`'s own settle hook can never fire for it either. The caller is
// told "poll again" forever, for a call that cannot ever be observed again.
//
// Fix: gate the warning on this PROCESS still genuinely owning the in-flight call
// (`RunManager.inflightAgentCount`, reading the live `AgentExecutor`'s own records) rather than on
// whatever a persisted snapshot happens to show. After a restart there is no live entry, so the
// count is 0 and the warning — correctly — does not fire.
//
// Mock policy (integration): real RunManager + real AgentExecutor + real sandbox child + real
// on-disk SqliteRunStore (the restart must survive an actual process boundary, not an in-memory
// one); only GatewayClient is faked, and the 'late' call's promise never resolves at all — a
// 250ms-delay fixture (like the sibling agent-still-running-warning.test.ts uses) would let it
// settle IN-PROCESS before the "restart" below and prove nothing about the restart case.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FixedClock } from '../../src/clock.js';
import { RunManager } from '../../src/run-manager.js';
import { McpFacade } from '../../src/mcp-facade.js';
import { startScript } from '../helpers/workflow-fixtures.js';
import { SqliteRunStore } from '../../src/store/sqlite-run-store.js';
import type { GatewayClient } from '../../src/gateway/client.js';

const CLOCK = new FixedClock(new Date('2024-01-01T00:00:00Z'));
const AUTH_DISABLED = { kind: 'auth-disabled' } as const;

function gatewayWithAnOrphanableLateCall(): GatewayClient {
  return {
    invoke: async (req) => {
      if (req.opts.label?.includes('late')) return new Promise(() => { /* never settles — simulates the call this process's restart orphans */ });
      return { ok: true, provider: 'fake', model: 'm', tokens: { input: 1, output: 1 }, content: 'fast' };
    },
  };
}

const SCRIPT = `agent('late', {}); return 'script done';`;

async function settled(mgr: RunManager, runId: string) {
  let v = await mgr.status(runId);
  for (let i = 0; i < 200 && v.status === 'running'; i++) {
    await new Promise((r) => setTimeout(r, 10));
    v = await mgr.status(runId);
  }
  return v;
}

describe('issue #165 reverify-2: AGENT_STILL_RUNNING does not survive an engine restart as a permanent warning', () => {
  it('a terminal run with a still-in-flight fire-and-forget agent shows the warning in-process, but NOT after a restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-orphan-restart-'));
    try {
      // --- before "restart": the run is terminal, the 'late' call is genuinely still in flight,
      // in THIS process. The warning is correct here — it may yet settle (it won't, in this test,
      // but the engine has no way to know that while the process is still alive). ---
      const store1 = new SqliteRunStore(join(dir, 'store'), CLOCK);
      const mgr1 = new RunManager({ store: store1, clock: CLOCK, workRoot: dir, gateway: gatewayWithAnOrphanableLateCall() });
      const runId = await startScript(mgr1, SCRIPT);
      const before = await settled(mgr1, runId);
      expect(before.status).toBe('completed');
      expect(before.agents.some((a) => a.state === 'queued' || a.state === 'running')).toBe(true);

      const facade1 = new McpFacade({ runManager: mgr1, store: store1, confinementPosture: 'unconfined' } as never);
      const before1 = await facade1.runResult({ runId }, AUTH_DISABLED, false, null);
      expect(before1.meta?.warnings).toContainEqual(expect.objectContaining({ code: 'AGENT_STILL_RUNNING' }));

      // --- "restart": fresh store + RunManager instances on the SAME data dir, same convention
      // every other restart-survival test in this suite uses (dag-restart-survival.test.ts,
      // issue-159-seed-config-stripped-restart-survival.test.ts, …). The 'late' call's promise
      // above never resolved, so from this new process's point of view it is gone for good — the
      // real engine would have SIGKILLed its sandbox child on the way down. ---
      const store2 = new SqliteRunStore(join(dir, 'store'), CLOCK);
      await store2.hydrateAll();
      const mgr2 = new RunManager({ store: store2, clock: CLOCK, workRoot: dir, gateway: gatewayWithAnOrphanableLateCall() });
      const facade2 = new McpFacade({ runManager: mgr2, store: store2, confinementPosture: 'unconfined' } as never);

      // RED today: the persisted snapshot still shows the 'late' agent queued/running, and
      // `agentStillRunningWarning` counts straight off it — the warning fires forever, telling the
      // caller to "poll again" for a call that can never settle in this or any future process.
      const resultAfterRestart = await facade2.runResult({ runId }, AUTH_DISABLED, false, null);
      expect(resultAfterRestart.meta?.warnings ?? []).not.toContainEqual(
        expect.objectContaining({ code: 'AGENT_STILL_RUNNING' }),
      );
      const statusAfterRestart = await facade2.runStatus({ runId }, AUTH_DISABLED, false, null);
      expect(statusAfterRestart.meta?.warnings ?? []).not.toContainEqual(
        expect.objectContaining({ code: 'AGENT_STILL_RUNNING' }),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20000);
});
