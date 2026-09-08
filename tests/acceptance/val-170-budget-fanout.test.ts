// VAL-170 (v25, REQ-120, issue #61): the real tier for "a budget must not cost `parallel()` its
// third branch, and a refusal must be visible".
//
// Why the real tier matters HERE more than usual: #61 was not caught by 250 test files. It was
// caught by the owner running a 3-lens research workflow on another machine, where the run reported
// success and quietly returned two thirds of its work. Everything below therefore goes through the
// SAME door that user did — a really booted engine, over real MCP HTTP, `workflow_register` +
// `workflow_publish` + `run_start` + `run_status` + `run_result` — with no SUT boundary mocked.
//
// What is NOT real here, stated rather than hidden: no model provider is configured in CI, so each
// dispatched agent() call fails at the gateway instead of returning text. That is enough for every
// clause of REQ-120 and is in fact the sharper oracle: a call that was DISPATCHED leaves a `failed`
// AgentRecord and a call the engine REFUSED leaves a `refused` one, so "did the third branch exist"
// is answered by the records, not by a count of non-null results. The token-cost half (a budget
// actually being spent by real usage) is covered at the integration tier (IT-030/IT-037/IT-137).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { registerPublishedVia } from '../helpers/workflow-fixtures.js';

type AgentRow = { agentId: string; label?: string; state: string; reasonCode?: string };

const FAN_OUT = `
  const results = await parallel([
    async () => agent('researcher', { prompt: 'lens A' }),
    async () => agent('researcher', { prompt: 'lens B' }),
    async () => agent('researcher', { prompt: 'lens C' }),
  ]);
  return { count: results.length };
`;

