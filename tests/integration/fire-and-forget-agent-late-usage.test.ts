// issue #162 D (TDD, RED->GREEN): a fire-and-forget (un-awaited) `agent()` call keeps running after
// the workflow script that dispatched it returns — adjudication #9 I-2 rules that this is DELIBERATE
// and unchanged (the engine never aborts work just because the run around it finished). `_runLive`
// (run-manager.ts) does not call `settleInflight` at all on the normal-completion path (only
// suspend()/stop() do) — so the run goes terminal, and `_transition` takes its ONE terminal snapshot,
// essentially immediately, while the un-awaited call is still at the fake gateway. Before this fix,
// that call's eventual usage reached `run_status` (which overlays LIVE records) but never
// `run_result.meta.usage` or `run_list` (both read the one terminal snapshot, taken before the call
// settled) — a PERMANENT gap, confirmed by the tester's own re-verify (run 3d9d8dd5-...: the
// fire-and-forget agent completed 18 seconds after run-terminal; usage stayed 0 in run_result/
// run_list indefinitely).
//
// Mock policy (integration): real RunManager + real AgentExecutor + real sandbox child; only
// GatewayClient is faked (the 'late' label resolves after a short delay, chosen so the run is
// already terminal well before it does).
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
      if (req.opts.label === 'late') {
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

describe('a fire-and-forget agent() call eventually folds its usage into run_result/run_list, even though the run already went terminal (issue #162 D)', () => {
  it('run_result.meta.usage includes the late call\'s tokens once it settles, not permanently 0', async () => {
    const store = new InMemoryRunStore(new SystemClock());
    const mgr = new RunManager({ gateway: lateGateway(), store });
    const runId = await startScript(mgr, SCRIPT);

    const status = await pollUntilTerminal(mgr, runId);
    expect(status.status).toBe('completed');

    const facade = new McpFacade({ runManager: mgr, store, confinementPosture: 'unconfined' } as never);

    // The run went terminal before the late call could possibly have settled — its own terminal
    // snapshot (taken here) must NOT yet show the late call's usage. This is not the bug; it is the
    // expected shape of the race this fix is about (confirms the test actually models it).
    const immediateResult = await facade.runResult({ runId }, AUTH_DISABLED, false, null);
    expect(immediateResult.meta?.usage.tokens.input).toBe(0);

    // Wait past the fake gateway's own delay — the late call has now genuinely settled.
    await new Promise((r) => setTimeout(r, LATE_DELAY_MS + 300));

    const lateResult = await facade.runResult({ runId }, AUTH_DISABLED, false, null);
    expect(lateResult.meta?.usage.tokens.input).toBe(111);
    expect(lateResult.meta?.usage.tokens.output).toBe(222);

    // run_list's row for the SAME run must agree — the exact second surface the tester's re-verify
    // found still reporting 0.
    const summaries = await mgr.listSummaries();
    const row = summaries.find((s) => s.runId === runId);
    expect(row).toBeDefined();
    expect(row!.tokensTotal).toBe(333); // 111 + 222
  }, 15000);
});
