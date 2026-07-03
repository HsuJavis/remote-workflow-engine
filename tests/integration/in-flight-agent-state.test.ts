// IT-024: in-flight AgentRecord state ('queued'/'running') is observable via workflow_status while
// an agent() call is dispatched/in-flight, not only once it resolves (D-F12, REQ-007 1st acceptance
// clause + REQ-002 2nd acceptance clause's observability half).
//
// D-F12 (binding): AgentRecord persists queued/running state transitions in real time so
// workflow_status shows in-flight agents, not only terminal states. `08-validation.md` round-5
// VAL-002/VAL-007 real repro: launched 3 real concurrent Ollama agent() calls via parallel() and
// polled workflow_status at t≈2s while the run was still "running" -> `agents:[]` (empty). Only
// once the run reached "completed" did all 3 agent records appear, every one already `state:"done"`
// — `"queued"`/`"running"` (both part of the documented `AgentRecord.state` type, src/types.ts) are
// never produced by any code path. Root cause confirmed by code:
// `src/agent-executor.ts` `AgentTranscriptSink.capture()` only ever creates a record at
// call-RESOLUTION time (success or failure) — there is no code path that records an
// in-flight/dispatched/queued-for-a-slot agent.
//
// Mock policy (DES-015, integration tier): real RunManager + real RunGuard + real AgentExecutor +
// real sandbox child process (real IPC, real OS subprocess); only GatewayClient (third-party
// network) is faked, with deferred (test-controlled) resolution so the in-flight window is
// deterministic rather than timing-dependent.
//
// Red reason: confirmed via `npx vitest run` this file — `view.agents` is `[]` (or missing the
// expected label/state) at every mid-flight poll point below, exactly matching the real round-5
// repro (`agents:[]` while `status:"running"`), not an import/syntax error.
import { describe, it, expect } from 'vitest';
import { RunManager } from '../../src/run-manager.js';
import type { GatewayClient } from '../../src/gateway/client.js';
import type { AgentRecord } from '../../src/types.js';

async function pollUntilSettled(mgr: RunManager, runId: string, maxIters = 60) {
  let view = await mgr.status(runId);
  for (let i = 0; i < maxIters && view.status === 'running'; i++) {
    await new Promise((r) => setTimeout(r, 50));
    view = await mgr.status(runId);
  }
  return view;
}

function findByLabel(agents: AgentRecord[], label: string): AgentRecord | undefined {
  return agents.find((a) => a.label === label);
}

describe('in-flight AgentRecord state observable via workflow_status (IT-024, D-F12)', () => {
  it('shows the in-flight agent as "running" and a same-slot-blocked agent as "queued" before either resolves', async () => {
    let releaseA!: () => void;
    const gateA = new Promise<void>((resolve) => { releaseA = resolve; });
    let releaseB!: () => void;
    const gateB = new Promise<void>((resolve) => { releaseB = resolve; });
    let aInvoked!: () => void;
    const aInvokedPromise = new Promise<void>((resolve) => { aInvoked = resolve; });
    let bInvoked!: () => void;
    const bInvokedPromise = new Promise<void>((resolve) => { bInvoked = resolve; });

    const gateway: GatewayClient = {
      invoke: async (req) => {
        const label = (req.opts as { label?: string }).label;
        if (label === 'A') {
          aInvoked();
          await gateA;
        } else {
          bInvoked();
          await gateB;
        }
        return { ok: true, provider: 'fake', model: 'm', tokens: { input: 1, output: 1 }, content: `done-${label}` };
      },
    };
    // concurrency:1 so B is genuinely blocked waiting for A's slot to free — the "queued" case.
    const mgr = new RunManager({ gateway, concurrency: 1 });

    const runId = await mgr.start({
      script: `
        return await parallel([
          async () => agent('call-A', { label: 'A' }),
          async () => agent('call-B', { label: 'B' }),
        ]);
      `,
    });

    // Deterministic: wait for A to have actually reached the gateway (slot acquired, in flight)
    // before asserting — avoids a race against the real child process's own startup time.
    await aInvokedPromise;
    let view = await mgr.status(runId);
    expect(view.status).toBe('running'); // sanity: the run itself is genuinely mid-flight

    // Forcing red: today `capture()` only records once a call resolves, so `view.agents` has no
    // entry for A yet at all (real round-5 repro: agents:[] while running).
    expect(findByLabel(view.agents, 'A')?.state).toBe('running');
    // Forcing red: B is genuinely queued behind the concurrency:1 cap (never reached the gateway
    // yet, bInvokedPromise not resolved) — but no AgentRecord exists for it at all today, since an
    // agentId is only ever allocated AFTER RunGuard.acquireSlot() resolves.
    expect(findByLabel(view.agents, 'B')?.state).toBe('queued');

    // Release A -> its slot frees -> B should now be dispatched to the gateway.
    releaseA();
    await bInvokedPromise;
    view = await mgr.status(runId);
    expect(findByLabel(view.agents, 'A')?.state).toBe('done'); // A's terminal capture already works today
    // Forcing red: B is now genuinely in flight but still unresolved (gateB not released yet).
    expect(findByLabel(view.agents, 'B')?.state).toBe('running');

    releaseB();
    const finalView = await pollUntilSettled(mgr, runId);
    expect(finalView.status).toBe('completed');
    expect(findByLabel(finalView.agents, 'A')?.state).toBe('done');
    expect(findByLabel(finalView.agents, 'B')?.state).toBe('done');

    const result = await mgr.result(runId);
    expect(result).toEqual({ ok: true, value: ['done-A', 'done-B'] });
  }, 15000);
});
