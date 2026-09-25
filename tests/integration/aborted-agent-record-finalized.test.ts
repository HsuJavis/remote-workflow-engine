// issue #53 (root cause B): an agent call aborted by run_suspend/run_stop must not leave its record
// `state:'running'` with no `endedAt` forever. `AgentExecutor.run()` returned `{kind:'null',
// aborted:true}` BEFORE the capture that finalizes a record, so the live record kept the
// `markRunning` stamp for the rest of the process's life — and after suspend→resume the phase lane
// was pushed a second time (`phases: ['greet','greet']`), putting the resumed agent in lane 1 of a
// one-lane workflow.
//
// Mock policy (integration tier): real RunManager + real AgentExecutor + real sandbox child; only the
// GatewayClient is faked. The fake's first call settles AFTER the abort (it waits for the signal),
// which is the real SDK gateway's shape.
import { describe, it, expect } from 'vitest';
import { RunManager } from '../../src/run-manager.js';
import { startScript } from '../helpers/workflow-fixtures.js';
import type { GatewayClient } from '../../src/gateway/client.js';

async function pollUntilSettled(mgr: RunManager, runId: string, maxIters = 100) {
  let view = await mgr.status(runId);
  for (let i = 0; i < maxIters && view.status === 'running'; i++) {
    await new Promise((r) => setTimeout(r, 50));
    view = await mgr.status(runId);
  }
  return view;
}

function gatewayHangingFirstCall(): { gateway: GatewayClient; firstStarted: Promise<void> } {
  let calls = 0;
  let started!: () => void;
  const firstStarted = new Promise<void>((r) => { started = r; });
  const gateway: GatewayClient = {
    invoke: async (req) => {
      calls += 1;
      if (calls === 1) {
        started();
        await new Promise<void>((resolve) => {
          if (req.signal?.aborted) resolve();
          else req.signal?.addEventListener('abort', () => resolve(), { once: true });
        });
        return { ok: false, provider: 'fake', reason: 'timeout' };
      }
      return { ok: true, provider: 'fake', model: 'm', tokens: { input: 1, output: 1 }, content: 'DONE' };
    },
  };
  return { gateway, firstStarted };
}

const SCRIPT = `phase('greet');\nreturn await agent('greet', {});`;

describe('an aborted agent record is finalized (#53 root cause B)', () => {
  it('suspend → resume: the aborted agent gets endedAt and a non-running state; the phase lane is not duplicated', async () => {
    const { gateway, firstStarted } = gatewayHangingFirstCall();
    const mgr = new RunManager({ gateway });
    const runId = await startScript(mgr, SCRIPT);
    await firstStarted;
    await mgr.suspend(runId);
    // Same post-suspend settle as IT-025 (resume-rerun-aborted-call.test.ts): an immediate resume
    // races the old sandbox child's teardown, a pre-existing behaviour outside this test's scope.
    await new Promise((r) => setTimeout(r, 300));
    await mgr.resume(runId);
    const view = await pollUntilSettled(mgr, runId);
    expect(view.status).toBe('completed');

    expect(view.agents).toHaveLength(2);
    const stuck = view.agents.filter((a) => a.state === 'running' || a.endedAt === undefined);
    expect(stuck).toEqual([]);
    const aborted = view.agents.find((a) => a.state !== 'done')!;
    expect(aborted.state).toBe('failed');
    expect(aborted.detail).toMatch(/aborted/i);
    // The resumed re-run lands in the SAME lane as the aborted attempt (replay-stable ordinals).
    expect(view.phases.map((p) => p.title)).toEqual(['greet']);
    expect(view.agents.map((a) => a.phaseIndex)).toEqual([0, 0]);
  }, 20000);

  it('stop: the aborted agent gets endedAt and a non-running state once the run is terminal', async () => {
    const { gateway, firstStarted } = gatewayHangingFirstCall();
    const mgr = new RunManager({ gateway });
    const runId = await startScript(mgr, SCRIPT);
    await firstStarted;
    await mgr.stop(runId);
    const view = await mgr.status(runId);
    expect(view.status).toBe('stopped');
    expect(view.agents).toHaveLength(1);
    expect(view.agents[0]!.state).toBe('failed');
    expect(view.agents[0]!.endedAt).toBeDefined();
    expect(view.agents[0]!.detail).toMatch(/aborted/i);
  }, 20000);
});
