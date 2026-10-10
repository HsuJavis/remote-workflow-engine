// issue #162(1) (owner decision, 2026-10-10): a fire-and-forget (un-awaited) `agent()` call still
// `queued`/`running` the moment its run goes terminal is a KNOWN, documented gap (adjudication #9
// I-2 — the engine never aborts in-flight work just because the run around it finished; issue
// #162 D already fixed the usage eventually back-filling into run_result/run_list). What a caller
// reading run_result/run_status RIGHT AT the terminal moment has no way to tell is that this is
// happening at all — the response looks complete. Fix: while something is still in flight, both
// tools carry a `meta.warnings` entry `{code:'AGENT_STILL_RUNNING', message}`; once everything has
// settled, the warning disappears and the usage total is the complete one.
// Mock policy (integration): real RunManager + real AgentExecutor + real sandbox child; only
// GatewayClient is faked (the 'late' label resolves after a short delay, chosen so the run is
// already terminal well before it does) — same fixture `fire-and-forget-agent-late-usage.test.ts`
// uses for the sibling issue #162 D fix.
import { describe, it, expect } from 'vitest';
import { RunManager } from '../../src/run-manager.js';
import { McpFacade } from '../../src/mcp-facade.js';
import { InMemoryRunStore } from '../../src/run-store.js';
import { SystemClock } from '../../src/clock.js';
import { startScript } from '../helpers/workflow-fixtures.js';
import type { GatewayClient } from '../../src/gateway/client.js';

const AUTH_DISABLED = { kind: 'auth-disabled' } as const;
const LATE_DELAY_MS = 250;

function lateGateway(): GatewayClient {
  return {
    invoke: async (req) => {
      if (req.opts.label?.includes('late')) {
        await new Promise((r) => setTimeout(r, LATE_DELAY_MS));
        return { ok: true, provider: 'fake', model: 'm', tokens: { input: 111, output: 222 }, content: 'late result' };
      }
      return { ok: true, provider: 'fake', model: 'm', tokens: { input: 1, output: 1 }, content: 'fast' };
    },
  };
}

// The script does NOT await the 'late' call — it dispatches it, then returns immediately. By
// construction the run reaches 'completed' well before the fake gateway's delay elapses.
const SCRIPT = `
agent('late', {});
return 'script done';
`;

async function pollUntilTerminal(mgr: RunManager, runId: string, maxIters = 40) {
  let view = await mgr.status(runId);
  for (let i = 0; i < maxIters && view.status === 'running'; i++) {
    await new Promise((r) => setTimeout(r, 10));
    view = await mgr.status(runId);
  }
  return view;
}

