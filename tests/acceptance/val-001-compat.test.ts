// VAL-001: Workflow JS executes unmodified; return value deep-equals (REQ-001)
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

describe('VAL-001: 100% workflow JS API compatibility (REQ-001)', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = await createServer({ port: 0 });
    baseUrl = `http://127.0.0.1:${server.port}`;
  });

  afterAll(async () => { await server?.close(); });

  async function runAndWait(script: string, args?: unknown) {
    const run = await callTool('workflow_run', { script, args });
    const runId = run.runId as string;
    for (let i = 0; i < 50; i++) {
      const s = await callTool('workflow_status', { runId });
      if (s.status === 'completed' || s.status === 'failed') {
        const r = await callTool('workflow_result', { runId });
        return { status: s.status as string, result: r.result, error: r.error };
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error('run timed out');
  }

  async function callTool(name: string, args: unknown) {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
    const body = await res.json() as { result?: { content: Array<{ text: string }> } };
    return JSON.parse(body.result!.content[0].text);
  }

  it('basic return value deep-equals script return', async () => {
    const r = await runAndWait(`return {answer: 42, tags: ['a','b']};`);
    expect(r.status).toBe('completed');
    expect(r.result).toEqual({ answer: 42, tags: ['a', 'b'] });
  }, 20000);

  it('args are accessible and reflected in the return value', async () => {
    const r = await runAndWait(`return args.name + ' says hi';`, { name: 'world' });
    expect(r.result).toBe('world says hi');
  }, 20000);

  it('Date.now() inside script throws (determinism guard)', async () => {
    const r = await runAndWait(`Date.now(); return 1;`);
    expect(r.status).toBe('failed');
    expect(JSON.stringify(r.error)).toMatch(/DETERMINISM_GUARD|Date\.now/i);
  }, 20000);

  it('Math.random() inside script throws (determinism guard)', async () => {
    const r = await runAndWait(`Math.random(); return 1;`);
    expect(r.status).toBe('failed');
    expect(JSON.stringify(r.error)).toMatch(/DETERMINISM_GUARD|Math\.random/i);
  }, 20000);

  it('pipeline(): throwing stage resolves that item to null, others complete', async () => {
    const script = `
      const stage = async (prev, item) => { if (item === 'bad') throw new Error('oops'); return 'ok:' + item; };
      return pipeline(['good', 'bad', 'also-good'], stage);
    `;
    const r = await runAndWait(script);
    expect(r.status).toBe('completed');
    expect(r.result).toEqual(['ok:good', null, 'ok:also-good']);
  }, 20000);

  it('parallel(): throwing thunk resolves that slot to null, others complete', async () => {
    // Uses only script-level logic (no real agent calls needed)
    const script = `
      return parallel([
        async () => 'ok-1',
        async () => { throw new Error('fail'); },
        async () => 'ok-3',
      ]);
    `;
    const r = await runAndWait(script);
    expect(r.status).toBe('completed');
    expect(r.result).toEqual(['ok-1', null, 'ok-3']);
  }, 20000);

  it('phase() calls are recorded in run status', async () => {
    const run = await callTool('workflow_run', { script: `phase('init'); phase('process'); return 'done';` });
    const runId = run.runId as string;
    for (let i = 0; i < 30; i++) {
      const s = await callTool('workflow_status', { runId });
      if (s.status === 'completed') {
        const phases = (s.result.phases as Array<{ title: string }>).map((p) => p.title);
        expect(phases).toContain('init');
        expect(phases).toContain('process');
        return;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error('timed out');
  }, 20000);
});
