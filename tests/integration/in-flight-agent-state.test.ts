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
import { startScript } from '../helpers/workflow-fixtures.js';
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

/** Polls workflow_status until `predicate(view.agents)` holds (or times out). B's `markQueued` is
 *  recorded by `_handleAgentRequest` over the sandbox IPC boundary, which lands a beat AFTER A first
 *  reaches the gateway (`aInvokedPromise`) — a single-shot snapshot at that instant races that IPC
 *  hop (~1/3 flake). While A is gated (gateA unreleased) and B is behind the concurrency:1 cap, the
 *  A='running' + B='queued' state is STABLE, so a bounded poll observes it deterministically without
 *  changing any product behavior. */
async function waitForAgents(mgr: RunManager, runId: string, predicate: (agents: AgentRecord[]) => boolean, maxIters = 60): Promise<AgentRecord[]> {
  let view = await mgr.status(runId);
  for (let i = 0; i < maxIters && !predicate(view.agents); i++) {
    await new Promise((r) => setTimeout(r, 25));
    view = await mgr.status(runId);
  }
  return view.agents;
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

    const runId = await startScript(mgr, `
        return await parallel([
          async () => agent('call-A', { label: 'A' }),
          async () => agent('call-B', { label: 'B' }),
        ]);
      `);

    // Deterministic: wait for A to have actually reached the gateway (slot acquired, in flight)
    // before asserting — avoids a race against the real child process's own startup time.
    await aInvokedPromise;
    expect((await mgr.status(runId)).status).toBe('running'); // sanity: the run itself is genuinely mid-flight

    // A is in flight (slot acquired, markRunning done before the gateway call) and B is genuinely
    // queued behind the concurrency:1 cap — a stable state while A stays gated. Poll for it (B's
    // markQueued lands over IPC just after aInvokedPromise) rather than snapshot-and-race.
    let agents = await waitForAgents(mgr, runId, (a) =>
      findByLabel(a, 'A')?.state === 'running' && findByLabel(a, 'B')?.state === 'queued',
    );
    expect(findByLabel(agents, 'A')?.state).toBe('running');
    expect(findByLabel(agents, 'B')?.state).toBe('queued');

    // Release A -> its slot frees -> B should now be dispatched to the gateway. Poll for the stable
    // post-release state (A terminal-captured 'done', B now in flight 'running' with gateB unreleased)
    // — A's capture(done) and B's markRunning settle a beat after bInvokedPromise over the same IPC.
    releaseA();
    await bInvokedPromise;
    agents = await waitForAgents(mgr, runId, (a) =>
      findByLabel(a, 'A')?.state === 'done' && findByLabel(a, 'B')?.state === 'running',
    );
    expect(findByLabel(agents, 'A')?.state).toBe('done');
    expect(findByLabel(agents, 'B')?.state).toBe('running');

    releaseB();
    const finalView = await pollUntilSettled(mgr, runId);
    expect(finalView.status).toBe('completed');
    expect(findByLabel(finalView.agents, 'A')?.state).toBe('done');
    expect(findByLabel(finalView.agents, 'B')?.state).toBe('done');

    const result = await mgr.result(runId);
    expect(result).toEqual({ ok: true, value: ['done-A', 'done-B'] });
  }, 15000);
});
