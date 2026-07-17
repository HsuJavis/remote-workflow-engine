// VAL-014: Named workflow registry (save, list, invoke by name; workflow(name) compat) (REQ-014)
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

describe('VAL-014: named workflow registry (REQ-014)', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
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

  async function runAndWait(name: string, args?: unknown) {
    const run = await callTool('workflow_run', { name, args });
    if (run.status === 'failed') return run;
    const runId = run.runId as string;
    for (let i = 0; i < 30; i++) {
      const s = await callTool('workflow_status', { runId });
      if (s.status === 'completed' || s.status === 'failed') {
        const r = await callTool('workflow_result', { runId });
        return { ...s, result: r.result, runId };
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error('timed out');
  }

  it('workflow_register registers a workflow visible in workflow_list', async () => {
    await callTool('workflow_register', { name: 'val014-a', script: `return 'registered';` });
    const list = (await callTool('workflow_list', {})).result;
    const found = (list as Array<{ name: string }>).some((w) => w.name === 'val014-a');
    expect(found).toBe(true);
  });

  it('workflow_run by name executes the registered script', async () => {
    await callTool('workflow_register', { name: 'val014-run', script: `return args.x * 3;` });
    const r = await runAndWait('val014-run', { x: 7 });
    expect(r.status).toBe('completed');
    expect(r.result).toBe(21);
  }, 15000);

  it('workflow(name) inside a script invokes the registered child inline', async () => {
    await callTool('workflow_register', { name: 'child-inline', script: `return args.n + 100;` });
    const r = await runAndWait('', undefined).catch(() => null);  // placeholder

    const run = await callTool('workflow_run', {
      script: `return workflow('child-inline', {n: args.base});`,
      args: { base: 5 },
    });
    const runId = run.runId as string;
    for (let i = 0; i < 30; i++) {
      const s = await callTool('workflow_status', { runId });
      if (s.status === 'completed') {
        const res = await callTool('workflow_result', { runId });
        expect(res.result).toBe(105);
        return;
      }
      if (s.status === 'failed') throw new Error('run failed unexpectedly');
      await new Promise((rv) => setTimeout(rv, 200));
    }
    throw new Error('timed out');
  }, 20000);

  it('workflow(unknownName) throws a catchable error naming the missing workflow', async () => {
    const run = await callTool('workflow_run', {
      script: `
        try {
          return await workflow('definitely-does-not-exist-xyz', {});
        } catch(e) {
          // C-2: guards.ts's makeWorkflow now PRESERVES the delegate failure's own code
          // (CatalogNotFoundError here), not a flat NESTING_ERROR, and keeps the original .message —
          // REQ-014's "naming the missing workflow" lives in .message.
          return 'caught: ' + e.message + ' code=' + (e.name || e.code);
        }
      `,
    });
    const runId = run.runId as string;
    for (let i = 0; i < 30; i++) {
      const s = await callTool('workflow_status', { runId });
      if (s.status === 'completed') {
        const res = await callTool('workflow_result', { runId });
        expect(String(res.result)).toMatch(/caught:/);
        expect(String(res.result)).toMatch(/definitely-does-not-exist-xyz/);
        // C-2: the preserved code, not a flat NESTING_ERROR.
        expect(String(res.result)).toMatch(/code=CatalogNotFoundError/);
        return;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error('timed out');
  }, 20000);

  it('updating a registered workflow: new runs use new script version', async () => {
    await callTool('workflow_register', { name: 'val014-ver', script: `return 'version-one';` });
    const run1 = await runAndWait('val014-ver');
    expect(run1.result).toBe('version-one');

    await callTool('workflow_register', { name: 'val014-ver', script: `return 'version-two';` });
    const run2 = await runAndWait('val014-ver');
    expect(run2.result).toBe('version-two');
  }, 30000);
});
