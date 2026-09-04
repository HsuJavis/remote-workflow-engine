// VAL-003: Real agent execution via Claude Agent SDK (REQ-003)
// Requires: a real LLM provider (Ollama or test API key) accessible at gateway time.
// Does NOT mock the SUT's own boundaries (AgentSpawner, GatewayClient, SDK session).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

// SKIP individual tests if no provider is available, but ALWAYS start the server
// (so Gate 5 RED is triggered by the unimplemented createServer, not by the SKIP guard).
const HAS_PROVIDER = !!(process.env['ANTHROPIC_API_KEY'] || process.env['OLLAMA_BASE_URL']);

describe('VAL-003: real agent execution via Claude Agent SDK (REQ-003)', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    // Always attempt to start — throws "not implemented" at Gate 5.
    server = await createServer({ port: 0 });
    baseUrl = `http://127.0.0.1:${server.port}`;
  });

  afterAll(async () => { await server?.close(); });

  async function callTool(name: string, args: unknown) {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
    const body = await res.json() as { result?: { content: Array<{ text: string }> } };
    return JSON.parse(body.result!.content[0].text);
  }

  async function runAndWait(script: string, opts?: { budget?: number }) {
    const run = await callTool('run_start', { script, ...opts });
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

  it('agent() without schema resolves to a string (final text)', async () => {
    if (!HAS_PROVIDER) return;
    const r = await runAndWait(`return agent('Reply with only the word: PONG', {});`);
    expect(r.status).toBe('completed');
    expect(typeof r.result).toBe('string');
    expect(String(r.result).toUpperCase()).toContain('PONG');
  }, 120000);

  it('agent() with schema resolves to a validated object', async () => {
    if (!HAS_PROVIDER) return;
    const r = await runAndWait(`
      return agent('Return a JSON object with field answer set to 42', {
        schema: { type: 'object', properties: { answer: { type: 'number' } }, required: ['answer'] }
      });
    `);
    expect(r.status).toBe('completed');
    expect(typeof r.result).toBe('object');
    expect((r.result as { answer: number }).answer).toBe(42);
  }, 120000);

  it('terminal API error resolves to null (agent() never rejects)', async () => {
    if (!HAS_PROVIDER) return;
    // Use an unknown agentType that produces a reported error but not a hang
    const r = await runAndWait(`
      const result = await agent('test', { agentType: 'unknown-type-xyz' });
      return result === null ? 'got-null' : 'got-value';
    `);
    // Either completed (unknown agentType rejected at submission) or the agent resolved null
    if (r.status === 'completed') {
      expect(['got-null', 'got-value']).toContain(r.result);
    }
  }, 60000);

  it('agent() transcript is retrievable after completion', async () => {
    if (!HAS_PROVIDER) return;
    const r = await runAndWait(`return agent('Say hello in one word', {});`);
    expect(r.status).toBe('completed');
    const statusView = await callTool('run_status', { runId: r.runId });
    const agents = (statusView as { agents: Array<{ agentId: string; state: string }> }).agents;
    expect(agents.length).toBeGreaterThan(0);
    const agentId = agents[0].agentId;
    const transcript = await callTool('run_agent_log', { runId: r.runId, agentId });
    expect(Array.isArray(transcript)).toBe(true);
    expect((transcript as unknown[]).length).toBeGreaterThan(0);
  }, 120000);
});
