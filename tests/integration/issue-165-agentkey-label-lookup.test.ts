// issue #165: since #154, per-agent config is selected by agent()'s POSITIONAL label while
// `opts.label` is purely a cosmetic, caller-chosen display name — but every agent-record/log
// producer (run_status's agents[], run_agent_log's label lookup) only ever carried the DISPLAY
// label. `agent('a', {label:'b'})` therefore recorded nothing naming the 'a' contract it actually
// dispatched under (run_agent_log({label:'a'}) answered AGENT_LOG_NOT_FOUND), and collided under
// `label:'b'` with a sibling `agent('b', {...})` call, whose own label defaults to its positional
// 'b' too — `run_agent_log({label:'b'})`'s log could show either one's model/skills.
//
// This test runs the EXACT issue scenario end to end (real RunManager + real AgentExecutor + real
// sandbox child + real McpFacade; only GatewayClient is faked, keyed on the dispatched prompt so
// each of the two agents gets a distinguishable model) and proves:
//   1. run_status's agents[] now carries `agentKey` (the positional) distinctly from `label`.
//   2. run_agent_log({label:'a'}) — previously unreachable — now finds the 'a' call specifically,
//      via its agentKey, and its OWN model (never the other call's).
//   3. run_agent_log({label:'b'}) stays ambiguous between the two same-display-label calls exactly
//      as before this fix (issue #158 NEW's pre-existing "first match wins" `.find()` semantics,
//      deliberately UNCHANGED by this fix — only the 'a' case, previously impossible, is new).
//
// Mock policy (integration): real RunManager + real AgentExecutor + real sandbox child + real
// McpFacade; only GatewayClient is faked (keyed on the dispatched prompt text).
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
      const model = req.prompt === 'PROMPT_A' ? 'model-A' : 'model-B';
      return { ok: true, provider: 'fake', model, tokens: { input: 1, output: 1 }, content: 'DONE' };
    },
  };
}

// The exact #165 repro: positional 'a' with an explicit opts.label of 'b' (so its DISPLAY label
// collides with the second call's own positional-defaulted label), plus positional 'b' with no
// label override at all.
const SCRIPT = `
const [a, b] = await Promise.all([
  agent('a', { label: 'b', prompt: 'PROMPT_A' }),
  agent('b', { prompt: 'PROMPT_B' }),
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

describe('run_status/run_agent_log key agents by agentKey (positional) as well as label (issue #165)', () => {
  it('run_status.agents[] carries agentKey distinctly from the (colliding) display label', async () => {
    const store = new InMemoryRunStore(new SystemClock());
    const mgr = new RunManager({ gateway: promptKeyedGateway(), store });
    const runId = await startScript(mgr, SCRIPT);
    const status = await pollUntilTerminal(mgr, runId);
    expect(status.status).toBe('completed');
    expect(status.agents?.length).toBe(2);
    // Both display labels are 'b' — the exact collision #165 reports.
    expect(status.agents!.every((a) => a.label === 'b')).toBe(true);

    const agentA = status.agents!.find((a) => a.agentKey === 'a')!;
    const agentB = status.agents!.find((a) => a.agentKey === 'b')!;
    expect(agentA).toBeDefined();
    expect(agentB).toBeDefined();
    expect(agentA.model).toBe('model-A');
    expect(agentB.model).toBe('model-B');
  }, 20000);

  it("run_agent_log({label:'a'}) now finds the positional-'a' agent specifically, by its OWN model (previously AGENT_LOG_NOT_FOUND)", async () => {
    const store = new InMemoryRunStore(new SystemClock());
    const mgr = new RunManager({ gateway: promptKeyedGateway(), store });
    const runId = await startScript(mgr, SCRIPT);
    const status = await pollUntilTerminal(mgr, runId);
    expect(status.status).toBe('completed');

    const facade = new McpFacade({ runManager: mgr, store, confinementPosture: 'unconfined' } as never);
    const log = await facade.runAgentLog({ runId, label: 'a' }, AUTH_DISABLED, false, null);
    expect(log.error).toBeUndefined();
    const record = (log as { record?: { agentKey?: string; label?: string; model?: string } }).record;
    expect(record?.agentKey).toBe('a');
    expect(record?.label).toBe('b');
    expect(record?.model).toBe('model-A');
  }, 20000);

  it("run_agent_log({label:'b'}) stays the pre-existing first-match-wins ambiguity between the two same-display-label calls (unchanged by this fix)", async () => {
    const store = new InMemoryRunStore(new SystemClock());
    const mgr = new RunManager({ gateway: promptKeyedGateway(), store });
    const runId = await startScript(mgr, SCRIPT);
    const status = await pollUntilTerminal(mgr, runId);
    expect(status.status).toBe('completed');

    const facade = new McpFacade({ runManager: mgr, store, confinementPosture: 'unconfined' } as never);
    const log = await facade.runAgentLog({ runId, label: 'b' }, AUTH_DISABLED, false, null);
    expect(log.error).toBeUndefined();
    const record = (log as { record?: { agentKey?: string; label?: string; model?: string } }).record;
    // Whichever of the two `.find()` surfaces, it is a real, internally-consistent record for ONE
    // of them — never a crash, never a cross-wired model/agentKey pair.
    expect(record?.label).toBe('b');
    expect(['a', 'b']).toContain(record?.agentKey);
    expect(record?.model).toBe(record?.agentKey === 'a' ? 'model-A' : 'model-B');
  }, 20000);

  it("run_agent_log by agentId still works for the 'b' agent specifically, disambiguating past the label collision", async () => {
    const store = new InMemoryRunStore(new SystemClock());
    const mgr = new RunManager({ gateway: promptKeyedGateway(), store });
    const runId = await startScript(mgr, SCRIPT);
    const status = await pollUntilTerminal(mgr, runId);
    const agentB = status.agents!.find((a) => a.agentKey === 'b')!;

    const facade = new McpFacade({ runManager: mgr, store, confinementPosture: 'unconfined' } as never);
    const log = await facade.runAgentLog({ runId, agentId: agentB.agentId }, AUTH_DISABLED, false, null);
    expect(log.error).toBeUndefined();
    const record = (log as { record?: { agentKey?: string; model?: string } }).record;
    expect(record?.agentKey).toBe('b');
    expect(record?.model).toBe('model-B');
  }, 20000);
});