describe('issue #162(1): AGENT_STILL_RUNNING meta.warnings while a fire-and-forget call is still in flight at terminal', () => {
  it('run_result carries the warning immediately at terminal, then loses it once the late call settles', async () => {
    const store = new InMemoryRunStore(new SystemClock());
    const mgr = new RunManager({ gateway: lateGateway(), store });
    const runId = await startScript(mgr, SCRIPT);
    const status = await pollUntilTerminal(mgr, runId);
    expect(status.status).toBe('completed');

    const facade = new McpFacade({ runManager: mgr, store, confinementPosture: 'unconfined' } as never);

    const immediate = await facade.runResult({ runId }, AUTH_DISABLED, false, null);
    expect(immediate.meta?.warnings).toContainEqual(
      expect.objectContaining({ code: 'AGENT_STILL_RUNNING' }),
    );

    await new Promise((r) => setTimeout(r, LATE_DELAY_MS + 300));

    const settled = await facade.runResult({ runId }, AUTH_DISABLED, false, null);
    expect(settled.meta?.warnings ?? []).not.toContainEqual(
      expect.objectContaining({ code: 'AGENT_STILL_RUNNING' }),
    );
    expect(settled.meta?.usage!.tokens.input).toBe(111);
  });

  it('run_status carries the SAME warning while in flight, then loses it once settled', async () => {
    const store = new InMemoryRunStore(new SystemClock());
    const mgr = new RunManager({ gateway: lateGateway(), store });
    const runId = await startScript(mgr, SCRIPT);
    const status = await pollUntilTerminal(mgr, runId);
    expect(status.status).toBe('completed');

    const facade = new McpFacade({ runManager: mgr, store, confinementPosture: 'unconfined' } as never);

    const immediate = await facade.runStatus({ runId }, AUTH_DISABLED, false, null);
    expect(immediate.meta?.warnings).toContainEqual(
      expect.objectContaining({ code: 'AGENT_STILL_RUNNING' }),
    );

    await new Promise((r) => setTimeout(r, LATE_DELAY_MS + 300));

    const settledStatus = await facade.runStatus({ runId }, AUTH_DISABLED, false, null);
    expect(settledStatus.meta?.warnings ?? []).not.toContainEqual(
      expect.objectContaining({ code: 'AGENT_STILL_RUNNING' }),
    );
  });

  it('a run that is itself still RUNNING (an ordinary, AWAITED in-flight agent() call) carries NO AGENT_STILL_RUNNING warning — the gate is on the RUN\'s own terminal status, never bare agent state', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const blockingGateway: GatewayClient = {
      invoke: async () => {
        await gate;
        return { ok: true, provider: 'fake', model: 'm', tokens: { input: 1, output: 1 }, content: 'done' };
      },
    };
    const store = new InMemoryRunStore(new SystemClock());
    const mgr = new RunManager({ gateway: blockingGateway, store });
    const runId = await startScript(mgr, `return await agent('slow', {});`);
    const facade = new McpFacade({ runManager: mgr, store, confinementPosture: 'unconfined' } as never);

    // Poll until the agent itself is genuinely dispatched (state running) while the RUN is still
    // running too — the exact state an ordinary, fully-awaited agent() call passes through on every
    // call, not a fire-and-forget gap.
    let status = await mgr.status(runId);
    for (let i = 0; i < 100 && !status.agents.some((a) => a.state === 'running'); i++) {
      await new Promise((r) => setTimeout(r, 10));
      status = await mgr.status(runId);
    }
    expect(status.status).toBe('running');
    expect(status.agents.some((a) => a.state === 'running')).toBe(true);

    const runStatusResult = await facade.runStatus({ runId }, AUTH_DISABLED, false, null);
    expect(runStatusResult.meta?.warnings ?? []).not.toContainEqual(
      expect.objectContaining({ code: 'AGENT_STILL_RUNNING' }),
    );
    const runResultResult = await facade.runResult({ runId }, AUTH_DISABLED, false, null);
    expect(runResultResult.error?.code).toBe('RUN_NOT_TERMINAL');
    expect(runResultResult.meta?.warnings ?? []).not.toContainEqual(
      expect.objectContaining({ code: 'AGENT_STILL_RUNNING' }),
    );

    release();
    const terminal = await pollUntilTerminal(mgr, runId);
    expect(terminal.status).toBe('completed');
  });

  it('a run with nothing still in flight carries no AGENT_STILL_RUNNING warning at all (positive control)', async () => {
    const store = new InMemoryRunStore(new SystemClock());
    const mgr = new RunManager({ gateway: lateGateway(), store });
    const runId = await startScript(mgr, `return await agent('fast', {});`);
    const status = await pollUntilTerminal(mgr, runId);
    expect(status.status).toBe('completed');

    const facade = new McpFacade({ runManager: mgr, store, confinementPosture: 'unconfined' } as never);
    const result = await facade.runResult({ runId }, AUTH_DISABLED, false, null);
    expect(result.meta?.warnings ?? []).not.toContainEqual(
      expect.objectContaining({ code: 'AGENT_STILL_RUNNING' }),
    );
    const runStatus = await facade.runStatus({ runId }, AUTH_DISABLED, false, null);
    expect(runStatus.meta?.warnings ?? []).not.toContainEqual(
      expect.objectContaining({ code: 'AGENT_STILL_RUNNING' }),
    );
  });
});
