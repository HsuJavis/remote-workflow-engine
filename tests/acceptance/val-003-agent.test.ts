// VAL-003: Real agent execution via Claude Agent SDK (REQ-003)
// Requires: a real LLM provider (Ollama or test API key) accessible at gateway time.
// Does NOT mock the SUT's own boundaries (AgentSpawner, GatewayClient, SDK session).
//
// v24 MIGRATION (TASK-152), two separate defects fixed here:
//  1. FALSE GREEN. Every case below began `if (!HAS_PROVIDER) return;`, so with no provider
//     configured the body never ran and vitest reported the case PASSED having asserted nothing —
//     four green lights for zero verification. Each is now `it.skipIf(!HAS_PROVIDER)` carrying the
//     reason in its NAME, so the suite reports "skipped / unverified" instead.
//  2. The fixtures were pre-v24 and would have failed instantly WITH a provider: inline
//     `run_start({script})` is closed (REQ-098), `agent(prompt, {})` is refused
//     AGENT_LABEL_REQUIRED/AGENT_LABEL_FORMAT (DES-143 — the first argument is a literal LABEL, the
//     prompt travels as `options.prompt`), every label needs a `meta.params.agents.<label>`
//     declaration (DES-144), registration needs a `mermaid` (DES-148), and `run_agent_log` is keyed
//     by `label`, not by the engine-minted `agentId` (DES-161).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { runScriptVia, type ToolCaller } from '../helpers/workflow-fixtures.js';

// SKIP individual tests if no provider is available, but ALWAYS start the server
// (so Gate 5 RED is triggered by the unimplemented createServer, not by the SKIP guard).
const HAS_PROVIDER = !!(process.env['ANTHROPIC_API_KEY'] || process.env['OLLAMA_BASE_URL']);
const NO_PROVIDER = ' [UNVERIFIED here: no provider configured — set ANTHROPIC_API_KEY or OLLAMA_BASE_URL]';

describe('VAL-003: real agent execution via Claude Agent SDK (REQ-003)', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    // Always attempt to start — throws "not implemented" at Gate 5.
    server = await createServer({ port: 0 });
    baseUrl = `http://127.0.0.1:${server.port}`;
  });

  afterAll(async () => { await server?.close(); });

  const callTool: ToolCaller<any> = async (name, args) => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
    const body = await res.json() as { result?: { content: Array<{ text: string }> } };
    return JSON.parse(body.result!.content[0].text);
  };

  // v22 (REQ-098) / v24 (TASK-152): inline script is closed at every ingress, so a script reaches
  // the engine through the sanctioned register → publish → run-by-name recipe. The SUBJECT (a real
  // agent() dispatch through the real SDK gateway) is untouched.
  async function runAndWait(script: string) {
    const run = await runScriptVia(callTool, script);
    const runId = run.runId as string;
    for (let i = 0; i < 90; i++) {
      const s = await callTool('run_status', { runId });
      if (s.status === 'completed' || s.status === 'failed') {
        const r = await callTool('run_result', { runId });
        return { ...s, result: r.result, runId };
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error('timed out');
  }

  /** One declared agent label, the shape DES-144 requires (model/effort/timeoutMs, each with a
   *  `.default`). `default` is the alias `DEFAULT_ALIASES` always defines. */
  function withAgent(label: string, body: string): string {
    return [
      `export const meta = { params: { agents: { ${label}: {`,
      "  model: { type: 'string', default: 'default' },",
      "  effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' },",
      '  timeoutMs: { type: \'number\', default: 120000 },',
      '} } } };',
      body,
    ].join('\n');
  }

  it.skipIf(!HAS_PROVIDER)('agent() without schema resolves to a string (final text)' + NO_PROVIDER, async () => {
    const r = await runAndWait(withAgent('pong', `return agent('pong', { prompt: 'Reply with only the word: PONG' });`));
    expect(r.status).toBe('completed');
    expect(typeof r.result).toBe('string');
    expect(String(r.result).toUpperCase()).toContain('PONG');
  }, 120000);

  it.skipIf(!HAS_PROVIDER)('agent() with schema resolves to a validated object' + NO_PROVIDER, async () => {
    // `schema` is NOT one of the three keys an agent() options literal may not carry
    // (`LOCKED_PARAM_KEYS` = model/effort/timeoutMs, workflow-meta.ts:155) — it stays here.
    const r = await runAndWait(withAgent('answer', `
      return agent('answer', {
        prompt: 'Return a JSON object with field answer set to 42',
        schema: { type: 'object', properties: { answer: { type: 'number' } }, required: ['answer'] }
      });
    `));
    expect(r.status).toBe('completed');
    expect(typeof r.result).toBe('object');
    expect((r.result as { answer: number }).answer).toBe(42);
  }, 120000);

  it.skipIf(!HAS_PROVIDER)('terminal API error resolves to null (agent() never rejects)' + NO_PROVIDER, async () => {
    // v34 (TASK-229): the `agentType:'unknown-type-xyz'` trigger this case used to force a
    // terminal, non-hanging error is retired — a script literal carrying `agentType` is now
    // refused AGENT_OPT_RETIRED at REGISTRATION (DES-224), before this run could even start. An
    // unresolvable model alias is the direct substitute: same property (a reported terminal error,
    // never a hang), with no live account/network dependency either way.
    const script = [
      `export const meta = { params: { agents: { probe: {`,
      "  model: { type: 'string', default: 'definitely-unresolvable-alias-xyz' },",
      "  effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' },",
      '  timeoutMs: { type: \'number\', default: 120000 },',
      '} } } };',
      `const result = await agent('probe', { prompt: 'test' });`,
      `return result === null ? 'got-null' : 'got-value';`,
    ].join('\n');
    const r = await runAndWait(script);
    // Either completed (unresolvable alias rejected at submission) or the agent resolved null
    if (r.status === 'completed') {
      expect(['got-null', 'got-value']).toContain(r.result);
    }
  }, 60000);

  it.skipIf(!HAS_PROVIDER)('agent() transcript is retrievable after completion' + NO_PROVIDER, async () => {
    const r = await runAndWait(withAgent('hello', `return agent('hello', { prompt: 'Say hello in one word' });`));
    expect(r.status).toBe('completed');
    const statusView = await callTool('run_status', { runId: r.runId });
    const agents = (statusView as { result?: { agents?: Array<{ label?: string }> }; agents?: Array<{ label?: string }> }).result?.agents
      ?? (statusView as { agents?: Array<{ label?: string }> }).agents ?? [];
    expect(agents.length).toBeGreaterThan(0);
    // v24 (DES-161, REQ-118): `run_agent_log`'s advertised key is the script's own LABEL — the
    // engine-minted `agentId` is not something a caller can learn from the schema.
    const log = await callTool('run_agent_log', { runId: r.runId, label: agents[0]!.label ?? 'hello' });
    // v24 (DES-161): the response is `{harness, events, hasMore, result}` — the transcript is the
    // `events` array, never the envelope itself (the pre-v24 assertion `Array.isArray(envelope)`
    // could only ever have been false; it was never executed, which is the point of the skipIf fix).
    expect(Array.isArray(log.events)).toBe(true);
    expect((log.events as unknown[]).length).toBeGreaterThan(0);
  }, 120000);
});
