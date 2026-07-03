// VAL-004: Multi-model routing via LiteLLM alias (REQ-004)
// Requires a running LiteLLM proxy configured with aliases.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

const HAS_PROVIDER = !!(process.env['LITELLM_BASE_URL'] || process.env['ANTHROPIC_API_KEY']);

describe('VAL-004: multi-model routing (REQ-004)', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    // Always attempt to start — throws "not implemented" at Gate 5.
    server = await createServer({
      port: 0,
      aliases: {
        sonnet:  { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
        haiku:   { provider: 'anthropic', model: 'claude-3-5-haiku-20241022' },
        default: { provider: 'anthropic', model: 'claude-3-5-haiku-20241022' },
      },
    });
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

  it('agent(prompt,{model:"haiku"}) routes to the haiku alias provider+model', async () => {
    if (!HAS_PROVIDER) return;
    const r = await runAndWait(`return agent('say yes', {model: 'haiku'});`);
    expect(r.status).toBe('completed');
    const statusView = await callTool('workflow_status', { runId: r.runId });
    const agents = (statusView as { agents: Array<{ provider: string; model: string }> }).agents;
    expect(agents.length).toBeGreaterThan(0);
    expect(agents[0].provider).toBe('anthropic');
    expect(agents[0].model).toBe('claude-3-5-haiku-20241022');
  }, 120000);

  it('omitting opts.model uses the default alias', async () => {
    if (!HAS_PROVIDER) return;
    const r = await runAndWait(`return agent('say yes');`);
    expect(r.status).toBe('completed');
    const statusView = await callTool('workflow_status', { runId: r.runId });
    const agents = (statusView as { agents: Array<{ model: string }> }).agents;
    expect(agents[0].model).toBe('claude-3-5-haiku-20241022');
  }, 120000);

  it('unknown alias rejected at submission with UNKNOWN_ALIAS (never mid-run)', async () => {
    if (!HAS_PROVIDER) return;
    const env = await callTool('workflow_run', { script: `return agent('x',{model:'nonexistent-alias'});` });
    expect(env.status).toBe('failed');
    expect(env.error?.code).toBe('UNKNOWN_ALIAS');
    expect(env.runId).toBe('');  // rejected before a run is created
  }, 10000);

  it('provider down: agent() resolves null, run continues (D-G breaker)', async () => {
    if (!HAS_PROVIDER) return;
    // Configure a bad-provider alias by creating a second server instance
    const badServer = await createServer({
      port: 0,
      aliases: { default: { provider: 'ollama', model: 'nonexistent:99b' } },
    });
    const badBase = `http://127.0.0.1:${badServer.port}`;
    try {
      const run = await (async () => {
        const res = await fetch(`${badBase}/mcp`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'workflow_run', arguments: { script: `const r = await agent('x'); return r === null ? 'null-ok' : 'unexpected';` } } }),
        });
        const body = await res.json() as { result?: { content: Array<{ text: string }> } };
        return JSON.parse(body.result!.content[0].text);
      })();
      const runId = run.runId as string;
      for (let i = 0; i < 60; i++) {
        const res = await fetch(`${badBase}/mcp`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'workflow_status', arguments: { runId } } }),
        });
        const body = await res.json() as { result?: { content: Array<{ text: string }> } };
        const s = JSON.parse(body.result!.content[0].text);
        if (s.status === 'completed') {
          const r2 = await fetch(`${badBase}/mcp`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'workflow_result', arguments: { runId } } }),
          });
          const rb = await r2.json() as { result?: { content: Array<{ text: string }> } };
          const result = JSON.parse(rb.result!.content[0].text);
          expect(result.result).toBe('null-ok');
          return;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
      throw new Error('timed out');
    } finally {
      await badServer.close();
    }
  }, 120000);
});
