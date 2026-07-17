// VAL-007: Per-agent observability via MCP tools (REQ-007)
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

const HAS_PROVIDER = !!(process.env['ANTHROPIC_API_KEY'] || process.env['OLLAMA_BASE_URL']);

describe('VAL-007: per-agent observability (REQ-007)', () => {
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

  async function runAndWait(script: string) {
    const run = await callTool('workflow_run', { script });
    const runId = run.runId as string;
    for (let i = 0; i < 90; i++) {
      const s = await callTool('workflow_status', { runId });
      if (s.status === 'completed' || s.status === 'failed') return { ...s, runId };
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error('timed out');
  }

  it('workflow_status for a completed run includes per-agent entries with required fields', async () => {
    if (!HAS_PROVIDER) return;
    const r = await runAndWait(`
      phase('analyze');
      const result = await agent('say one word: hello', { label: 'greeter' });
      return result;
    `);
    expect(r.status).toBe('completed');
    const agents = (r as { agents: Array<{ agentId: string; label: string; state: string; provider: string; model: string; tokens: { input: number; output: number } }> }).agents;
    expect(agents.length).toBeGreaterThan(0);
    const agent = agents[0];
    expect(typeof agent.agentId).toBe('string');
    expect(agent.label).toBe('greeter');
    expect(agent.state).toBe('done');
    expect(typeof agent.provider).toBe('string');
    expect(typeof agent.model).toBe('string');
    expect(typeof agent.tokens.input).toBe('number');
    expect(typeof agent.tokens.output).toBe('number');
  }, 120000);

  it('workflow_agent_log returns the full transcript of a completed agent', async () => {
    if (!HAS_PROVIDER) return;
    const r = await runAndWait(`return agent('Say exactly: OK');`);
    const statusView = await callTool('workflow_status', { runId: r.runId });
    const agentId = (statusView as { agents: Array<{ agentId: string }> }).agents[0].agentId;

    const transcript = await callTool('workflow_agent_log', { runId: r.runId, agentId });
    expect(Array.isArray(transcript)).toBe(true);
    expect((transcript as unknown[]).length).toBeGreaterThan(0);
    // Each entry should have ts, kind, data
    const entry = (transcript as Array<{ ts: string; kind: string; data: unknown }>)[0];
    expect(typeof entry.ts).toBe('string');
    expect(['message', 'tool_call', 'tool_result', 'usage']).toContain(entry.kind);
  }, 120000);

  it('phases appear in workflow_status with their titles', async () => {
    // This test does not require a real LLM — phases are tracked without agent calls
    const localServer = await createServer({ port: 0 });
    const localBase = `http://127.0.0.1:${localServer.port}`;
    try {
      const run = await (async () => {
        const res = await fetch(`${localBase}/mcp`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'workflow_run', arguments: { script: `phase('alpha'); phase('beta'); return 'done';` } } }),
        });
        const body = await res.json() as { result?: { content: Array<{ text: string }> } };
        return JSON.parse(body.result!.content[0].text);
      })();
      const runId = run.runId as string;
      for (let i = 0; i < 30; i++) {
        const res = await fetch(`${localBase}/mcp`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'workflow_status', arguments: { runId } } }),
        });
        const body = await res.json() as { result?: { content: Array<{ text: string }> } };
        const s = JSON.parse(body.result!.content[0].text);
        if (s.status === 'completed') {
          const phases = (s.result.phases as Array<{ title: string }>).map((p) => p.title);
          expect(phases).toContain('alpha');
          expect(phases).toContain('beta');
          return;
        }
        await new Promise((r) => setTimeout(r, 200));
      }
      throw new Error('timed out');
    } finally {
      await localServer.close();
    }
  }, 20000);
});
