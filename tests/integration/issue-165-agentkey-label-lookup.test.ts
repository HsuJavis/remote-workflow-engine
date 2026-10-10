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
// each of the two agents gets a distinguishable model AND distinguishable skills) and proves:
//   1. run_status's agents[] now carries `agentKey` (the positional) distinctly from `label`.
//   2. run_agent_log({label:'a'}) — previously unreachable — now finds the 'a' call specifically,
//      via its agentKey, and its OWN model AND skills (never the other call's).
//   3. run_agent_log({label:'b'}) ALSO resolves deterministically to the positional-'b' call's own
//      model AND skills — the lookup checks `agentKey` across every candidate BEFORE it ever checks
//      `label`, so a query value that is one record's `agentKey` wins even though it is also a
//      DIFFERENT record's (colliding) display `label`. A single two-field `.find()` in array order
//      would NOT prove this (the positional-'a' record is queued first and would win on its
//      `label:'b'` match) — that exact regression is what this case exists to catch.
//   4. The pre-existing "first match wins" `.find()` semantics (issue #158 NEW) are UNCHANGED for a
//      GENUINE duplicate — two calls sharing the same `agentKey` value — see the dedicated case
//      below.
//
// Mock policy (integration): real RunManager + real AgentExecutor + real sandbox child + real
// McpFacade; only GatewayClient is faked (keyed on the dispatched prompt text), and its `invoke`
// calls the injected `onHarness` hook (like a real gateway does at session-build time) so
// `run_agent_log`'s `harness` field — and `skillsExposed` on it — is populated end to end instead
// of staying `null` (a `null` harness would let the skills half of "each log shows its own
// model/skills" (the issue's own acceptance text) pass vacuously).
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
      const isA = req.prompt === 'PROMPT_A';
      const model = isA ? 'model-A' : 'model-B';
      const skillsExposed = isA ? ['skill-a'] : ['skill-b'];
      if (req.onHarness) {
        await req.onHarness({
          model,
          provider: 'fake',
          prompt: req.prompt,
          tools: [],
          skills: skillsExposed,
          mcpServers: [],
          surfaceType: 'none',
          skillsExposed,
        });
      }
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

// A GENUINE duplicate: two calls sharing the exact same positional name (and thus, with no
// `opts.label` override, the same `label` too) — DES-174's "duplicate labels are legal". Unlike
// SCRIPT above (a cross-field collision between two DIFFERENT values), both candidates match on
// the SAME field/value, so this is the case issue #158 NEW's first-match-in-array-order rule
// actually governs, and this fix leaves it untouched.
const DUPLICATE_SCRIPT = `
const [a, b] = await Promise.all([
  agent('x', { prompt: 'PROMPT_A' }),
  agent('x', { prompt: 'PROMPT_B' }),
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

  it("run_agent_log({label:'a'}) now finds the positional-'a' agent specifically, by its OWN model AND skills (previously AGENT_LOG_NOT_FOUND)", async () => {
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
    expect(log.harness).not.toBeNull();
    expect(log.harness?.agentKey).toBe('a');
    expect(log.harness?.skillsExposed).toEqual(['skill-a']);
  }, 20000);

  it("run_agent_log({label:'b'}) resolves to the positional-'b' call's OWN model AND skills — deterministically, NOT the colliding 'a' call's — because agentKey is checked before label", async () => {
    const store = new InMemoryRunStore(new SystemClock());
    const mgr = new RunManager({ gateway: promptKeyedGateway(), store });
    const runId = await startScript(mgr, SCRIPT);
    const status = await pollUntilTerminal(mgr, runId);
    expect(status.status).toBe('completed');
    // The positional-'a' record (label:'b', agentKey:'a') is queued FIRST (it is the first element
    // of the `Promise.all` array) — a combined `.find()` over both fields in array order would
    // match IT on `label:'b'` before ever reaching the positional-'b' record's own `agentKey:'b'`.
    // Asserting this ordering here makes the regression this case guards against reproducible: if
    // the lookup ever regresses to array-order-first instead of agentKey-tier-first, this case
    // fails by returning model-A/skill-a instead of model-B/skill-b.
    expect(status.agents![0].agentKey).toBe('a');

    const facade = new McpFacade({ runManager: mgr, store, confinementPosture: 'unconfined' } as never);
    const log = await facade.runAgentLog({ runId, label: 'b' }, AUTH_DISABLED, false, null);
    expect(log.error).toBeUndefined();
    const record = (log as { record?: { agentKey?: string; label?: string; model?: string } }).record;
    expect(record?.label).toBe('b');
    expect(record?.agentKey).toBe('b');
    expect(record?.model).toBe('model-B');
    expect(log.harness).not.toBeNull();
    expect(log.harness?.agentKey).toBe('b');
    expect(log.harness?.skillsExposed).toEqual(['skill-b']);
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

  it("run_agent_log({label:'x'}) on a GENUINE agentKey duplicate (two agent('x', …) calls, no opts.label override) keeps the pre-#165 first-match-in-array-order behaviour (issue #158 NEW), unchanged by the agentKey-tiered lookup", async () => {
    const store = new InMemoryRunStore(new SystemClock());
    const mgr = new RunManager({ gateway: promptKeyedGateway(), store });
    const runId = await startScript(mgr, DUPLICATE_SCRIPT);
    const status = await pollUntilTerminal(mgr, runId);
    expect(status.status).toBe('completed');
    expect(status.agents?.length).toBe(2);
    expect(status.agents!.every((a) => a.agentKey === 'x' && a.label === 'x')).toBe(true);
    // Both candidates match in the SAME tier (agentKey:'x') on the SAME value — the first one in
    // `view.agents` array order wins, exactly as the pre-#165 single-field `.find()` did.
    const firstInArrayOrder = status.agents![0];

    const facade = new McpFacade({ runManager: mgr, store, confinementPosture: 'unconfined' } as never);
    const log = await facade.runAgentLog({ runId, label: 'x' }, AUTH_DISABLED, false, null);
    expect(log.error).toBeUndefined();
    const record = (log as { record?: { agentId?: string; agentKey?: string; model?: string } }).record;
    expect(record?.agentId).toBe(firstInArrayOrder.agentId);
    expect(record?.model).toBe(firstInArrayOrder.model);
  }, 20000);
});