describe('VAL-170: a budget does not truncate a fan-out, and a refusal is visible (REQ-120, issue #61)', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = await createServer({ port: 0 });
    baseUrl = `http://127.0.0.1:${server.port}`;
  });

  afterAll(async () => { await server?.close(); });

  async function callTool(name: string, args: unknown): Promise<Record<string, unknown>> {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
    const body = await res.json() as { result?: { content: Array<{ text: string }> } };
    return JSON.parse(body.result!.content[0]!.text) as Record<string, unknown>;
  }

  /** The MCP envelope is `{runId, status, result: <the view>}` — the agents live on `result`. */
  // v26 (owner ruling Q5, ADR-037, DES-181): `budget` is an OBJECT on the wire — a bare number is
  // refused ahead of ajv with a migration hint (`{tokens: N}`). Every case below arms a TOKEN limit,
  // which is exactly what these v25 cases always meant, so the property each one pins is unchanged.
  async function runAndWait(name: string, budget: { usd?: number; tokens?: number } | undefined) {
    const started = await callTool('run_start', { name, ...(budget === undefined ? {} : { budget }) });
    const runId = started['runId'] as string;
    if (!runId) throw new Error(`run_start refused, so nothing was exercised: ${JSON.stringify(started)}`);
    for (let i = 0; i < 100; i++) {
      const envelope = await callTool('run_status', { runId });
      const view = envelope['result'] as { status?: string; agents?: AgentRow[] } | undefined;
      if (view?.status === 'completed' || view?.status === 'failed') {
        return { view, result: await callTool('run_result', { runId }) };
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error('timed out waiting for the run to settle');
  }

  it('a 3-wide parallel() under a real budget reaches the gateway THREE times, not twice', async () => {
    const name = `val170-fanout-${Date.now()}`;
    await registerPublishedVia(callTool, name, FAN_OUT);

    // The owner's own budget. Before v25 the reservation arithmetic (2 x 50% of the TOTAL) refused
    // the third call outright, so `agents` held two researcher records and the third existed
    // nowhere — not as a record, not as a log, not as an event.
    const { view } = await runAndWait(name, { tokens: 1_500_000 });
    const researchers = (view.agents ?? []).filter((a) => a.label === 'researcher');

    expect(researchers).toHaveLength(3);
    // With no provider configured every dispatch fails at the gateway — which is exactly the proof
    // that all three were DISPATCHED. None may be `refused`: the budget is untouched.
    expect(researchers.filter((a) => a.state === 'refused')).toHaveLength(0);
  }, 60000);

  it('an exhausted budget refuses VISIBLY: a named code on the run and a refused record on the agent', async () => {
    const name = `val170-refusal-${Date.now()}`;
    await registerPublishedVia(callTool, name, FAN_OUT);

    // budget 0 is spent before the run starts, so every branch meets a genuinely exhausted budget.
    const { view, result } = await runAndWait(name, { tokens: 0 });

    // 「如果是 budget 問題 應該 fail 時 client 知道 不然他會認為這是問題」 — the owner, on #61.
    expect(view.status).toBe('failed');
    expect((result['error'] as { code?: string } | undefined)?.code).toBe('BUDGET_EXCEEDED');

    const refused = (view.agents ?? []).filter((a) => a.state === 'refused');
    expect(refused.length).toBeGreaterThan(0);
    expect(refused[0]!.reasonCode).toBe('BUDGET_EXCEEDED');
    expect(refused[0]!.label).toBe('researcher');
  }, 60000);

  it('an omitted budget is unbounded — the fan-out runs and nothing is refused', async () => {
    const name = `val170-unbounded-${Date.now()}`;
    await registerPublishedVia(callTool, name, FAN_OUT);

    const { view } = await runAndWait(name, undefined);
    const agents = view.agents ?? [];
    expect(agents.filter((a) => a.label === 'researcher')).toHaveLength(3);
    expect(agents.filter((a) => a.state === 'refused')).toHaveLength(0);
  }, 60000);

  it('the live authoring guide teaches the limit an author could not previously learn', async () => {
    // REQ-120's third clause, checked on the REAL tool a cold client calls — not on the builder.
    const guide = await callTool('workflow_authoring_guide', {});
    const text = JSON.stringify(guide['result'] ?? guide);
    expect(text).toContain('runConcurrency');
    expect(text).toContain('BUDGET_EXCEEDED');
    expect(text).toMatch(/stop-dispatching signal/);
    expect(text).toMatch(/overshoot/);
  }, 30000);

  // v25 (DES-169, REQ-120, issue #63): the guide's recovery example is EXTRACTED from the live tool
  // and RUN, not read. This repo has shipped a guide example the engine refused before (v23
  // AUTHORING.md), found only because Gate 7.5 ran it; #63 is the same class of defect one layer
  // down — the example parsed and registered fine, it just always rethrew. Lifting the snippet out
  // of the served text (rather than re-typing it here) is what stops the test and the manual
  // drifting apart: change the guide's predicate and this case runs the NEW predicate.
  it("the guide's BUDGET_EXCEEDED recovery example, extracted from the live guide, actually recovers", async () => {
    const guide = await callTool('workflow_authoring_guide', {});
    const text = (guide['result'] as { text?: string } | undefined)?.text ?? '';
    expect(text.length).toBeGreaterThan(0);

    const snippet = [...text.matchAll(/```js\n([\s\S]*?)```/g)]
      .map((m) => m[1]!)
      .find((block) => block.includes('BUDGET_EXCEEDED') && block.includes('parallel('));
    expect(snippet, 'the guide no longer contains a js example that catches BUDGET_EXCEEDED').toBeDefined();

    // The snippet is a fragment: it reads a free `lenses` and returns nothing. Supply the binding
    // and a verdict around it — the CATCH BLOCK ITSELF is untouched guide text.
    const script =
      "const lenses = ['lens A', 'lens B', 'lens C'];\n" +
      snippet! +
      '\nreturn { recovered: true, findings: findings.length };\n';

    const name = `val170-guide-example-${Date.now()}`;
    await registerPublishedVia(callTool, name, script);

    // budget 0 is spent before the run starts, so `parallel()` meets a genuinely exhausted budget
    // and the guide's catch is the only thing between this run and a failure.
    const { view, result } = await runAndWait(name, { tokens: 0 });

    // Before the #63 fix `e.code` was undefined inside the sandbox, so `e.code !== 'BUDGET_EXCEEDED'`
    // was always true, the example rethrew, and the run this documentation promised was recoverable
    // ended `failed` with BUDGET_EXCEEDED.
    expect(view.status).toBe('completed');
    expect((result['result'] as { recovered?: boolean } | undefined)?.recovered).toBe(true);
  }, 60000);
});
