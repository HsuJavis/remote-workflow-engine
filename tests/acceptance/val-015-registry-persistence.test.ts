// VAL-015: named workflow registry survives a real server restart (REQ-014, D-V2 — user-confirmed).
// Mirrors val-006-lifecycle.test.ts's "same workRoot, fresh createServer()" restart pattern.
// No mock of the SUT's own boundaries: real HTTP server, real MCP tool calls, real on-disk store.
//
// Red reason (2026-07-03, before Gate 6 rework): WorkflowCatalog is in-memory only (confirmed at
// Gate 7.5 real-run via genuine `pkill` + fresh `npm run start` — see 08-validation.md VAL-014) —
// a fresh server instance on the same workRoot has an empty catalog, so workflow_list omits the
// registered workflow and run_start(name) fails with UNKNOWN_WORKFLOW.
import { describe, it, expect, afterAll } from 'vitest';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { registerPublishedVia } from '../helpers/workflow-fixtures.js';

describe('VAL-015: named workflow registry survives server restart (REQ-014, D-V2)', () => {
  let server: Server;
  let baseUrl: string;

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

  async function runAndWait(name: string) {
    const run = await callTool('run_start', { name });
    if (run.status === 'failed') return run;
    const runId = run.runId as string;
    for (let i = 0; i < 30; i++) {
      const s = await callTool('run_status', { runId });
      if (s.status === 'completed' || s.status === 'failed') {
        const r = await callTool('run_result', { runId });
        return { ...s, result: r.result, runId };
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error('timed out');
  }

  it('registered workflow survives restart: workflow_list shows it and run_start(name) still works', async () => {
    server = await createServer({ port: 0 });
    baseUrl = `http://127.0.0.1:${server.port}`;

    // v22: run-by-name resolves the `release` channel, so the fixture registers AND publishes —
    // the restart assertion below now covers the channel pointer surviving too.
    await registerPublishedVia(callTool, 'val015-persist', `return 'still-here';`);
    const workRoot = server.workRoot;
    await server.close();

    // Restart: fresh server + fresh McpFacade/RunManager/WorkflowCatalog instance, same on-disk workRoot.
    server = await createServer({ port: 0, workRoot });
    baseUrl = `http://127.0.0.1:${server.port}`;

    const list = (await callTool('workflow_list', {})).result as Array<{ name?: string }>;
    expect(list.some((w) => w.name === 'val015-persist')).toBe(true);

    const run = await runAndWait('val015-persist');
    expect(run.status).toBe('completed');
    expect(run.result).toBe('still-here');
  }, 30000);
});
