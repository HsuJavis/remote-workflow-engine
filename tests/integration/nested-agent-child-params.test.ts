// Bug fix (final verification, real run c92f3a9e): an agent() dispatched from a NESTED workflow()
// frame resolved its per-agent params from the PARENT run's admission snapshot
// (`entry.effectiveParams.agents[label]`), not from the CHILD version's own
// `meta.params.agents.<label>` — so a child echoer declaring `model: 'haiku'` ran on `default`, and
// because only the parent's reachable models were pinned, the child's model was never priced.
//
// Spec decision (parent overrides): a parent run's `overrides.agents.<label>` does NOT reach a nested
// frame. Overrides are validated against, and scoped to, the parent's own contract (REQ-110: "a user
// tunes each agent independently"), and a nested `workflow()` is another workflow's black box
// (AUTHORING.md "nested workflow() black box") — its labels are its own. The collision case below is
// the only way a parent override could leak, so that is what it pins.
//
// Mock policy (integration): real createServer(), real MCP HTTP, real sandbox child processes for
// both frames, real catalog/RunManager/AgentExecutor/price pin. Only the provider network is faked
// (injected GatewayClient) and the live model catalog (injected `modelCatalog`, feeding ModelBook).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import type { GatewayClient } from '../../src/gateway/client.js';
import { DEFAULT_ALIASES } from '../../src/default-aliases.js';
import { registerPublishedVia } from '../helpers/workflow-fixtures.js';

const seen: Array<{ prompt: string; model: string | undefined; effort: unknown; timeoutMs: unknown }> = [];
const GATEWAY: GatewayClient = {
  async invoke(req: any) {
    seen.push({ prompt: req.prompt, model: req.opts?.model, effort: req.opts?.effort, timeoutMs: req.opts?.timeoutMs });
    const target = DEFAULT_ALIASES[req.opts?.model ?? 'default']!;
    return { ok: true, provider: target.provider, model: target.model, tokens: { input: 10, output: 5 }, content: req.prompt };
  },
} as GatewayClient;

const priced = (model: string) => ({
  provider: 'anthropic', model, description: 'test-priced', modalities: { in: ['text'], out: ['text'] },
  contextWindow: 200_000, price: { in: '$1/1M', out: '$2/1M' }, toolUse: true, location: 'remote',
  ratesPerM: { in: 1, out: 2, cacheRead: 0, cacheWrite: 0 },
});
// `default` and `haiku` priced; `opus` deliberately not (only the collision case dispatches it).
const CATALOG = async (): Promise<any[]> => [priced(DEFAULT_ALIASES.default!.model), priced(DEFAULT_ALIASES.haiku!.model)];

let server: Server;
let baseUrl: string;
let dir: string;

async function mcp(name: string, args: unknown): Promise<any> {
  const res = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Math.random(), method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = (await res.json()) as { result?: { content: Array<{ text: string }> } };
  return JSON.parse(body.result!.content[0]!.text);
}

async function settle(runId: string): Promise<any> {
  for (let i = 0; i < 100; i++) {
    const s = await mcp('run_status', { runId });
    if (['completed', 'failed'].includes(s.status)) return s;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`run ${runId} never settled`);
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'rwe-nested-params-'));
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: dir, gateway: GATEWAY, modelCatalog: CATALOG });
  baseUrl = `http://127.0.0.1:${server.port}`;
});
afterAll(async () => {
  await server?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('a nested workflow() frame dispatches its agents with the CHILD version\'s declared params', () => {
  it('child echoer declaring haiku runs on haiku, and that call is priced (child model pinned)', async () => {
    await registerPublishedVia(mcp, 'np-inner', `return await agent('echoer', { prompt: 'inner-echo-1' });`, { model: 'haiku' });
    await registerPublishedVia(mcp, 'np-outer', `const r = await workflow('np-inner', {}); return r;`);
    const started = await mcp('run_start', { name: 'np-outer' });
    const status = await settle(started.runId);
    expect(status.status).toBe('completed');

    const call = seen.find((c) => c.prompt === 'inner-echo-1');
    expect(call).toBeDefined();
    expect(call!.model).toBe('haiku'); // pre-fix: undefined (parent snapshot has no `echoer` slice)
    expect(call!.effort).toBe('low');
    expect(call!.timeoutMs).toBe(60000);

    // the full RunStatusView (per-agent records) — `run_status` returns a summary row
    const view = (await (await fetch(`${baseUrl}/api/runs/${started.runId}`)).json()) as any;
    const rec = view.agents.find((a: any) => a.label === 'echoer');
    expect(rec).toBeDefined();
    expect(rec.frame).not.toBe('');
    expect(rec.model).toBe(DEFAULT_ALIASES.haiku!.model);
    expect(rec.unpriced).toBe(false);
    expect(rec.costUSD).toBeGreaterThan(0);

    const result = await mcp('run_result', { runId: started.runId });
    expect(result.meta.budgetEnforceable).toEqual({ usd: true, tokens: true, unpricedModels: [] });
  }, 30000);

  it("a parent run's override for a colliding label does not leak into the child's same-named agent", async () => {
    await registerPublishedVia(mcp, 'np-inner2', `return await agent('echoer', { prompt: 'inner-echo-2' });`, { model: 'haiku' });
    await registerPublishedVia(mcp, 'np-outer2', `const mine = await agent('echoer', { prompt: 'outer-echo-2' }); const r = await workflow('np-inner2', {}); return { mine, r };`);
    const started = await mcp('run_start', { name: 'np-outer2', overrides: { agents: { echoer: { model: 'opus', timeoutMs: 30000 } } } });
    expect(started.runId).toBeDefined();
    const status = await settle(started.runId);
    expect(status.status).toBe('completed');

    // top level: the parent's own echoer takes the parent's override (unchanged behaviour)
    const outer = seen.find((c) => c.prompt === 'outer-echo-2');
    expect(outer?.model).toBe('opus');
    expect(outer?.timeoutMs).toBe(30000);
    // nested: the child's own declared defaults, never the parent's override
    const inner = seen.find((c) => c.prompt === 'inner-echo-2');
    expect(inner?.model).toBe('haiku'); // pre-fix: 'opus' (the parent's override leaked)
    expect(inner?.timeoutMs).toBe(60000);
  }, 30000);
});
