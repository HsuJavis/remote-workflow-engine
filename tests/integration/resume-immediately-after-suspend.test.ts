// issue #53 (the remaining half: "run went `failed` right after resume"): `suspend()` SIGKILLs the
// run's sandbox child but does not wait for it to exit, and `resume()` sets the status back to
// `running` and starts a NEW child. The OLD child's `exit` (delivered after resume) used to settle
// the resumed run as `failed` with `ABORTED: … signal SIGKILL`, because `_runLive`'s settle only
// checked `entry.status !== 'running'`. A superseded child must never settle the current run —
// decided by identity, not timing. Existing suspend/resume tests hid this with a 300 ms pause.
//
// Mock policy (integration tier): real RunManager + real AgentExecutor + real sandbox child; only the
// GatewayClient is faked (first call hangs until aborted, like the real SDK gateway).
import { describe, it, expect } from 'vitest';
import { RunManager } from '../../src/run-manager.js';
import { registerPublished, startScript, uniqueWorkflowName } from '../helpers/workflow-fixtures.js';
import type { GatewayClient } from '../../src/gateway/client.js';

async function pollUntilSettled(mgr: RunManager, runId: string, maxIters = 200) {
  let view = await mgr.status(runId);
  for (let i = 0; i < maxIters && view.status === 'running'; i++) {
    await new Promise((r) => setTimeout(r, 25));
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

describe('resume immediately after suspend (#53: a superseded sandbox child never settles the run)', () => {
  it('20× suspend → resume with zero delay: never failed, always completed', async () => {
    const outcomes: string[] = [];
    const shapes: string[] = [];
    for (let i = 0; i < 20; i++) {
      const { gateway, firstStarted } = gatewayHangingFirstCall();
      const mgr = new RunManager({ gateway });
      const runId = await startScript(mgr, SCRIPT);
      await firstStarted;
      await mgr.suspend(runId);
      await mgr.resume(runId);
      const view = await pollUntilSettled(mgr, runId);
      outcomes.push(view.status === 'completed' ? 'completed' : `${view.status}: ${JSON.stringify(view.error ?? null).slice(0, 160)}`);
      // the superseded child contributes nothing to the resumed execution: one lane, one aborted + one done record
      shapes.push(`${view.phases.map((p) => p.title).join(',')}|${view.agents.map((a) => a.state).sort().join(',')}`);
    }
    expect(outcomes).toEqual(Array(20).fill('completed'));
    expect(shapes).toEqual(Array(20).fill('greet|done,failed'));
  }, 120000);

  it('stop stays stopped after the killed child finally exits', async () => {
    const { gateway, firstStarted } = gatewayHangingFirstCall();
    const mgr = new RunManager({ gateway });
    const runId = await startScript(mgr, SCRIPT);
    await firstStarted;
    await mgr.stop(runId);
    expect((await mgr.status(runId)).status).toBe('stopped');
    await new Promise((r) => setTimeout(r, 300));
    expect((await mgr.status(runId)).status).toBe('stopped');
  }, 20000);

  it('the CURRENT child crashing (killed from outside, no suspend/stop) still fails the run', async () => {
    const { gateway, firstStarted } = gatewayHangingFirstCall();
    const mgr = new RunManager({ gateway });
    const runId = await startScript(mgr, SCRIPT);
    await firstStarted;
    const entry = (mgr as any)._runs.get(runId);
    (entry.sandbox as any)._active.get(runId).child.kill('SIGKILL');
    const view = await pollUntilSettled(mgr, runId);
    expect(view.status).toBe('failed');
    expect(JSON.stringify(view.error)).toMatch(/ABORTED/);
  }, 20000);

  it('a crash of the RESUMED child (current generation) still fails the run', async () => {
    const { gateway, firstStarted } = gatewayHangingFirstCall();
    // second call hangs too, so the resumed child is alive when we kill it
    let calls = 0;
    let secondStarted!: () => void;
    const second = new Promise<void>((r) => { secondStarted = r; });
    const inner = gateway.invoke;
    gateway.invoke = async (req) => {
      calls += 1;
      if (calls === 2) {
        secondStarted();
        return new Promise(() => {});
      }
      return inner(req);
    };
    const mgr = new RunManager({ gateway });
    const runId = await startScript(mgr, SCRIPT);
    await firstStarted;
    await mgr.suspend(runId);
    await mgr.resume(runId);
    await second;
    const entry = (mgr as any)._runs.get(runId);
    (entry.sandbox as any)._active.get(runId).child.kill('SIGKILL');
    const view = await pollUntilSettled(mgr, runId);
    expect(view.status).toBe('failed');
    expect(JSON.stringify(view.error)).toMatch(/ABORTED/);
  }, 20000);

  // Nested workflow() frames run in their OWN SandboxHost, which suspend()/stop() did not kill: the
  // nested child kept executing after suspend, and its next agent() either dispatched LIVE into the
  // resumed generation (zero-delay resume: an extra real gateway call + a phantom `B:done`) or left a
  // phantom aborted `B:failed` record (delayed resume). Its generation is now the frame's identity.
  for (const delay of [0, 300]) {
    it(`nested workflow(): suspend → resume after ${delay} ms — the superseded nested child dispatches nothing`, async () => {
      const results: string[] = [];
      for (let i = 0; i < 5; i++) {
        let calls = 0;
        const { gateway, firstStarted } = gatewayHangingFirstCall();
        const inner = gateway.invoke;
        gateway.invoke = (req) => { calls += 1; return inner(req); };
        const mgr = new RunManager({ gateway });
        const innerName = uniqueWorkflowName('inner');
        await registerPublished(mgr.catalog, innerName, `const a = await agent('A', {}); const b = await agent('B', {}); return [a, b];`);
        const runId = await startScript(mgr, `return await workflow('${innerName}', {});`);
        await firstStarted;
        await mgr.suspend(runId);
        if (delay) await new Promise((r) => setTimeout(r, delay));
        await mgr.resume(runId);
        const view = await pollUntilSettled(mgr, runId);
        await new Promise((r) => setTimeout(r, 200)); // let any straggler from the old frame land
        const after = await mgr.status(runId);
        results.push(`${view.status} calls=${calls} ${after.agents.map((a) => `${a.label}:${a.state}`).join(',')}`);
      }
      expect(results).toEqual(Array(5).fill('completed calls=3 A:failed,A:done,B:done'));
    }, 60000);
  }

  it('nested workflow(): stop kills the nested child — no later agent() record appears', async () => {
    let calls = 0;
    const { gateway, firstStarted } = gatewayHangingFirstCall();
    const inner = gateway.invoke;
    gateway.invoke = (req) => { calls += 1; return inner(req); };
    const mgr = new RunManager({ gateway });
    const innerName = uniqueWorkflowName('inner');
    await registerPublished(mgr.catalog, innerName, `const a = await agent('A', {}); const b = await agent('B', {}); return [a, b];`);
    const runId = await startScript(mgr, `return await workflow('${innerName}', {});`);
    await firstStarted;
    await mgr.stop(runId);
    await new Promise((r) => setTimeout(r, 300));
    const view = await mgr.status(runId);
    expect(view.status).toBe('stopped');
    expect(calls).toBe(1);
    expect(view.agents.map((a) => `${a.label}:${a.state}`)).toEqual(['A:failed']);
  }, 20000);
});
