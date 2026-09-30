// issue #104 follow-on (dash-auth-spec.md section C, 2026-09-30 owner decisions): every run view
// must make agent failures obvious. `agent()` still resolves null and the run still completes
// (unchanged) — but `run_status`/`run_result`/`run_list` must agree on `failedAgentCount`, and
// `run_status`/`run_result` must carry `agentFailures: [{label, agentId, reason, message}]`.
//
// Red reason (measured): `RunStatusView.agentFailures` does not exist yet (tsc); `listSummaries()`'s
// live-entry overlay never computes `failedAgentCount` at all (only `summarizeUsage`'s four usage
// columns), so a run still cached in `_runs` — which includes a run that JUST went terminal, not
// only a genuinely running one — reports `failedAgentCount` on `run_status` but omits it on
// `run_list`'s row for the SAME run. `run_result`'s `meta` carries no `warnings` field.
//
// Mock policy (integration): real RunManager + real AgentExecutor + real sandbox child; only
// GatewayClient is faked (one label fails with reason:'timeout', the other succeeds).
import { describe, it, expect } from 'vitest';
import { RunManager } from '../../src/run-manager.js';
import { McpFacade } from '../../src/mcp-facade.js';
import { InMemoryRunStore } from '../../src/run-store.js';
import { SystemClock } from '../../src/clock.js';
import { startScript } from '../helpers/workflow-fixtures.js';
import type { GatewayClient } from '../../src/gateway/client.js';

const AUTH_DISABLED = { kind: 'auth-disabled' } as const;

function twoAgentGateway(): GatewayClient {
  return {
    invoke: async (req) => {
      if (req.opts.label === 'flaky') {
        return { ok: false, provider: 'fake', reason: 'timeout' };
      }
      return { ok: true, provider: 'fake', model: 'm', tokens: { input: 1, output: 1 }, content: 'DONE' };
    },
  };
}

const SCRIPT = `
phase('work');
const a = await agent('flaky', {});
const b = await agent('steady', {});
return { a, b };
`;

async function pollUntilTerminal(mgr: RunManager, runId: string, maxIters = 100) {
  let view = await mgr.status(runId);
  for (let i = 0; i < maxIters && view.status === 'running'; i++) {
    await new Promise((r) => setTimeout(r, 25));
    view = await mgr.status(runId);
  }
  return view;
}

describe('agent failures are visible and consistent across run views (dash-auth-spec C)', () => {
  it('a completed run with one failed agent reports the SAME failedAgentCount on run_status and run_list, plus agentFailures and an AGENT_FAILED warning on run_result', async () => {
    // D-I1: the store is constructed first and shared between RunManager and McpFacade — a facade
    // with its own private store 404s on every run the RunManager admitted.
    const store = new InMemoryRunStore(new SystemClock());
    const mgr = new RunManager({ gateway: twoAgentGateway(), store });
    const runId = await startScript(mgr, SCRIPT);
    const status = await pollUntilTerminal(mgr, runId);
    expect(status.status).toBe('completed');

    // run_status: the count + the structured failure list.
    expect(status.failedAgentCount).toBe(1);
    expect(status.agentFailures).toHaveLength(1);
    const failure = status.agentFailures![0]!;
    expect(failure.agentId).toBeDefined();
    expect(failure.label).toBe('flaky');
    expect(failure.reason).toBe('timeout');
    expect(typeof failure.message).toBe('string');

    // run_list: the SAME run, read immediately (entry still cached) — must agree with run_status,
    // not omit the field the way the pre-fix `summarizeUsage`-only overlay did.
    const summaries = await mgr.listSummaries();
    const row = summaries.find((s) => s.runId === runId);
    expect(row).toBeDefined();
    expect(row!.failedAgentCount).toBe(1);

    // run_result: an AGENT_FAILED warning rides `meta.warnings` even though the SCRIPT's own
    // return value is untouched (agent() resolved null, the script completed normally).
    const result = await mgr.result(runId);
    expect(result.ok).toBe(true);

    const facade = new McpFacade({ runManager: mgr, store, confinementPosture: 'unconfined' } as never);
    const envelope = await facade.runResult({ runId }, AUTH_DISABLED, false, null);
    expect(envelope.meta?.warnings).toEqual([{ code: 'AGENT_FAILED', message: expect.stringContaining('1') }]);
  }, 20000);

  it('while still running, run_status reports a live failedAgentCount but run_list stays terminal-only (the documented DES-234 asymmetry is preserved, not widened)', async () => {
    let releaseSteady!: () => void;
    const steadyGate = new Promise<void>((r) => { releaseSteady = r; });
    const gateway: GatewayClient = {
      invoke: async (req) => {
        if (req.opts.label === 'flaky') return { ok: false, provider: 'fake', reason: 'timeout' };
        await steadyGate;
        return { ok: true, provider: 'fake', model: 'm', tokens: { input: 1, output: 1 }, content: 'DONE' };
      },
    };
    const mgr = new RunManager({ gateway });
    const runId = await startScript(mgr, SCRIPT);

    // Poll until the flaky agent has failed but the run is still running (steady still gated).
    let view = await mgr.status(runId);
    for (let i = 0; i < 100 && !(view.status === 'running' && (view.failedAgentCount ?? 0) > 0); i++) {
      await new Promise((r) => setTimeout(r, 25));
      view = await mgr.status(runId);
    }
    expect(view.status).toBe('running');
    expect(view.failedAgentCount).toBe(1);

    const summaries = await mgr.listSummaries();
    const row = summaries.find((s) => s.runId === runId);
    expect(row).toBeDefined();
    expect(row!.failedAgentCount).toBeUndefined();

    releaseSteady();
    await pollUntilTerminal(mgr, runId);
  }, 20000);

  it('agentFailures[].message is redacted — a secret in the failure detail never leaks through the summary', async () => {
    const SECRET_NAME = 'AGENTFAIL_TOKEN';
    const SECRET_VALUE = 'agentfail-secret-tok-1a2b3c4d5e';
    const secretValueProvider = { entries: () => [{ name: SECRET_NAME, value: SECRET_VALUE }] };
    const gateway: GatewayClient = {
      invoke: async (req) => {
        if (req.opts.label === 'flaky') {
          return { ok: false, provider: 'fake', reason: 'terminal', detail: `leaked: ${SECRET_VALUE}` };
        }
        return { ok: true, provider: 'fake', model: 'm', tokens: { input: 1, output: 1 }, content: 'DONE' };
      },
    };
    const mgr = new RunManager({ gateway, secretValueProvider } as never);
    const runId = await startScript(mgr, SCRIPT);
    const status = await pollUntilTerminal(mgr, runId);
    expect(status.status).toBe('completed');
    const failure = status.agentFailures![0]!;
    expect(failure.message).toContain(`‹secret:${SECRET_NAME}›`);
    expect(failure.message).not.toContain(SECRET_VALUE);
  }, 20000);
});
