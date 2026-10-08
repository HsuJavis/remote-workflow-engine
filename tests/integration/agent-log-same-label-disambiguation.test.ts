// issue #158 NEW (tester re-verify, 2026-10-07): run_agent_log's label lookup is a `.find()` —
// when two concurrent agent() calls share a label, only the FIRST matching record is reachable by
// label. A later-failing same-label agent's log/diagnostics were unreachable at all: the schema fix
// (tool-specs.test.ts) makes an agentId-only call schema-valid; this test proves the underlying
// disambiguation itself works end to end for the case that actually matters — reading a FAILED
// agent's log when it shares a label with a SUCCEEDED one.
//
// Mock policy (integration): real RunManager + real AgentExecutor + real sandbox child + real
// McpFacade; only GatewayClient is faked (keyed on the dispatched prompt text, since both calls
// share the same label by construction — the whole point of this scenario).
import { describe, it, expect } from 'vitest';
import { RunManager } from '../../src/run-manager.js';
import { McpFacade } from '../../src/mcp-facade.js';
import { InMemoryRunStore } from '../../src/run-store.js';
import { SystemClock } from '../../src/clock.js';
import { startScript } from '../helpers/workflow-fixtures.js';
import type { GatewayClient } from '../../src/gateway/client.js';

const AUTH_DISABLED = { kind: 'auth-disabled' } as const;

function promptKeyedGateway(): GatewayClient {
  return {
    invoke: async (req) => {
      if (req.prompt === 'FAIL_ME') {
        return { ok: false, provider: 'fake', reason: 'terminal', detail: 'synthetic failure for issue #158 NEW' };
      }
      return { ok: true, provider: 'fake', model: 'm', tokens: { input: 1, output: 1 }, content: 'DONE' };
    },
  };
}

// Both calls share the SAME label ('dup') — the exact concurrency shape issue #158's NEW item
// describes. Distinguished only by prompt text (the fake gateway's own key), never by label.
const SCRIPT = `
const [a, b] = await Promise.all([
  agent('dup', { prompt: 'FAIL_ME' }),
  agent('dup', { prompt: 'OK_ME' }),
]);
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

describe('run_agent_log agentId disambiguates two concurrent same-label agents (issue #158 NEW)', () => {
  it('label alone reaches only ONE of the two (the pre-existing .find() behavior) — not itself a bug, just the reason agentId must work', async () => {
    const store = new InMemoryRunStore(new SystemClock());
    const mgr = new RunManager({ gateway: promptKeyedGateway(), store });
    const runId = await startScript(mgr, SCRIPT);
    const status = await pollUntilTerminal(mgr, runId);
    expect(status.status).toBe('completed');
    expect(status.agents?.length).toBe(2);
    expect(status.agents!.every((a) => a.label === 'dup')).toBe(true);

    const facade = new McpFacade({ runManager: mgr, store, confinementPosture: 'unconfined' } as never);
    const byLabel = await facade.runAgentLog({ runId, label: 'dup' }, AUTH_DISABLED, false, null);
    expect(byLabel.error).toBeUndefined();
    // Whichever one .find() surfaces, it is only ONE of the two agentIds.
    const reachedByLabelFirst = status.agents!.find((a) => a.label === 'dup')!;
    expect(reachedByLabelFirst).toBeDefined();
  }, 20000);

  it('agentId reaches the FAILED agent specifically, even though it shares a label with a succeeded one', async () => {
    const store = new InMemoryRunStore(new SystemClock());
    const mgr = new RunManager({ gateway: promptKeyedGateway(), store });
    const runId = await startScript(mgr, SCRIPT);
    const status = await pollUntilTerminal(mgr, runId);
    expect(status.status).toBe('completed');
    expect(status.failedAgentCount).toBe(1);

    const failedAgentId = status.agentFailures![0]!.agentId!;
    const succeededAgent = status.agents!.find((a) => a.agentId !== failedAgentId)!;
    expect(succeededAgent.label).toBe('dup'); // same label as the failed one — the whole scenario

    const facade = new McpFacade({ runManager: mgr, store, confinementPosture: 'unconfined' } as never);
    // agentId ONLY — no label — reaches the FAILED record specifically, never the succeeded one
    // that happens to share its label.
    const log = await facade.runAgentLog({ runId, agentId: failedAgentId }, AUTH_DISABLED, false, null);
    expect(log.error).toBeUndefined();
    // `record` is the resolved AgentRecord itself (v27b) — proves agentId picked out the RIGHT one,
    // not merely that SOME record came back.
    expect((log as { record?: { agentId?: string; state?: string } }).record?.agentId).toBe(failedAgentId);
    expect((log as { record?: { agentId?: string; state?: string } }).record?.state).toBe('failed');
  }, 20000);
});
