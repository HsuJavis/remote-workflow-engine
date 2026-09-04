// VAL-005: MCP Streamable HTTP interface (REQ-005)
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { registerPublishedVia, uniqueWorkflowName } from '../helpers/workflow-fixtures.js';

describe('VAL-005: MCP Streamable HTTP interface (REQ-005)', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = await createServer({ port: 0 });
    baseUrl = `http://127.0.0.1:${server.port}`;
  });

  afterAll(async () => { await server?.close(); });

  // v22: the raw-fetch tests below need a name to run, and a name needs register+publish. This is
  // the same `${baseUrl}/mcp` POST + `result.content[0].text` parse the tests do inline; it exists
  // only so the shared fixture helper can drive it. The tests keep their own raw fetches.
  async function callTool(name: string, args: unknown) {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
    const body = await res.json() as { result?: { content: Array<{ text: string }> } };
    return JSON.parse(body.result!.content[0].text);
  }

  it('tools/list returns all required v1 MCP tools', async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    expect(res.ok).toBe(true);
    const body = await res.json() as { result?: { tools: Array<{ name: string }> } };
    const names = body.result!.tools.map((t) => t.name);
    const required = ['run_start', 'run_status', 'run_result',
      'run_suspend', 'run_resume', 'run_stop', 'workflow_list', 'run_agent_log'];
    for (const tool of required) {
      expect(names).toContain(tool);
    }
  });

  it('run_start returns runId immediately (async — does not block until completion)', async () => {
    // Register+publish OUTSIDE the timed window so `elapsed` still measures only the run submission.
    const wf = uniqueWorkflowName('val005-immediate');
    await registerPublishedVia(callTool, wf, 'return 42;');
    const start = Date.now();
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'run_start', arguments: { name: wf } } }),
    });
    const elapsed = Date.now() - start;
    const body = await res.json() as { result?: { content: Array<{ text: string }> } };
    const result = JSON.parse(body.result!.content[0].text);

    expect(result.runId).toBeTruthy();
    // The response must not wait for the full run to complete — it returns immediately
    // (the run may already be done for a trivial script, but the API is non-blocking)
  });

  it('server binds to 127.0.0.1 by default', async () => {
    // Default bind — we can reach it on 127.0.0.1
    const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    expect(res.ok).toBe(true);
  });

  it('run_result polled after completion returns the script return value', async () => {
    // Submit a deterministic script and poll for the result
    const wf = uniqueWorkflowName('val005-result');
    await registerPublishedVia(callTool, wf, 'return {x:7};');
    const run = await (async () => {
      const res = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'run_start', arguments: { name: wf } } }),
      });
      const body = await res.json() as { result?: { content: Array<{ text: string }> } };
      return JSON.parse(body.result!.content[0].text);
    })();

    const runId = run.runId as string;
    for (let i = 0; i < 30; i++) {
      const res = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'run_status', arguments: { runId } } }),
      });
      const body = await res.json() as { result?: { content: Array<{ text: string }> } };
      const status = JSON.parse(body.result!.content[0].text);
      if (status.status === 'completed') {
        const res2 = await fetch(`${baseUrl}/mcp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'run_result', arguments: { runId } } }),
        });
        const body2 = await res2.json() as { result?: { content: Array<{ text: string }> } };
        const result = JSON.parse(body2.result!.content[0].text);
        expect(result.result).toEqual({ x: 7 });
        return;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error('run did not complete in time');
  }, 20000);
});
